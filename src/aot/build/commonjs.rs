//! CommonJS and JSON modules, and `require`.
//!
//! A CommonJS module is evaluated by the first `require` or import of it. Its `module` object is an ordinary object: what it exports
//! is only known once it has run. An import from an ES module reads the properties of a view of `module.exports`, as in a bundle.

use super::fit::Ty;
use super::imports::ImportSource;
use super::{FileBuild, Fx};
use crate::fragment::GlobalKey;
use crate::id::{GlobalId, V};
use crate::ir::{self, Op, Operation};
use bun_builtin_syntax::Archive;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Decl, PatParent, SymFlags};
use bun_sema::check::CommonJsExports;
use bun_sema::hir::{CallId, ExprId, ExprKind, FileKind, FnBody, FnId, ImportEqualsTarget, PatId, PatKind, PropKey, PropKind, ResolutionMode, SpecifierKind, StmtId, StmtKind, VarKind};
use bun_sema::program::{Builtin, FileId, Files, Sym};
use bun_sema::util::InParallel;
use rustc_hash::FxHashMap;

/// A function at the top level of a file of builtin functions, and what the directives in front of it say.
#[derive(Copy, Clone)]
pub(crate) struct BuiltinFunction {
    pub(crate) file: FileId,
    pub(crate) func: FnId,
    /// What native code asks for it by. `None`: only other builtin functions call it.
    pub(crate) id: Option<u32>,
    /// `$overriddenName = "..";`
    pub(crate) name: Option<Atom>,
    /// `$getter;`
    pub(crate) is_getter: bool,
    /// `$constructor;`, `$nakedConstructor;`. Any other neither constructs nor has a `prototype`.
    pub(crate) is_constructor: bool,
    /// `$visibility = "..";`: `ImplementationVisibility`, as a number.
    pub(crate) visibility: u32,
}

/// Those of all files that are loaded.
#[derive(Default)]
pub(crate) struct BuiltinFunctions {
    /// In the order of the files, and in each in the order of the text.
    pub(crate) list: Vec<BuiltinFunction>,
    by_declaration: FxHashMap<(FileId, FnId), usize>,
    /// `$linkTimeConstant;`: by the name as it is declared, which `$name` stands for in every builtin file.
    linked: FxHashMap<Atom, usize>,
}


impl BuiltinFunctions {
    /// From the trees alone.
    pub(crate) fn new(files: &Files<'_>) -> BuiltinFunctions {
        let mut found = BuiltinFunctions::default();
        for file in (0..files.modules.len() as u32).map(FileId).filter(|&file| files.module(file).builtin == Some(Builtin::Functions)) {
            let (hir, path) = (files.hir(file), files.module(file).file_name());
            let blank = BuiltinFunction { file, func: FnId::NONE, id: None, name: None, is_getter: false, is_constructor: false, visibility: 0 };
            let (mut next, mut is_linked) = (blank, false);
            for stmt in hir.ids(hir.body) {
                match hir[stmt].kind {
                    StmtKind::Expr(e) => match hir[e].kind {
                        ExprKind::Ident(directive) => match files.atoms.bytes(directive) {
                            b"$getter" => next.is_getter = true,
                            b"$constructor" | b"$nakedConstructor" => next.is_constructor = true,
                            b"$linkTimeConstant" => is_linked = true,
                            _ => {}
                        },
                        ExprKind::Assign { op: None, target, value } => {
                            if let (ExprKind::Ident(directive), ExprKind::String(text)) = (hir[target].kind, hir[value].kind) {
                                match (files.atoms.bytes(directive), files.atoms.bytes(text)) {
                                    (b"$overriddenName", _) => next.name = Some(text),
                                    (b"$visibility", b"Private") => next.visibility = 1,
                                    (b"$visibility", b"PrivateRecursive") => next.visibility = 2,
                                    _ => {}
                                }
                            }
                        }
                        _ => {}
                    },
                    StmtKind::Fn(func) if !matches!(hir[func].body, FnBody::None) => {
                        let id = Archive::embedded().manifest().builtin_function_id(path, files.atoms.bytes(hir[func].name));
                        found.by_declaration.insert((file, func), found.list.len());
                        if is_linked {
                            found.linked.insert(hir[func].name, found.list.len());
                        }
                        found.list.push(BuiltinFunction { func, id, ..next });
                        (next, is_linked) = (blank, false);
                    }
                    _ => {}
                }
            }
        }
        found
    }

    pub(crate) fn declared_as(&self, file: FileId, func: FnId) -> Option<&BuiltinFunction> {
        self.by_declaration.get(&(file, func)).map(|&at| &self.list[at])
    }

    pub(crate) fn linked_as(&self, name: Atom) -> Option<&BuiltinFunction> {
        self.linked.get(&name).map(|&at| &self.list[at])
    }
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum RequiredEsModule {
    Unbound,
    Marked,
    AsItIs,
}

/// The global of a module that remembers what `default` is for an ES module.
fn name_of_default(is_node_mode: bool) -> &'static str {
    if is_node_mode { "default for Node.js" } else { "default" }
}

impl<'c, 'p, 's> FileBuild<'c, 'p, 's> {
    /// JavaScript that uses `require`, `module` or `exports`, and has neither `import` nor `export`.
    pub(crate) fn is_commonjs(&self, file: FileId) -> bool {
        self.files.module(file).is_commonjs()
    }

    /// Whether what the module exports is read from an object at run time.
    pub(crate) fn exports_an_object(&self, file: FileId) -> bool {
        self.is_commonjs(file) || self.hir(file).kind == FileKind::Json
    }

    /// A builtin module, or a file of builtin functions.
    pub(crate) fn is_builtin_file(&self, file: FileId) -> bool {
        self.files.module(file).builtin.is_some()
    }

    /// The registry id of a builtin module.
    pub(crate) fn builtin_id(&self, file: FileId) -> Option<u32> {
        match self.files.module(file).builtin {
            Some(Builtin::Module(id, _)) => Some(id),
            _ => None,
        }
    }

    /// The registry id of what `require(specifier)` in the builtin file `file` yields.
    pub(crate) fn builtin_id_required_by(&self, file: FileId, specifier: Atom) -> Option<u32> {
        let manifest = Archive::embedded().manifest();
        let importer = manifest.module_for_path(self.files.module(file).file_name()).map_or(&b""[..], |module| &module.path);
        manifest.resolve(self.c.atoms().bytes(specifier), importer)
    }

    /// The registry is the only cache: the function runs the body and returns the value of the module, which is what `export default` was given, or
    /// an object with what the exported names hold in the end.
    pub(crate) fn emit_builtin_module(&mut self, fx: &mut Fx, file: FileId) {
        let body = self.hir(file).body;
        self.block_body(fx, body);
        let mut exports = self.exports_of_file(file);
        exports.sort_by(|a, b| self.c.atoms().bytes(a.0).cmp(self.c.atoms().bytes(b.0)));
        let value = match exports.iter().find(|export| export.0 == known::default) {
            Some(&(_, source)) => self.read_export(fx, source),
            None => {
                let object = self.emit(fx, Op::NewObject);
                for (name, source) in exports {
                    let value = self.read_export(fx, source);
                    let name = self.str(name);
                    let name = self.emit(fx, Op::Str(name));
                    self.operation(fx, Operation::DefineField, &[object, name, value]);
                }
                object
            }
        };
        self.terminate_with_return(fx, value);
    }

    fn read_export(&mut self, fx: &mut Fx, source: ImportSource) -> V {
        match source {
            ImportSource::Declaration(exported) => {
                let exported = self.value_symbol_of_export(exported);
                self.read_sym(fx, exported, 0)
            }
            source => self.read_import(fx, source, 0),
        }
    }

    fn global_of_module(&mut self, file: FileId, name: &'static str) -> GlobalId {
        if let Some(&global) = self.globals_of_modules.get(&(file, name)) {
            return global;
        }
        let interned = self.out.strs.intern(name.as_bytes());
        let global = self.add_global(interned, file, Ty::NONE, GlobalKey::OfModule(file, name));
        self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
        self.globals_of_modules.insert((file, name), global);
        global
    }

    /// Once for the program, before anything is translated: which code each import runs, and which conditions at the top level of CommonJS modules the build folds.
    pub(crate) fn resolved_imports_of(&mut self, files: &[FileId]) -> (Vec<((FileId, Atom), FileId)>, Vec<(FileId, FileId)>) {
        let (mut resolved, mut implicit) = (Vec::new(), Vec::new());
        for &file in files {
            let hir = self.hir(file);
            let holders = self.c.variables_that_may_hold_made_requires(file);
            let symbols = &self.c.bound(file).expr_symbol;
            let made_requires: Vec<ExprId> = hir.calls.iter().map(|call| call.callee).filter(|&callee| matches!(hir[callee].kind, ExprKind::Ident(_)) && holders.contains(&symbols[callee.idx()])).collect();
            let texts_of = |e: ExprId| {
                let mut found = Vec::new();
                if !hir.choice_of_specifiers(e, &mut found) {
                    found.clear();
                }
                found
            };
            let declared = hir.ids(hir.body).map(|stmt| match hir[stmt].kind {
                StmtKind::Import(import) => hir[import].spec,
                StmtKind::ExportNamed(export) => hir[export].spec,
                StmtKind::ExportStar { spec, .. } => spec,
                StmtKind::ImportEquals(import) => match hir[import].target {
                    ImportEqualsTarget::Require(specifier) => specifier,
                    _ => Atom::NONE,
                },
                _ => Atom::NONE,
            });
            let on_demand = hir.exprs.iter().flat_map(|e| match e.kind {
                ExprKind::ImportCall { args } => hir.ids(args).next().map_or(Vec::new(), texts_of),
                ExprKind::Call(call) if hir[call].args.len() == 1 && hir.is_written_as_require(hir[call].callee) => texts_of(hir.id_at(hir[call].args, 0)),
                ExprKind::Call(call) if hir[call].args.len() == 1 && made_requires.contains(&hir[call].callee) => texts_of(hir.id_at(hir[call].args, 0)),
                _ => Vec::new(),
            });
            resolved.extend(declared.chain(on_demand).filter_map(|specifier| Some(((file, specifier), self.imported_file(file, specifier)?))));
            if let Some(runtime) = self.jsx_runtime(file)
                && hir.exprs.iter().any(|e| matches!(e.kind, ExprKind::Jsx(_)))
                && let Some(imported) = self.imported_file(file, runtime)
            {
                implicit.push((file, imported));
            }
        }
        (resolved, implicit)
    }

    pub(crate) fn tell_resolved_imports(&mut self, found: impl Iterator<Item = (Vec<((FileId, Atom), FileId)>, Vec<(FileId, FileId)>)>, in_parallel: InParallel<'_>) {
        let shared = self.shared;
        let (mut resolved, mut folded, mut implicit) = (Vec::new(), Vec::new(), Vec::new());
        for (mut more_resolved, mut more_implicit) in found {
            resolved.append(&mut more_resolved);
            implicit.append(&mut more_implicit);
        }
        for &file in &shared.modules {
            if self.is_commonjs(file) {
                let hir = self.hir(file);
                for stmt in hir.ids(hir.body) {
                    self.fold_conditions(file, stmt, &mut folded);
                }
            }
        }
        let entry_points = shared.entry_points().iter().filter_map(|roots| roots.first().copied()).collect();
        let marked = shared.bundle.iter().flat_map(|bundle| bundle.requires_resolved_otherwise());
        let mut required_otherwise: Vec<((FileId, Atom), FileId)> = marked.filter_map(|(from, specifier, to)| Some(((from, self.c.atoms().lookup(specifier)?), to))).collect();
        required_otherwise.sort_unstable_by_key(|&((from, _), to)| (from, to));
        implicit.extend(required_otherwise.iter().map(|&((from, _), to)| (from, to)));
        let evaluated_again = shared.modules.iter().copied().filter(|&file| self.second_form_of(file).is_some()).collect();
        self.c.set_resolved_imports(&shared.modules, resolved, required_otherwise, evaluated_again, folded, implicit, entry_points, shared.constants.own_paths.is_some());
        self.c.settle_commonjs(in_parallel);
    }

    fn fold_conditions(&mut self, file: FileId, stmt: StmtId, folded: &mut Vec<((FileId, StmtId), bool)>) {
        if stmt.is_none() {
            return;
        }
        let hir = self.hir(file);
        match hir[stmt].kind {
            StmtKind::If { test, yes, no } => {
                if let Some(test) = self.constant_in(file, test) {
                    folded.push(((file, stmt), test.is_truthy()));
                    self.fold_conditions(file, if test.is_truthy() { yes } else { no }, folded);
                }
            }
            StmtKind::Block(stmts) => {
                for stmt in hir.ids(stmts) {
                    self.fold_conditions(file, stmt, folded);
                }
            }
            _ => {}
        }
    }

    /// Where the CommonJS module keeps what it exports under the name: `Checker::commonjs_exports`.
    pub(crate) fn export_variable(&mut self, module: FileId, name: Atom) -> GlobalId {
        if let Some(&known) = self.export_variables.get(&(module, name)) {
            return known;
        }
        let key = GlobalKey::Export(module, self.c.atoms().bytes(name).into());
        let text = self.str(name);
        let global = self.add_global(text, module, Ty::NONE, key);
        self.out.globals[global.idx()].initialization = if self.c.is_export_variable_stored_before_every_read(module, name) { ir::Initialization::NeverSeen } else { ir::Initialization::Undefined };
        if let Some((file, func, is_predicted)) = self.c.only_function_of_export_variable(module, name) {
            self.out.globals[global.idx()].only_function = self.name_function(file, func);
            self.out.globals[global.idx()].only_function_flags = if is_predicted { 0 } else { ir::only_function_flags::OR_NULLISH };
        }
        self.export_variables.insert((module, name), global);
        global
    }

    /// `module.exports`, where that is a variable.
    pub(crate) fn module_exports_variable(&mut self, file: FileId) -> GlobalId {
        let global = self.global_of_module(file, "module.exports");
        if let Some((of, func, _)) = self.c.function_exported_whole(file) {
            self.out.globals[global.idx()].only_function = self.name_function(of, func);
        }
        global
    }

    pub(crate) fn export_variable_assigned_by(&mut self, fx: &mut Fx, e: ExprId) -> Option<(GlobalId, V, Atom)> {
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = self.hir(fx.file)[e].kind else { return None };
        if self.c.is_module_exports_variable(fx.file, e) {
            return Some((self.module_exports_variable(fx.file), V::NONE, Atom::NONE));
        }
        let (module, name) = self.c.export_variable_named_by(fx.file, e)?;
        let held = self.holder_of_exports(fx, obj);
        Some((self.export_variable(module, name), held, name))
    }

    pub(crate) fn emit_module_exports_for_host(&mut self, fx: &mut Fx, exports: GlobalId) {
        let file = fx.file;
        if !self.may_be_asked_by_the_host() || self.is_builtin_file(file) || self.own_path(file, b"path").is_none() {
            return;
        }
        let module = self.global_of_module(file, "module");
        let module = self.emit(fx, Op::GlobalGet(module));
        let undefined = self.emit(fx, Op::Undefined);
        let has_none = self.emit(fx, Op::StrictEq { a: module, b: undefined });
        let (stores, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, has_none, done, stores);
        fx.b.seal(stores);
        fx.b.switch_to(stores);
        let value = self.emit(fx, Op::GlobalGet(exports));
        let name = self.out.strs.intern(b"exports");
        self.emit_throwing(fx, Op::PropSet { obj: module, name, value });
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
    }

