use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Decl, SymbolId};
use bun_sema::hir::{ExprId, ExprKind, ImportId, MemberKey};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::program::{FileId, Sym};
use rustc_hash::FxHashMap;

use crate::builtins::id::{BuiltinId, BuiltinName};
use crate::builtins::{BuiltinPath, Mutability, Resolved, table};
use crate::ir::generated::{BlockFrequency, ImportPhase, ModuleKind};
use crate::ir::{
    BlockId, Edge, ModuleId, PropertyKeyId, StringId, TypeTable, ValueId, VariableKey,
};
use crate::lower::member::PropertyName;
use crate::lower::scope::BindingRef;
use crate::lower::{FileLowering, FunctionLowering, commonjs};
use crate::modules::{
    ExportBinding, ImportBinding, ModuleExport, ModuleGraph, ModuleRef, Shape, SiteAnswer,
    SyntheticExport, SyntheticExportId, View,
};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn get_import(&mut self, symbol: SymbolId) -> ValueId {
        if let Some(constant) = self.file.find_data_variable_read(symbol) {
            return self.emit_constant(constant);
        }
        let file = &mut *self.file;
        let binding = file.inputs.modules.import_binding(file.file, symbol);
        if let ImportBinding::BuiltinMember { .. } = binding {
            let path = file.builtins.of_symbol(symbol);
            let value = match self.scopes.find_local(BindingRef::Symbol(symbol)) {
                Some(local) => self.builder.read_variable(local.variable),
                None => {
                    let variable = file.ensure_variable(file.imported_copy_key(symbol));
                    self.builder.get_module_variable(variable)
                }
            };
            return match path.map(|path| (path.id, path.mutability)) {
                Some((id, Mutability::AlwaysLocked | Mutability::ConstantUnlessWritten)) => {
                    self.expect_builtin(value, table::canonical_id(id))
                }
                Some((_, Mutability::ChangesOnItsOwn)) | None => value,
            };
        }
        let local_name = file.bound.symbol(symbol).name;
        let name = file.intern_binding_name(Binding::Symbol(symbol), local_name);
        let path = file.builtins.of_symbol(symbol);
        let asked = find_what_statement_asks(file, symbol);
        emit_import_binding_asked(self, binding, name, path, asked)
    }

    /// `import { a } from "bun"` runs as `var { a } = Bun` where the statement stands.
    pub(crate) fn lower_import(&mut self, import: ImportId) {
        let named = self.file.hir[import].named.iter().map(Decl::ImportSpec);
        let whole = [Decl::ImportNamespace(import), Decl::ImportDefault(import)];
        for declaration in whole.into_iter().chain(named) {
            let symbol = self.file.bound.declared_symbol(declaration);
            if symbol.is_none() {
                continue;
            }
            let key = self.file.imported_copy_key(symbol);
            let modules = self.file.inputs.modules;
            let value = match modules.import_binding(self.file.file, symbol) {
                ImportBinding::BuiltinMember { holder, name } => {
                    let object = self.builder.builtin(holder, false);
                    self.emit_named_read(object, name)
                }
                ImportBinding::Builtin(object) if self.file.is_exported_variable(key) => {
                    self.emit_builtin_import(object, None)
                }
                // A link reads every name that the statement imports from the object of a built-in module, whether or not anything uses the name. It shows where the object lists a member from its first read on.
                ImportBinding::CapturedBuiltin { member, export }
                    if table::entry(member).is_added_at_first_read =>
                {
                    let variable = self
                        .file
                        .ensure_variable(VariableKey::SyntheticExport(export));
                    self.builder.get_module_variable(variable);
                    continue;
                }
                ImportBinding::Builtin(member) if table::entry(member).is_added_at_first_read => {
                    self.emit_export_read(member);
                    continue;
                }
                _ => continue,
            };
            if let Some(local) = self.scopes.find_local(BindingRef::Symbol(symbol)) {
                self.builder.write_variable(local.variable, value);
                continue;
            }
            let variable = self.file.ensure_variable(key);
            self.builder.put_module_variable(variable, value);
        }
    }

    pub(crate) fn emit_variable_read(&mut self, key: VariableKey, name: StringId) -> ValueId {
        let variable = self.file.ensure_variable(key);
        let value = self.builder.get_module_variable(variable);
        self.builder.check_initialized(value, name)
    }

    // A name of a library module is a variable that the loader fills. `Err`: the value itself.
    fn find_synthetic_variable(
        &mut self,
        export: SyntheticExportId,
    ) -> Result<VariableKey, ValueId> {
        let modules = self.file.inputs.modules;
        let synthetic = *modules.synthetic_export(export);
        match modules.shape(synthetic.module) {
            Shape::AsToday | Shape::EsModule => return Ok(VariableKey::SyntheticExport(export)),
            Shape::Names | Shape::Value => {}
        }
        if modules.settled(synthetic.module, synthetic.name)
            && let Some(value) = self.read_imported_name(synthetic.module, synthetic.name)
        {
            return Err(value);
        }
        Ok(VariableKey::Copy(export))
    }

    fn emit_synthetic_read(&mut self, export: SyntheticExportId, name: StringId) -> ValueId {
        let may_stay_empty = self.file.inputs.modules.commonjs().may_stay_empty(export);
        match self.find_synthetic_variable(export) {
            Ok(key) if may_stay_empty => self.emit_read_of_copy_that_may_stay_empty(key),
            Ok(key) => self.emit_variable_read(key, name),
            Err(value) => value,
        }
    }

    // `import { A } from "./a.cjs"; export { A }` in a TypeScript module that is linked without the export where the file lacks the name: `A` reads as `undefined` there.
    fn emit_read_of_copy_that_may_stay_empty(&mut self, key: VariableKey) -> ValueId {
        let variable = self.file.ensure_variable(key);
        let value = self.builder.get_module_variable(variable);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(value, TypeTable::ABSENT);
        self.builder
            .set_frequency(split.taken, BlockFrequency::Unlikely);
        self.builder.switch_to(split.taken);
        let undefined = self.builder.undefined();
        self.builder.write_variable(result, undefined);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        self.builder.write_variable(result, split.not_taken_value);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    // Another module imports the name, so its variable stays empty where the module turns out to lack the name. The namespace object knows what `ns.x` finds then.
    fn emit_synthetic_member_read(&mut self, export: SyntheticExportId, access: ExprId) -> ValueId {
        let key = match self.find_synthetic_variable(export) {
            Ok(key) => key,
            Err(value) => return value,
        };
        let variable = self.file.ensure_variable(key);
        let value = self.builder.get_module_variable(variable);
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let split = self.split_on_type(value, TypeTable::ABSENT);
        self.builder
            .set_frequency(split.taken, BlockFrequency::Unlikely);
        self.builder.switch_to(split.taken);
        let found = match self.file.hir.member_key(access) {
            Some((object, MemberKey::Name(name))) => {
                let namespace = self.lower_namespace_receiver(object);
                self.emit_named_read(namespace, name)
            }
            _ => self.builder.undefined(),
        };
        self.builder.write_variable(result, found);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        self.builder.write_variable(result, split.not_taken_value);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    // ES modules see a CommonJS file through its face.
    fn emit_module_namespace(&mut self, module: ModuleRef, phase: ImportPhase) -> ValueId {
        let mocked = match module {
            ModuleRef::File(file) if phase == ImportPhase::Evaluation => {
                Some(file).filter(|&file| holds_mock_in_variable(self.file.inputs.modules, file))
            }
            _ => None,
        };
        let module = self.file.inputs.modules.face(module).unwrap_or(module);
        let module = self.file.fragment.declare_module(module);
        let Some(mocked) = mocked else {
            return self.builder.module_namespace(module, phase, false, false);
        };
        // `bun test` leaves a module that has run as it is where `vi.doMock()` names it. Whoever was linked to it before keeps its object; whoever comes behind gets the object of the mock.
        let importer = self.file.module_id();
        self.emit_namespace_behind_mock(mocked, module, Some(importer))
    }

    /// `require("./m.mjs").name`: the module is asked for by name.
    pub(crate) fn emit_namespace_asked_by_name(&mut self, module: ModuleRef) -> ValueId {
        let mocked = match module {
            ModuleRef::File(file) => {
                Some(file).filter(|&file| holds_mock_in_variable(self.file.inputs.modules, file))
            }
            _ => None,
        };
        let module = self.file.fragment.declare_module(module);
        match mocked {
            Some(mocked) => self.emit_namespace_behind_mock(mocked, module, None),
            None => (self.builder).module_namespace(module, ImportPhase::Evaluation, false, false),
        }
    }

    /// `importer`: whose link decides. Without one what stands now answers.
    fn emit_namespace_behind_mock(
        &mut self,
        mocked: FileId,
        module: ModuleId,
        importer: Option<ModuleId>,
    ) -> ValueId {
        let phase = ImportPhase::Evaluation;
        let result = self.builder.create_variable(None);
        let join = self.create_block();
        let variable = self.file.ensure_variable(VariableKey::MockOf(mocked));
        let mock = self.builder.get_module_variable(variable);
        let split = self.split_on_type(mock, TypeTable::ABSENT);
        (self.builder).set_frequency(split.not_taken, BlockFrequency::Unlikely);
        self.builder.switch_to(split.taken);
        let object = self.builder.module_namespace(module, phase, false, false);
        self.builder.write_variable(result, object);
        self.jump(join);
        self.builder.switch_to(split.not_taken);
        if let Some(importer) = importer {
            let target = (self.file.fragment).declare_module(ModuleRef::File(mocked));
            let sees_mock = self.builder.sees_mock_of(target, importer);
            let (of_mock, own) = (self.create_block(), self.create_block());
            (self.builder).branch(sees_mock, Edge::to(of_mock), Edge::to(own));
            self.continue_in(own);
            let object = self.builder.module_namespace(module, phase, true, false);
            self.builder.write_variable(result, object);
            self.jump(join);
            self.continue_in(of_mock);
        }
        let object = self.builder.module_namespace(module, phase, false, true);
        self.builder.write_variable(result, object);
        self.jump(join);
        self.continue_in(join);
        self.builder.read_variable(result)
    }

    pub(crate) fn emit_named_read(&mut self, object: ValueId, name: Atom) -> ValueId {
        let key = self.file.name_key(name);
        self.emit_get(object, PropertyName::Constant(key))
    }

    pub(super) fn emit_builtin_import(
        &mut self,
        id: BuiltinId,
        path: Option<BuiltinPath>,
    ) -> ValueId {
        match path.map(|path| (path.id, path.mutability)) {
            Some((locked, Mutability::AlwaysLocked))
                if table::is_legal_builtin_constant(locked) =>
            {
                self.builder.builtin(locked, false)
            }
            // A locked property that holds a function of the host, which has no entry of its own: `import { wrap } from "node:module"`.
            Some((_, Mutability::AlwaysLocked | Mutability::ChangesOnItsOwn)) => {
                self.emit_export_read(id)
            }
            Some((_, Mutability::ConstantUnlessWritten)) | None => {
                let value = self.emit_export_read(id);
                self.expect_builtin(value, table::canonical_id(id))
            }
        }
    }

    fn emit_export_read(&mut self, id: BuiltinId) -> ValueId {
        let entry = table::entry(id);
        match (entry.module, entry.holder) {
            (None, Some(holder)) => {
                let object = self.builder.builtin(holder, false);
                let key = self.file.text_key_of_name(entry.name);
                self.builder.prop_get(object, key, false, false)
            }
            (Some(_), Some(_) | None) | (None, None) => self.builder.builtin(id, false),
        }
    }

    // A module that is not in the program has no object.
    pub(crate) fn lower_namespace_receiver(&mut self, object: ExprId) -> ValueId {
        let file = &*self.file;
        let name = file.hir.skip_type_assertions(object);
        let binding = match file.bound.binding(name) {
            Binding::Symbol(symbol) if matches!(file.hir[name].kind, ExprKind::Ident(_)) => {
                file.inputs.modules.import_binding(file.file, symbol)
            }
            // `require("./m.mjs").inner` where m.mjs has `export * as inner from ..`.
            _ => (file.inputs.modules.member_binding(file.file, name))
                .filter(|binding| matches!(binding, ImportBinding::Namespace { .. }))
                .unwrap_or(ImportBinding::Local),
        };
        let is_member = !matches!(file.hir[name].kind, ExprKind::Ident(_));
        match binding {
            ImportBinding::Namespace { module, .. } if file.inputs.modules.is_left_out(module) => {
                self.builder.undefined()
            }
            // The read of the member below it has evaluated what stands in front.
            ImportBinding::Namespace { module, phase } if is_member => {
                self.emit_module_namespace(module, phase)
            }
            // `const a = require("./m.mjs")`: `a` stands for what `import * as a` stands for, and so does the call itself in `require("./m.mjs").f()`, which the read of the member has evaluated.
            _ => match file.find_view(name) {
                Some(View::Namespace(module)) => {
                    self.emit_module_namespace(module, ImportPhase::Evaluation)
                }
                Some(View::Exports(_)) | None => self.lower_expression(object),
            },
        }
    }

    pub(crate) fn lower_namespace_member(&mut self, access: ExprId) -> Option<ValueId> {
        let file = &mut *self.file;
        let binding = file.inputs.modules.member_binding(file.file, access)?;
        let asked = match file.hir.member_key(access) {
            Some((object, MemberKey::Name(name))) => {
                let object = file.hir.skip_type_assertions(object);
                match file.bound.binding(object) {
                    Binding::Symbol(symbol)
                        if matches!(file.hir[object].kind, ExprKind::Ident(_)) =>
                    {
                        match file.inputs.modules.import_binding(file.file, symbol) {
                            ImportBinding::Namespace {
                                module: ModuleRef::File(module),
                                ..
                            } => Some((module, name)),
                            _ => None,
                        }
                    }
                    _ => None,
                }
            }
            _ => None,
        };
        let name = match file.hir.member_key(access) {
            Some((_, MemberKey::Name(name))) => file.intern_atom(name),
            Some((_, MemberKey::PrivateName(_) | MemberKey::Computed(_))) | None => {
                debug_assert!(
                    false,
                    "module binding binds member accesses with a constant name"
                );
                return None;
            }
        };
        let path = match file.builtins.of_expr(access) {
            Some(Resolved::Builtin(path)) => Some(path),
            Some(Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_)) | None => None,
        };
        let position = file.hir[access].pos;
        // Whoever reads `a.c` has read `a` first, which throws in the dead zone of `a`: before `const a = require(..)` has run.
        self.check_member_root(access);
        self.record_read_from_object(access);
        self.set_position(position);
        let modules = self.file.inputs.modules;
        if let ImportBinding::Synthetic(export) = binding
            && !modules.synthetic_export(export).is_known_member
        {
            let read = ReadWithoutMock::SyntheticMember { export, access };
            return Some(emit_behind_mocks(self, binding, None, read));
        }
        Some(emit_import_binding_asked(self, binding, name, path, asked))
    }
}

