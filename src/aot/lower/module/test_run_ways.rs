use bun_sema::atom::{Atom, known};
use bun_sema::program::{FileId, Sym};
use rustc_hash::{FxHashMap, FxHashSet};

use super::imports::RequestedImport;
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

#[derive(Copy, Clone, PartialEq, Eq, Hash)]
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
        /// The stars of the file lead back to a file that asks it.
        is_on_cycle: bool,
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
        ends_way: bool,
    },
    Declaration,
    /// A declaration that the import is not bound to.
    OtherDeclaration {
        file: FileId,
        name: Atom,
    },
}

/// Whether the file or one of its mocks may have the name.
fn may_have_name(modules: &ModuleGraph, file: FileId, name: Atom) -> bool {
    let is_dynamic = |request: &ModuleRequest| request.is_dynamic_star_export;
    let Some(of_mocks) = modules.names_of_mocks(file) else {
        return true;
    };
    modules.kind(file) == ModuleKind::CommonJs
        || modules.requests(file).iter().any(is_dynamic)
        || of_mocks.contains(&name)
        || modules.is_installed_by_spy(name)
        || modules.exports(file).iter().any(|it| it.name == name)
        || modules.names_handed_on(file).iter().any(|it| it.0 == name)
        || modules.names_from_stars(file).contains(&name)
}

#[derive(Default)]
struct PlacesOfStars {
    asked_for_every_name: Vec<u32>,
    mocked: Vec<u32>,
    asked_for_name: FxHashMap<Atom, Vec<u32>>,
}

impl PlacesOfStars {
    fn add(&mut self, modules: &ModuleGraph, place: u32, target: ModuleRef) {
        let is_dynamic = |request: &ModuleRequest| request.is_dynamic_star_export;
        let next = match target {
            ModuleRef::File(next)
                if (!modules.holds_mock_in_variable(next)
                    || modules.names_of_mocks(next).is_some())
                    && modules.kind(next) != ModuleKind::CommonJs
                    && !modules.requests(next).iter().any(is_dynamic) =>
            {
                next
            }
            _ => return self.asked_for_every_name.push(place),
        };
        if modules.holds_mock_in_variable(next) {
            self.mocked.push(place);
        }
        let of_mocks = modules.names_of_mocks(next).unwrap_or_default();
        let listed = modules.exports(next).iter().map(|it| it.name);
        let handed_on = modules.names_handed_on(next).iter().map(|it| it.0);
        let from_stars = modules.names_from_stars(next).iter().copied();
        let of_mocks = of_mocks.iter().copied();
        for name in listed.chain(handed_on).chain(from_stars).chain(of_mocks) {
            let places = self.asked_for_name.entry(name).or_default();
            if places.last() != Some(&place) {
                places.push(place);
            }
        }
    }

    fn of(&self, modules: &ModuleGraph, name: Atom) -> Vec<u32> {
        let for_name = self
            .asked_for_name
            .get(&name)
            .map_or(&[][..], |places| places);
        let mocked = match modules.is_installed_by_spy(name) {
            true => &self.mocked[..],
            false => &[],
        };
        let mut places = [&self.asked_for_every_name[..], for_name, mocked].concat();
        places.sort_unstable();
        places.dedup();
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
        let places = written.places.of(modules, name).into_iter();
        places.map(|place| written.stars[place as usize]).collect()
    }
}

/// One request for a name. The importer is kept only for a file that is left out, because that file requests names on its importer's behalf.
#[derive(Copy, Clone, PartialEq, Eq, Hash)]
struct Request {
    file: FileId,
    name: Atom,
    asked_by: AskedBy,
    importer: Option<FileId>,
}

/// The result of a request, valid wherever the innermost station that enclosed the request encloses the next one too.
#[derive(Copy, Clone)]
struct Answer {
    is_found: bool,
    enclosing_station: Option<usize>,
}

#[derive(Copy, Clone)]
struct EmittedFile {
    has_inner_station: bool,
    is_found: bool,
}

