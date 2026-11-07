use bun_sema::atom::{Atom, known};
use bun_sema::program::FileId;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::builtins::RuntimeModule;
use crate::ir::generated::{ImportPhase, ModuleKind};
use crate::ir::{BlockId, Edge, TypeTable, ValueId, VariableKey};
use crate::lower::FunctionLowering;
use crate::lower::member::PropertyName;
use crate::modules::{
    ExportBinding, ImportBinding, ModuleExport, ModuleGraph, ModuleRef, ModuleRequest,
    SyntheticExport,
};

#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum AskedBy {
    Statement,
    Name,
    Star,
}

#[derive(Copy, Clone)]
pub(super) enum Step {
    Station {
        file: FileId,
        name: Atom,
        asked_by: AskedBy,
        asked_from: Option<FileId>,
        behind: usize,
    },
    ModuleWithoutTable {
        module: ModuleRef,
        name: Atom,
        is_behind_its_mock: bool,
        holder_of_star_to_built_in: Option<FileId>,
    },
    Declaration,
}

struct WayToDeclaration<'a> {
    modules: &'a ModuleGraph,
    asking_file: Option<FileId>,
    declared_in: Option<FileId>,
    steps: Vec<Step>,
    path: Vec<FileId>,
    names_on_path: FxHashSet<(FileId, Atom)>,
    answers_to_stars: FxHashMap<(FileId, Atom), (bool, Option<usize>)>,
    rings_met: usize,
    stations_on_path: Vec<usize>,
}

