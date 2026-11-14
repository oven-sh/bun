use bun_sema::atom::Atom;
use bun_sema::program::FileId;
use bun_sema::util::FxHashMap;
use bun_threading::Guarded;
use smallvec::SmallVec;

use super::graph::ModuleGraph;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct ReexportPath(u32);

#[derive(Copy, Clone)]
pub(super) struct ReexportChain(u32);

pub(super) type Request = (FileId, Atom);
pub(super) type Reexports = SmallVec<[Request; 2]>;

#[derive(Copy, Clone)]
pub struct PathStep {
    pub file: FileId,
    pub rest: Option<ReexportPath>,
    pub target: FileId,
}

struct ChainLink {
    request: Request,
    first: Option<Request>,
    rest: Option<ReexportChain>,
}

#[derive(Default)]
pub(super) struct ReexportPaths {
    links: Vec<ChainLink>,
    chains: FxHashMap<(Request, Option<FileId>), Option<ReexportChain>>,
    steps: Vec<PathStep>,
    paths: FxHashMap<(FileId, Option<ReexportPath>), ReexportPath>,
    paths_of_chains: FxHashMap<(u32, Option<FileId>), Option<ReexportPath>>,
}

struct Visit {
    request: Request,
    reexports: Reexports,
    next: usize,
    lowest: usize,
    is_open: bool,
}

impl ReexportPaths {
    fn find_chain(
        &mut self,
        graph: &ModuleGraph,
        root: Request,
        end: Option<FileId>,
    ) -> Option<ReexportChain> {
        if let Some(&known) = self.chains.get(&(root, end)) {
            return known;
        }
        let enter = |request: Request, index: usize| Visit {
            request,
            reexports: graph.reexports_of_name(request.0, request.1),
            next: 0,
            lowest: index,
            is_open: true,
        };
        let mut indexes: FxHashMap<Request, usize> = FxHashMap::default();
        let mut visits = vec![enter(root, 0)];
        let mut path = vec![0];
        let mut open = vec![0];
        indexes.insert(root, 0);
        while let Some(&index) = path.last() {
            let visit = &mut visits[index];
            if let Some(&next) = visit.reexports.get(visit.next) {
                visit.next += 1;
                if self.chains.contains_key(&(next, end)) {
                    continue;
                }
                match indexes.get(&next) {
                    Some(&met) if visits[met].is_open => {
                        visits[index].lowest = visits[index].lowest.min(met);
                    }
                    Some(_) => {}
                    None => {
                        let met = visits.len();
                        indexes.insert(next, met);
                        visits.push(enter(next, met));
                        path.push(met);
                        open.push(met);
                    }
                }
                continue;
            }
            path.pop();
            let lowest = visits[index].lowest;
            if let Some(&before) = path.last() {
                visits[before].lowest = visits[before].lowest.min(lowest);
            }
            if lowest == index {
                let first = open.iter().rposition(|&it| it == index).unwrap_or(0);
                let component = open.split_off(first);
                for &member in &component {
                    visits[member].is_open = false;
                }
                self.settle(&visits, &indexes, &component, end);
            }
        }
        self.chains.get(&(root, end)).copied().flatten()
    }