/// `VariableKey::MockOf`. A module of Bun's own code is mocked by its name, not as a file.
pub(super) fn holds_mock_in_variable(modules: &ModuleGraph, file: FileId) -> bool {
    modules.holds_mock_in_variable(file)
}

/// The module that the import statement of `symbol` names, and the name that it asks of the module.
fn find_what_statement_asks(
    file: &FileLowering<'_, '_, '_, '_>,
    symbol: SymbolId,
) -> Option<(FileId, Atom)> {
    let (import, name) = match *file.bound.symbol(symbol).decls {
        [Decl::ImportSpec(specifier)] => (file.hir[specifier].import, file.hir[specifier].imported),
        [Decl::ImportDefault(import)] => (import, known::default),
        _ => return None,
    };
    let site = ImportSiteKind::Import(import);
    match file.inputs.modules.find_site_answer(file.file, site)? {
        SiteAnswer::Module(ModuleRef::File(module)) => Some((module, name)),
        _ => None,
    }
}

/// Where nothing says what was asked: the file that `binding` leads to, and the name of it there.
fn find_what_binding_leads_to(
    modules: &ModuleGraph,
    binding: ImportBinding,
) -> Option<(FileId, Atom)> {
    match binding {
        ImportBinding::Variable(symbol) => {
            let is_symbol = |it: &&ModuleExport| it.binding == ExportBinding::Variable(symbol);
            Some((
                symbol.file,
                modules.exports(symbol.file).iter().find(is_symbol)?.name,
            ))
        }
        ImportBinding::Synthetic(export) => match *modules.synthetic_export(export) {
            SyntheticExport {
                module: ModuleRef::File(file),
                name,
                ..
            } => Some((file, name)),
            _ => None,
        },
        ImportBinding::Exports {
            module: ModuleRef::File(file),
        } => Some((file, known::default)),
        ImportBinding::NamespaceRead {
            module: ModuleRef::File(file),
            name,
        } => Some((file, name)),
        _ => None,
    }
}

