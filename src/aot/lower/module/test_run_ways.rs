use bun_sema::atom::{Atom, known};
use bun_sema::program::{FileId, Sym};
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
pub(crate) enum BoundBy {
    Statement,
    Call,
}

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
    FileItself {
        file: FileId,
        name: Atom,
    },
    Declaration,
}

#[derive(Default)]
struct PlacesOfStars {
    asked_for_every_name: Vec<u32>,
    asked_for_name: FxHashMap<Atom, Vec<u32>>,
}

impl PlacesOfStars {
    fn add(&mut self, modules: &ModuleGraph, place: u32, target: ModuleRef) {
        let is_dynamic = |request: &ModuleRequest| request.is_dynamic_star_export;
        let next = match target {
            ModuleRef::File(next)
                if !modules.holds_mock_in_variable(next)
                    && modules.kind(next) != ModuleKind::CommonJs
                    && !modules.requests(next).iter().any(is_dynamic) =>
            {
                next
            }
            _ => return self.asked_for_every_name.push(place),
        };
        let listed = modules.exports(next).iter().map(|it| it.name);
        let handed_on = modules.names_handed_on(next).iter().map(|it| it.0);
        let from_stars = modules.names_from_stars(next).iter().copied();
        for name in listed.chain(handed_on).chain(from_stars) {
            let places = self.asked_for_name.entry(name).or_default();
            if places.last() != Some(&place) {
                places.push(place);
            }
        }
    }

    fn of(&self, name: Atom) -> Vec<u32> {
        let for_name = self
            .asked_for_name
            .get(&name)
            .map_or(&[][..], |places| places);
        let mut places = [&self.asked_for_every_name[..], for_name].concat();
        places.sort_unstable();
        places
    }
}

struct StarsThatBring {
    has_dynamic_star: bool,
    places: PlacesOfStars,
}

struct StarsAsWritten {
    stars: Vec<ModuleRequest>,
    places: PlacesOfStars,
}

#[derive(Default)]
pub(crate) struct KeptBetweenWays {
    places_of_names: FxHashMap<FileId, FxHashMap<Atom, u32>>,
    places_of_symbols: FxHashMap<FileId, FxHashMap<Sym, Vec<u32>>>,
    stars_that_bring: FxHashMap<FileId, StarsThatBring>,
    stars_as_written: FxHashMap<FileId, StarsAsWritten>,
    writers: FxHashMap<(FileId, Atom), ((FileId, Atom), FileId)>,
}

impl KeptBetweenWays {
    fn find_listed(
        &mut self,
        modules: &ModuleGraph,
        file: FileId,
        name: Atom,
    ) -> Option<ModuleExport> {
        let exports = modules.exports(file);
        let list = || {
            (0..)
                .zip(exports)
                .map(|(place, it)| (it.name, place))
                .collect()
        };
        let places = self.places_of_names.entry(file).or_insert_with(list);
        places.get(&name).map(|&place| exports[place as usize])
    }

    fn find_declared(
        &mut self,
        modules: &ModuleGraph,
        symbol: Sym,
        name: Atom,
    ) -> Option<ModuleExport> {
        let exports = modules.exports(symbol.file);
        let list = || {
            let mut places: FxHashMap<Sym, Vec<u32>> = FxHashMap::default();
            for (place, export) in (0..).zip(exports) {
                if let ExportBinding::Variable(declared) = export.binding {
                    places.entry(declared).or_default().push(place);
                }
            }
            places
        };
        let places = self
            .places_of_symbols
            .entry(symbol.file)
            .or_insert_with(list);
        let mut there = places
            .get(&symbol)?
            .iter()
            .map(|&place| exports[place as usize]);
        there
            .clone()
            .find(|it| it.name == name)
            .or_else(|| there.next())
    }