impl WayToDeclaration<'_> {
    fn ask(&mut self, file: FileId, name: Atom, asked_by: AskedBy) -> bool {
        if self.names_on_path.contains(&(file, name)) {
            self.rings_met += 1;
            return false;
        }
        let is_station =
            Some(file) != self.asking_file && self.modules.holds_mock_in_variable(file);
        let is_kept = asked_by == AskedBy::Star && !is_station;
        if is_kept
            && let Some(&(answer, below)) = self.answers_to_stars.get(&(file, name))
            && below.is_none_or(|station| self.stations_on_path.binary_search(&station).is_ok())
        {
            return answer;
        }
        let rings_met = self.rings_met;
        let below = self.stations_on_path.last().copied();
        let asked_from = self.path.last().copied();
        self.path.push(file);
        self.names_on_path.insert((file, name));
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
        let is_named = asked_by != AskedBy::Star || (is_station && self.declared_in == Some(file));
        let is_found = match asked_by == AskedBy::Star && self.lacks_table(file, name) {
            true => {
                self.steps.push(Step::ModuleWithoutTable {
                    module: ModuleRef::File(file),
                    name,
                    is_behind_its_mock: is_station,
                    holder_of_star_to_built_in: None,
                });
                false
            }
            false => self.ask_exports(file, name, is_named),
        };
        let end = self.steps.len();
        if is_station {
            self.stations_on_path.pop();
        }
        if is_station && let Some(Step::Station { behind, .. }) = self.steps.get_mut(station) {
            *behind = end;
        }
        self.path.pop();
        self.names_on_path.remove(&(file, name));
        if is_kept && rings_met == self.rings_met {
            self.answers_to_stars
                .insert((file, name), (is_found, below));
        }
        is_found && !(is_station && asked_by == AskedBy::Star)
    }

    fn lacks_table(&self, file: FileId, name: Atom) -> bool {
        let modules = self.modules;
        modules.kind(file) == ModuleKind::CommonJs
            && modules.find_what_hands_on_names(file, name).is_none()
            && !modules.exports(file).iter().any(|it| it.name == name)
    }

    fn ask_exports(&mut self, file: FileId, name: Atom, is_named: bool) -> bool {
        let modules = self.modules;
        if let Some((ModuleRef::File(next), name)) = modules.find_what_hands_on_names(file, name) {
            return self.ask(next, name, AskedBy::Name);
        }
        let export = modules.exports(file).iter().find(|it| it.name == name);
        match export.map(|export| (export.binding, export.is_from_star_export)) {
            Some((
                ExportBinding::Indirect {
                    module,
                    name: listed,
                },
                is_from_star,
            )) => match module {
                _ if is_from_star => self.ask_stars_as_written(file, name),
                ModuleRef::File(next) => self.ask(next, listed, AskedBy::Name),
                _ => false,
            },
            Some((ExportBinding::Variable(symbol), is_from_star)) if symbol.file != file => {
                if is_from_star && let Some(is_found) = self.ask_stars_that_bring(file, name) {
                    return is_found;
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
            Some((ExportBinding::Synthetic(handed_on), is_from_star)) => {
                if is_from_star && let Some(is_found) = self.ask_stars_that_bring(file, name) {
                    return is_found;
                }
                match *modules.synthetic_export(handed_on) {
                    SyntheticExport {
                        module: ModuleRef::File(next),
                        name,
                        ..
                    } if next != file => self.ask(next, name, AskedBy::Name),
                    _ => self.end_at_declaration(),
                }
            }
            Some(_) => self.end_at_declaration(),
            None if is_named && modules.kind(file) == ModuleKind::CommonJs => {
                self.end_at_declaration()
            }
            None if modules.is_brought_by_star(file, name) => self.ask_stars_as_written(file, name),
            None => self.ask_stars(file, name),
        }
    }

    fn end_at_declaration(&mut self) -> bool {
        self.steps.push(Step::Declaration);
        true
    }

    fn ask_stars_that_bring(&mut self, file: FileId, name: Atom) -> Option<bool> {
        let mut requests = self.modules.requests(file).iter();
        if requests.any(|request| request.is_dynamic_star_export) {
            return Some(self.ask_stars_as_written(file, name));
        }
        let mut named = self.modules.files_named_by_stars(file).iter();
        named
            .any(|&next| self.ask(next, name, AskedBy::Star))
            .then_some(true)
    }

    fn ask_stars(&mut self, file: FileId, name: Atom) -> bool {
        self.ask_stars_that(file, name, |request| request.is_dynamic_star_export)
    }

    fn ask_stars_as_written(&mut self, file: FileId, name: Atom) -> bool {
        self.ask_stars_that(file, name, |request| {
            request.is_star_export || request.is_dynamic_star_export
        })
    }

    fn ask_stars_that(
        &mut self,
        file: FileId,
        name: Atom,
        is_asked: impl Fn(&ModuleRequest) -> bool,
    ) -> bool {
        if name == known::default {
            return false;
        }
        let modules = self.modules;
        let stars = modules.in_order_of_stars(ModuleRef::File(file), modules.requests(file));
        let mut stars = stars.iter().filter(|request| is_asked(request));
        stars.any(|request| match request.target {
            ModuleRef::File(target) => self.ask(target, name, AskedBy::Star),
            module => {
                if !modules.interop(module).has_export_table() {
                    self.steps.push(Step::ModuleWithoutTable {
                        module,
                        name,
                        is_behind_its_mock: false,
                        holder_of_star_to_built_in: Some(file),
                    });
                }
                false
            }
        })
    }
}

pub(super) fn find_way_to_declaration(
    modules: &ModuleGraph,
    asking_file: Option<FileId>,
    asked: (FileId, Atom),
) -> Vec<Step> {
    find_way_to_declaration_in(modules, asking_file, asked, None, false)
}

fn find_way_to_declaration_in(
    modules: &ModuleGraph,
    asking_file: Option<FileId>,
    asked: (FileId, Atom),
    declared_in: Option<FileId>,
    leads_to_mocked_built_in: bool,
) -> Vec<Step> {
    if !modules.reaches_mock(asked.0) && !leads_to_mocked_built_in {
        return Vec::new();
    }
    let mut way = WayToDeclaration {
        modules,
        asking_file,
        declared_in,
        steps: Vec::new(),
        path: Vec::new(),
        names_on_path: FxHashSet::default(),
        answers_to_stars: FxHashMap::default(),
        rings_met: 0,
        stations_on_path: Vec::new(),
    };
    way.ask(asked.0, asked.1, AskedBy::Statement);
    way.steps
}

pub(super) fn has_station(steps: &[Step]) -> bool {
    steps
        .iter()
        .any(|step| matches!(step, Step::Station { .. }))
}

fn has_declaration(steps: &[Step]) -> bool {
    let ends_way = |step: &Step| {
        matches!(
            step,
            Step::Declaration
                | Step::ModuleWithoutTable {
                    is_behind_its_mock: true,
                    ..
                }
        )
    };
    steps.iter().any(ends_way)
}

pub(super) fn find_what_binding_leads_to(
    modules: &ModuleGraph,
    binding: ImportBinding,
) -> Option<(FileId, Atom)> {
    match binding {
        ImportBinding::Variable(symbol) if modules.reaches_mock(symbol.file) => {
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

pub(super) fn find_way_of_read(
    modules: &ModuleGraph,
    reader: FileId,
    binding: ImportBinding,
    asked: Option<(FileId, Atom)>,
) -> Vec<Step> {
    let end = find_what_binding_leads_to(modules, binding);
    let declared_in = end.map(|end| end.0);
    let leads_to_mocked_built_in = find_mocked_built_in_behind(modules, reader, binding).is_some();
    let mut steps = match asked {
        Some(asked) => find_way_to_declaration_in(
            modules,
            Some(reader),
            asked,
            declared_in,
            leads_to_mocked_built_in,
        ),
        None => Vec::new(),
    };
    let is_station_of = |steps: &[Step], end: FileId| {
        let mut stations = steps.iter();
        stations.any(|step| matches!(*step, Step::Station { file, .. } if file == end))
    };
    if let Some(end) = end
        && !is_station_of(&steps, end.0)
        && !has_declaration(&steps)
    {
        let first = steps.len();
        let more = find_way_to_declaration(modules, Some(reader), end);
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
                asked_by: match asked_by {
                    AskedBy::Statement if asked.is_some_and(|asked| asked.0 != file) => {
                        AskedBy::Name
                    }
                    _ => asked_by,
                },
                behind: behind + first,
            },
            Step::ModuleWithoutTable { .. } | Step::Declaration => step,
        }));
    }
    steps
}