    pub(crate) fn has_export_variables(&mut self, file: FileId) -> bool {
        matches!(self.c.commonjs_exports(file), CommonJsExports::Variables | CommonJsExports::Of(_))
    }

    /// What stands in for the exports of a module that has no object for them. Nobody looks at it.
    fn exports_without_object(&mut self, fx: &mut Fx) -> V {
        self.emit(fx, if fx.is_typed { Op::NewObject } else { Op::Bool(true) })
    }

    /// `m` of `m.name` is evaluated for what that does: `require(..)` evaluates the module, a `let` or a `const` may be in its dead zone, and a `var` may
    /// still be `undefined`, which has no properties.
    fn evaluate_holder_of_exports(&mut self, fx: &mut Fx, holder: ExprId, name: Atom) {
        let held = self.holder_of_exports(fx, holder);
        self.check_holder_of_exports(fx, held, name);
    }

    fn holder_of_exports(&mut self, fx: &mut Fx, holder: ExprId) -> V {
        if self.c.is_held_whenever_read(fx.file, holder) {
            return V::NONE;
        }
        let held = self.expr(fx, holder);
        let ExprKind::Ident(variable) = self.hir(fx.file)[holder].kind else { return V::NONE };
        if self.c.binding_of_identifier(fx.file, holder, variable).is_some_and(|sym| self.c.is_hoisted(sym)) { held } else { V::NONE }
    }