    fn stars_that_bring(&mut self, modules: &ModuleGraph, file: FileId) -> &StarsThatBring {
        let is_dynamic = |request: &ModuleRequest| request.is_dynamic_star_export;
        self.stars_that_bring.entry(file).or_insert_with(|| {
            let mut stars = StarsThatBring {
                has_dynamic_star: modules.requests(file).iter().any(is_dynamic),
                places: PlacesOfStars::default(),
            };
            for (place, &next) in (0..).zip(modules.files_named_by_stars(file)) {
                stars.places.add(modules, place, ModuleRef::File(next));
            }
            stars
        })
    }

    fn find_stars_as_written(
        &mut self,
        modules: &ModuleGraph,
        file: FileId,
        name: Atom,
    ) -> Vec<ModuleRequest> {
        let written = self.stars_as_written.entry(file).or_insert_with(|| {
            let requests = modules.in_order_of_stars(ModuleRef::File(file), modules.requests(file));
            let stars = requests.iter().copied();
            let stars: Vec<ModuleRequest> = stars
                .filter(|it| it.is_star_export || it.is_dynamic_star_export)
                .collect();
            let mut places = PlacesOfStars::default();
            for (place, star) in (0..).zip(&stars) {
                places.add(modules, place, star.target);
            }
            StarsAsWritten { stars, places }
        });
        let places = written.places.of(name).into_iter();
        places.map(|place| written.stars[place as usize]).collect()
    }
}

struct WayToDeclaration<'a> {
    modules: &'a ModuleGraph,
    kept: Option<&'a mut KeptBetweenWays>,
    station_of_writer: Option<(FileId, Atom)>,
    names_of_path: Vec<Atom>,
    way_to_writer: Option<Vec<(FileId, Atom)>>,
    asking_file: Option<FileId>,
    declared_in: Option<FileId>,
    steps: Vec<Step>,
    path: Vec<FileId>,
    names_on_path: FxHashSet<(FileId, Atom)>,
    answers_to_stars: FxHashMap<(FileId, Atom), (bool, Option<usize>)>,
    rings_met: usize,
    stations_on_path: Vec<usize>,
    stations_written_out: FxHashMap<(FileId, Atom), bool>,
    count_of_stations: usize,
}