fn find_mocked_built_in_behind(
    modules: &ModuleGraph,
    reader: FileId,
    binding: ImportBinding,
) -> Option<(RuntimeModule, Atom)> {
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
        modules.kind(reader) == ModuleKind::RuntimeSource || modules.is_library(reader);
    (!is_code_of_bun && modules.is_named_by_mock(ModuleRef::Runtime(module)))
        .then_some((module, name))
}

fn find_file_that_names_built_in(
    modules: &ModuleGraph,
    reader: FileId,
    asked: Option<(FileId, Atom)>,
) -> FileId {
    let Some((mut file, mut name)) = asked else {
        return reader;
    };
    let mut seen = FxHashSet::default();
    while seen.insert((file, name)) {
        if let Some((ModuleRef::File(next), handed_on)) =
            modules.find_what_hands_on_names(file, name)
        {
            (file, name) = (next, handed_on);
            continue;
        }
        let export = modules.exports(file).iter().find(|it| it.name == name);
        match export.map(|export| export.binding) {
            Some(ExportBinding::Indirect {
                module: ModuleRef::File(next),
                name: listed,
            }) => (file, name) = (next, listed),
            Some(ExportBinding::Synthetic(handed_on)) => {
                match *modules.synthetic_export(handed_on) {
                    SyntheticExport {
                        module: ModuleRef::File(next),
                        name: listed,
                        ..
                    } if next != file => (file, name) = (next, listed),
                    _ => break,
                }
            }
            _ => break,
        }
    }
    file
}