/// A module of Bun's own that a mock names, where `binding` is a name of it. Bun's own code never sees a mock.
fn find_runtime_module_that_may_be_mocked(
    file: &FileLowering<'_, '_, '_, '_>,
    binding: ImportBinding,
) -> Option<(VariableKey, Atom)> {
    let modules = file.inputs.modules;
    let ImportBinding::Synthetic(export) = binding else {
        return None;
    };
    let SyntheticExport {
        module: ModuleRef::Runtime(module),
        name,
        ..
    } = *modules.synthetic_export(export)
    else {
        return None;
    };
    let is_code_of_bun =
        modules.kind(file.file) == ModuleKind::RuntimeSource || modules.is_library(file.file);
    (!is_code_of_bun && modules.is_named_by_mock(ModuleRef::Runtime(module)))
        .then_some((VariableKey::MockOfRuntimeModule(module), name))
}

/// How the question for a name has come to a file.
#[derive(Copy, Clone, PartialEq, Eq)]
enum AskedBy {
    /// The import statement names the file. What its mock makes of a name that the factory left out is the mock's to say.
    Statement,
    /// `export { a as b } from "./c"`: the name is an export of the file that hands it on, whatever the mock has: undefined where the mock lacks it.
    Name,
    /// `export *` hands on what the mock has. For a name that it lacks the next star of the file is asked.
    Star,
}