    fn settle(
        &mut self,
        visits: &[Visit],
        indexes: &FxHashMap<Request, usize>,
        component: &[usize],
        end: Option<FileId>,
    ) {
        let is_end = |visit: &Visit| {
            visit.reexports.is_empty() && end.is_none_or(|it| it == visit.request.0)
        };
        let known_chain =
            |paths: &Self, request: Request| paths.chains.get(&(request, end)).copied().flatten();
        let places = component.iter().enumerate();
        let places: FxHashMap<usize, usize> =
            places.map(|(place, &member)| (member, place)).collect();
        let place_of = |request: &Request| places.get(indexes.get(request)?).copied();
        let mut exits: Vec<Option<ReexportChain>> = Vec::with_capacity(component.len());
        let mut entered_from: Vec<Vec<usize>> = vec![Vec::new(); component.len()];
        let mut reached: Vec<usize> = Vec::new();
        for (place, &member) in component.iter().enumerate() {
            let visit = &visits[member];
            let exit = visit.reexports.iter().find_map(|&it| known_chain(self, it));
            exits.push(exit);
            if exit.is_some() || is_end(visit) {
                reached.push(place);
            }
            for target in visit.reexports.iter().filter_map(place_of) {
                entered_from[target].push(place);
            }
        }
        let mut distances: Vec<Option<u32>> = vec![None; component.len()];
        for &place in &reached {
            distances[place] = Some(0);
        }
        let mut next = 0;
        while let Some(&place) = reached.get(next) {
            next += 1;
            let distance = distances[place].map(|it| it + 1);
            for &before in &entered_from[place] {
                if distances[before].is_none() {
                    distances[before] = distance;
                    reached.push(before);
                }
            }
        }
        let mut chains: Vec<Option<ReexportChain>> = vec![None; component.len()];
        let mut closer: Vec<Option<usize>> = vec![None; component.len()];
        for &place in &reached {
            let visit = &visits[component[place]];
            let mut inside = visit.reexports.iter().filter_map(place_of);
            if distances[place] != Some(0) {
                closer[place] =
                    inside.find(|&it| distances[it].is_some() && distances[it] < distances[place]);
            }
            let rest = exits[place].or_else(|| chains[closer[place]?]);
            let chain = ReexportChain(self.links.len() as u32);
            self.links.push(ChainLink {
                request: visit.request,
                first: rest.map(|it| self.link(it).request),
                rest,
            });
            chains[place] = Some(chain);
        }
        if component.len() > 1 {
            self.find_first_requests(visits, component, &chains, &closer, &place_of);
        }
        for (place, &member) in component.iter().enumerate() {
            let request = visits[member].request;
            self.chains.insert((request, end), chains[place]);
        }
    }

    fn find_first_requests(
        &mut self,
        visits: &[Visit],
        component: &[usize],
        chains: &[Option<ReexportChain>],
        closer: &[Option<usize>],
        place_of: &dyn Fn(&Request) -> Option<usize>,
    ) {
        let ranges = number_tree(closer);
        let passes = |from: usize, place: usize| {
            ranges[place].0 <= ranges[from].0 && ranges[from].0 < ranges[place].1
        };
        let leaves = |paths: &Self, place: usize| {
            let rest = chains[place].map(|it| paths.link(it).rest);
            rest.is_some_and(|rest| {
                rest.is_none_or(|it| place_of(&paths.link(it).request).is_none())
            })
        };
        let mut seen = vec![usize::MAX; component.len()];
        let mut work = Vec::new();
        for (place, &member) in component.iter().enumerate() {
            let Some(chain) = chains[place] else {
                continue;
            };
            for &next in &visits[member].reexports {
                let Some(target) = place_of(&next) else {
                    if self
                        .link(chain)
                        .rest
                        .is_some_and(|it| self.link(it).request == next)
                    {
                        self.links[chain.0 as usize].first = Some(next);
                        break;
                    }
                    continue;
                };
                if chains[target].is_some() && !passes(target, place) {
                    self.links[chain.0 as usize].first = Some(next);
                    break;
                }
                seen[place] = place;
                work.clear();
                if seen[target] != place {
                    seen[target] = place;
                    work.push(target);
                }
                let mut leads_to_end = false;
                while let Some(at) = work.pop() {
                    if leaves(self, at) || (chains[at].is_some() && !passes(at, place)) {
                        leads_to_end = true;
                        break;
                    }
                    let targets = visits[component[at]].reexports.iter().rev();
                    for target in targets.filter_map(place_of) {
                        if seen[target] != place {
                            seen[target] = place;
                            work.push(target);
                        }
                    }
                }
                if leads_to_end {
                    self.links[chain.0 as usize].first = Some(next);
                    break;
                }
            }
        }
    }

    fn link(&self, chain: ReexportChain) -> &ChainLink {
        &self.links[chain.0 as usize]
    }

    fn step(&self, path: ReexportPath) -> PathStep {
        self.steps[path.0 as usize]
    }