struct WayToDeclaration<'a> {
    modules: &'a ModuleGraph,
    kept: Option<&'a mut KeptBetweenWays>,
    station_of_writer: Option<(FileId, Atom)>,
    way_to_writer: Option<Vec<(FileId, Atom)>>,
    asking_file: Option<FileId>,
    declared_in: Option<FileId>,
    steps: Vec<Step>,
    path: Vec<(FileId, Atom)>,
    names_on_path: FxHashSet<(FileId, Atom)>,
    answers: FxHashMap<Request, Answer>,
    rings_met: usize,
    /// The first place on the path that a request led back to.
    outermost_ring: usize,
    stations_on_path: Vec<usize>,
    emitted_files: FxHashMap<(FileId, Atom), EmittedFile>,
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
            way_to_writer: None,
            asking_file,
            declared_in,
            steps: Vec::new(),
            path: Vec::new(),
            names_on_path: FxHashSet::default(),
            answers: FxHashMap::default(),
            rings_met: 0,
            outermost_ring: usize::MAX,
            stations_on_path: Vec::new(),
            emitted_files: FxHashMap::default(),
            count_of_stations: 0,
        }
    }

    /// The innermost file on the path that is not left out.
    fn last_file_on_path(&self) -> Option<FileId> {
        let mut files = self.path.iter().rev().map(|&(file, _)| file);
        files.find(|&file| !self.modules.is_left_out(ModuleRef::File(file)))
    }

    fn ask(&mut self, file: FileId, name: Atom, asked_by: AskedBy) -> bool {
        if self.way_to_writer.is_some() {
            return true;
        }
        if self.names_on_path.contains(&(file, name)) {
            self.rings_met += 1;
            let place = (self.path.iter()).position(|&on_path| on_path == (file, name));
            self.outermost_ring = self.outermost_ring.min(place.unwrap_or(usize::MAX));
            return false;
        }
        let is_station = Some(file) != self.asking_file
            && self.modules.holds_mock_in_variable(file)
            && (asked_by != AskedBy::Star || may_have_name(self.modules, file, name));
        if let Some(sought) = self.station_of_writer {
            let kept = self
                .kept
                .as_deref()
                .and_then(|kept| kept.writers.get(&(file, name)));
            let told = kept
                .filter(|&&(station, _)| station == sought)
                .map(|&(_, writer)| writer);
            let asking = (is_station && (file, name) == sought).then(|| self.last_file_on_path());
            if let Some(asked_from) = told.map(Some).or(asking) {
                self.way_to_writer = Some(self.path.clone());
                self.steps.push(Step::Station {
                    file: sought.0,
                    name: sought.1,
                    asked_by,
                    asked_from,
                    behind: 0,
                    is_on_cycle: false,
                });
                return true;
            }
        }
        let asked_from = self.last_file_on_path();
        let is_left_out = self.modules.is_left_out(ModuleRef::File(file));
        let request = Request {
            file,
            name,
            asked_by,
            importer: asked_from.filter(|_| asked_by == AskedBy::Name && is_left_out),
        };
        // A mock that lacks the name skips the steps of its file only where a star names the file, so only such a file must be asked again.
        let is_answer_reused = asked_by == AskedBy::Name || !is_station;
        if is_answer_reused && let Some(is_found) = self.find_answer(request) {
            if is_station && !is_found {
                let behind = self.steps.len() + 1;
                self.count_of_stations += 1;
                self.steps.push(Step::Station {
                    file,
                    name,
                    asked_by,
                    asked_from,
                    behind,
                    is_on_cycle: false,
                });
            }
            return is_found;
        }
        let enclosing_station = self.stations_on_path.last().copied();
        let may_use_namespace =
            asked_by == AskedBy::Name && !is_left_out || asked_by == AskedBy::Star && is_station;
        if may_use_namespace
            && let Some(&emitted) = self.emitted_files.get(&(file, name))
            && emitted.has_inner_station
        {
            if is_station {
                let behind = self.steps.len() + 2;
                self.count_of_stations += 1;
                self.steps.push(Step::Station {
                    file,
                    name,
                    asked_by,
                    asked_from,
                    behind,
                    is_on_cycle: false,
                });
            }
            let ends_way = asked_by == AskedBy::Name && emitted.is_found;
            self.steps.push(Step::FileItself {
                file,
                name,
                ends_way,
            });
            return ends_way;
        }
        self.path.push((file, name));
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
                is_on_cycle: false,
            });
        }
        let place_on_path = self.path.len() - 1;
        let outermost_ring = core::mem::replace(&mut self.outermost_ring, usize::MAX);
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
        let emitted = EmittedFile {
            has_inner_station: self.count_of_stations > count_of_stations + usize::from(is_station),
            is_found,
        };
        self.emitted_files.insert((file, name), emitted);
        if is_station
            && let Some(Step::Station {
                behind,
                is_on_cycle,
                ..
            }) = self.steps.get_mut(station)
        {
            *behind = end;
            *is_on_cycle = self.outermost_ring < place_on_path;
        }
        self.outermost_ring = self.outermost_ring.min(outermost_ring);
        self.path.pop();
        self.names_on_path.remove(&(file, name));
        if is_answer_reused {
            let answer = Answer {
                is_found,
                enclosing_station,
            };
            self.answers.insert(request, answer);
        }
        is_found && !(is_station && asked_by == AskedBy::Star)
    }

    fn find_answer(&self, request: Request) -> Option<bool> {
        let answer = self.answers.get(&request)?;
        let is_on_path = |station| self.stations_on_path.binary_search(&station).is_ok();
        (answer.enclosing_station.is_none_or(is_on_path)).then_some(answer.is_found)
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
                    _ => self.end_at_declaration(file, name),
                }
            }
            Some(_) => self.end_at_declaration(file, name),
            None if is_named && modules.kind(file) == ModuleKind::CommonJs => {
                self.end_at_declaration(file, name)
            }
            None if modules.is_brought_by_star(file, name) => self.ask_stars_as_written(file, name),
            None => self.ask_stars(file, name),
        }
    }

    /// The read without mocks reads what the import is bound to. A way that has left the files behind that binding, past a mock that lacks the name, ends at another declaration: the run is asked for it.
    fn end_at_declaration(&mut self, file: FileId, name: Atom) -> bool {
        let is_of_binding = (self.declared_in)
            .is_none_or(|end| self.path.iter().any(|&(on_path, _)| on_path == end));
        self.steps.push(match is_of_binding {
            true => Step::Declaration,
            false => Step::OtherDeclaration { file, name },
        });
        true
    }

    fn ask_stars_that_bring(&mut self, file: FileId, name: Atom) -> Option<bool> {
        let modules = self.modules;
        if let Some(kept) = self.kept.as_deref_mut() {
            let stars = kept.stars_that_bring(modules, file);
            if stars.has_dynamic_star {
                return Some(self.ask_stars_as_written(file, name));
            }
            let mut places = stars.places.of(modules, name).into_iter();
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
        let holder = self.last_file_on_path();
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

/// Whether the import is bound to what the steps lead to.
fn ends_at_binding(steps: &[Step]) -> bool {
    let is_other = |step: &Step| matches!(step, Step::OtherDeclaration { .. });
    !has_station(steps) && !steps.iter().any(is_other)
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
                is_on_cycle,
            } => Step::Station {
                file,
                name,
                asked_from,
                is_on_cycle,
                asked_by: match asked_by {
                    AskedBy::Statement if asked.is_some_and(|asked| asked.0 != file) => {
                        AskedBy::Name
                    }
                    _ => asked_by,
                },
                behind: behind + first,
            },
            Step::ModuleWithoutTable { .. }
            | Step::FileItself { .. }
            | Step::Declaration
            | Step::OtherDeclaration { .. } => step,
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
    requested_import: RequestedImport<'_>,
    bound_by: BoundBy,
    read_off: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>, ValueId, Atom) -> ValueId,
    read_without_mock: &mut dyn FnMut(&mut FunctionLowering<'_, '_, '_, '_, '_>) -> ValueId,
) -> ValueId {
    let RequestedImport {
        request: asked,
        passed_by: handed_on_by,
        holders,
    } = requested_import;
    let modules = lowering.file.inputs.modules;
    let belongs_to_other_importer = handed_on_by.is_some() && holders.is_empty();
    let reads_links = bound_by == BoundBy::Statement
        && !belongs_to_other_importer
        && modules.has_instances(lowering.file.file);
    let find_path_to_holder = |holder: FileId| {
        let (file, name) = asked?;
        let path = modules.find_path_to_holder(file, name, holder)?;
        Some([holders, &path].concat())
    };
    let own_file = lowering.file.file;
    let find_linked_built_in = |holder: FileId, module: ModuleRef| match module {
        ModuleRef::Runtime(built_in) if reads_links && modules.is_named_by_mock(module) => {
            let path = match holder == own_file {
                true => Some(Vec::new()),
                false => find_path_to_holder(holder),
            };
            let fields = modules.instance_layout(holder)?;
            fields.field_of_mock(module)?;
            Some((built_in, path?))
        }
        _ => None,
    };
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
    if ends_at_binding(&steps) && runtime_station.is_none() {
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
    let place_without_declaration = (!has_declaration(&steps)).then_some(steps.len());
    if place_without_declaration.is_some() {
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
    let mut ends_question = vec![false; steps.len() + 2];
    let mut is_inside_question = vec![false; steps.len() + 2];
    let mut end_of_widest = 0;
    for (station, step) in steps.iter().enumerate() {
        is_inside_question[station] = station < end_of_widest;
        if let Step::Station {
            asked_by: AskedBy::Star,
            behind,
            ..
        } = *step
            && behind > station + 1
        {
            ends_question[behind] = true;
            end_of_widest = end_of_widest.max(behind);
        }
    }
    let end_of_question = (end_of_widest > 0).then(|| {
        let end_of_question = lowering.builder.create_variable(None);
        let none = lowering.builder.integer(0);
        lowering.builder.write_variable(end_of_question, none);
        end_of_question
    });
    match runtime_station {
        Some((module, _)) if is_asked_only_of_built_in && !reads_links => {
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
        if let Some(end_of_question) = end_of_question.filter(|_| ends_question[index]) {
            let end = lowering.builder.read_variable(end_of_question);
            let here = lowering.builder.integer(index as _);
            let ends_here = lowering.builder.strict_eq(end, here);
            let ends_here = lowering.split_on_truthiness(ends_here);
            let goes_on = lowering.create_block();
            lowering.builder.switch_to(ends_here.taken);
            let none = lowering.builder.integer(0);
            lowering.builder.write_variable(end_of_question, none);
            lowering.jump(goes_on);
            lowering.builder.switch_to(ends_here.not_taken);
            lowering.jump(goes_on);
            lowering.continue_in(goes_on);
        }
        let question = end_of_question.filter(|_| is_inside_question[index]);
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
            Step::FileItself { file, name, .. } => Some((ModuleRef::File(file), name, true, None)),
            Step::OtherDeclaration { file, name } => {
                Some((ModuleRef::File(file), name, false, None))
            }
            _ => None,
        };
        if let Some((module, name, is_behind_its_mock, holder_of_star_to_built_in)) = asked_of_run {
            let requested_module = module;
            let linked_file = match module {
                ModuleRef::File(file) if reads_links && modules.has_instances(file) => Some(file),
                _ => None,
            };
            let module = modules.facade(module).unwrap_or(module);
            let module = lowering.file.fragment.declare_module(module);
            let phase = ImportPhase::Evaluation;
            let object = match holder_of_star_to_built_in {
                Some(holder)
                    if let Some((built_in, path)) =
                        find_linked_built_in(holder, requested_module) =>
                {
                    lowering.emit_built_in_namespace(&path, built_in)
                }
                Some(holder) => {
                    let holder = (lowering.file.fragment).declare_module(ModuleRef::File(holder));
                    let reader = reader_through(holder);
                    lowering.builder.namespace_seen_by(module, holder, reader)
                }
                None => match linked_file.and_then(find_path_to_holder) {
                    Some(path) => {
                        let target = *path.last().expect("a path has a last file");
                        lowering.emit_linked_namespace(target, phase, &path)
                    }
                    None => (lowering.builder).module_namespace(
                        module,
                        phase,
                        is_behind_its_mock,
                        false,
                    ),
                },
            };
            let key = lowering.file.name_key(name);
            let has = lowering.emit_has(object, PropertyName::Constant(key));
            let has = lowering.split_on_truthiness(has);
            lowering.builder.switch_to(has.not_taken);
            let lacking = match step {
                Step::FileItself { ends_way: true, .. } => nothing,
                _ => index + 1,
            };
            let lacking = block_at(lowering, &mut blocks, lacking);
            lowering.jump(lacking);
            lowering.builder.switch_to(has.taken);
            if let Some(end_of_question) = question {
                let end = lowering.builder.read_variable(end_of_question);
                let is_open = lowering.split_on_truthiness(end);
                lowering.builder.switch_to(is_open.taken);
                let nothing = block_at(lowering, &mut blocks, nothing);
                lowering.jump(nothing);
                lowering.builder.switch_to(is_open.not_taken);
            }
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
            is_on_cycle,
        } = step
        else {
            if let Some(end_of_question) = question {
                let end = lowering.builder.read_variable(end_of_question);
                let is_open = lowering.split_on_truthiness(end);
                lowering.builder.switch_to(is_open.taken);
                if let Step::ModuleWithoutTable { module, name, .. } = step {
                    let module = modules.facade(module).unwrap_or(module);
                    let module = lowering.file.fragment.declare_module(module);
                    let phase = ImportPhase::Evaluation;
                    let original = lowering
                        .builder
                        .module_namespace(module, phase, true, false);
                    let key = lowering.file.name_key(name);
                    let shows = lowering.emit_has(original, PropertyName::Constant(key));
                    let shows = lowering.split_on_truthiness(shows);
                    lowering.builder.switch_to(shows.not_taken);
                    let next = block_at(lowering, &mut blocks, index + 1);
                    lowering.jump(next);
                    lowering.builder.switch_to(shows.taken);
                }
                let nothing = block_at(lowering, &mut blocks, nothing);
                lowering.jump(nothing);
                lowering.builder.switch_to(is_open.not_taken);
            }
            let declaration = block_at(lowering, &mut blocks, declaration);
            lowering.jump(declaration);
            continue;
        };
        let mocked = (lowering.file.fragment).declare_module(ModuleRef::File(file));
        let path = match asked_from {
            _ if !reads_links => None,
            Some(holder) => find_path_to_holder(holder),
            None => Some(holders.to_vec()),
        };
        let by_link = path.and_then(|path| lowering.split_on_mock(&path, ModuleRef::File(file)));
        if by_link.is_none() {
            let variable = lowering.file.ensure_variable(VariableKey::MockOf(file));
            let mock = lowering.builder.get_module_variable(variable);
            let split = lowering.split_on_type(mock, TypeTable::ABSENT);
            lowering.builder.switch_to(split.taken);
            let next = block_at(lowering, &mut blocks, index + 1);
            lowering.jump(next);
            lowering.builder.switch_to(split.not_taken);
        }
        let next = block_at(lowering, &mut blocks, index + 1);
        let importer = match asked_from.or(handed_on_by) {
            Some(importer) => (lowering.file.fragment).declare_module(ModuleRef::File(importer)),
            None => lowering.file.module_id(),
        };
        let reader = reader_through(importer);
        let mock = match &by_link {
            Some(split) => {
                lowering.continue_in(split.unmocked);
                lowering.jump(next);
                lowering.continue_in(split.mocked);
                split.exports
            }
            None => {
                let sees_mock = lowering
                    .builder
                    .sees_mock_of(mocked, importer, reader, false);
                let asks_mock = lowering.create_block();
                (lowering.builder).branch(sees_mock, Edge::to(asks_mock), Edge::to(next));
                lowering.continue_in(asks_mock);
                lowering.builder.mock_seen_by(mocked, importer, reader)
            }
        };
        if asked_by != AskedBy::Statement {
            let key = lowering.file.name_key(name);
            let has = lowering.emit_has(mock, PropertyName::Constant(key));
            let has = lowering.split_on_truthiness(has);
            lowering.builder.switch_to(has.not_taken);
            let lacking = match asked_by {
                AskedBy::Star if Some(behind) == place_without_declaration => nothing,
                AskedBy::Star => behind,
                AskedBy::Name | AskedBy::Statement => nothing,
            };
            let lacking = block_at(lowering, &mut blocks, lacking);
            let word = by_link.as_ref().map(|split| split.word);
            let word = word.filter(|_| asked_by == AskedBy::Star);
            if let Some(word) = word {
                let is_listed = lowering.builder.has_name_in_mock(word, key, true);
                let nothing = block_at(lowering, &mut blocks, nothing);
                let asks_steps = lowering.create_block();
                (lowering.builder).branch(is_listed, Edge::to(nothing), Edge::to(asks_steps));
                lowering.continue_in(asks_steps);
            }
            let has_steps_of_its_own = asked_by == AskedBy::Star && behind > index + 1;
            match end_of_question.filter(|_| has_steps_of_its_own) {
                Some(end_of_question) => {
                    let keeps_names = match &by_link {
                        Some(split) => lowering.builder.keeps_original_names(split.word),
                        None => lowering
                            .builder
                            .sees_mock_of(mocked, importer, reader, true),
                    };
                    let asks_original = lowering.create_block();
                    (lowering.builder).branch(
                        keeps_names,
                        Edge::to(asks_original),
                        Edge::to(lacking),
                    );
                    lowering.continue_in(asks_original);
                    let end = lowering.builder.read_variable(end_of_question);
                    let is_open = lowering.split_on_truthiness(end);
                    lowering.builder.switch_to(is_open.taken);
                    lowering.jump(next);
                    lowering.builder.switch_to(is_open.not_taken);
                    let end = lowering.builder.integer(behind as _);
                    lowering.builder.write_variable(end_of_question, end);
                    lowering.jump(next);
                }
                None => lowering.jump(lacking),
            }
            lowering.builder.switch_to(has.taken);
            // A spy adds the name to the mock of an import that no star provides.
            if let Some(word) = word.filter(|_| !modules.is_installed_by_spy(name)) {
                let is_listed = lowering.builder.has_name_in_mock(word, key, is_on_cycle);
                let reads_mock = lowering.create_block();
                (lowering.builder).branch(is_listed, Edge::to(reads_mock), Edge::to(lacking));
                lowering.continue_in(reads_mock);
            }
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
        let by_word = runtime_station
            .filter(|_| reads_links)
            .and_then(|(module, name)| {
                let built_in = ModuleRef::Runtime(module);
                let path = match asked {
                    Some((file, name)) => {
                        let rest = modules.find_module_holders(file, name, built_in)?;
                        find_linked_built_in(*rest.last()?, built_in)?.1
                    }
                    None => holders.to_vec(),
                };
                let split = lowering.split_on_mock(&path, built_in)?;
                Some((split, name, !path.is_empty()))
            });
        if let Some((split, name, is_handed_on)) = by_word {
            lowering.continue_in(split.mocked);
            if is_brought_by_star {
                let undefined = lowering.builder.undefined();
                lowering.builder.write_variable(result, undefined);
                lowering.jump(join);
            } else {
                if is_handed_on {
                    let key = lowering.file.name_key(name);
                    let has = lowering.emit_has(split.exports, PropertyName::Constant(key));
                    let has = lowering.split_on_truthiness(has);
                    lowering.builder.switch_to(has.not_taken);
                    let undefined = lowering.builder.undefined();
                    lowering.builder.write_variable(result, undefined);
                    lowering.jump(join);
                    lowering.builder.switch_to(has.taken);
                }
                let answered = read_off(lowering, split.exports, name);
                lowering.builder.write_variable(result, answered);
                lowering.jump(join);
            }
            lowering.continue_in(split.unmocked);
        } else if let Some((module, name)) = runtime_station {
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
                let sees_mock = lowering.builder.sees_mock_of(mocked, holder, reader, false);
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
    if let Some(end_of_question) = end_of_question {
        let end = lowering.builder.read_variable(end_of_question);
        let is_open = lowering.split_on_truthiness(end);
        let goes_on = lowering.create_block();
        lowering.builder.switch_to(is_open.taken);
        let undefined = lowering.builder.undefined();
        lowering.builder.write_variable(result, undefined);
        lowering.jump(goes_on);
        lowering.builder.switch_to(is_open.not_taken);
        lowering.jump(goes_on);
        lowering.continue_in(goes_on);
    }
    lowering.builder.read_variable(result)
}