#[derive(Copy, Clone)]
enum Step {
    /// A file that a mock may stand in place of, with the name that it is asked for there. `behind`: the first step that does not lie below the file.
    Station {
        file: FileId,
        name: Atom,
        asked_by: AskedBy,
        /// The file on the way that names this one. None: the file that reads.
        asked_from: Option<FileId>,
        behind: usize,
    },
    /// What declares the name is reached, and no mock stands on the way.
    Declaration,
}

/// The way from a name that is asked of a file to what declares it, in the order in which the loader looks: `export { a as b } from "./c"` hands the question on
/// under another name, `export *` under the same, and of several stars the first that has the name answers.
struct WayToDeclaration<'a> {
    modules: &'a ModuleGraph,
    asking_file: Option<FileId>,
    steps: Vec<Step>,
    path: Vec<FileId>,
    /// What a star heard that asked a file for a name, and the step of the innermost station that it stood below. Stars meet again behind a fork: whoever reaches
    /// the steps of the second one has been through those of the first, and none of them answered. That holds below the same station alone: a mock that lacks the
    /// name sends the run past what lies below it. What a station itself shows goes by who asks it, so each asks. And an answer that was made while the way came
    /// round in a ring holds for that way alone.
    answers_to_stars: FxHashMap<(FileId, Atom), (bool, Option<usize>)>,
    rings_met: usize,
    stations_on_path: Vec<usize>,
}