    fn intern(&mut self, file: FileId, rest: Option<ReexportPath>) -> ReexportPath {
        let target = rest.map_or(file, |rest| self.step(rest).target);
        let steps = &mut self.steps;
        *self.paths.entry((file, rest)).or_insert_with(|| {
            steps.push(PathStep { file, rest, target });
            ReexportPath(steps.len() as u32 - 1)
        })
    }

    fn path_of_chain(
        &mut self,
        graph: &ModuleGraph,
        chain: ReexportChain,
        last: Option<FileId>,
    ) -> Option<ReexportPath> {
        let mut passed: SmallVec<[ReexportChain; 8]> = SmallVec::new();
        let mut at = Some(chain);
        let mut path = None;
        let mut is_known = false;
        while let Some(chain) = at {
            if let Some(&known) = self.paths_of_chains.get(&(chain.0, last)) {
                path = known;
                is_known = true;
                break;
            }
            passed.push(chain);
            at = self.link(chain).rest;
        }
        if !is_known {
            path = last.map(|last| self.intern(last, None));
        }
        while let Some(chain) = passed.pop() {
            let file = self.link(chain).request.0;
            if graph.has_instances(file) {
                path = Some(self.intern(file, path));
            }
            self.paths_of_chains.insert((chain.0, last), path);
        }
        path
    }
}

fn number_tree(parents: &[Option<usize>]) -> Vec<(usize, usize)> {
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); parents.len()];
    let mut work = Vec::new();
    for (node, parent) in parents.iter().enumerate() {
        match parent {
            Some(parent) => children[*parent].push(node),
            None => work.push((node, false)),
        }
    }
    let mut ranges = vec![(0, 0); parents.len()];
    let mut next = 0;
    while let Some((node, is_done)) = work.pop() {
        if is_done {
            ranges[node].1 = next;
            continue;
        }
        ranges[node].0 = next;
        next += 1;
        work.push((node, true));
        work.extend(children[node].iter().map(|&child| (child, false)));
    }
    ranges
}

impl ModuleGraph {
    fn find_chain_in(
        &self,
        paths: &mut ReexportPaths,
        request: Request,
        ends: &[Option<FileId>],
    ) -> Option<ReexportChain> {
        ends.iter()
            .find_map(|&end| paths.find_chain(self, request, end))
    }

    pub(super) fn find_reexport_passed(
        &self,
        request: Request,
        ends: &[Option<FileId>],
        mut is_found: impl FnMut(Request) -> bool,
    ) -> Option<Request> {
        let mut paths = self.reexport_paths.lock();
        let chain = self.find_chain_in(&mut paths, request, ends)?;
        let first = paths.link(chain).first?;
        let mut at = self.find_chain_in(&mut paths, first, ends);
        while let Some(chain) = at {
            let request = paths.link(chain).request;
            if is_found(request) {
                return Some(request);
            }
            at = paths.link(chain).rest;
        }
        None
    }

    pub(super) fn find_path_behind(
        &self,
        request: Request,
        ends: &[Option<FileId>],
        last: Option<FileId>,
    ) -> Option<ReexportPath> {
        let mut paths = self.reexport_paths.lock();
        let chain = self.find_chain_in(&mut paths, request, ends)?;
        let rest = paths.link(chain).rest?;
        paths.path_of_chain(self, rest, last)
    }

    pub fn path_step(&self, path: ReexportPath) -> PathStep {
        self.reexport_paths.lock().step(path)
    }

    pub fn intern_path(&self, files: &[FileId]) -> Option<ReexportPath> {
        let mut paths = self.reexport_paths.lock();
        let mut path = None;
        for &file in files.iter().rev() {
            path = Some(paths.intern(file, path));
        }
        path
    }

    #[cfg(test)]
    pub(super) fn files_of_path(&self, path: ReexportPath) -> Vec<FileId> {
        let paths = self.reexport_paths.lock();
        let mut files = Vec::new();
        let mut at = Some(path);
        while let Some(path) = at {
            let step = paths.step(path);
            files.push(step.file);
            at = step.rest;
        }
        files
    }
}

pub(super) type GuardedReexportPaths = Guarded<ReexportPaths>;
