use bun_sema::atom::{Atom, known};
use bun_sema::program::FileId;
use rustc_hash::{FxHashMap, FxHashSet};

use crate::ir::generated::ModuleKind;
use crate::ir::{BlockId, Edge, TypeTable, ValueId, VariableKey};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering};
use crate::modules::{
    ExportBinding, ImportBinding, ModuleExport, ModuleGraph, ModuleRef, SyntheticExport,
};

/// How the question for a name has come to a file.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum AskedBy {
    /// The import statement names the file. What its mock makes of a name that the factory left out is the mock's to say.
    Statement,
    /// `export { a as b } from "./c"`: the name is an export of the file that hands it on, whatever the mock has: undefined where the mock lacks it.
    Name,
    /// `export *` hands on what the mock has. For a name that it lacks the next star of the file is asked.
    Star,
}

#[derive(Copy, Clone)]
pub(super) enum Step {
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
    files_on_path: FxHashSet<FileId>,
    /// What a star heard that asked a file for a name, and the step of the innermost station that it stood below. Stars meet again behind a fork: whoever reaches
    /// the steps of the second one has been through those of the first, and none of them answered. That holds below the same station alone: a mock that lacks the
    /// name sends the run past what lies below it. What a station itself shows goes by who asks it, so each asks. And an answer that was made while the way came
    /// round in a ring holds for that way alone.
    answers_to_stars: FxHashMap<(FileId, Atom), (bool, Option<usize>)>,
    rings_met: usize,
    /// Ascending.
    stations_on_path: Vec<usize>,
}

impl WayToDeclaration<'_> {
    /// Whether the name is found below the file whichever mocks stand.
    fn ask(&mut self, file: FileId, name: Atom, asked_by: AskedBy) -> bool {
        if self.files_on_path.contains(&file) {
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
        self.files_on_path.insert(file);
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
        self.files_on_path.remove(&file);
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
                    return self.ask_stars(file, name) || self.ask_ordinary_stars(file, name);
                }
                if is_from_star && self.ask_ordinary_stars(file, name) {
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
            // The table has lost what nobody reads off the object of the file: `ModuleGraph::limit_exports`.
            None => {
                self.ask_stars(file, name)
                    || (modules.is_brought_by_star(file, name)
                        && self.ask_ordinary_stars(file, name))
            }
        }
    }

    /// The stars whose names the build knows: what one of them names may have the name from a file that a mock stands in place of. On any other way no mock stands.
    fn ask_ordinary_stars(&mut self, file: FileId, name: Atom) -> bool {
        let modules = self.modules;
        let requests = modules.requests(file).iter();
        let asked = requests.filter(|request| request.is_dynamic_star_export);
        let asked: FxHashSet<ModuleRef> = asked.map(|request| request.target).collect();
        let mut named = modules.files_named_by_stars(file).iter();
        named.any(|&next| {
            !asked.contains(&ModuleRef::File(next)) && self.ask(next, name, AskedBy::Star)
        })
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

/// Empty where `!modules.reaches_mock(asked.0)`.
pub(super) fn find_way_to_declaration(
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
        files_on_path: FxHashSet::default(),
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
    steps.iter().any(|step| matches!(step, Step::Declaration))
}

/// Where nothing says what was asked: the file that `binding` leads to, and the name of it there. None for a variable of a file from which no way comes to a mock.
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

/// The way from what the statement asks. Where the tables end before the declaration, the way from what the binding leads to follows.
pub(super) fn find_way_of_read(
    modules: &ModuleGraph,
    reader: FileId,
    binding: ImportBinding,
    asked: Option<(FileId, Atom)>,
) -> Vec<Step> {
    let mut steps = match asked {
        Some(asked) => find_way_to_declaration(modules, Some(reader), asked),
        None => Vec::new(),
    };
    // The table of a file that hands a name on lists what somebody reads off its object. The end of the way is known without it.
    let is_station_of = |steps: &[Step], end: FileId| {
        let mut stations = steps.iter();
        stations.any(|step| matches!(*step, Step::Station { file, .. } if file == end))
    };
    if let Some(end) = find_what_binding_leads_to(modules, binding)
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
    steps
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

/// What a mock on the way of `binding` answers, and `read_without_mock` where none stands.
pub(super) fn emit_behind_stations(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    asked: Option<(FileId, Atom)>,
    read_without_mock: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId,
) -> ValueId {
    let modules = lowering.file.inputs.modules;
    let mut steps = find_way_of_read(modules, lowering.file.file, binding, asked);
    let runtime_station = find_runtime_module_that_may_be_mocked(lowering.file, binding);
    if !has_station(&steps) && runtime_station.is_none() {
        return read_without_mock(lowering);
    }
    // Where the tables do not lead to the declaration, the binding does.
    if !has_declaration(&steps) {
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
            lowering.builder.switch_to(split.not_taken);
            let answered = lowering.emit_named_read(split.not_taken_value, name);
            lowering.builder.write_variable(result, answered);
            lowering.jump(join);
            lowering.builder.switch_to(split.taken);
        }
        let real = read_without_mock(lowering);
        lowering.builder.write_variable(result, real);
        lowering.jump(join);
    }
    lowering.continue_in(join);
    lowering.builder.read_variable(result)
}