impl WayToDeclaration<'_> {
    /// Whether the name is found below the file whichever mocks stand.
    fn ask(&mut self, file: FileId, name: Atom, asked_by: AskedBy) -> bool {
        if self.path.contains(&file) {
            self.rings_met += 1;
            return false;
        }
        let is_station =
            Some(file) != self.asking_file && holds_mock_in_variable(self.modules, file);
        let is_kept = asked_by == AskedBy::Star && !is_station;
        if is_kept
            && let Some(&(answer, below)) = self.answers_to_stars.get(&(file, name))
            && below.is_none_or(|station| self.stations_on_path.contains(&station))
        {
            return answer;
        }
        let rings_met = self.rings_met;
        let below = self.stations_on_path.last().copied();
        let asked_from = self.path.last().copied();
        self.path.push(file);
        let station = self.steps.len();
        if is_station {
            self.stations_on_path.push(station);
            self.steps.push(Step::Station {
                file,
                name,
                asked_by,
                asked_from,
                behind: 0,
            });
        }
        let is_found = self.ask_exports(file, name);
        let end = self.steps.len();
        if is_station {
            self.stations_on_path.pop();
        }
        if is_station && let Some(Step::Station { behind, .. }) = self.steps.get_mut(station) {
            *behind = end;
        }
        self.path.pop();
        if is_kept && rings_met == self.rings_met {
            self.answers_to_stars
                .insert((file, name), (is_found, below));
        }
        is_found && !(is_station && asked_by == AskedBy::Star)
    }

    fn ask_exports(&mut self, file: FileId, name: Atom) -> bool {
        let modules = self.modules;
        // The table names the variable, and lists what somebody reads off the object of the file. The statement names the next file on the way.
        if let Some((ModuleRef::File(next), name)) = modules.find_what_hands_on_names(file, name) {
            return self.ask(next, name, AskedBy::Name);
        }
        let export = modules.exports(file).iter().find(|it| it.name == name);
        match export.map(|export| (export.binding, export.is_from_star_export)) {
            Some((ExportBinding::Indirect { module, name }, _)) => match module {
                ModuleRef::File(next) => self.ask(next, name, AskedBy::Name),
                _ => false,
            },
            Some((ExportBinding::Variable(symbol), is_from_star)) if symbol.file != file => {
                let mut requests = modules.requests(file).iter();
                if is_from_star && requests.any(|request| request.is_dynamic_star_export) {
                    return self.ask_stars(file, name);
                }
                // An ordinary star: what it names may have the name from a file that a mock stands in place of. On any other way no mock stands.
                let mut named = modules.files_named_by_stars(file).iter();
                if is_from_star && named.any(|&next| self.ask(next, name, AskedBy::Star)) {
                    return true;
                }
                let there = modules.exports(symbol.file).iter();
                let mut there = there.filter(|it| it.binding == ExportBinding::Variable(symbol));
                let same_name = there.clone().find(|it| it.name == name);
                let asked_by = match is_from_star {
                    true => AskedBy::Star,
                    false => AskedBy::Name,
                };
                match same_name.or_else(|| there.next()) {
                    Some(declared) => self.ask(symbol.file, declared.name, asked_by),
                    None => false,
                }
            }
            // A name of a CommonJS file that another file hands on.
            Some((ExportBinding::Synthetic(handed_on), _)) => {
                match *modules.synthetic_export(handed_on) {
                    SyntheticExport {
                        module: ModuleRef::File(next),
                        name,
                        ..
                    } if next != file => self.ask(next, name, AskedBy::Name),
                    _ => {
                        self.steps.push(Step::Declaration);
                        true
                    }
                }
            }
            Some(_) => {
                self.steps.push(Step::Declaration);
                true
            }
            None => self.ask_stars(file, name),
        }
    }

    fn ask_stars(&mut self, file: FileId, name: Atom) -> bool {
        if name == known::default {
            return false;
        }
        let modules = self.modules;
        let stars = modules.requests(file).iter();
        let mut stars = stars.filter(|request| request.is_dynamic_star_export);
        stars.any(|request| match request.target {
            ModuleRef::File(target) => self.ask(target, name, AskedBy::Star),
            _ => false,
        })
    }
}