pub(super) fn emit_behind_stations(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    asked: Option<(FileId, Atom)>,
    handed_on_by: Option<FileId>,
    read_without_mock: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId,
) -> ValueId {
    let modules = lowering.file.inputs.modules;
    let mut steps = find_way_of_read(modules, lowering.file.file, binding, asked);
    let runtime_station = find_mocked_built_in_behind(modules, lowering.file.file, binding);
    if !has_station(&steps) && runtime_station.is_none() {
        return read_without_mock(lowering);
    }
    let is_brought_by_star = steps.iter().any(|step| {
        matches!(
            *step,
            Step::ModuleWithoutTable {
                module: ModuleRef::Runtime(module),
                name,
                holder_of_star_to_built_in: Some(_),
                ..
            } if runtime_station == Some((module, name))
        )
    });
    let is_asked_only_of_built_in = !has_station(&steps);
    if !has_declaration(&steps) {
        steps.push(Step::Declaration);
    }
    let result = lowering.builder.create_variable(None);
    let join = lowering.create_block();
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
    match runtime_station {
        Some((module, _)) if is_asked_only_of_built_in => {
            let key = VariableKey::MockOfRuntimeModule(module);
            let variable = lowering.file.ensure_variable(key);
            let word = lowering.builder.get_module_variable(variable);
            let split = lowering.split_on_type(word, TypeTable::ABSENT);
            lowering.builder.switch_to(split.taken);
            let declaration = block_at(lowering, &mut blocks, declaration);
            lowering.jump(declaration);
            lowering.builder.switch_to(split.not_taken);
            lowering.jump(first);
        }
        _ => lowering.jump(first),
    }
    for (index, &step) in steps.iter().enumerate() {
        let Some(block) = blocks[index] else {
            continue;
        };
        lowering.continue_in(block);
        let mut rest = steps[index + 1..].iter();
        let is_way_left = rest.any(|step| !matches!(step, Step::Declaration));
        if let Step::ModuleWithoutTable {
            module,
            name,
            is_behind_its_mock,
            holder_of_star_to_built_in,
        } = step
            && (is_way_left || !is_behind_its_mock)
        {
            let module = modules.face(module).unwrap_or(module);
            let module = lowering.file.fragment.declare_module(module);
            let phase = ImportPhase::Evaluation;
            let object = match holder_of_star_to_built_in {
                Some(holder) => {
                    let holder = (lowering.file.fragment).declare_module(ModuleRef::File(holder));
                    lowering.builder.namespace_seen_by(module, holder)
                }
                None => {
                    (lowering.builder).module_namespace(module, phase, is_behind_its_mock, false)
                }
            };
            let key = lowering.file.name_key(name);
            let has = lowering.emit_has(object, PropertyName::Constant(key));
            let has = lowering.split_on_truthiness(has);
            lowering.builder.switch_to(has.not_taken);
            let next = block_at(lowering, &mut blocks, index + 1);
            lowering.jump(next);
            lowering.builder.switch_to(has.taken);
            let answered = lowering.emit_named_read(object, name);
            lowering.builder.write_variable(result, answered);
            lowering.jump(join);
            continue;
        }
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
        lowering.builder.switch_to(split.taken);
        let next = block_at(lowering, &mut blocks, index + 1);
        lowering.jump(next);
        lowering.builder.switch_to(split.not_taken);
        let mocked = (lowering.file.fragment).declare_module(ModuleRef::File(file));
        let importer = match asked_from.or(handed_on_by) {
            Some(importer) => (lowering.file.fragment).declare_module(ModuleRef::File(importer)),
            None => lowering.file.module_id(),
        };
        let sees_mock = lowering.builder.sees_mock_of(mocked, importer);
        let asks_mock = lowering.create_block();
        (lowering.builder).branch(sees_mock, Edge::to(asks_mock), Edge::to(next));
        lowering.continue_in(asks_mock);
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
        if let Some((module, name)) = runtime_station {
            let key = VariableKey::MockOfRuntimeModule(module);
            let variable = lowering.file.ensure_variable(key);
            let word = lowering.builder.get_module_variable(variable);
            let split = lowering.split_on_type(word, TypeTable::ABSENT);
            let real = lowering.create_block();
            lowering.builder.switch_to(split.not_taken);
            if is_brought_by_star {
                let undefined = lowering.builder.undefined();
                lowering.builder.write_variable(result, undefined);
                lowering.jump(join);
            } else {
                let holder = find_file_that_names_built_in(modules, lowering.file.file, asked);
                let is_handed_on = holder != lowering.file.file;
                let holder = (lowering.file.fragment).declare_module(ModuleRef::File(holder));
                let mocked = (lowering.file.fragment).declare_module(ModuleRef::Runtime(module));
                let sees_mock = lowering.builder.sees_mock_of(mocked, holder);
                let asks_mock = lowering.create_block();
                (lowering.builder).branch(sees_mock, Edge::to(asks_mock), Edge::to(real));
                lowering.continue_in(asks_mock);
                let mock = lowering.builder.mock_seen_by(mocked, holder);
                if is_handed_on {
                    let key = lowering.file.name_key(name);
                    let has = lowering.emit_has(mock, PropertyName::Constant(key));
                    let has = lowering.split_on_truthiness(has);
                    lowering.builder.switch_to(has.not_taken);
                    let undefined = lowering.builder.undefined();
                    lowering.builder.write_variable(result, undefined);
                    lowering.jump(join);
                    lowering.builder.switch_to(has.taken);
                }
                let answered = lowering.emit_named_read(mock, name);
                lowering.builder.write_variable(result, answered);
                lowering.jump(join);
            }
            lowering.builder.switch_to(split.taken);
            lowering.jump(real);
            lowering.continue_in(real);
        }
        let real = read_without_mock(lowering);
        lowering.builder.write_variable(result, real);
        lowering.jump(join);
    }
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}