    pub(crate) fn check_holder_of_exports(&mut self, fx: &mut Fx, held: V, name: Atom) {
        if held.is_none() {
            return;
        }
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: held, b: undefined });
        let (missing, found) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, missing, found);
        fx.b.seal(missing);
        fx.b.switch_to(missing);
        let name = self.str(name);
        self.emit_throwing(fx, Op::PropGet { obj: held, name });
        fx.b.jump(found);
        fx.b.seal(found);
        fx.b.switch_to(found);
    }

    /// The variable that `m.name` or `m["name"]` names, with `m` evaluated.
    pub(crate) fn export_variable_named_by(&mut self, fx: &mut Fx, e: ExprId) -> Option<GlobalId> {
        let (ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) = self.hir(fx.file)[e].kind else { return None };
        if self.c.is_module_exports_variable(fx.file, e) {
            return Some(self.module_exports_variable(fx.file));
        }
        let (module, name) = self.c.export_variable_named_by(fx.file, e)?;
        self.evaluate_holder_of_exports(fx, obj, name);
        Some(self.export_variable(module, name))
    }

    /// The value of an expression that reads an export variable, or that stands for the exports of a module that has no object for them.
    pub(crate) fn exports_expression(&mut self, fx: &mut Fx, e: ExprId) -> Option<V> {
        if !self.c.has_exports_expressions(fx.file) {
            return None;
        }
        if let Some(global) = self.export_variable_named_by(fx, e) {
            let value = self.emit(fx, Op::GlobalGet(global));
            return Some(self.fit_to_expression(fx, value, e));
        }
        if self.c.marks_export_variables(fx.file, e) {
            let global = self.export_variable(fx.file, known::__esModule);
            let value = self.emit(fx, Op::Bool(true));
            self.emit(fx, Op::GlobalSet(global, value));
            return Some(self.exports_without_object(fx));
        }
        if self.c.stars_export_variables(fx.file, e)
            && let ExprKind::Call(call) = self.hir(fx.file)[e].kind
        {
            let other = self.hir(fx.file).id_at(self.hir(fx.file)[call].args, 0);
            return Some(self.expr(fx, other));
        }
        if self.c.defines_alias_of_export_variable(fx.file, e) {
            self.cut_expr(fx, e);
            return Some(self.exports_without_object(fx));
        }
        let mention = self.c.exports_mentioned_by(fx.file, e)?;
        match self.hir(fx.file)[e].kind {
            ExprKind::Call(call) => {
                let callee = self.hir(fx.file)[call].callee;
                if self.c.names_require_made_for_its_file(fx.file, callee) {
                    self.expr_for_effect(fx, callee);
                }
                if let Some(pos) = self.position_of_required_path(fx, call) {
                    fx.b.pos = pos;
                }
                self.emit_module_evaluation_by_require(fx, mention.module)
            }
            // `box.default`, `ns.default`
            ExprKind::Dot { obj, name, .. } if !matches!(self.hir(fx.file)[obj].kind, ExprKind::Ident(known::module)) => self.evaluate_holder_of_exports(fx, obj, name),
            // A variable holds what `require` has yielded.
            ExprKind::Ident(name) if name != known::exports && !self.c.binding_of_identifier(fx.file, e, name).is_some_and(|sym| self.is_declared_by_import(sym)) => return None,
            _ => {}
        }
        Some(self.exports_without_object(fx))
    }

    /// `module.exports = { a, b: value }`
    pub(crate) fn store_export_variables(&mut self, fx: &mut Fx, literal: ExprId) -> V {
        let hir = self.hir(fx.file);
        let ExprKind::Object(props) = hir[literal].kind else { return self.exports_without_object(fx) };
        let mut stores = Vec::new();
        for p in props.iter() {
            let prop = &hir[p];
            let PropKey::Name(name) = prop.key else { continue };
            let value = if prop.kind == PropKind::Init { self.expr_named(fx, prop.value, name) } else { self.expr(fx, prop.value) };
            stores.push((self.export_variable(fx.file, name), value));
        }
        for (global, value) in stores {
            self.emit(fx, Op::GlobalSet(global, value));
        }
        self.exports_without_object(fx)
    }

    /// `const { a, b: c = 1 } = require("./m")`
    pub(crate) fn bind_export_variables(&mut self, fx: &mut Fx, pat: PatId, from: ExprId) -> bool {
        let hir = self.hir(fx.file);
        let PatKind::Object(props) = hir[pat].kind else { return false };
        let Some(mention) = self.c.exports_mentioned_by(fx.file, from).filter(|mention| self.c.module_with_export_variables(mention.module).is_some()) else { return false };
        let module = mention.module;
        let held = self.expr(fx, from);
        self.require_object_coercible(fx, held);
        for p in props.iter() {
            let prop = &hir[p];
            let name = match (prop.key, hir[prop.value].kind) {
                (PropKey::Name(name), _) | (_, PatKind::Ident(name)) => name,
                _ => continue,
            };
            let found = if mention.is_namespace { self.c.export_variable_imported_as(fx.file, module, name) } else { self.c.export_variable_of(module, name) };
            // A module keeps its object where a pattern takes a name that stands for all it exports (`default`), or `__esModule`.
            let mut member = match found {
                Some((module, name)) => {
                    let global = self.export_variable(module, name);
                    self.emit(fx, Op::GlobalGet(global))
                }
                None => self.unsupported(fx, fx.b.pos, "a name in a pattern that is not a variable of a CommonJS module without an object"),
            };
            if prop.default.is_some() {
                member = self.emit_default_initializer(fx, member, prop.default, self.name_of_pat(fx, prop.value));
            }
            self.bind_pat(fx, prop.value, member);
        }
        true
    }

    /// What a bundle has a constant in the place of: `__filename`, `__dirname`, `module.id`, `module.path`, `module.filename`, `require.main === module`.
    pub(crate) fn constant_of_the_environment(&mut self, file: FileId, e: ExprId) -> Option<super::constants::Constant> {
        use super::constants::Constant;
        let hir = self.hir(file);
        let named = |this: &Self, e: ExprId, name: &[u8]| matches!(hir[e].kind, ExprKind::Ident(found) if this.c.atoms().bytes(found) == name);
        let is_candidate = match hir[e].kind {
            ExprKind::Ident(_) => named(self, e, b"__filename") || named(self, e, b"__dirname"),
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => named(self, obj, b"module"),
            ExprKind::Binary { left, right, .. } => named(self, left, b"module") || named(self, right, b"module"),
            _ => false,
        };
        if !is_candidate || self.is_builtin_file(file) {
            return None;
        }
        let is_free = |this: &mut Self, e: ExprId| matches!(hir[e].kind, ExprKind::Ident(name) if this.is_free_in(file, e, name));
        let path = self.files.module(file).file_name();
        let slash = bun_core::strings::last_index_of_char(path, b'/')?;
        match hir[e].kind {
            ExprKind::Ident(_) if is_free(self, e) => Some(Constant::String(if named(self, e, b"__filename") { path.to_vec() } else { path[..slash.max(1)].to_vec() })),
            ExprKind::Dot { obj, name, chain: bun_sema::hir::Chain::No, .. } if self.is_commonjs(file) && is_free(self, obj) => match (self.c.atoms().bytes(name), self.shared.constants.own_paths.is_some()) {
                (b"filename", true) => Some(Constant::String(path.to_vec())),
                (b"path", true) => Some(Constant::String(path[..slash.max(1)].to_vec())),
                (b"id", true) if !self.shared.roots().contains(&file) => Some(Constant::String(path.to_vec())),
                (b"id", true) => None,
                (b"id" | b"path", _) => Some(Constant::String(bun_sema::resolve::get_relative_path_from_directory(&self.shared.constants.root, path, self.files.is_case_sensitive))),
                (b"filename", _) => Some(Constant::String(path[slash + 1..].to_vec())),
                _ => None,
            },
            ExprKind::Index { obj, index, chain: bun_sema::hir::Chain::No } if self.shared.constants.own_paths.is_none() && self.is_commonjs(file) && is_free(self, obj) => {
                let ExprKind::String(name) = hir[index].kind else { return None };
                match self.c.atoms().bytes(name) {
                    b"id" | b"path" => Some(Constant::String(bun_sema::resolve::get_relative_path_from_directory(&self.shared.constants.root, path, self.files.is_case_sensitive))),
                    b"filename" => Some(Constant::String(path[slash + 1..].to_vec())),
                    _ => None,
                }
            }
            ExprKind::Binary { op, left, right } => {
                let (module, main) = if named(self, left, b"module") { (left, right) } else { (right, left) };
                let ExprKind::Dot { obj: require, name, chain: bun_sema::hir::Chain::No, .. } = hir[main].kind else { return None };
                if self.c.atoms().bytes(name) != b"main" || !named(self, require, b"require") || !is_free(self, require) || !is_free(self, module) {
                    return None;
                }
                // As for `import.meta.main`: only a file that the program can be started with may be the main one; in an executable each of them is.
                let is_entry_point = self.shared.entry_points().iter().any(|entry_point| entry_point.first() == Some(&file));
                if is_entry_point && !(self.shared.constants.resolved.is_some() && self.shared.constants.own_paths.is_none()) {
                    return None;
                }
                Some(Constant::Bool(is_entry_point == matches!(op, bun_sema::hir::BinOp::EqEqEq | bun_sema::hir::BinOp::EqEq)))
            }
            _ => None,
        }
    }

    pub(crate) fn is_main_by_the_host(&mut self, fx: &mut Fx, op: bun_sema::hir::BinOp, left: ExprId, right: ExprId) -> Option<V> {
        use bun_sema::hir::BinOp;
        let file = fx.file;
        let is_equality = matches!(op, BinOp::EqEqEq | BinOp::EqEq);
        if !(is_equality || matches!(op, BinOp::NotEqEq | BinOp::NotEq)) || self.shared.constants.own_paths.is_none() || self.is_builtin_file(file) {
            return None;
        }
        let hir = self.hir(file);
        let named = |this: &Self, e: ExprId, name: &[u8]| matches!(hir[e].kind, ExprKind::Ident(found) if this.c.atoms().bytes(found) == name);
        let is_free = |this: &mut Self, e: ExprId| matches!(hir[e].kind, ExprKind::Ident(name) if this.is_free_in(file, e, name));
        let (module, main) = if named(self, left, b"module") { (left, right) } else { (right, left) };
        let ExprKind::Dot { obj: require, name, chain: bun_sema::hir::Chain::No, .. } = hir[main].kind else { return None };
        if !named(self, module, b"module") || self.c.atoms().bytes(name) != b"main" || !named(self, require, b"require") || !is_free(self, require) || !is_free(self, module) {
            return None;
        }
        if !self.shared.entry_points().iter().any(|entry_point| entry_point.first() == Some(&file)) {
            return None;
        }
        let meta = self.import_meta(fx);
        let name = self.out.strs.intern(b"main");
        let said = self.emit_throwing(fx, Op::PropGet { obj: meta, name });
        let yes = self.emit(fx, Op::Bool(true));
        let is_main = self.emit(fx, Op::StrictEq { a: said, b: yes });
        Some(if is_equality { is_main } else { self.emit(fx, Op::Not(is_main)) })
    }

    /// `this` at the top level of a module, from within an arrow function: of a CommonJS module, what `exports` is.
    pub(crate) fn this_of_module(&mut self, fx: &mut Fx) -> V {
        if !self.is_commonjs(fx.file) || self.hir(fx.file).names_import_meta() {
            return self.emit(fx, Op::Undefined);
        }
        let global = self.global_of_module(fx.file, "exports");
        self.emit(fx, Op::GlobalGet(global))
    }

    pub(crate) fn emit_note_that_the_cache_is_read(&mut self, fx: &mut Fx, file: FileId) {
        let require = match self.require_function_of(fx, file) {
            Some(require) => require,
            None => self.operation(fx, Operation::GetRequireFunction, &[]),
        };
        let cache = self.out.strs.intern(b"cache");
        self.emit_throwing(fx, Op::PropGet { obj: require, name: cache });
    }

    pub(crate) fn may_be_asked_by_the_host(&self) -> bool {
        self.shared.constants.own_paths.is_some() && self.shared.bundle.is_some()
    }

    fn host_may_ask_for(&self, file: FileId) -> bool {
        !self.is_builtin_file(file) && !self.shared.is_prelude(file) && !self.is_second_form(file) && self.files.module(file).is_module() && self.hir(file).kind != FileKind::Json && !self.only_declares(file)
    }

    fn files_the_host_may_ask_for(&self) -> Vec<FileId> {
        self.shared.modules.iter().copied().filter(|&file| self.host_may_ask_for(file)).collect()
    }

    pub(crate) fn namespace_for_host_of(&mut self, file: FileId) -> crate::id::FuncId {
        let name = self.name_after_file("namespace of", file);
        let module = self.module_of(file);
        let func = self.add_func(name, module, 0, ir::FuncKind::Plain, super::Source::NamespaceForHost(file));
        self.out.funcs[func.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        if self.is_first_of_an_entry_point(file) {
            self.out.funcs[func.idx()].params = vec![crate::id::TyId::NONE];
            self.out.funcs[func.idx()].length = 1;
        }
        func
    }

    fn is_first_of_an_entry_point(&self, file: FileId) -> bool {
        self.shared.entry_points().iter().any(|files| files.first() == Some(&file))
    }

    pub(crate) fn emit_namespace_for_host(&mut self, fx: &mut Fx, file: FileId) {
        if self.is_first_of_an_entry_point(file) {
            let asked = self.add_entry_param(fx, Ty::NONE);
            let is_required = self.emit(fx, Op::Truthy(asked));
            let (required, imported) = (fx.b.new_block(), fx.b.new_block());
            let is_followed_by_an_async_module = self.shared.entry_points().iter().filter(|files| files.first() == Some(&file)).any(|files| files[1..].iter().any(|&later| self.is_async_module(later)));
            if is_followed_by_an_async_module {
                self.branch(fx, is_required, required, imported);
            } else {
                let (not_required, only_waits) = (fx.b.new_block(), fx.b.new_block());
                self.branch(fx, is_required, required, not_required);
                fx.b.seal(not_required);
                fx.b.switch_to(not_required);
                let null = self.emit(fx, Op::Null);
                let is_waited_for = self.emit(fx, Op::StrictEq { a: asked, b: null });
                self.branch(fx, is_waited_for, only_waits, imported);
                fx.b.seal(only_waits);
                fx.b.switch_to(only_waits);
                let undefined = self.emit(fx, Op::Undefined);
                self.terminate_with_return(fx, undefined);
            }
            fx.b.seal(required);
            fx.b.seal(imported);
            fx.b.switch_to(imported);
            let func = self.dynamic_import_of(file, false);
            let promise = self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
            self.terminate_with_return(fx, promise);
            fx.b.switch_to(required);
        }
        if let Some(func) = self.evaluation_of(file) {
            self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
        }
        if self.exports_an_object(file) {
            let (seen, exported) = (self.emit(fx, Op::NewObject), self.exported_object(fx, file));
            let key = self.out.strs.intern(b"module.exports");
            let key = self.emit(fx, Op::Str(key));
            self.operation(fx, Operation::DefineField, &[seen, key, exported]);
            return self.terminate_with_return(fx, seen);
        }
        if self.files.export(self.files.file_symbol(file), known::export_equals).is_some() {
            let (seen, exported) = (self.emit(fx, Op::NewObject), self.required_es_module(fx, file, 0));
            let key = self.out.strs.intern(b"module.exports");
            let key = self.emit(fx, Op::Str(key));
            self.operation(fx, Operation::DefineField, &[seen, key, exported]);
            return self.terminate_with_return(fx, seen);
        }
        let namespace = self.read_sym(fx, self.files.file_symbol(file), 0);
        self.terminate_with_return(fx, namespace);
    }

    pub(crate) fn files_by_path(&mut self, entry: FileId) -> crate::id::FuncId {
        let name = self.name_after_file("files of", entry);
        let module = self.module_of(entry);
        self.add_func(name, module, 0, ir::FuncKind::Plain, super::Source::FilesByPath(entry))
    }

    pub(crate) fn emit_files_by_path(&mut self, fx: &mut Fx, entry: FileId) {
        let name = self.name_after_file("evaluation of a file of", entry);
        let module = self.module_of(entry);
        let evaluate = self.add_func(name, module, 0, ir::FuncKind::Plain, super::Source::EvaluationByNumber(entry));
        self.out.funcs[evaluate.idx()].params = vec![crate::id::TyId::NONE; 4];
        self.out.funcs[evaluate.idx()].length = 4;
        self.out.funcs[evaluate.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
        let table = self.emit(fx, Op::NewObject);
        let key = self.out.strs.intern(b"");
        let key = self.emit(fx, Op::Str(key));
        let evaluate = self.emit(fx, Op::FuncRef(evaluate));
        self.operation(fx, Operation::DefineField, &[table, key, evaluate]);
        for (number, file) in self.files_the_host_may_ask_for().into_iter().enumerate() {
            let Some(path) = self.own_path(file, b"path") else { continue };
            let key = self.out.strs.intern(&path);
            let key = self.emit(fx, Op::Str(key));
            let number = self.emit(fx, Op::Int(number as i64));
            self.operation(fx, Operation::DefineField, &[table, key, number]);
        }
        self.terminate_with_return(fx, table);
    }

    fn sorted_names_of_export_variables(&mut self, keeper: FileId) -> Vec<Atom> {
        let mut names = self.c.names_of_export_variables(keeper);
        names.sort_by_cached_key(|&name| bstr::BStr::new(self.c.atoms().bytes(name)).to_string().encode_utf16().collect::<Vec<u16>>());
        names.dedup();
        names
    }

    fn view_of_export_variables(&mut self, fx: &mut Fx, keeper: FileId) -> V {
        let global = self.global_of_module(keeper, "view of the exports");
        self.lazily(fx, global, |this, fx| {
            let read = match this.imports_of_exported_objects.get(&(keeper, 3)) {
                Some(&known) => known,
                None => {
                    let name = this.name_after_file("exports of", keeper);
                    let module = this.module_of(keeper);
                    let read = this.add_func(name, module, 0, ir::FuncKind::Plain, super::Source::ExportVariablesReader(keeper));
                    this.out.funcs[read.idx()].params = vec![crate::id::TyId::NONE];
                    this.out.funcs[read.idx()].length = 1;
                    this.imports_of_exported_objects.insert((keeper, 3), read);
                    read
                }
            };
            let mut arguments = vec![this.emit(fx, Op::FuncRef(read))];
            for name in this.sorted_names_of_export_variables(keeper) {
                let name = this.str(name);
                arguments.push(this.emit(fx, Op::Str(name)));
            }
            arguments.push(this.emit(fx, Op::Bool(true)));
            this.operation(fx, Operation::MakeModuleNamespace, &arguments)
        })
    }

    pub(crate) fn emit_export_variables_reader(&mut self, fx: &mut Fx, keeper: FileId) {
        let number = self.add_entry_param(fx, Ty::NONE);
        let number = self.emit_throwing(fx, Op::Coerce { value: number, to: self.known.int32, why: ir::Why::Claim });
        let names = self.sorted_names_of_export_variables(keeper);
        let arms: Vec<crate::id::BlockId> = names.iter().map(|_| fx.b.new_block()).collect();
        let none = fx.b.new_block();
        let cases = arms.iter().enumerate().map(|(number, &arm)| (number as i64, ir::Target::new(arm))).collect();
        fx.b.terminate(ir::Term::Switch { value: number, cases, default: ir::Target::new(none) });
        for (&arm, name) in arms.iter().zip(names) {
            fx.b.seal(arm);
            fx.b.switch_to(arm);
            let value = if name == known::__esModule {
                self.emit(fx, Op::Bool(true))
            } else {
                let (module, name) = self.c.export_variable_behind(keeper, name);
                let global = self.export_variable(module, name);
                self.emit(fx, Op::GlobalGet(global))
            };
            self.terminate_with_return(fx, value);
        }
        fx.b.seal(none);
        fx.b.switch_to(none);
        let undefined = self.emit(fx, Op::Undefined);
        self.terminate_with_return(fx, undefined);
    }

    pub(crate) fn emit_evaluation_by_number(&mut self, fx: &mut Fx, entry: FileId) {
        let number_given = self.add_entry_param(fx, Ty::NONE);
        let module = self.add_entry_param(fx, Ty::NONE);
        let how_given = self.add_entry_param(fx, Ty::NONE);
        let value = self.add_entry_param(fx, Ty::NONE);
        let number = self.emit_throwing(fx, Op::Coerce { value: number_given, to: self.known.int32, why: ir::Why::Claim });
        let how = self.emit_throwing(fx, Op::Coerce { value: how_given, to: self.known.int32, why: ir::Why::Claim });
        let files = self.files_the_host_may_ask_for();
        let (notes, by_number) = (fx.b.new_block(), fx.b.new_block());
        fx.b.terminate(ir::Term::Switch { value: how, cases: vec![(7, ir::Target::new(notes))], default: ir::Target::new(by_number) });
        fx.b.seal(notes);
        fx.b.seal(by_number);
        fx.b.switch_to(notes);
        let is_read = self.variable_of_program("require.cache is read");
        let was_read = self.emit(fx, Op::GlobalGet(is_read));
        let yes = self.emit(fx, Op::Bool(true));
        self.emit(fx, Op::GlobalSet(is_read, yes));
        self.terminate_with_return(fx, was_read);
        fx.b.switch_to(by_number);
        let arms: Vec<crate::id::BlockId> = files.iter().map(|_| fx.b.new_block()).collect();
        let none = fx.b.new_block();
        let cases = arms.iter().enumerate().map(|(number, &arm)| (number as i64, ir::Target::new(arm))).collect();
        fx.b.terminate(ir::Term::Switch { value: number, cases, default: ir::Target::new(none) });
        for (&arm, file) in arms.iter().zip(files) {
            fx.b.seal(arm);
            fx.b.switch_to(arm);
            let name = self.name_after_file("evaluation by the host of", file);
            let module_of_entry = self.module_of(entry);
            let func = self.add_func(name, module_of_entry, 0, ir::FuncKind::Plain, super::Source::EvaluationOfOneFile(entry, file));
            self.out.funcs[func.idx()].params = vec![crate::id::TyId::NONE; 4];
            self.out.funcs[func.idx()].length = 4;
            self.out.funcs[func.idx()].flags |= ir::func_flags::IS_HIDDEN_IN_STACK_TRACES;
            let said = self.emit_throwing(fx, Op::CallDirect { func, args: [number_given, module, how_given, value].into_iter().collect() });
            self.terminate_with_return(fx, said);
        }
        fx.b.seal(none);
        fx.b.switch_to(none);
        let no = self.emit(fx, Op::Bool(false));
        self.terminate_with_return(fx, no);
    }

    pub(crate) fn emit_evaluation_of_one_file(&mut self, fx: &mut Fx, file: FileId) {
        let number = self.add_entry_param(fx, Ty::NONE);
        let module = self.add_entry_param(fx, Ty::NONE);
        let how = self.add_entry_param(fx, Ty::NONE);
        self.add_entry_param(fx, Ty::NONE);
        let number = self.emit_throwing(fx, Op::Coerce { value: number, to: self.known.int32, why: ir::Why::Claim });
        let how = self.emit_throwing(fx, Op::Coerce { value: how, to: self.known.int32, why: ir::Why::Claim });
        let none = fx.b.new_block();
        for file in [file] {
            if let Some(second) = self.second_form_of(file) {
                let (hands_over, goes_on) = (fx.b.new_block(), fx.b.new_block());
                fx.b.terminate(ir::Term::Switch { value: how, cases: vec![(13, ir::Target::new(hands_over))], default: ir::Target::new(goes_on) });
                fx.b.seal(hands_over);
                fx.b.seal(goes_on);
                fx.b.switch_to(hands_over);
                self.emit_module_evaluation(fx, second);
                let wrapper = self.exported_object(fx, second);
                self.terminate_with_return(fx, wrapper);
                fx.b.switch_to(goes_on);
            }
            let (registers, otherwise) = (fx.b.new_block(), fx.b.new_block());
            fx.b.terminate(ir::Term::Switch { value: how, cases: vec![(8, ir::Target::new(registers))], default: ir::Target::new(otherwise) });
            fx.b.seal(registers);
            fx.b.seal(otherwise);
            fx.b.switch_to(registers);
            if self.is_registered_on_demand(file) {
                let flag = self.global_of_module(file, "evaluated");
                let known = self.emit(fx, Op::GlobalGet(flag));
                let undefined = self.emit(fx, Op::Undefined);
                let has_not_run = self.emit(fx, Op::StrictEq { a: known, b: undefined });
                let has_run = fx.b.new_block();
                self.branch(fx, has_not_run, none, has_run);
                fx.b.seal(has_run);
                fx.b.switch_to(has_run);
                self.emit_registration(fx, file);
                let yes = self.emit(fx, Op::Bool(true));
                self.terminate_with_return(fx, yes);
            } else {
                fx.b.jump(none);
            }
            fx.b.switch_to(otherwise);
            let (evict, proceed) = (fx.b.new_block(), fx.b.new_block());
            fx.b.terminate(ir::Term::Switch { value: how, cases: vec![(9, ir::Target::new(evict))], default: ir::Target::new(proceed) });
            fx.b.seal(evict);
            fx.b.seal(proceed);
            fx.b.switch_to(evict);
            if self.is_commonjs(file) {
                fx.b.jump(none);
            } else {
                let finished = self.global_of_module(file, "evaluation finished");
                let known = self.emit(fx, Op::GlobalGet(finished));
                let undefined = self.emit(fx, Op::Undefined);
                let is_not_loaded = self.emit(fx, Op::StrictEq { a: known, b: undefined });
                let forget = fx.b.new_block();
                self.branch(fx, is_not_loaded, none, forget);
                fx.b.seal(forget);
                fx.b.switch_to(forget);
                let sym = self.files.file_symbol(file);
                let name = self.out.strs.intern(b"namespace");
                let namespace = self.add_global(name, file, Ty::NONE, GlobalKey::Namespace(sym.file, sym.id));
                self.out.globals[namespace.idx()].initialization = ir::Initialization::Undefined;
                let namespace_made_so_far = self.emit(fx, Op::GlobalGet(namespace));
                self.emit_forget_evaluation(fx, file);
                self.terminate_with_return(fx, namespace_made_so_far);
            }
            fx.b.switch_to(proceed);
            let (requires, imports, reads, non_default_loader) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
            let evaluated_namespace = fx.b.new_block();
            fx.b.terminate(ir::Term::Switch {
                value: how,
                cases: vec![(1, ir::Target::new(imports)), (2, ir::Target::new(reads)), (11, ir::Target::new(evaluated_namespace)), (12, ir::Target::new(non_default_loader))],
                default: ir::Target::new(requires),
            });
            fx.b.seal(evaluated_namespace);
            fx.b.switch_to(evaluated_namespace);
            if self.is_commonjs(file) {
                fx.b.jump(none);
            } else {
                let finished = self.global_of_module(file, "evaluation finished");
                let known = self.emit(fx, Op::GlobalGet(finished));
                let yes = self.emit(fx, Op::Bool(true));
                let has_succeeded = self.emit(fx, Op::StrictEq { a: known, b: yes });
                let found = fx.b.new_block();
                self.branch(fx, has_succeeded, found, none);
                fx.b.seal(found);
                fx.b.switch_to(found);
                let namespace = self.read_sym(fx, self.files.file_symbol(file), 0);
                self.terminate_with_return(fx, namespace);
            }
            fx.b.seal(imports);
            fx.b.seal(reads);
            fx.b.seal(non_default_loader);
            fx.b.switch_to(non_default_loader);
            if self.is_commonjs(file) {
                let importing = self.variable_of_program("module imported through require");
                let imported = self.emit(fx, Op::GlobalGet(importing));
                let is_this_module = self.emit(fx, Op::StrictEq { a: imported, b: number });
                self.branch(fx, is_this_module, requires, none);
            } else {
                fx.b.jump(none);
            }
            fx.b.seal(requires);
            if !self.is_commonjs(file) {
                fx.b.switch_to(imports);
                let func = self.dynamic_import_of(file, false);
                let promise = self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
                self.terminate_with_return(fx, promise);
                fx.b.switch_to(reads);
                if self.is_async_module(file) {
                    let record = self.module_record_of(file);
                    let record = self.emit(fx, Op::GlobalGet(record));
                    let waits = self.operation(fx, Operation::WaitsForImportFromHost, &[record]);
                    let hands_over = fx.b.new_block();
                    self.branch(fx, waits, hands_over, none);
                    fx.b.seal(hands_over);
                    fx.b.switch_to(hands_over);
                    let namespace = self.read_sym(fx, self.files.file_symbol(file), 0);
                    self.terminate_with_return(fx, namespace);
                } else {
                    if let Some(func) = self.evaluation_of(file) {
                        self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
                    }
                    let namespace = self.read_sym(fx, self.files.file_symbol(file), 0);
                    self.terminate_with_return(fx, namespace);
                }
                fx.b.switch_to(requires);
                if self.is_async_module(file) {
                    fx.b.jump(none);
                } else {
                    if let Some(func) = self.evaluation_by_require_of(file) {
                        self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
                    }
                    let exports = self.required_es_module(fx, file, 0);
                    let name = self.out.strs.intern(b"exports");
                    self.emit_throwing(fx, Op::PropSet { obj: module, name, value: exports });
                    let yes = self.emit(fx, Op::Bool(true));
                    self.terminate_with_return(fx, yes);
                }
                continue;
            }
            for asked in [imports, reads] {
                fx.b.switch_to(asked);
                let path = self.own_path(file, b"path").unwrap_or_default();
                let path = self.out.strs.intern(&path);
                let path = self.emit(fx, Op::Str(path));
                let importing = self.variable_of_program("module imported through require");
                self.emit(fx, Op::GlobalSet(importing, number));
                self.operation(fx, Operation::RequireExternalModule, &[path]);
                let undefined = self.emit(fx, Op::Undefined);
                self.emit(fx, Op::GlobalSet(importing, undefined));
                if asked == reads {
                    let said = self.emit(fx, Op::Int(if self.c.is_in_module_package(file) { 2 } else { 1 }));
                    self.terminate_with_return(fx, said);
                } else {
                    fx.b.jump(none);
                }
            }
            fx.b.switch_to(requires);
            let importing = self.variable_of_program("module imported through require");
            let undefined = self.emit(fx, Op::Undefined);
            self.emit(fx, Op::GlobalSet(importing, undefined));
            let has_object = !self.has_export_variables(file) && self.c.commonjs_exports(file) == CommonJsExports::Object;
            let asked = self.global_of_module(file, if has_object { "evaluated" } else { "handed to the host" });
            let known = self.emit(fx, Op::GlobalGet(asked));
            let undefined = self.emit(fx, Op::Undefined);
            let is_first = self.emit(fx, Op::StrictEq { a: known, b: undefined });
            let first = fx.b.new_block();
            self.branch(fx, is_first, first, none);
            fx.b.seal(first);
            fx.b.switch_to(first);
            let yes = self.emit(fx, Op::Bool(true));
            let own = self.global_of_module(file, "module");
            self.give_require_to_host_module(fx, file, module);
            if has_object {
                self.emit(fx, Op::GlobalSet(own, module));
                self.emit_evaluation_that_forgets_a_failure(fx, file, &[asked]);
                self.terminate_with_return(fx, yes);
                continue;
            }
            self.emit(fx, Op::GlobalSet(asked, yes));
            let flag = self.global_of_module(file, "evaluated");
            let evaluated = self.emit(fx, Op::GlobalGet(flag));
            let has_not_run = self.emit(fx, Op::StrictEq { a: evaluated, b: undefined });
            let (run, ready) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, has_not_run, run, ready);
            fx.b.seal(run);
            fx.b.switch_to(run);
            self.emit(fx, Op::GlobalSet(own, module));
            self.emit_evaluation_that_forgets_a_failure(fx, file, &[asked, flag]);
            fx.b.jump(ready);
            fx.b.seal(ready);
            fx.b.switch_to(ready);
            let exports = match self.c.module_with_export_variables(file) {
                Some(keeper) => self.view_of_export_variables(fx, keeper),
                None => {
                    let global = self.module_exports_variable(file);
                    self.emit(fx, Op::GlobalGet(global))
                }
            };
            let name = self.out.strs.intern(b"exports");
            self.emit_throwing(fx, Op::PropSet { obj: module, name, value: exports });
            self.terminate_with_return(fx, yes);
        }
        fx.b.seal(none);
        fx.b.switch_to(none);
        let no = self.emit(fx, Op::Bool(false));
        self.terminate_with_return(fx, no);
    }

    pub(crate) fn emit_removal_from_the_cache_of_modules(&mut self, fx: &mut Fx, file: FileId) {
        let (Some(path), Some(require)) = (self.own_path(file, b"path"), self.require_function_of(fx, file)) else { return };
        let (path, cache) = (self.out.strs.intern(&path), self.out.strs.intern(b"cache"));
        let path = self.emit(fx, Op::Str(path));
        let cache = self.emit_throwing(fx, Op::PropGet { obj: require, name: cache });
        self.emit_throwing(fx, Op::ElemDelete { obj: cache, key: path });
    }

    fn emit_evaluation_that_forgets_a_failure(&mut self, fx: &mut Fx, file: FileId, marks: &[GlobalId]) {
        let Some(func) = self.evaluation_of(file) else { return };
        let (throwing, finished) = (fx.b.new_block(), fx.b.new_block());
        fx.handlers.push(throwing);
        self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
        fx.handlers.pop();
        fx.b.jump(finished);
        fx.b.seal(throwing);
        fx.b.switch_to(throwing);
        let error = self.emit(fx, Op::Caught);
        if self.second_form_of(file).is_some() {
            self.emit_removal_from_the_cache_of_modules(fx, file);
        } else {
            let undefined = self.emit(fx, Op::Undefined);
            for &mark in marks {
                self.emit(fx, Op::GlobalSet(mark, undefined));
            }
        }
        fx.b.terminate(ir::Term::Throw { value: error, unwind: None, pos: 0 });
        fx.b.seal(finished);
        fx.b.switch_to(finished);
    }

    fn emit_forget_evaluation(&mut self, fx: &mut Fx, file: FileId) {
        let sym = self.files.file_symbol(file);
        let name = self.out.strs.intern(b"namespace");
        let namespace = self.add_global(name, file, Ty::NONE, GlobalKey::Namespace(sym.file, sym.id));
        self.out.globals[namespace.idx()].initialization = ir::Initialization::Undefined;
        let mut globals = vec![self.global_of_module(file, "evaluated"), self.global_of_module(file, "evaluation"), self.global_of_module(file, "evaluation finished"), namespace];
        if self.is_async_module(file) {
            globals.push(self.module_record_of(file));
        }
        let undefined = self.emit(fx, Op::Undefined);
        for global in globals {
            self.emit(fx, Op::GlobalSet(global, undefined));
        }
    }

    pub(crate) fn emit_evaluation_finished(&mut self, fx: &mut Fx, file: FileId, has_thrown: bool) {
        if self.may_be_asked_by_the_host() && !self.is_commonjs(file) && self.host_may_ask_for(file) {
            let finished = self.global_of_module(file, "evaluation finished");
            let succeeded = self.emit(fx, Op::Bool(!has_thrown));
            self.emit(fx, Op::GlobalSet(finished, succeeded));
        }
    }

    fn is_registered_on_demand(&mut self, file: FileId) -> bool {
        let has_object = !self.has_export_variables(file) && self.c.commonjs_exports(file) == CommonJsExports::Object;
        self.may_be_asked_by_the_host() && self.is_commonjs(file) && !self.is_builtin_file(file) && !self.is_second_form(file) && !has_object && !self.shared.roots().contains(&file) && self.own_path(file, b"path").is_some()
    }

    fn emit_registration(&mut self, fx: &mut Fx, file: FileId) {
        let own = self.global_of_module(file, "module");
        let own = self.emit(fx, Op::GlobalGet(own));
        let exports = match self.c.module_with_export_variables(file) {
            Some(keeper) => self.view_of_export_variables(fx, keeper),
            None => {
                let global = self.module_exports_variable(file);
                self.emit(fx, Op::GlobalGet(global))
            }
        };
        let (name, cache) = (self.out.strs.intern(b"exports"), self.out.strs.intern(b"_cache"));
        self.emit_throwing(fx, Op::PropSet { obj: own, name, value: exports });
        let constructor = self.module_constructor(fx);
        let cache = self.emit_throwing(fx, Op::PropGet { obj: constructor, name: cache });
        let path = self.own_path(file, b"path").unwrap_or_default();
        let path = self.out.strs.intern(&path);
        let path = self.emit(fx, Op::Str(path));
        self.emit_throwing(fx, Op::ElemSet { obj: cache, key: path, value: own });
        let handed = self.global_of_module(file, "handed to the host");
        let yes = self.emit(fx, Op::Bool(true));
        self.emit(fx, Op::GlobalSet(handed, yes));
    }

    pub(crate) fn emit_commonjs_epilogue(&mut self, fx: &mut Fx, file: FileId) {
        if !self.is_registered_on_demand(file) {
            return;
        }
        let is_read = self.variable_of_program("require.cache is read");
        let is_read = self.emit(fx, Op::GlobalGet(is_read));
        let undefined = self.emit(fx, Op::Undefined);
        let is_unread = self.emit(fx, Op::StrictEq { a: is_read, b: undefined });
        let (registers, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_unread, done, registers);
        fx.b.seal(registers);
        fx.b.switch_to(registers);
        self.emit_registration(fx, file);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
    }

    pub(crate) fn emit_host_module(&mut self, fx: &mut Fx, file: FileId) -> Option<V> {
        if self.is_second_form(file) {
            return None;
        }
        if !self.may_be_asked_by_the_host() || self.own_path(file, b"path").is_none() || self.is_builtin_file(file) {
            return self.emit_new_host_module(fx, file);
        }
        let global = self.global_of_module(file, "module");
        Some(self.lazily(fx, global, |this, fx| this.emit_new_host_module(fx, file).unwrap_or(V::NONE)))
    }

    fn emit_new_host_module(&mut self, fx: &mut Fx, file: FileId) -> Option<V> {
        let path = self.own_path(file, b"path").filter(|_| !self.is_builtin_file(file))?;
        let has_object = !self.has_export_variables(file) && self.c.commonjs_exports(file) == CommonJsExports::Object;
        let is_registered = has_object || self.shared.roots().contains(&file);
        let path = self.out.strs.intern(&path);
        let path = self.emit(fx, Op::Str(path));
        let constructor = self.module_constructor(fx);
        let module = self.emit_throwing(fx, Op::Construct { callee: constructor, args: [path].into_iter().collect() });
        let require = match self.emit_require_function_bound_to(fx, file, module) {
            Some(require) => require,
            None => self.operation(fx, Operation::GetRequireFunction, &[]),
        };
        let yes = self.emit(fx, Op::Bool(true));
        for (name, value) in [(&b"filename"[..], path), (b"loaded", yes), (b"require", require)] {
            let name = self.out.strs.intern(name);
            self.emit_throwing(fx, Op::PropSet { obj: module, name, value });
        }
        let global = self.global_of_module(file, "parent");
        let parent = self.emit(fx, Op::GlobalGet(global));
        let has_none = self.emit(fx, Op::IsNullish(parent));
        let (alone, required, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        self.branch(fx, has_none, alone, required);
        fx.b.seal(alone);
        fx.b.seal(required);
        fx.b.switch_to(alone);
        let (name, dot) = (self.out.strs.intern(b"id"), self.out.strs.intern(b"."));
        let dot = self.emit(fx, Op::Str(dot));
        self.emit_throwing(fx, Op::PropSet { obj: module, name, value: dot });
        fx.b.jump(join);
        fx.b.switch_to(required);
        let (name, children, push) = (self.out.strs.intern(b"parent"), self.out.strs.intern(b"children"), self.out.strs.intern(b"push"));
        self.emit_throwing(fx, Op::PropSet { obj: module, name, value: parent });
        if !self.c.are_children_of_modules_read() {
            let children = self.emit_throwing(fx, Op::PropGet { obj: parent, name: children });
            self.emit_throwing(fx, Op::CallMethod { obj: children, name: push, args: [module].into_iter().collect() });
        }
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        if is_registered {
            let name = self.out.strs.intern(b"_cache");
            let cache = self.emit_throwing(fx, Op::PropGet { obj: constructor, name });
            self.emit_throwing(fx, Op::ElemSet { obj: cache, key: path, value: module });
        }
        let global = self.global_of_module(file, "module");
        self.emit(fx, Op::GlobalSet(global, module));
        Some(module)
    }

    /// The start of the evaluation of a CommonJS module: `module` and `exports`.
    pub(crate) fn emit_commonjs_prologue(&mut self, fx: &mut Fx, file: FileId) {
        let host_module = if self.is_part_of_the_host_around_the_body(file) { None } else { self.emit_host_module(fx, file) };
        if self.has_export_variables(file) {
            fx.this = self.exports_without_object(fx);
            return;
        }
        if self.c.commonjs_exports(file) == CommonJsExports::Value {
            let exports = self.emit(fx, Op::NewObject);
            let global = self.module_exports_variable(file);
            self.emit(fx, Op::GlobalSet(global, exports));
            let global = self.global_of_module(file, "exports");
            self.emit(fx, Op::GlobalSet(global, exports));
            if let Some(module) = host_module {
                let name = self.out.strs.intern(b"exports");
                self.emit_throwing(fx, Op::PropSet { obj: module, name, value: exports });
            }
            return;
        }
        if let Some(module) = host_module {
            let name = self.out.strs.intern(b"exports");
            let exports = self.emit_throwing(fx, Op::PropGet { obj: module, name });
            let global = self.global_of_module(file, "exports");
            self.emit(fx, Op::GlobalSet(global, exports));
            return;
        }
        let module = self.emit(fx, Op::NewObject);
        let exports = self.emit(fx, Op::NewObject);
        let name = self.out.strs.intern(b"exports");
        let name = self.emit(fx, Op::Str(name));
        self.operation(fx, Operation::DefineField, &[module, name, exports]);
        let global = self.global_of_module(file, "module");
        self.emit(fx, Op::GlobalSet(global, module));
        let global = self.global_of_module(file, "exports");
        self.emit(fx, Op::GlobalSet(global, exports));
    }

    /// Evaluates the module if it has not been.
    pub(crate) fn emit_module_evaluation(&mut self, fx: &mut Fx, file: FileId) {
        let evaluation = self.evaluation_of(file);
        self.emit_call_of_evaluation(fx, file, evaluation);
    }

    fn emit_module_evaluation_by_require(&mut self, fx: &mut Fx, file: FileId) {
        let evaluation = self.evaluation_by_require_of(file);
        self.emit_call_of_evaluation(fx, file, evaluation);
    }

    fn emit_call_of_evaluation(&mut self, fx: &mut Fx, file: FileId, evaluation: Option<crate::id::FuncId>) {
        if let Some(func) = evaluation {
            if self.shared.constants.own_paths.is_some() && self.is_commonjs(file) && self.is_commonjs(fx.file) && !self.is_builtin_file(fx.file) {
                let (own, parent) = (self.global_of_module(fx.file, "module"), self.global_of_module(file, "parent"));
                let module = self.emit(fx, Op::GlobalGet(own));
                self.emit(fx, Op::GlobalSet(parent, module));
                self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
                if !self.is_builtin_file(file) && self.c.are_children_of_modules_read() {
                    self.emit_child_of_module(fx, module, file);
                }
                return;
            }
            self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
        }
    }

    fn emit_child_of_module(&mut self, fx: &mut Fx, module: V, required: FileId) {
        let child = self.global_of_module(required, "module");
        let child = self.emit(fx, Op::GlobalGet(child));
        let has_none = self.emit(fx, Op::IsNullish(child));
        let (looks, lists, done) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        self.branch(fx, has_none, done, looks);
        fx.b.seal(looks);
        fx.b.switch_to(looks);
        let (children, includes, push) = (self.out.strs.intern(b"children"), self.out.strs.intern(b"includes"), self.out.strs.intern(b"push"));
        let children = self.emit_throwing(fx, Op::PropGet { obj: module, name: children });
        let is_listed = self.emit_throwing(fx, Op::CallMethod { obj: children, name: includes, args: [child].into_iter().collect() });
        let is_listed = self.emit(fx, Op::Truthy(is_listed));
        self.branch(fx, is_listed, done, lists);
        fx.b.seal(lists);
        fx.b.switch_to(lists);
        self.emit_throwing(fx, Op::CallMethod { obj: children, name: push, args: [child].into_iter().collect() });
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
    }

    /// `module.exports` of an evaluated CommonJS module, or the value of a JSON module.
    pub(crate) fn exported_object(&mut self, fx: &mut Fx, file: FileId) -> V {
        if self.has_export_variables(file) {
            return self.unsupported(fx, fx.b.pos, "the object of a CommonJS module that has none");
        }
        if self.c.commonjs_exports(file) == CommonJsExports::Value {
            let global = self.module_exports_variable(file);
            return self.emit(fx, Op::GlobalGet(global));
        }
        if self.hir(file).kind != FileKind::Json {
            let global = self.global_of_module(file, "module");
            let module = self.emit(fx, Op::GlobalGet(global));
            let name = self.out.strs.intern(b"exports");
            return self.emit_throwing(fx, Op::PropGet { obj: module, name });
        }
        // A text, or the key in whose place the bundler puts the path of a file once it is known.
        let hir = self.hir(file);
        let string = hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
            StmtKind::ExportAssign(e) => match hir[e].kind {
                ExprKind::String(value) => Some(value),
                _ => None,
            },
            _ => None,
        });
        if let Some(value) = string {
            let value = self.str(value);
            return self.emit(fx, Op::Str(value));
        }
        let global = self.global_of_module(file, "json");
        self.lazily(fx, global, |this, fx| {
            let text = this.out.strs.intern(&this.hir(file).text);
            let text = this.emit(fx, Op::Str(text));
            let whole = this.operation(fx, Operation::ParseJSON, &[text]);
            if this.shared.json_modules_read_by_name.contains(&file) {
                let members = this.emit_members_of_json(fx, file, whole);
                let global = this.global_of_module(file, "members");
                this.emit(fx, Op::GlobalSet(global, members));
            }
            whole
        })
    }

    /// As Node.js has it, `default` is `module.exports` whatever `__esModule` says.
    pub(crate) fn is_node_mode(&self, importer: FileId, file: FileId) -> bool {
        let ignores_the_marker = match self.shared.constants.own_paths {
            Some(_) => self.c.is_in_module_package(file),
            None => self.files.module(importer).implied_format == ResolutionMode::Import,
        };
        ignores_the_marker || self.hir(file).kind == FileKind::Json
    }

    /// What an ES module sees of such a module: `default` and a getter for each property.
    pub(crate) fn namespace_of_exported_object(&mut self, fx: &mut Fx, importer: FileId, file: FileId) -> V {
        if self.is_lifted_by_bundler(file) {
            return self.exported_object(fx, file);
        }
        if self.hir(file).kind == FileKind::Json {
            return self.namespace_of_json(fx, file);
        }
        let is_node_mode = self.is_node_mode(importer, file);
        self.namespace_of_exported_object_as(fx, is_node_mode, file)
    }

    pub(crate) fn is_lifted_by_bundler(&self, file: FileId) -> bool {
        self.shared.constants.lifted_commonjs.contains(self.files.module(file).file_name())
    }

    pub(crate) fn member_of_imported_namespace(&mut self, fx: &mut Fx, importer: FileId, file: FileId, name: &[u8]) -> V {
        if name != b"default" || !self.is_lifted_by_bundler(file) || self.has_export_variables(file) {
            return self.member_of_exported_object(fx, importer, file, name);
        }
        let exported = self.exported_object(fx, file);
        let name = self.out.strs.intern(name);
        let key = self.emit(fx, Op::Str(name));
        let has_own = self.call_builtin(fx, b"Object", b"hasOwn", &[exported, key]);
        let has_own = self.emit(fx, Op::Truthy(has_own));
        let (own, whole, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        self.branch(fx, has_own, own, whole);
        fx.b.seal(own);
        fx.b.seal(whole);
        fx.b.switch_to(own);
        let value = self.emit_throwing(fx, Op::PropGet { obj: exported, name });
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.switch_to(whole);
        self.write(fx, result, exported);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    pub(crate) fn is_seen_through_the_host(&mut self, file: FileId) -> bool {
        self.may_be_asked_by_the_host() && self.is_commonjs(file) && !self.is_builtin_file(file) && !self.has_export_variables(file) && self.own_path(file, b"path").is_some()
    }

    pub(crate) fn namespace_by_the_host(&mut self, fx: &mut Fx, file: FileId) -> V {
        let path = self.own_path(file, b"path").unwrap_or_default();
        let path = self.c.atoms().intern(&path);
        let global = self.external_module_global(file, path);
        self.lazily(fx, global, |this, fx| {
            let path = this.str(path);
            this.emit_throwing(fx, Op::ExternalModule(path))
        })
    }

    fn names_of_json_members(&mut self, file: FileId, are_listed_by_a_bundle: bool) -> Vec<Atom> {
        let hir = self.hir(file);
        let root = hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
            StmtKind::ExportAssign(e) => Some(e),
            _ => None,
        });
        let mut names = vec![known::default];
        if let Some(ExprKind::Object(props)) = root.map(|root| hir[root].kind) {
            for prop in props.iter() {
                let PropKey::Name(name) = hir[prop].key else { continue };
                let text = self.c.atoms().bytes(name);
                if !names.contains(&name) && !(are_listed_by_a_bundle && (!bun_core::string::identifier::is_identifier(text) || matches!(text, b"__proto__" | b"__esModule"))) {
                    names.push(name);
                }
            }
        }
        names.remove(0);
        names
    }

    fn emit_members_of_json(&mut self, fx: &mut Fx, file: FileId, whole: V) -> V {
        let members = self.emit(fx, Op::NewObject);
        for name in self.names_of_json_members(file, false) {
            let text = self.str(name);
            let value = self.emit_throwing(fx, Op::PropGet { obj: whole, name: text });
            let key = self.emit(fx, Op::Str(text));
            self.operation(fx, Operation::DefineField, &[members, key, value]);
        }
        members
    }

    fn members_of_json(&mut self, fx: &mut Fx, file: FileId) -> V {
        let whole = self.exported_object(fx, file);
        let global = self.global_of_module(file, "members");
        self.lazily(fx, global, |this, fx| this.emit_members_of_json(fx, file, whole))
    }

    fn namespace_of_json(&mut self, fx: &mut Fx, file: FileId) -> V {
        let global = self.global_of_module(file, "sorted namespace");
        self.lazily(fx, global, |this, fx| {
            let mut members = this.members_of_json(fx, file);
            if this.shared.constants.own_paths.is_none() && !this.shared.json_modules_loaded_whole.contains(&file) {
                let listed = this.emit(fx, Op::NewObject);
                for name in this.names_of_json_members(file, true) {
                    let text = this.str(name);
                    let value = this.emit_throwing(fx, Op::PropGet { obj: members, name: text });
                    let key = this.emit(fx, Op::Str(text));
                    this.operation(fx, Operation::DefineField, &[listed, key, value]);
                }
                members = listed;
            }
            let read = this.import_of_exported_object(super::Source::DefaultOfExportedObject(file, true), file);
            let read = this.emit(fx, Op::FuncRef(read));
            let name = this.str(known::default);
            let name = this.emit(fx, Op::Str(name));
            let mut arguments = vec![read, name, members];
            if this.shared.constants.own_paths.is_some() {
                arguments.push(this.emit(fx, Op::Bool(true)));
            }
            this.operation(fx, Operation::MakeModuleNamespace, &arguments)
        })
    }

    pub(crate) fn namespace_of_exported_object_as(&mut self, fx: &mut Fx, is_node_mode: bool, file: FileId) -> V {
        if self.is_seen_through_the_host(file) {
            return self.namespace_by_the_host(fx, file);
        }
        if self.hir(file).kind == FileKind::Json && (self.shared.constants.own_paths.is_some() || self.shared.json_modules_read_by_name.contains(&file)) {
            return self.namespace_of_json(fx, file);
        }
        let global = self.global_of_module(file, if is_node_mode { "namespace for Node.js" } else { "namespace" });
        self.lazily(fx, global, |this, fx| {
            let exported = this.exported_object(fx, file);
            let is_node_mode = this.emit(fx, Op::Bool(is_node_mode));
            this.operation(fx, Operation::ToESM, &[exported, is_node_mode])
        })
    }

    /// What the object of `namespace_of_exported_object` has under the name, without that object. Its getter reads the property from what
    /// `module.exports` was when the object was made, on each use. So does this, which remembers what it was at the first use.
    pub(crate) fn member_of_exported_object(&mut self, fx: &mut Fx, importer: FileId, file: FileId, name: &[u8]) -> V {
        if self.has_export_variables(file) {
            let name = self.c.atoms().intern(name);
            return match self.c.export_variable_imported_as(importer, file, name) {
                Some((module, name)) => {
                    let global = self.export_variable(module, name);
                    self.emit(fx, Op::GlobalGet(global))
                }
                None => self.exports_without_object(fx),
            };
        }
        if self.is_seen_through_the_host(file) {
            let namespace = self.namespace_by_the_host(fx, file);
            let name = self.out.strs.intern(name);
            return self.emit_throwing(fx, Op::PropGet { obj: namespace, name });
        }
        let is_default = name == b"default";
        let is_node_mode = self.is_node_mode(importer, file);
        let (global, source) = match (is_default, is_node_mode) {
            (false, _) => ("exported object", super::Source::MemberOfExportedObject(file)),
            (true, is_node_mode) => (name_of_default(is_node_mode), super::Source::DefaultOfExportedObject(file, is_node_mode)),
        };
        let global = self.global_of_module(file, global);
        let name = self.out.strs.intern(name);
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (first, direct, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        self.branch(fx, is_missing, first, direct);
        fx.b.seal(first);
        fx.b.seal(direct);
        fx.b.switch_to(first);
        // Once per module: a copy of it at every read would be the larger part of the read.
        let func = self.import_of_exported_object(source, file);
        let func = self.emit(fx, Op::FuncRef(func));
        let value = if is_default {
            self.operation(fx, Operation::CallNoInline, &[func, undefined])
        } else {
            let key = self.emit(fx, Op::Str(name));
            self.operation(fx, Operation::CallNoInline, &[func, undefined, key])
        };
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.switch_to(direct);
        let value = if is_default { known } else { self.emit_throwing(fx, Op::PropGet { obj: known, name }) };
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    /// What carries out such a read as long as nothing is remembered.
    fn import_of_exported_object(&mut self, source: super::Source, file: FileId) -> crate::id::FuncId {
        let which = match source {
            super::Source::DefaultOfExportedObject(_, is_node_mode) => 1 + is_node_mode as u8,
            _ => 0,
        };
        if let Some(&known) = self.imports_of_exported_objects.get(&(file, which)) {
            return known;
        }
        let name = self.name_after_file("import from", file);
        let module = self.module_of(file);
        let func = self.add_func(name, module, 0, ir::FuncKind::Plain, source);
        if which == 0 {
            self.out.funcs[func.idx()].params = vec![crate::id::TyId::NONE];
            self.out.funcs[func.idx()].length = 1;
        }
        self.imports_of_exported_objects.insert((file, which), func);
        func
    }

    /// `(name)`: `module.exports` is remembered if it is an object. What is no object has no properties for an ES module to see: then
    /// the object of `namespace_of_exported_object` says.
    pub(crate) fn emit_member_of_exported_object(&mut self, fx: &mut Fx, file: FileId) {
        let name = self.add_entry_param(fx, Ty::NONE);
        let global = self.global_of_module(file, "exported object");
        if self.hir(file).kind == FileKind::Json {
            let members = self.members_of_json(fx, file);
            self.emit(fx, Op::GlobalSet(global, members));
            let value = self.emit_throwing(fx, Op::ElemGet { obj: members, key: name });
            return self.terminate_with_return(fx, value);
        }
        let exported = self.exported_object(fx, file);
        let is_object = self.operation(fx, Operation::IsObject, &[exported]);
        let (keep, general) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_object, keep, general);
        fx.b.seal(keep);
        fx.b.seal(general);
        fx.b.switch_to(general);
        let namespace = self.namespace_of_exported_object(fx, file, file);
        let value = self.emit_throwing(fx, Op::ElemGet { obj: namespace, key: name });
        self.terminate_with_return(fx, value);
        fx.b.switch_to(keep);
        self.emit(fx, Op::GlobalSet(global, exported));
        let value = self.emit_throwing(fx, Op::ElemGet { obj: exported, key: name });
        self.terminate_with_return(fx, value);
    }

    /// `default` of that object: what `module.exports` is now, which is remembered. Not as Node.js has it: if that says it was an ES module
    /// and has a `default` of its own, then that, on each use.
    pub(crate) fn emit_default_of_exported_object(&mut self, fx: &mut Fx, file: FileId, is_node_mode: bool) {
        let global = self.global_of_module(file, name_of_default(is_node_mode));
        if is_node_mode {
            let exported = self.exported_object(fx, file);
            self.emit(fx, Op::GlobalSet(global, exported));
            return self.terminate_with_return(fx, exported);
        }
        let name = self.out.strs.intern(b"default");
        let was_module = self.global_of_module(file, "exported object that was an ES module");
        let known = self.emit(fx, Op::GlobalGet(was_module));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (first, object, marked, keep, plain, own) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let source = self.new_temporary(fx);
        self.write(fx, source, known);
        self.branch(fx, is_missing, first, own);
        fx.b.seal(first);
        fx.b.switch_to(first);
        let exported = self.exported_object(fx, file);
        let is_object = self.operation(fx, Operation::IsObject, &[exported]);
        self.branch(fx, is_object, object, plain);
        fx.b.seal(object);
        fx.b.switch_to(object);
        let marker = self.out.strs.intern(b"__esModule");
        let marker = self.emit_throwing(fx, Op::PropGet { obj: exported, name: marker });
        let is_marked = self.emit(fx, Op::Truthy(marker));
        self.branch(fx, is_marked, marked, plain);
        fx.b.seal(marked);
        fx.b.switch_to(marked);
        let key = self.emit(fx, Op::Str(name));
        let has_own = self.call_builtin(fx, b"Object", b"hasOwn", &[exported, key]);
        let has_own = self.emit(fx, Op::Truthy(has_own));
        self.branch(fx, has_own, keep, plain);
        fx.b.seal(keep);
        fx.b.seal(plain);
        fx.b.switch_to(keep);
        self.emit(fx, Op::GlobalSet(was_module, exported));
        self.write(fx, source, exported);
        fx.b.jump(own);
        fx.b.seal(own);
        fx.b.switch_to(plain);
        self.emit(fx, Op::GlobalSet(global, exported));
        self.terminate_with_return(fx, exported);
        fx.b.switch_to(own);
        let source = self.read(fx, source);
        let value = self.emit_throwing(fx, Op::PropGet { obj: source, name });
        self.terminate_with_return(fx, value);
    }

    /// The value of the global, which `make` yields the first time.
    fn lazily(&mut self, fx: &mut Fx, global: GlobalId, make: impl FnOnce(&mut Self, &mut Fx) -> V) -> V {
        let known = self.emit(fx, Op::GlobalGet(global));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (create, join) = (fx.b.new_block(), fx.b.new_block());
        let result = self.new_temporary(fx);
        self.write(fx, result, known);
        self.branch(fx, is_missing, create, join);
        fx.b.seal(create);
        fx.b.switch_to(create);
        let made = make(self, fx);
        self.emit(fx, Op::GlobalSet(global, made));
        self.write(fx, result, made);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    /// Whether the identifier is the one every CommonJS module gets, not a declaration of the program by that name.
    fn is_free(&mut self, fx: &Fx, e: ExprId, name: Atom) -> bool {
        self.is_free_in(fx.file, e, name)
    }

    pub(crate) fn emit_commonjs_variables_declared_again(&mut self, fx: &mut Fx) {
        for (which, name) in [("exports", known::exports), ("module", known::module)] {
            if let Some(sym) = self.c.commonjs_variable_declared_again(fx.file, name) {
                let global = self.global_of_module(fx.file, which);
                let value = self.emit(fx, Op::GlobalGet(global));
                self.write_sym(fx, sym, value, 0);
            }
        }
    }

    fn arguments_of_commonjs_module(&mut self, fx: &mut Fx) -> V {
        let global = self.global_of_module(fx.file, "arguments");
        self.lazily(fx, global, |this, fx| {
            let file = fx.file;
            let exports = this.global_of_module(file, "exports");
            let exports = this.emit(fx, Op::GlobalGet(exports));
            let require = match this.own_require_function(fx) {
                Some(require) => require,
                None => this.operation(fx, Operation::GetRequireFunction, &[]),
            };
            let module = this.global_of_module(file, "module");
            let module = this.emit(fx, Op::GlobalGet(module));
            let path = this.files.module(file).file_name().to_vec();
            let slash = bun_core::strings::last_index_of_char(&path, b'/').unwrap_or(0);
            let (filename, dirname) = (this.out.strs.intern(&path), this.out.strs.intern(&path[..slash.max(1).min(path.len())]));
            let (filename, dirname) = (this.emit(fx, Op::Str(filename)), this.emit(fx, Op::Str(dirname)));
            let all = this.emit_throwing(fx, Op::NewArray([exports, require, module, filename, dirname].into_iter().collect()));
            this.operation(fx, Operation::CreateArguments, &[all])
        })
    }

    pub(crate) fn is_free_in(&mut self, file: FileId, e: ExprId, name: Atom) -> bool {
        let Some(found) = self.c.binding_of_identifier(file, e, name) else { return true };
        if self.files.flags(found).intersects(SymFlags::MODULE_EXPORTS) {
            return true;
        }
        if self.files.decls(found).into_iter().any(|(_, decl)| matches!(decl, Decl::CommonJsVariable | Decl::File)) {
            return true;
        }
        if found.file == file && self.files.flags(found).contains(SymFlags::ALIAS) {
            return false;
        }
        let sym = self.value_symbol(found);
        self.is_ambient(sym)
    }

    /// Where `module` or `exports` is kept, if that is what the identifier refers to. They are variables: `exports = module.exports = {}`.
    pub(crate) fn commonjs_variable_global(&mut self, fx: &Fx, e: ExprId, name: Atom) -> Option<crate::id::GlobalId> {
        let text = self.c.atoms().bytes(name);
        let which = ["module", "exports"].into_iter().find(|it| it.as_bytes() == text)?;
        if !self.is_commonjs(fx.file) || !self.is_free(fx, e, name) {
            return None;
        }
        Some(self.global_of_module(fx.file, which))
    }

    /// What the property `name` of `import.meta` is in the file, where each module reports its own path (`Constants::own_paths`) and the
    /// property is one of those that the bundler puts a string in the place of.
    pub(crate) fn own_path(&self, file: FileId, name: &[u8]) -> Option<Vec<u8>> {
        let file_url = self.shared.constants.own_paths?;
        if self.shared.runtime_helpers() == Some(file) {
            return matches!(name, b"path" | b"filename").then(|| b"bun:wrap".to_vec());
        }
        let path = crate::written_path(self.files.module(file).file_name());
        let slash = bun_core::strings::last_index_of_char(path, b'/')?;
        Some(match name {
            b"dir" | b"dirname" => path[..slash.max(1)].to_vec(),
            b"file" => path[slash + 1..].to_vec(),
            b"path" | b"filename" => path.to_vec(),
            b"url" => file_url(path),
            _ => return None,
        })
    }

    pub(crate) fn import_meta(&mut self, fx: &mut Fx) -> V {
        let mut path_of_module = Vec::new();
        if let Some(path) = self.own_path(fx.file, b"path") {
            let path = self.out.strs.intern(&path);
            path_of_module.push(self.emit(fx, Op::Str(path)));
        }
        self.operation(fx, Operation::GetImportMeta, &path_of_module)
    }

    /// `require` of a module that reports its own path and is no entry point: the host's is the entry point's.
    fn own_require_function(&mut self, fx: &mut Fx) -> Option<V> {
        self.require_function_of(fx, fx.file)
    }

    fn give_require_to_host_module(&mut self, fx: &mut Fx, file: FileId, module: V) {
        let Some(require) = self.emit_require_function_bound_to(fx, file, module) else { return };
        let name = self.out.strs.intern(b"require");
        self.emit_throwing(fx, Op::PropSet { obj: module, name, value: require });
    }

    pub(crate) fn path_that_computed_names_are_asked_from(&self, file: FileId) -> Option<Vec<u8>> {
        let finds_entry_points_by_path = self.shared.constants.own_paths.is_none() && self.shared.bundle.is_some() && self.shared.entry_points().len() > 1;
        (finds_entry_points_by_path && !self.files.module(file).doors_to_files.is_empty()).then(|| crate::written_path(self.files.module(file).file_name()).to_vec())
    }

    fn path_of_require_function(&mut self, file: FileId) -> Option<Vec<u8>> {
        match self.path_that_computed_names_are_asked_from(file) {
            Some(path) => Some(path),
            None => self.own_path(file, b"path").filter(|_| self.is_commonjs(file) || self.shared.roots().len() > 1 || !self.shared.roots().contains(&file)),
        }
    }

    fn require_function_of(&mut self, fx: &mut Fx, file: FileId) -> Option<V> {
        let path = self.path_of_require_function(file)?;
        let global = self.global_of_module(file, "require");
        Some(self.lazily(fx, global, |this, fx| {
            let own = (this.shared.constants.own_paths.is_some() && this.is_commonjs(file)).then(|| {
                let own = this.global_of_module(file, "module");
                this.emit(fx, Op::GlobalGet(own))
            });
            this.emit_new_require_function(fx, &path, own)
        }))
    }

    fn emit_require_function_bound_to(&mut self, fx: &mut Fx, file: FileId, module: V) -> Option<V> {
        let path = self.path_of_require_function(file)?;
        let require = self.emit_new_require_function(fx, &path, Some(module));
        let global = self.global_of_module(file, "require");
        self.emit(fx, Op::GlobalSet(global, require));
        Some(require)
    }

    fn emit_new_require_function(&mut self, fx: &mut Fx, path: &[u8], asking_module: Option<V>) -> V {
        let (create, path) = (self.out.strs.intern(b"createRequire"), self.out.strs.intern(path));
        let constructor = self.module_constructor(fx);
        let path = self.emit(fx, Op::Str(path));
        match asking_module {
            Some(this) => {
                let callee = self.emit_throwing(fx, Op::PropGet { obj: constructor, name: create });
                self.emit_throwing(fx, Op::Call { callee, this, args: [path].into_iter().collect() })
            }
            None => self.emit_throwing(fx, Op::CallMethod { obj: constructor, name: create, args: [path].into_iter().collect() }),
        }
    }

    fn module_constructor(&mut self, fx: &mut Fx) -> V {
        let global = self.variable_of_program("Module");
        self.lazily(fx, global, |this, fx| {
            let (specifier, name) = (this.out.strs.intern(b"node:module"), this.out.strs.intern(b"default"));
            let namespace = this.emit_throwing(fx, Op::ExternalModule(specifier));
            this.emit_throwing(fx, Op::PropGet { obj: namespace, name })
        })
    }

    fn require_through_host(&mut self, fx: &mut Fx, specifier: Atom) -> V {
        let own = if self.is_commonjs(fx.file) { self.emit_host_module(fx, fx.file) } else { None };
        let (callee, this) = match own {
            Some(own) => {
                let (prototype, require) = (self.out.strs.intern(b"prototype"), self.out.strs.intern(b"require"));
                let constructor = self.module_constructor(fx);
                let prototype = self.emit_throwing(fx, Op::PropGet { obj: constructor, name: prototype });
                (Some(self.emit_throwing(fx, Op::PropGet { obj: prototype, name: require })), own)
            }
            None => (self.own_require_function(fx), self.emit(fx, Op::Undefined)),
        };
        let specifier = self.str(specifier);
        let specifier = self.emit(fx, Op::Str(specifier));
        match callee {
            Some(callee) => self.emit_throwing(fx, Op::Call { callee, this, args: [specifier].into_iter().collect() }),
            None => self.operation(fx, Operation::RequireExternalModule, &[specifier]),
        }
    }

    /// `test`, `expect`, `describe`: what `bun test` imports from `bun:test` on behalf of a file that imports nothing from there, nor from
    /// what it takes for the same.
    pub(crate) fn test_runner_variable(&mut self, fx: &mut Fx, e: ExprId, name: Atom) -> Option<V> {
        const NAMES: [&[u8]; 14] =
            [b"test", b"it", b"describe", b"expect", b"expectTypeOf", b"beforeAll", b"beforeEach", b"afterEach", b"afterAll", b"jest", b"vi", b"xit", b"xtest", b"xdescribe"];
        if !self.shared.constants.has_test_globals || !NAMES.contains(&self.c.atoms().bytes(name)) || !self.is_free(fx, e, name) {
            return None;
        }
        let imports_it = |specifier: &Atom| matches!(self.c.atoms().bytes(*specifier), b"bun:test" | b"@jest/globals" | b"vitest");
        if self.c.bound(fx.file).specifiers.iter().any(imports_it) {
            return None;
        }
        let module = self.out.strs.intern(b"bun:test");
        let module = self.emit(fx, Op::Str(module));
        let module = self.operation(fx, Operation::RequireExternalModule, &[module]);
        let name = self.str(name);
        Some(self.emit_throwing(fx, Op::PropGet { obj: module, name }))
    }

    /// `module`, `exports`, `require`, `__filename` and `__dirname`.
    pub(crate) fn commonjs_variable(&mut self, fx: &mut Fx, e: ExprId, name: Atom) -> Option<V> {
        let text = self.c.atoms().bytes(name);
        let which = ["module", "exports", "require", "arguments"].into_iter().find(|it| it.as_bytes() == text)?;
        if matches!(which, "module" | "exports" | "arguments") && !self.is_commonjs(fx.file) {
            return None;
        }
        if !self.is_free(fx, e, name) {
            return None;
        }
        Some(match which {
            "arguments" => self.arguments_of_commonjs_module(fx),
            "module" if self.c.commonjs_exports(fx.file) != CommonJsExports::Object => self.unsupported(fx, fx.b.pos, "the `module` object of a CommonJS module that has none"),
            "module" | "exports" => {
                let global = self.global_of_module(fx.file, which);
                self.emit(fx, Op::GlobalGet(global))
            }
            _ => match self.own_require_function(fx) {
                Some(require) => require,
                None => self.operation(fx, Operation::GetRequireFunction, &[]),
            },
        })
    }

    pub(crate) fn require_resolve_call(&mut self, fx: &mut Fx, call: CallId) -> Option<V> {
        use bun_sema::hir::Chain;
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let ExprKind::Dot { obj, name, chain: Chain::No, .. } = hir[c.callee].kind else { return None };
        let ExprKind::Ident(require) = hir[obj].kind else { return None };
        let is_named_require = self.c.atoms().bytes(require) == b"require";
        if self.c.atoms().bytes(name) != b"resolve" || c.args.len() != 1 || c.chain != Chain::No || !is_named_require && !self.c.create_require_candidates(fx.file).contains(&require) {
            return None;
        }
        let ExprKind::String(specifier) = hir[hir.id_at(c.args, 0)].kind else { return None };
        let is_executable = self.shared.constants.resolved.is_some() && self.shared.constants.own_paths.is_none();
        if !is_executable || self.is_builtin_file(fx.file) {
            return None;
        }
        if !(is_named_require && self.is_free(fx, obj, require)) {
            if !self.c.names_require_made_for_its_file(fx.file, obj) {
                return None;
            }
            self.expr_for_effect(fx, obj);
        }
        let path = self.files.module(fx.file).file_name();
        let slash = bun_core::strings::last_index_of_char(path, b'/')?;
        let (folder, paths, resolve) = (self.out.strs.intern(&path[..slash.max(1)]), self.out.strs.intern(b"paths"), self.out.strs.intern(b"resolve"));
        let require = self.operation(fx, Operation::GetRequireFunction, &[]);
        let specifier = self.str(specifier);
        let specifier = self.emit(fx, Op::Str(specifier));
        let folder = self.emit(fx, Op::Str(folder));
        let folders = self.emit_throwing(fx, Op::NewArray([folder].into_iter().collect()));
        let options = self.emit(fx, Op::NewObject);
        let paths = self.emit(fx, Op::Str(paths));
        self.operation(fx, Operation::DefineField, &[options, paths, folders]);
        Some(self.emit_throwing(fx, Op::CallMethod { obj: require, name: resolve, args: [specifier, options].into_iter().collect() }))
    }

    pub(crate) fn create_require_call(&mut self, fx: &mut Fx, call: CallId) -> Option<V> {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let path = self.path_that_computed_names_are_asked_from(fx.file)?;
        if c.chain != bun_sema::hir::Chain::No || !self.c.makes_require_for_its_file(fx.file, call) {
            return None;
        }
        let path = self.out.strs.intern(&path);
        if let ExprKind::Dot { obj, name, .. } = hir[c.callee].kind {
            let obj = self.expr(fx, obj);
            let name = self.str(name);
            let path = self.emit(fx, Op::Str(path));
            return Some(self.emit_throwing(fx, Op::CallMethod { obj, name, args: [path].into_iter().collect() }));
        }
        let callee = self.expr(fx, c.callee);
        let this = self.emit(fx, Op::Undefined);
        let path = self.emit(fx, Op::Str(path));
        Some(self.emit_throwing(fx, Op::Call { callee, this, args: [path].into_iter().collect() }))
    }

    fn variable_of_what_the_host_loads(&mut self, keeper: FileId, key: crate::id::StrId) -> GlobalId {
        if let Some(&(_, global)) = self.external_modules.iter().find(|&&(known, _)| known == key) {
            return global;
        }
        let global = self.add_global(key, keeper, Ty::NONE, GlobalKey::ExternalModule(self.out.strs.get(key).into()));
        self.external_modules.push((key, global));
        self.out.globals[global.idx()].initialization = ir::Initialization::Undefined;
        global
    }

    pub(crate) fn emit_value_of_asset(&mut self, fx: &mut Fx, file: FileId, specifier: Atom, text: &[u8]) -> V {
        let interned = self.out.strs.intern(text);
        let text = self.emit(fx, Op::Str(interned));
        let Some(kind) = self.asset_the_host_loads(file, specifier) else { return text };
        if matches!(kind, super::imports::HostLoads::Manifest) {
            let hir = self.hir(file);
            let said = hir.ids(hir.body).find_map(|stmt| match hir[stmt].kind {
                StmtKind::Import(import) if hir[import].spec == specifier => Some(self.type_attribute(file, stmt)),
                _ => None,
            });
            if self.shared.constants.own_paths.is_some() && self.is_reached_otherwise_than_with_type(file, specifier, said.flatten()) {
                return self.unsupported(fx, fx.b.pos, "an import of an HTML page that the program also loads with `import()` and options");
            }
            let global = self.variable_of_what_the_host_loads(file, interned);
            return self.lazily(fx, global, |this, fx| this.operation(fx, Operation::ParseJSON, &[text]));
        }
        if let super::imports::HostLoads::OfType(said) = kind {
            if self.is_reached_otherwise_than_with_type(file, specifier, Some(said)) {
                return self.unsupported(fx, fx.b.pos, "an import `with { type: .. }` of a file that the program also loads with `require()`, without a type or with a different type");
            }
            let asked_for = self.as_the_host_finds_it(file, specifier);
            let key = [self.c.atoms().bytes(asked_for), b" with type ", self.c.atoms().bytes(said)].concat();
            let key = self.out.strs.intern(&key);
            let global = self.variable_of_what_the_host_loads(file, key);
            let namespace = self.lazily(fx, global, |this, fx| {
                let asked_for = this.str(asked_for);
                let asked_for = this.emit(fx, Op::Str(asked_for));
                let said = this.str(said);
                let said = this.emit(fx, Op::Str(said));
                this.operation(fx, Operation::GetExternalModuleWithType, &[asked_for, said])
            });
            let name = self.out.strs.intern(b"default");
            return self.emit_throwing(fx, Op::PropGet { obj: namespace, name });
        }
        let require = self.operation(fx, Operation::GetRequireFunction, &[]);
        let this = self.emit(fx, Op::Undefined);
        if matches!(kind, super::imports::HostLoads::Addon) {
            return self.emit_throwing(fx, Op::Call { callee: require, this, args: [text].into_iter().collect() });
        }
        let (name, sqlite, db) = (self.out.strs.intern(b"type"), self.out.strs.intern(b"sqlite"), self.out.strs.intern(b"db"));
        let options = self.emit(fx, Op::NewObject);
        let name = self.emit(fx, Op::Str(name));
        let sqlite = self.emit(fx, Op::Str(sqlite));
        self.operation(fx, Operation::DefineField, &[options, name, sqlite]);
        let module = self.emit_throwing(fx, Op::Call { callee: require, this, args: [text, options].into_iter().collect() });
        self.emit_throwing(fx, Op::PropGet { obj: module, name: db })
    }

    pub(crate) fn position_of_required_path(&mut self, fx: &Fx, call: CallId) -> Option<u32> {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        let ExprKind::Ident(name) = hir[c.callee].kind else { return None };
        if self.c.atoms().bytes(name) != b"require" || c.args.len() != 1 {
            return None;
        }
        let argument = hir.id_at(c.args, 0);
        (hir.constant_specifier(argument).is_some() && self.is_free(fx, c.callee, name)).then(|| hir[argument].pos)
    }

    /// `require("specifier")`
    pub(crate) fn require_call(&mut self, fx: &mut Fx, call: CallId) -> Option<V> {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        if let ExprKind::Dot { obj, .. } = hir[c.callee].kind
            && c.args.len() == 1
            && hir.is_written_as_require(c.callee)
            && self.is_commonjs(fx.file)
            && self.is_free(fx, obj, known::module)
        {
            let argument = hir.id_at(c.args, 0);
            return hir.choice_of_specifiers(argument, &mut Vec::new()).then(|| self.require_choice(fx, call, argument));
        }
        let ExprKind::Ident(name) = hir[c.callee].kind else { return None };
        let is_named_require = self.c.atoms().bytes(name) == b"require";
        if c.args.len() != 1 || !is_named_require && !self.c.create_require_candidates(fx.file).contains(&name) {
            return None;
        }
        let argument = hir.id_at(c.args, 0);
        let mut specifiers = Vec::new();
        if !hir.choice_of_specifiers(argument, &mut specifiers) {
            return None;
        }
        if !(is_named_require && self.is_free(fx, c.callee, name)) {
            let is_seen_by_the_checker = is_named_require || matches!(hir[argument].kind, ExprKind::String(_));
            if !is_seen_by_the_checker || !self.c.names_require_made_for_its_file(fx.file, c.callee) {
                return None;
            }
            self.expr_for_effect(fx, c.callee);
        }
        Some(self.require_choice(fx, call, argument))
    }

    fn require_choice(&mut self, fx: &mut Fx, call: CallId, argument: ExprId) -> V {
        let hir = self.hir(fx.file);
        let ExprKind::Cond { test, yes, no } = hir[argument].kind else {
            fx.b.pos = hir[argument].pos;
            let required = hir.constant_specifier(argument).and_then(|specifier| self.require_specifier(fx, call, specifier));
            debug_assert!(required.is_some());
            return required.unwrap_or_else(|| self.emit(fx, Op::Undefined));
        };
        if let Some(test) = self.constant(fx, test) {
            let (taken, left_out) = if test.is_truthy() { (yes, no) } else { (no, yes) };
            self.cut_expr(fx, left_out);
            return self.require_choice(fx, call, taken);
        }
        let (then, otherwise, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
        let result = self.new_result(fx, None);
        self.branch_on(fx, test, then, otherwise);
        fx.b.seal(then);
        fx.b.seal(otherwise);
        fx.b.switch_to(then);
        let value = self.require_choice(fx, call, yes);
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.switch_to(otherwise);
        let value = self.require_choice(fx, call, no);
        self.write(fx, result, value);
        fx.b.jump(join);
        fx.b.seal(join);
        fx.b.switch_to(join);
        self.read(fx, result)
    }

    fn require_specifier(&mut self, fx: &mut Fx, call: CallId, specifier: Atom) -> Option<V> {
        let hir = self.hir(fx.file);
        let c = &hir[call];
        if self.is_builtin_file(fx.file) {
            let Some(id) = self.builtin_id_required_by(fx.file, specifier) else {
                return Some(self.unsupported(fx, hir[c.callee].pos, "a `require` of something that is not a builtin module"));
            };
            let id = self.emit(fx, Op::Int(id as i64));
            return Some(self.operation(fx, Operation::RequireBuiltinModule, &[id]));
        }
        if matches!(self.asset_the_host_loads(fx.file, specifier), Some(super::imports::HostLoads::Manifest)) {
            return Some(self.unsupported(fx, hir[c.callee].pos, "a `require` of an HTML page: use `import page from` instead"));
        }
        // A file that is loaded as a string, or for its path.
        if let Some(text) = self.text_imported_as(fx.file, specifier) {
            return Some(self.emit_value_of_asset(fx, fx.file, specifier, text));
        }
        let Some(imported) = self.required_file(fx.file, specifier) else {
            if self.is_in_the_bundle_only(fx.file, specifier) {
                return Some(self.unsupported(fx, hir[c.callee].pos, "a `require` of a file that is neither code nor a constant"));
            }
            // A path is relative to the module that writes it. What the bundler has not found may be there by the time it is asked for.
            let text = self.c.atoms().bytes(specifier);
            let is_path = text.starts_with(b"./") || text.starts_with(b"../") || text.starts_with(b"/");
            let require = if is_path || !super::imports::is_builtin_specifier(text) { self.own_require_function(fx) } else { None };
            let specifier = self.str(specifier);
            let specifier = self.emit(fx, Op::Str(specifier));
            return Some(match require {
                Some(callee) => {
                    let this = self.emit(fx, Op::Undefined);
                    self.emit_throwing(fx, Op::Call { callee, this, args: [specifier].into_iter().collect() })
                }
                None => self.operation(fx, Operation::RequireExternalModule, &[specifier]),
            });
        };
        if let Some(id) = self.builtin_id(imported) {
            let id = self.emit(fx, Op::Int(id as i64));
            return Some(self.operation(fx, Operation::RequireBuiltinModule, &[id]));
        }
        if self.is_async_module(imported) {
            return Some(self.unsupported(fx, hir[c.callee].pos, "a `require` of a module that has a top-level `await` or imports one that does"));
        }
        if self.may_be_asked_by_the_host() && self.hir(imported).kind == FileKind::Json {
            return Some(self.require_through_host(fx, specifier));
        }
        if self.may_be_asked_by_the_host()
            && (if self.is_commonjs(imported) { !self.has_export_variables(imported) } else { self.host_may_ask_for(imported) })
            && self.own_path(imported, b"path").is_some()
        {
            let is_read = self.variable_of_program("require.cache is read");
            let known = self.emit(fx, Op::GlobalGet(is_read));
            let undefined = self.emit(fx, Op::Undefined);
            let is_unread = self.emit(fx, Op::StrictEq { a: known, b: undefined });
            let (unread, read, join) = (fx.b.new_block(), fx.b.new_block(), fx.b.new_block());
            let result = self.new_temporary(fx);
            self.branch(fx, is_unread, unread, read);
            fx.b.seal(unread);
            fx.b.seal(read);
            fx.b.switch_to(read);
            let value = self.require_through_host(fx, specifier);
            self.write(fx, result, value);
            fx.b.jump(join);
            fx.b.switch_to(unread);
            self.emit_module_evaluation_by_require(fx, imported);
            let value = if self.exports_an_object(imported) {
                self.exported_object(fx, imported)
            } else {
                self.required_es_module(fx, imported, hir[c.callee].pos)
            };
            self.write(fx, result, value);
            fx.b.jump(join);
            fx.b.seal(join);
            fx.b.switch_to(join);
            return Some(self.read(fx, result));
        }
        if self.how_es_module_is_required(imported) != RequiredEsModule::Unbound {
            self.emit_require_of_es_module(fx, imported);
            return Some(self.read_sym(fx, self.files.file_symbol(imported), hir[c.callee].pos));
        }
        self.emit_module_evaluation_by_require(fx, imported);
        if self.exports_an_object(imported) {
            return Some(self.exported_object(fx, imported));
        }
        let pos = hir[c.callee].pos;
        Some(self.required_es_module(fx, imported, pos))
    }

    pub(crate) fn emit_import_by_require(&mut self, fx: &mut Fx, specifier: Atom, pos: u32) {
        if specifier.is_none() || self.is_dropped_import(fx.file, specifier) || self.text_imported_as(fx.file, specifier).is_some() {
            return;
        }
        let Some(imported) = self.required_file(fx.file, specifier) else {
            let global = self.external_module_global(fx.file, specifier);
            let known = self.emit(fx, Op::GlobalGet(global));
            let undefined = self.emit(fx, Op::Undefined);
            let is_missing = self.emit(fx, Op::StrictEq { a: known, b: undefined });
            let (first, there) = (fx.b.new_block(), fx.b.new_block());
            self.branch(fx, is_missing, first, there);
            fx.b.seal(first);
            fx.b.switch_to(first);
            let asked_for = self.as_the_host_finds_it(fx.file, specifier);
            let asked_for = self.str(asked_for);
            let namespace = self.emit_throwing(fx, Op::ExternalModule(asked_for));
            self.emit(fx, Op::GlobalSet(global, namespace));
            fx.b.jump(there);
            fx.b.seal(there);
            fx.b.switch_to(there);
            return;
        };
        if let Some(id) = self.builtin_id(imported) {
            let id = self.emit(fx, Op::Int(id as i64));
            self.operation(fx, Operation::RequireBuiltinModule, &[id]);
            return;
        }
        if self.is_async_module(imported) {
            return self.problem(fx.file, pos, "a `require` of a module that has a top-level `await` or imports one that does");
        }
        if self.how_es_module_is_required(imported) != RequiredEsModule::Unbound {
            return self.emit_require_of_es_module(fx, imported);
        }
        self.emit_module_evaluation_by_require(fx, imported);
        if !self.exports_an_object(imported) {
            self.required_es_module(fx, imported, pos);
        }
    }

    fn required_es_module(&mut self, fx: &mut Fx, imported: FileId, pos: u32) -> V {
        let exports = self.exports_of_file(imported);
        let named = |name: &[u8]| exports.iter().find(|export| self.c.atoms().bytes(export.0) == name).map(|export| export.1);
        let declares_es_module_itself = named(b"__esModule").is_some();
        // `export { x as "module.exports" }`
        if let Some(source) = named(b"module.exports") {
            if self.files.export(self.files.file_symbol(imported), known::export_equals).is_some() {
                return self.read_member_of_namespace(fx, source);
            }
            let yielded = self.global_of_module(imported, "what require yields");
            return self.lazily(fx, yielded, |this, fx| {
                let value = this.read_member_of_namespace(fx, source);
                let result = this.new_temporary(fx);
                this.write(fx, result, value);
                let is_nothing = this.emit(fx, Op::IsNullish(value));
                let (whole, join) = (fx.b.new_block(), fx.b.new_block());
                this.branch(fx, is_nothing, whole, join);
                fx.b.seal(whole);
                fx.b.switch_to(whole);
                let namespace = this.namespace_that_require_yields(fx, imported, declares_es_module_itself, pos);
                this.write(fx, result, namespace);
                fx.b.jump(join);
                fx.b.seal(join);
                fx.b.switch_to(join);
                this.read(fx, result)
            });
        }
        self.namespace_that_require_yields(fx, imported, declares_es_module_itself, pos)
    }

    pub(crate) fn what_require_has_yielded(&mut self, fx: &mut Fx, file: FileId) -> V {
        let yielded = self.global_of_module(file, "what require yields");
        self.emit(fx, Op::GlobalGet(yielded))
    }

    fn namespace_that_require_yields(&mut self, fx: &mut Fx, imported: FileId, declares_es_module_itself: bool, pos: u32) -> V {
        let namespace = self.read_sym(fx, self.files.file_symbol(imported), pos);
        // From now on it says that it is an ES module, to whoever asks.
        if !declares_es_module_itself {
            let key = self.out.strs.intern(b"__esModule");
            let (key, yes) = (self.emit(fx, Op::Str(key)), self.emit(fx, Op::Bool(true)));
            self.operation(fx, Operation::DefineField, &[namespace, key, yes]);
        }
        namespace
    }

    pub(crate) fn how_es_module_is_required(&mut self, module: FileId) -> RequiredEsModule {
        if let Some(&known) = self.es_modules_required.get(&module) {
            return known;
        }
        let is_es_module = !self.exports_an_object(module) && !self.is_builtin_file(module) && !self.is_async_module(module) && !self.is_evaluated_otherwise_by_require(module);
        let has_the_host_a_say = self.may_be_asked_by_the_host() && self.host_may_ask_for(module) && self.own_path(module, b"path").is_some();
        let how = if !is_es_module || has_the_host_a_say {
            RequiredEsModule::Unbound
        } else {
            let exports = self.exports_of_file(module);
            let exports_as = |name: &[u8]| exports.iter().any(|export| self.c.atoms().bytes(export.0) == name);
            if exports_as(b"module.exports") {
                RequiredEsModule::Unbound
            } else if exports_as(b"__esModule") {
                RequiredEsModule::AsItIs
            } else {
                RequiredEsModule::Marked
            }
        };
        self.es_modules_required.insert(module, how);
        how
    }

    fn has_requires(&mut self, file: FileId) -> bool {
        if let Some(&known) = self.files_with_requires.get(&file) {
            return known;
        }
        let hir = self.hir(file);
        let may_have = hir.calls.iter().any(|call| matches!(hir[call.callee].kind, ExprKind::Ident(known::require))) || hir.specifier_uses.iter().any(|used| used.kind == SpecifierKind::ImportCall);
        let found = may_have
            && (0..hir.exprs.len()).map(|at| ExprId(at as u32)).any(|e| match hir[e].kind {
                ExprKind::Call(_) => self.es_module_required_by(file, e).is_some(),
                ExprKind::Await(_) => self.es_module_imported_by(file, e).is_some(),
                _ => false,
            });
        self.files_with_requires.insert(file, found);
        found
    }

    pub(crate) fn es_module_required_by(&mut self, file: FileId, e: ExprId) -> Option<FileId> {
        let hir = self.hir(file);
        match hir[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.es_module_required_by(file, expr),
            ExprKind::Cond { test, yes, no } if self.has_requires(file) => {
                let outer = std::mem::replace(&mut self.only_asks, true);
                let test = self.constant_in(file, test);
                self.only_asks = outer;
                self.es_module_required_by(file, if test?.is_truthy() { yes } else { no })
            }
            ExprKind::Call(call) => {
                let c = &hir[call];
                let ExprKind::Ident(name @ known::require) = hir[c.callee].kind else { return None };
                if c.args.len() != 1 || c.chain != bun_sema::hir::Chain::No || self.is_builtin_file(file) || !self.is_free_in(file, c.callee, name) {
                    return None;
                }
                let specifier = hir.constant_specifier(hir.id_at(c.args, 0))?;
                if self.asset_the_host_loads(file, specifier).is_some() || self.text_imported_as(file, specifier).is_some() {
                    return None;
                }
                let module = self.required_file(file, specifier)?;
                (self.how_es_module_is_required(module) != RequiredEsModule::Unbound).then_some(module)
            }
            _ => None,
        }
    }

    pub(crate) fn es_module_held_by(&mut self, sym: Sym) -> Option<FileId> {
        if !self.has_requires(sym.file) {
            return None;
        }
        let (file, init) = self.c.initializer_of_const(sym)?;
        let module = self.es_module_required_by(file, init).or_else(|| self.es_module_imported_by(file, init))?;
        Some(module)
    }

    pub(crate) fn es_module_imported_by(&mut self, file: FileId, e: ExprId) -> Option<FileId> {
        let hir = self.hir(file);
        let promise = match hir[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => return self.es_module_imported_by(file, expr),
            ExprKind::Await(promise) => promise,
            _ => return None,
        };
        let ExprKind::ImportCall { args } = hir[promise].kind else { return None };
        let ExprKind::String(specifier) = hir[hir.id_at(args, 0)].kind else { return None };
        if args.len() != 1 || self.shared.constants.own_paths.is_some() || self.is_builtin_file(file) || hir.deferred_import_calls.iter().any(|call| call.0 == hir.id_at(args, 0)) {
            return None;
        }
        let module = self.imported_file(file, specifier)?;
        let is_es_module = !self.exports_an_object(module) && !self.is_builtin_file(module) && self.second_form_of(module).is_none();
        (is_es_module && self.is_known_not_to_export(module, known::then)).then_some(module)
    }

    fn is_type_of_module(&mut self, seen_as: Option<bun_sema::types::TypeId>, module: FileId) -> bool {
        seen_as.is_none_or(|seen_as| self.c.non_nullable(seen_as) == self.c.type_of_symbol(self.files.file_symbol(module)))
    }

    pub(crate) fn required_module_named_by(&mut self, file: FileId, e: ExprId) -> Option<FileId> {
        if !self.has_requires(file) {
            return None;
        }
        let module = self.required_module_under_assertions(file, e)?;
        let seen_as = if self.is_untyped_file(file) { None } else { Some(self.c.type_of_expr(file, e)) };
        self.is_type_of_module(seen_as, module).then_some(module)
    }

    pub(crate) fn required_module_looked_at_by(&mut self, file: FileId, e: ExprId) -> Option<FileId> {
        if !self.has_requires(file) {
            return None;
        }
        self.required_module_under_assertions(file, e)
    }

    pub(crate) fn as_the_module_is_looked_at(&mut self, fx: &mut Fx, module: ExprId, value: V) -> V {
        let anything = self.out.tys.anything;
        if self.ty(fx, value) == anything || self.required_module_named_by(fx.file, module).is_some() {
            return value;
        }
        self.emit(fx, Op::Coerce { value, to: anything, why: ir::Why::Upcast })
    }

    fn required_module_under_assertions(&mut self, file: FileId, e: ExprId) -> Option<FileId> {
        match self.hir(file)[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) => self.required_module_under_assertions(file, expr),
            ExprKind::Ident(name) => {
                let sym = self.c.binding_of_identifier(file, e, name)?;
                let sym = self.value_symbol(sym);
                self.es_module_held_by(sym)
            }
            ExprKind::Dot { obj, name, .. } => {
                let module = self.required_module_under_assertions(file, obj)?;
                let member = self.binding_exported_as(module, name)?;
                (matches!(self.value_declaration(member), Some((_, Decl::File))) && !self.exports_an_object(member.file)).then_some(member.file)
            }
            ExprKind::Call(_) | ExprKind::Cond { .. } => self.es_module_required_by(file, e),
            ExprKind::Await(_) => self.es_module_imported_by(file, e),
            _ => None,
        }
    }

    pub(crate) fn evaluate_name_of_required_module(&mut self, fx: &mut Fx, e: ExprId) {
        let hir = self.hir(fx.file);
        match hir[e].kind {
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Dot { obj: expr, .. } => self.evaluate_name_of_required_module(fx, expr),
            ExprKind::Ident(name) => {
                if let Some(sym) = self.c.binding_of_identifier(fx.file, e, name) {
                    let sym = self.value_symbol(sym);
                    self.find_holder_initialized(fx, sym, e);
                }
            }
            ExprKind::Cond { test, yes, no } => {
                let Some(test) = self.constant(fx, test) else { return };
                let (taken, left_out) = if test.is_truthy() { (yes, no) } else { (no, yes) };
                self.cut_expr(fx, left_out);
                self.evaluate_name_of_required_module(fx, taken);
            }
            ExprKind::Call(call) => {
                let Some(module) = self.es_module_required_by(fx.file, e) else { return };
                fx.b.pos = hir[hir.id_at(hir[call].args, 0)].pos;
                self.emit_require_of_es_module(fx, module);
            }
            ExprKind::Await(_) => self.expr_for_effect(fx, e),
            _ => {}
        }
    }

    pub(crate) fn member_of_required_module(&mut self, fx: &mut Fx, obj: ExprId, name: Atom) -> Option<Sym> {
        let module = self.required_module_looked_at_by(fx.file, obj)?;
        let member = self.binding_exported_as(module, name).filter(|&member| self.has_value_at_runtime(member))?;
        self.evaluate_name_of_required_module(fx, obj);
        Some(member)
    }

    pub(crate) fn bind_exports_of_required_module(&mut self, fx: &mut Fx, pat: PatId, from: ExprId) -> bool {
        let hir = self.hir(fx.file);
        let PatKind::Object(props) = hir[pat].kind else { return false };
        let Some(module) = self.required_module_looked_at_by(fx.file, from) else { return false };
        let mut members = Vec::new();
        for p in props.iter() {
            let prop = &hir[p];
            let name = match (prop.key, hir[prop.value].kind) {
                _ if prop.is_rest => return false,
                (PropKey::Name(name), _) | (PropKey::None, PatKind::Ident(name)) => name,
                _ => return false,
            };
            let Some(member) = self.binding_exported_as(module, name).filter(|&member| self.has_value_at_runtime(member)) else { return false };
            members.push(member);
        }
        self.evaluate_name_of_required_module(fx, from);
        for (p, member) in props.iter().zip(members) {
            let prop = &hir[p];
            let value = self.read_sym(fx, member, hir[prop.value].pos);
            let mut value = self.as_the_module_is_looked_at(fx, from, value);
            if prop.default.is_some() {
                value = self.emit_default_initializer(fx, value, prop.default, self.name_of_pat(fx, prop.value));
            }
            self.bind_pat(fx, prop.value, value);
        }
        true
    }

    pub(crate) fn export_copied_by(&mut self, sym: Sym) -> Option<Sym> {
        if !self.has_requires(sym.file) {
            return None;
        }
        let (file, Decl::Var(pat)) = self.value_declaration(sym)? else { return None };
        let (hir, bound) = (self.hir(file), self.c.bound(file));
        let PatParent::Prop(whole, prop) = bound.pat_parent[pat.idx()] else { return None };
        let PatParent::Var(declaration) = bound.pat_parent[whole.idx()] else { return None };
        let (declaration, prop) = (&hir[declaration], &hir[prop]);
        if declaration.kind != VarKind::Const || declaration.init.is_none() || declaration.ty.is_some() || prop.is_rest || prop.default.is_some() {
            return None;
        }
        let name = match (prop.key, hir[prop.value].kind) {
            (PropKey::Name(name), PatKind::Ident(_)) | (PropKey::None, PatKind::Ident(name)) => name,
            _ => return None,
        };
        let module = self.required_module_named_by(file, declaration.init)?;
        let exported = self.binding_exported_as(module, name).filter(|&exported| self.has_value_at_runtime(exported))?;
        (self.function_declared_as(exported).is_some() || self.c.is_constant(exported)).then_some(exported)
    }

    pub(crate) fn names_known_function_of_required_module(&mut self, fx: &Fx, obj: ExprId, name: Atom) -> bool {
        let Some(module) = self.required_module_looked_at_by(fx.file, obj) else { return false };
        let Some(member) = self.binding_exported_as(module, name) else { return false };
        let member = self.value_symbol(member);
        self.function_declared_as(member).is_some() || self.c.initializer_of_const(member).is_some_and(|(file, init)| matches!(self.hir(file)[init].kind, ExprKind::Fn(_)))
    }

    pub(crate) fn is_seen_as_declared(&mut self, fx: &Fx, e: ExprId, exported: Sym) -> bool {
        !fx.is_typed || {
            let exported = self.value_symbol(exported);
            self.c.type_of_expr(fx.file, e) == self.c.type_of_symbol(exported)
        }
    }

    pub(crate) fn find_copy_of_export_initialized(&mut self, fx: &mut Fx, e: ExprId) {
        let ExprKind::Ident(name) = self.hir(fx.file)[e].kind else { return };
        let Some(sym) = self.c.binding_of_identifier(fx.file, e, name) else { return };
        let sym = self.value_symbol(sym);
        if self.export_copied_by(sym).is_some() {
            self.find_holder_initialized(fx, sym, e);
        }
    }

    pub(crate) fn hold_required_module(&mut self, fx: &mut Fx, pat: PatId, init: ExprId) -> bool {
        let mut names = Vec::new();
        if matches!(self.hir(fx.file)[pat].kind, PatKind::Ident(_)) && self.has_requires(fx.file) {
            self.names_of_pat(fx.file, pat, &mut names);
        }
        let &[sym] = &names[..] else { return false };
        if self.es_module_held_by(sym).is_none() {
            return false;
        }
        self.evaluate_name_of_required_module(fx, init);
        let pos = self.hir(fx.file)[pat].pos;
        self.initialize_sym_without_value(fx, sym, pos);
        true
    }

    fn variable_of_module_namespace(&mut self, module: FileId) -> GlobalId {
        let sym = self.files.file_symbol(module);
        let name = self.out.strs.intern(b"namespace");
        let namespace = self.add_global(name, module, Ty::NONE, GlobalKey::Namespace(sym.file, sym.id));
        self.out.globals[namespace.idx()].initialization = ir::Initialization::Undefined;
        namespace
    }

    fn emit_mark_of_es_module(&mut self, fx: &mut Fx, namespace: V) {
        let key = self.out.strs.intern(b"__esModule");
        let (key, yes) = (self.emit(fx, Op::Str(key)), self.emit(fx, Op::Bool(true)));
        self.operation(fx, Operation::DefineField, &[namespace, key, yes]);
    }

    pub(crate) fn emit_require_of_es_module(&mut self, fx: &mut Fx, module: FileId) {
        self.emit_module_evaluation(fx, module);
        if self.how_es_module_is_required(module) != RequiredEsModule::Marked {
            return;
        }
        let marked = self.global_of_module(module, "marked");
        let known = self.emit(fx, Op::GlobalGet(marked));
        let undefined = self.emit(fx, Op::Undefined);
        let is_first = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (first, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_first, first, done);
        fx.b.seal(first);
        fx.b.switch_to(first);
        let func = self.marking_of(module);
        self.emit_throwing(fx, Op::CallDirect { func, args: ir::Args::new() });
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
    }

    pub(crate) fn emit_mark_of_required_module(&mut self, fx: &mut Fx, module: FileId) {
        let marked = self.global_of_module(module, "marked");
        let yes = self.emit(fx, Op::Bool(true));
        self.emit(fx, Op::GlobalSet(marked, yes));
        let namespace = self.variable_of_module_namespace(module);
        let made = self.emit(fx, Op::GlobalGet(namespace));
        let undefined = self.emit(fx, Op::Undefined);
        let is_missing = self.emit(fx, Op::StrictEq { a: made, b: undefined });
        let (marks, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_missing, done, marks);
        fx.b.seal(marks);
        fx.b.switch_to(marks);
        self.emit_mark_of_es_module(fx, made);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
        self.terminate_with_return(fx, V::NONE);
    }

    pub(crate) fn emit_mark_if_required(&mut self, fx: &mut Fx, module: FileId, namespace: V) {
        if self.how_es_module_is_required(module) != RequiredEsModule::Marked {
            return;
        }
        let marked = self.global_of_module(module, "marked");
        let known = self.emit(fx, Op::GlobalGet(marked));
        let undefined = self.emit(fx, Op::Undefined);
        let is_unmarked = self.emit(fx, Op::StrictEq { a: known, b: undefined });
        let (marks, done) = (fx.b.new_block(), fx.b.new_block());
        self.branch(fx, is_unmarked, done, marks);
        fx.b.seal(marks);
        fx.b.switch_to(marks);
        self.emit_mark_of_es_module(fx, namespace);
        fx.b.jump(done);
        fx.b.seal(done);
        fx.b.switch_to(done);
    }
}