fn find_way_to_declaration(
    modules: &ModuleGraph,
    asking_file: Option<FileId>,
    asked: (FileId, Atom),
) -> Vec<Step> {
    // Every step of the way follows a request.
    if !modules.reaches_mock(asked.0) {
        return Vec::new();
    }
    let mut way = WayToDeclaration {
        modules,
        asking_file,
        steps: Vec::new(),
        path: Vec::new(),
        answers_to_stars: FxHashMap::default(),
        rings_met: 0,
        stations_on_path: Vec::new(),
    };
    way.ask(asked.0, asked.1, AskedBy::Statement);
    way.steps
}

fn has_station(steps: &[Step]) -> bool {
    steps
        .iter()
        .any(|step| matches!(step, Step::Station { .. }))
}

pub(super) fn emit_import_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
    path: Option<BuiltinPath>,
) -> ValueId {
    emit_import_binding_asked(lowering, binding, name, path, None)
}

// A mock that comes before the body of a file has run stands in place of the file. What it answers is the host's to say, at each read: which names it has, what
// a name that it leaves out reads as, whether the read throws. The host stores its object in a variable of the file, which is empty while no such mock stands.
fn emit_import_binding_asked(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
    path: Option<BuiltinPath>,
    asked: Option<(FileId, Atom)>,
) -> ValueId {
    let read = ReadWithoutMock::Binding { name, path };
    emit_behind_mocks(lowering, binding, asked, read)
}

#[derive(Copy, Clone)]
enum ReadWithoutMock {
    Binding {
        name: StringId,
        path: Option<BuiltinPath>,
    },
    SyntheticMember {
        export: SyntheticExportId,
        access: ExprId,
    },
}

fn emit_read_without_mock(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    read: ReadWithoutMock,
) -> ValueId {
    match read {
        ReadWithoutMock::Binding { name, path } => {
            emit_binding_where_no_mock_stands(lowering, binding, name, path)
        }
        ReadWithoutMock::SyntheticMember { export, access } => {
            lowering.emit_synthetic_member_read(export, access)
        }
    }
}