impl<'a> WayToDeclaration<'a> {
    fn new(
        modules: &'a ModuleGraph,
        kept: Option<&'a mut KeptBetweenWays>,
        asking_file: Option<FileId>,
        declared_in: Option<FileId>,
    ) -> WayToDeclaration<'a> {
        WayToDeclaration {
            modules,
            kept,
            station_of_writer: None,
            names_of_path: Vec::new(),
            way_to_writer: None,
            asking_file,
            declared_in,
            steps: Vec::new(),
            path: Vec::new(),
            names_on_path: FxHashSet::default(),
            answers_to_stars: FxHashMap::default(),
            rings_met: 0,
            stations_on_path: Vec::new(),
            stations_written_out: FxHashMap::default(),
            count_of_stations: 0,
        }
    }

    fn ask(&mut self, file: FileId, name: Atom, asked_by: AskedBy) -> bool {
        if self.way_to_writer.is_some() {
            return true;
        }
        if self.names_on_path.contains(&(file, name)) {
            self.rings_met += 1;
            return false;
        }
        let is_station =
            Some(file) != self.asking_file && self.modules.holds_mock_in_variable(file);
        if let Some(sought) = self.station_of_writer {
            let kept = self
                .kept
                .as_deref()
                .and_then(|kept| kept.writers.get(&(file, name)));
            let told = kept
                .filter(|&&(station, _)| station == sought)
                .map(|&(_, writer)| writer);
            let stays = |&&on_path: &&FileId| !self.modules.is_left_out(ModuleRef::File(on_path));
            let asking = (is_station && (file, name) == sought)
                .then(|| self.path.iter().rev().find(stays).copied());
            if let Some(asked_from) = told.map(Some).or(asking) {
                let names = self.names_of_path.iter().copied();
                self.way_to_writer = Some(self.path.iter().copied().zip(names).collect());
                self.steps.push(Step::Station {
                    file: sought.0,
                    name: sought.1,
                    asked_by,
                    asked_from,
                    behind: 0,
                });
                return true;
            }
        }
        let is_kept = asked_by == AskedBy::Star && !is_station;
        if is_kept
            && let Some(&(answer, below)) = self.answers_to_stars.get(&(file, name))
            && below.is_none_or(|station| self.stations_on_path.binary_search(&station).is_ok())
        {
            return answer;
        }
        let rings_met = self.rings_met;
        let below = self.stations_on_path.last().copied();
        let stays = |&&on_path: &&FileId| !self.modules.is_left_out(ModuleRef::File(on_path));
        let asked_from = self.path.iter().rev().find(stays).copied();
        let holds_station_behind = self.stations_written_out.get(&(file, name));
        if is_station && asked_by == AskedBy::Star && holds_station_behind == Some(&true) {
            let behind = self.steps.len() + 2;
            self.count_of_stations += 1;
            self.steps.push(Step::Station {
                file,
                name,
                asked_by,
                asked_from,
                behind,
            });
            self.steps.push(Step::FileItself { file, name });
            return false;
        }
        self.path.push(file);
        self.names_of_path.push(name);
        self.names_on_path.insert((file, name));
        let station = self.steps.len();
        let count_of_stations = self.count_of_stations;
        if is_station {
            self.count_of_stations += 1;
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
            let holds_station_behind = self.count_of_stations > count_of_stations + 1;
            self.stations_written_out
                .insert((file, name), holds_station_behind);
        }
        if is_station && let Some(Step::Station { behind, .. }) = self.steps.get_mut(station) {
            *behind = end;
        }
        self.path.pop();
        self.names_of_path.pop();
        self.names_on_path.remove(&(file, name));
        if is_kept && rings_met == self.rings_met {
            self.answers_to_stars
                .insert((file, name), (is_found, below));
        }
        is_found && !(is_station && asked_by == AskedBy::Star)
    }

    fn find_listed(&mut self, file: FileId, name: Atom) -> Option<ModuleExport> {
        match self.kept.as_deref_mut() {
            Some(kept) => kept.find_listed(self.modules, file, name),
            None => (self.modules.exports(file).iter())
                .find(|it| it.name == name)
                .copied(),
        }
    }

    fn find_declared(&mut self, symbol: Sym, name: Atom) -> Option<ModuleExport> {
        if let Some(kept) = self.kept.as_deref_mut() {
            return kept.find_declared(self.modules, symbol, name);
        }
        let there = self.modules.exports(symbol.file).iter();
        let mut there = there.filter(|it| it.binding == ExportBinding::Variable(symbol));
        there
            .clone()
            .find(|it| it.name == name)
            .or_else(|| there.next())
            .copied()
    }

    fn lacks_table(&mut self, file: FileId, name: Atom) -> bool {
        let modules = self.modules;
        modules.kind(file) == ModuleKind::CommonJs
            && modules.find_what_hands_on_names(file, name).is_none()
            && self.find_listed(file, name).is_none()
    }

    fn ask_exports(&mut self, file: FileId, name: Atom, is_named: bool) -> bool {
        let modules = self.modules;
        if let Some((ModuleRef::File(next), name)) = modules.find_what_hands_on_names(file, name) {
            return self.ask(next, name, AskedBy::Name);
        }
        let export = self.find_listed(file, name);
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
                let asked_by = match is_from_star {
                    true => AskedBy::Star,
                    false => AskedBy::Name,
                };
                match self.find_declared(symbol, name) {
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
        if let Some(kept) = self.kept.as_deref_mut() {
            let stars = kept.stars_that_bring(self.modules, file);
            if stars.has_dynamic_star {
                return Some(self.ask_stars_as_written(file, name));
            }
            let mut places = stars.places.of(name).into_iter();
            let rings_met = self.rings_met;
            let named = self.modules.files_named_by_stars(file);
            let is_found = places.any(|place| self.ask(named[place as usize], name, AskedBy::Star));
            return (is_found || rings_met != self.rings_met).then_some(is_found);
        }
        let mut requests = self.modules.requests(file).iter();
        if requests.any(|request| request.is_dynamic_star_export) {
            return Some(self.ask_stars_as_written(file, name));
        }
        let rings_met = self.rings_met;
        let mut named = self.modules.files_named_by_stars(file).iter();
        let is_found = named.any(|&next| self.ask(next, name, AskedBy::Star));
        (is_found || rings_met != self.rings_met).then_some(is_found)
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
        let stays = |&&on_path: &&FileId| !modules.is_left_out(ModuleRef::File(on_path));
        let holder = self.path.iter().rev().find(stays).copied();
        let holder = holder.or(self.asking_file).unwrap_or(file);
        if let Some(kept) = self.kept.as_deref_mut() {
            let stars = kept.find_stars_as_written(modules, file, name);
            let mut stars = stars.iter().filter(|request| is_asked(request));
            return stars.any(|request| self.ask_star(request.target, name, holder));
        }
        let stars = modules.in_order_of_stars(ModuleRef::File(file), modules.requests(file));
        let mut stars = stars.iter().filter(|request| is_asked(request));
        stars.any(|request| self.ask_star(request.target, name, holder))
    }

    fn ask_star(&mut self, target: ModuleRef, name: Atom, holder: FileId) -> bool {
        match target {
            ModuleRef::File(target) => self.ask(target, name, AskedBy::Star),
            module => {
                if !self.modules.interop(module).has_export_table() {
                    self.steps.push(Step::ModuleWithoutTable {
                        module,
                        name,
                        is_behind_its_mock: false,
                        holder_of_star_to_built_in: Some(holder),
                    });
                }
                false
            }
        }
    }
}