/// What a mock on the way of `binding` answers, and `read` where none stands.
fn emit_behind_mocks(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    asked: Option<(FileId, Atom)>,
    read: ReadWithoutMock,
) -> ValueId {
    let modules = lowering.file.inputs.modules;
    // `export * as inner from "./dep"`: which object of a file that may be mocked the file between hands on goes by the link of that file. The run time knows it.
    if let ImportBinding::Namespace {
        module: ModuleRef::File(target),
        phase: ImportPhase::Evaluation,
    } = binding
        && let Some((named, name)) = asked
        && named != target
        && holds_mock_in_variable(modules, target)
    {
        let holder = ModuleRef::File(named);
        let holder = lowering.emit_module_namespace(holder, ImportPhase::Evaluation);
        return lowering.emit_named_read(holder, name);
    }
    let own_file = Some(lowering.file.file);
    let mut steps = match asked {
        Some(asked) => find_way_to_declaration(modules, own_file, asked),
        None => Vec::new(),
    };
    // The table of a file that hands a name on lists what somebody reads off its object. The end of the way is known without it.
    let is_station_of = |steps: &[Step], end: FileId| {
        let mut stations = steps.iter();
        stations.any(|step| matches!(*step, Step::Station { file, .. } if file == end))
    };
    if let Some(end) = find_what_binding_leads_to(modules, binding)
        && !is_station_of(&steps, end.0)
        && !steps.iter().any(|step| matches!(step, Step::Declaration))
    {
        let first = steps.len();
        let more = find_way_to_declaration(modules, own_file, end);
        steps.extend(more.into_iter().map(|step| match step {
            Step::Station {
                file,
                name,
                asked_by,
                asked_from,
                behind,
            } => Step::Station {
                file,
                name,
                asked_from,
                // Only the file that the statement names is asked by it.
                asked_by: match asked_by {
                    AskedBy::Statement if asked.is_some_and(|asked| asked.0 != file) => {
                        AskedBy::Name
                    }
                    _ => asked_by,
                },
                behind: behind + first,
            },
            Step::Declaration => Step::Declaration,
        }));
    }
    let runtime_station = find_runtime_module_that_may_be_mocked(lowering.file, binding);
    if !has_station(&steps) && runtime_station.is_none() {
        return emit_read_without_mock(lowering, binding, read);
    }
    // Where the tables do not lead to the declaration, the binding does.
    if !steps.iter().any(|step| matches!(step, Step::Declaration)) {
        steps.push(Step::Declaration);
    }
    let result = lowering.builder.create_variable(None);
    let join = lowering.create_block();
    // A block for each step that something leads to, one for whoever has asked every star in vain, and one for the declaration.
    let nothing = steps.len();
    let declaration = steps.len() + 1;
    let mut blocks: Vec<Option<BlockId>> = vec![None; steps.len() + 2];
    fn block_at(
        lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
        blocks: &mut [Option<BlockId>],
        index: usize,
    ) -> BlockId {
        *blocks[index].get_or_insert_with(|| lowering.create_block())
    }
    let first = block_at(lowering, &mut blocks, 0);
    lowering.jump(first);
    for (index, &step) in steps.iter().enumerate() {
        let Some(block) = blocks[index] else {
            continue;
        };
        lowering.continue_in(block);
        let Step::Station {
            file,
            name,
            asked_by,
            asked_from,
            behind,
        } = step
        else {
            let declaration = block_at(lowering, &mut blocks, declaration);
            lowering.jump(declaration);
            continue;
        };
        let variable = lowering.file.ensure_variable(VariableKey::MockOf(file));
        let mock = lowering.builder.get_module_variable(variable);
        let split = lowering.split_on_type(mock, TypeTable::ABSENT);
        (lowering.builder).set_frequency(split.not_taken, BlockFrequency::Unlikely);
        lowering.builder.switch_to(split.taken);
        let next = block_at(lowering, &mut blocks, index + 1);
        lowering.jump(next);
        lowering.builder.switch_to(split.not_taken);
        // `bun test` leaves a module that has run as it is where `vi.doMock()` names it: whoever was linked to it before keeps it. The run time knows who was.
        let mocked = (lowering.file.fragment).declare_module(ModuleRef::File(file));
        let importer = match asked_from {
            Some(importer) => (lowering.file.fragment).declare_module(ModuleRef::File(importer)),
            None => lowering.file.module_id(),
        };
        let sees_mock = lowering.builder.sees_mock_of(mocked, importer);
        let asks_mock = lowering.create_block();
        (lowering.builder).branch(sees_mock, Edge::to(asks_mock), Edge::to(next));
        (lowering.builder).set_frequency(asks_mock, BlockFrequency::Unlikely);
        lowering.continue_in(asks_mock);
        // The mock that stood when the importer was linked, which may have ended since.
        let mock = lowering.builder.mock_seen_by(mocked, importer);
        if asked_by != AskedBy::Statement {
            let key = lowering.file.name_key(name);
            let has = lowering.emit_has(mock, PropertyName::Constant(key));
            let has = lowering.split_on_truthiness(has);
            lowering.builder.switch_to(has.not_taken);
            let lacking = match asked_by {
                AskedBy::Star => behind,
                AskedBy::Name | AskedBy::Statement => nothing,
            };
            let lacking = block_at(lowering, &mut blocks, lacking);
            lowering.jump(lacking);
            lowering.builder.switch_to(has.taken);
        }
        let answered = lowering.emit_named_read(mock, name);
        lowering.builder.write_variable(result, answered);
        lowering.jump(join);
    }
    if let Some(block) = blocks[nothing] {
        lowering.continue_in(block);
        let undefined = lowering.builder.undefined();
        lowering.builder.write_variable(result, undefined);
        lowering.jump(join);
    }
    if let Some(block) = blocks[declaration] {
        lowering.continue_in(block);
        // What is declared by a module of Bun's own: the mock of that module is asked last.
        if let Some((key, name)) = runtime_station {
            let variable = lowering.file.ensure_variable(key);
            let mock = lowering.builder.get_module_variable(variable);
            let split = lowering.split_on_type(mock, TypeTable::ABSENT);
            (lowering.builder).set_frequency(split.not_taken, BlockFrequency::Unlikely);
            lowering.builder.switch_to(split.not_taken);
            let answered = lowering.emit_named_read(split.not_taken_value, name);
            lowering.builder.write_variable(result, answered);
            lowering.jump(join);
            lowering.builder.switch_to(split.taken);
        }
        let real = emit_read_without_mock(lowering, binding, read);
        lowering.builder.write_variable(result, real);
        lowering.jump(join);
    }
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}