pub(super) fn find_way_to_declaration(
    modules: &ModuleGraph,
    kept: Option<&mut KeptBetweenWays>,
    asking_file: Option<FileId>,
    asked: (FileId, Atom),
) -> Vec<Step> {
    find_way_to_declaration_in(modules, kept, asking_file, asked, None, false)
}

fn find_way_to_declaration_in(
    modules: &ModuleGraph,
    kept: Option<&mut KeptBetweenWays>,
    asking_file: Option<FileId>,
    asked: (FileId, Atom),
    declared_in: Option<FileId>,
    leads_to_mocked_built_in: bool,
) -> Vec<Step> {
    if !modules.reaches_mock(asked.0) && !leads_to_mocked_built_in {
        return Vec::new();
    }
    let mut way = WayToDeclaration::new(modules, kept, asking_file, declared_in);
    way.ask(asked.0, asked.1, AskedBy::Statement);
    way.steps
}

pub(crate) fn find_file_that_asks_mock(
    modules: &ModuleGraph,
    kept: &mut KeptBetweenWays,
    holder: FileId,
    export: &ModuleExport,
) -> Option<FileId> {
    let declared = match export.binding {
        ExportBinding::Variable(symbol) => (
            symbol.file,
            kept.find_declared(modules, symbol, export.name)?.name,
        ),
        ExportBinding::Synthetic(copy) => match *modules.synthetic_export(copy) {
            SyntheticExport {
                module: ModuleRef::File(file),
                name,
                ..
            } => (file, name),
            _ => return None,
        },
        ExportBinding::Namespace { .. } | ExportBinding::Indirect { .. } => return None,
    };
    if !modules.reaches_mock(holder) || !modules.holds_mock_in_variable(declared.0) {
        return None;
    }
    let mut way = WayToDeclaration::new(modules, Some(kept), None, None);
    way.station_of_writer = Some(declared);
    way.ask(holder, export.name, AskedBy::Statement);
    let writer = way.steps.iter().find_map(|step| match *step {
        Step::Station {
            file,
            name,
            asked_from,
            ..
        } if (file, name) == declared => asked_from,
        _ => None,
    });
    let on_the_way = way.way_to_writer.unwrap_or_default();
    if let Some(writer) = writer.filter(|_| way.rings_met == 0) {
        let is_told = |&(file, _): &(FileId, Atom)| {
            modules.kind(file) != ModuleKind::CommonJs && !modules.holds_mock_in_variable(file)
        };
        let place_of_writer = on_the_way.iter().rposition(|&(file, _)| file == writer);
        let count = place_of_writer.map_or(on_the_way.len(), |place| place + 1);
        let told = on_the_way.into_iter().take(count).filter(is_told);
        kept.writers
            .extend(told.map(|asked| (asked, (declared, writer))));
    }
    writer
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
    mut kept: Option<&mut KeptBetweenWays>,
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
            kept.as_deref_mut(),
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
        let more = find_way_to_declaration(modules, kept, Some(reader), end);
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
            Step::ModuleWithoutTable { .. } | Step::FileItself { .. } | Step::Declaration => step,
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
    let mut holder = reader;
    while seen.insert((file, name)) {
        if !modules.is_left_out(ModuleRef::File(file)) {
            holder = file;
        }
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
    holder
}

pub(super) fn emit_behind_stations(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: ImportBinding,
    asked: Option<(FileId, Atom)>,
    handed_on_by: Option<FileId>,
    bound_by: BoundBy,
    read_off: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, ValueId, Atom) -> ValueId,
    read_without_mock: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId,
) -> ValueId {
    let modules = lowering.file.inputs.modules;
    let reading_file = lowering.file.module_id();
    let reader_through = |holder| match bound_by {
        BoundBy::Statement => reading_file,
        BoundBy::Call => holder,
    };
    let mut steps = {
        let kept = &mut *lowering.file.modules.kept_between_ways.borrow_mut();
        find_way_of_read(modules, Some(kept), lowering.file.file, binding, asked)
    };
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
        let asked_of_run = match step {
            Step::ModuleWithoutTable {
                module,
                name,
                is_behind_its_mock,
                holder_of_star_to_built_in,
            } if is_way_left || !is_behind_its_mock => {
                Some((module, name, is_behind_its_mock, holder_of_star_to_built_in))
            }
            Step::FileItself { file, name } => Some((ModuleRef::File(file), name, true, None)),
            _ => None,
        };
        if let Some((module, name, is_behind_its_mock, holder_of_star_to_built_in)) = asked_of_run {
            let module = modules.face(module).unwrap_or(module);
            let module = lowering.file.fragment.declare_module(module);
            let phase = ImportPhase::Evaluation;
            let object = match holder_of_star_to_built_in {
                Some(holder) => {
                    let holder = (lowering.file.fragment).declare_module(ModuleRef::File(holder));
                    let reader = reader_through(holder);
                    lowering.builder.namespace_seen_by(module, holder, reader)
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
            let answered = read_off(lowering, object, name);
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
        let reader = reader_through(importer);
        let sees_mock = lowering.builder.sees_mock_of(mocked, importer, reader);
        let asks_mock = lowering.create_block();
        (lowering.builder).branch(sees_mock, Edge::to(asks_mock), Edge::to(next));
        lowering.continue_in(asks_mock);
        let mock = lowering.builder.mock_seen_by(mocked, importer, reader);
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
        let answered = read_off(lowering, mock, name);
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
                let reader = reader_through(holder);
                let sees_mock = lowering.builder.sees_mock_of(mocked, holder, reader);
                let asks_mock = lowering.create_block();
                (lowering.builder).branch(sees_mock, Edge::to(asks_mock), Edge::to(real));
                lowering.continue_in(asks_mock);
                let mock = lowering.builder.mock_seen_by(mocked, holder, reader);
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
                let answered = read_off(lowering, mock, name);
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