fn emit_binding_where_no_mock_stands(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    name: StringId,
    path: Option<BuiltinPath>,
) -> ValueId {
    match binding {
        ImportBinding::Variable(symbol) => {
            lowering.emit_variable_read(VariableKey::Symbol(symbol), name)
        }
        ImportBinding::Synthetic(export) => lowering.emit_synthetic_read(export, name),
        ImportBinding::Namespace { module, phase } => lowering.emit_module_namespace(module, phase),
        ImportBinding::Builtin(id) => lowering.emit_builtin_import(id, path),
        ImportBinding::CapturedBuiltin { member, export } => {
            let value = lowering.emit_variable_read(VariableKey::SyntheticExport(export), name);
            match path.map(|path| path.mutability) {
                Some(Mutability::ChangesOnItsOwn) => value,
                Some(Mutability::AlwaysLocked | Mutability::ConstantUnlessWritten) | None => {
                    lowering.expect_builtin(value, table::canonical_id(member))
                }
            }
        }
        ImportBinding::BuiltinMember {
            holder,
            name: member_name,
        } => {
            let object = lowering.builder.builtin(holder, false);
            lowering.emit_named_read(object, member_name)
        }
        ImportBinding::NamespaceRead {
            module,
            name: export_name,
        } => {
            let namespace = lowering.emit_module_namespace(module, ImportPhase::Evaluation);
            lowering.emit_named_read(namespace, export_name)
        }
        // Where the module has no object every use of the import is a member that is bound, and nothing looks at what it holds.
        ImportBinding::Exports { module } => match commonjs::emit_module_value(lowering, module) {
            Some(value) => value,
            None => lowering.builder.boolean(true),
        },
        ImportBinding::Unbound => lowering.builder.undefined(),
        ImportBinding::Unused | ImportBinding::Local => {
            debug_assert!(false, "no read reaches an import binding without storage");
            lowering.builder.undefined()
        }
    }
}

impl FileLowering<'_, '_, '_, '_> {
    /// Whether a mock may stand on the way from the import to what declares it. What a read gives is then the mock's to say, whatever the declaration holds.
    pub(in crate::lower) fn may_be_answered_by_mock(&self, symbol: SymbolId) -> bool {
        let modules = self.inputs.modules;
        let asked = find_what_statement_asks(self, symbol);
        let end = find_what_binding_leads_to(modules, modules.import_binding(self.file, symbol));
        let mut starts = asked.into_iter().chain(end);
        starts.any(|start| has_station(&find_way_to_declaration(modules, Some(self.file), start)))
    }

    pub(in crate::lower) fn imported_copy_key(&self, symbol: SymbolId) -> VariableKey {
        VariableKey::Symbol(Sym {
            file: self.file,
            id: symbol,
        })
    }

    fn is_exported_variable(&self, key: VariableKey) -> bool {
        let mut exports = self.inputs.modules.exports(self.file).iter();
        exports.any(|export| match export.binding {
            ExportBinding::Variable(symbol) => VariableKey::Symbol(symbol) == key,
            _ => false,
        })
    }

    pub(in crate::lower) fn text_key_of_name(&mut self, name: BuiltinName) -> PropertyKeyId {
        debug_assert!(
            !table::is_symbol_name(name),
            "an export and a member of a module value have a text name"
        );
        let text = self.intern_bytes(table::text_of_name(name));
        self.text_key(text)
    }
}
