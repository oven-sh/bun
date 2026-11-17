//! One record for each thing that is fetched: where it stands, and who waits for it.

use bun_collections::{HashMap, IdentityContext};

use super::{ArrivedPackage, ManifestFailure, RemoteTurn, Wanted};
use crate::isolated_install::store::entry::Id as EntryId;
use crate::package_manager_task::Id;
use crate::{DependencyID, DependencyInstallContext, PackageID};

type Table<V> = HashMap<Id, V, IdentityContext<Id>>;

/// A dependency that is resolved again when the task that it waits for has ended.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct WaitingRow {
    pub(crate) id: DependencyID,
    pub(crate) is_import: bool,
}

/// Who a manifest is requested for. A later one takes over from an earlier one.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Reader {
    /// `populate_manifest_cache`, whose caller finds a failure in the log as a warning.
    OptionalBackfill,
    RequiredBackfill,
    /// A failure is kept for the rows that run into it.
    Rows,
}

#[derive(Default)]
pub(crate) enum ManifestState {
    #[default]
    Idle,
    InFlight {
        reader: Reader,
        follow: Option<Wanted>,
    },
    /// After a 304, a version that the cached copy lacks may have been published since.
    Arrived {
        from_registry: bool,
    },
    Failed(ManifestFailure),
    /// There is no such package, and nothing is left to report.
    Missing,
    /// A backfill has logged that it cannot build the URL.
    BadUrl,
}

impl ManifestState {
    /// The registry, or with `--offline` the cache, has no package of this name.
    pub(crate) fn is_missing(&self) -> bool {
        match self {
            Self::Failed(failure) => failure.missing_until.is_some(),
            Self::Missing => true,
            Self::Idle | Self::InFlight { .. } | Self::Arrived { .. } | Self::BadUrl => false,
        }
    }
}

#[derive(Default)]
struct ManifestRequest {
    state: ManifestState,
    /// The imports that wait for the response, and the rows that ran into the failure.
    rows: Vec<WaitingRow>,
    /// The event loop iteration in which a runtime lookup found nothing.
    missed_in: Option<u64>,
}

#[derive(Default)]
pub(crate) struct ManifestRequests(Table<ManifestRequest>);

impl ManifestRequests {
    fn entry(&mut self, id: Id) -> &mut ManifestRequest {
        self.0.get_or_put(id).expect("unreachable").value_ptr
    }

    pub(crate) fn state(&self, id: Id) -> &ManifestState {
        (self.0.get(&id)).map_or(&ManifestState::Idle, |request| &request.state)
    }

    pub(crate) fn rows(&self, id: Id) -> &[WaitingRow] {
        self.0.get(&id).map_or(&[], |request| &request.rows)
    }

    pub(crate) fn take_rows(&mut self, id: Id) -> Vec<WaitingRow> {
        (self.0.get_mut(&id)).map_or(Vec::new(), |request| core::mem::take(&mut request.rows))
    }

    pub(crate) fn reader(&self, id: Id) -> Reader {
        let &ManifestState::InFlight { reader, .. } = self.state(id) else {
            unreachable!("a response has a request");
        };
        reader
    }

    pub(crate) fn sent(&mut self, id: Id, reader: Reader) {
        let follow = None;
        self.entry(id).state = ManifestState::InFlight { reader, follow };
    }

    /// The queue tries its rows again, so only an import is listed.
    pub(crate) fn join(&mut self, id: Id, joins: Reader, import: Option<WaitingRow>) {
        if let Some(request) = self.0.get_mut(&id)
            && let ManifestState::InFlight { reader, .. } = &mut request.state
        {
            *reader = joins.max(*reader);
            request.rows.extend(import);
        }
    }

    pub(crate) fn follow(&mut self, id: Id, wanted: Wanted) {
        if let Some(request) = self.0.get_mut(&id)
            && let ManifestState::InFlight { follow, .. } = &mut request.state
        {
            *follow = Some(wanted);
        }
    }

    pub(crate) fn arrived(
        &mut self,
        id: Id,
        from_registry: bool,
    ) -> (Option<Wanted>, Vec<WaitingRow>) {
        let request = self.entry(id);
        let arrived = ManifestState::Arrived { from_registry };
        let ManifestState::InFlight { follow, .. } =
            core::mem::replace(&mut request.state, arrived)
        else {
            unreachable!("a response has a request");
        };
        (follow, core::mem::take(&mut request.rows))
    }

    pub(crate) fn failed(&mut self, id: Id, failure: ManifestFailure) {
        self.entry(id).state = ManifestState::Failed(failure);
    }

    pub(crate) fn missing(&mut self, id: Id, turn: u64) {
        let request = self.entry(id);
        request.state = ManifestState::Missing;
        request.missed_in = Some(turn);
    }

    pub(crate) fn bad_url(&mut self, id: Id) {
        self.entry(id).state = ManifestState::BadUrl;
    }

    /// Lists `row`, for `log_held` and for a later request of the runtime.
    pub(crate) fn run_into_failure(&mut self, id: Id, row: WaitingRow) -> &mut ManifestFailure {
        let request = self.entry(id);
        request.rows.push(row);
        let ManifestState::Failed(failure) = &mut request.state else {
            unreachable!("the caller saw the failure");
        };
        failure
    }

    pub(crate) fn missed(&mut self, id: Id, turn: u64) {
        if let Some(request) = self.0.get_mut(&id)
            && !matches!(request.state, ManifestState::Idle)
        {
            request.missed_in = Some(turn);
        }
    }

    /// A miss is remembered for the rest of its turn, a 404 for as long as a manifest is cached.
    pub(crate) fn forget_miss(&mut self, id: Id, turn: u64, now: impl FnOnce() -> i64) {
        let Some(request) = self.0.get_mut(&id) else {
            return;
        };
        let missing_until = match &request.state {
            ManifestState::InFlight { .. } => return,
            ManifestState::Failed(failure) => failure.missing_until.unwrap_or(0),
            ManifestState::Idle
            | ManifestState::Arrived { .. }
            | ManifestState::Missing
            | ManifestState::BadUrl => 0,
        };
        if request.missed_in.is_some_and(|missed_in| missed_in != turn)
            && i64::from(missing_until) <= now()
        {
            request.state = ManifestState::Idle;
            request.missed_in = None;
        }
    }

    pub(crate) fn forget_rows(&mut self) {
        self.0.values_mut().for_each(|request| request.rows.clear());
    }

    /// Nothing may be in flight.
    pub(crate) fn clear(&mut self) {
        self.0.clear();
    }
}

pub(crate) enum Waiter {
    Row(WaitingRow),
    Hoisted(DependencyInstallContext),
    Isolated(EntryId),
    /// A checkout that needs the clone. `dependency_id` may resolve to another package.
    Checkout {
        dependency_id: DependencyID,
        package_id: PackageID,
    },
}

pub(crate) fn rows(waiters: &[Waiter]) -> impl Iterator<Item = WaitingRow> {
    waiters.iter().filter_map(|waiter| match *waiter {
        Waiter::Row(row) => Some(row),
        Waiter::Hoisted(_) | Waiter::Isolated(_) | Waiter::Checkout { .. } => None,
    })
}

enum Fetch {
    /// Only `ask` lists anybody here: a row that starts the task next, or cannot start it.
    Idle(Vec<Waiter>),
    /// A checkout that waits for its clone counts as running.
    Running {
        is_required: bool,
        waiters: Vec<Waiter>,
    },
    /// Nobody tries again, except the runtime in a later iteration of its event loop.
    Failed {
        is_required: bool,
        turn: u64,
    },
    Arrived(Box<(ArrivedPackage, Vec<Waiter>)>),
    /// A row that comes later binds to this package.
    Appended(PackageID),
}

const _: () = assert!(size_of::<Waiter>() == 32 && size_of::<Fetch>() == 32);

impl Default for Fetch {
    fn default() -> Self {
        Fetch::Idle(Vec::new())
    }
}

/// How a row needs a task.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Need {
    /// A peer before the peer pass. It starts nothing, because the tree may provide it.
    Deferred,
    Optional,
    Required,
}

#[must_use]
pub(crate) enum Join {
    Running,
    Failed {
        is_required: bool,
    },
    /// The waiter goes to `start`.
    Start,
}

/// What a task that has ended leaves to its handler.
pub(crate) struct Ended {
    pub(crate) is_required: bool,
    pub(crate) waiters: Vec<Waiter>,
}

/// The tarballs, and the clones, commit lookups and checkouts of git.
#[derive(Default)]
pub(crate) struct Fetches {
    table: Table<Fetch>,
    /// Every task that a row on a git, GitHub or tarball package has waited for.
    remote: Vec<Id>,
    /// How many records are `Arrived`.
    arrived: usize,
}

impl Fetches {
    fn entry(&mut self, id: Id) -> &mut Fetch {
        self.table.get_or_put(id).expect("unreachable").value_ptr
    }

    pub(crate) fn is_optional_so_far(&self, id: Id) -> bool {
        let fetch = self.table.get(&id);
        matches!(fetch, Some(Fetch::Running { is_required, .. }) if !is_required)
    }

    pub(crate) fn has_failed(&self, id: Id) -> bool {
        matches!(self.table.get(&id), Some(Fetch::Failed { .. }))
    }

    pub(crate) fn appended_package(&self, id: Id) -> Option<PackageID> {
        match self.table.get(&id) {
            Some(&Fetch::Appended(package_id)) => Some(package_id),
            _ => None,
        }
    }

    pub(crate) fn has_rows(&self, id: Id) -> bool {
        let fetch = self.table.get(&id);
        matches!(fetch, Some(Fetch::Running { waiters, .. }) if rows(waiters).next().is_some())
    }

    /// A dependency needs `id`, and lists `row`. Returns true if the caller has to start the task.
    #[must_use]
    pub(crate) fn ask(&mut self, id: Id, row: Option<WaitingRow>, need: Need) -> bool {
        if row.is_some() && !self.remote.contains(&id) {
            self.remote.push(id);
        }
        let (waiters, starts) = match self.entry(id) {
            Fetch::Appended(_) => return false,
            Fetch::Failed { is_required, .. } => {
                *is_required |= need == Need::Required;
                return false;
            }
            Fetch::Running {
                is_required,
                waiters,
            } => {
                *is_required |= need == Need::Required;
                (waiters, false)
            }
            Fetch::Arrived(arrived) => (&mut arrived.1, false),
            Fetch::Idle(parked) => (parked, need != Need::Deferred),
        };
        // It is listed already if it asked ahead of its turn, or waited for the peer pass.
        if let Some(row) = row
            && !rows(waiters).any(|listed| listed == row)
        {
            waiters.push(Waiter::Row(row));
        }
        starts
    }

    /// A package of the lockfile is not in the cache. Takes `waiter` if a task will answer it.
    pub(crate) fn join(&mut self, id: Id, waiter: &mut Option<Waiter>) -> Join {
        match self.table.get_mut(&id) {
            Some(Fetch::Running { waiters, .. }) => {
                waiters.extend(waiter.take());
                Join::Running
            }
            Some(&mut Fetch::Failed { is_required, .. }) => Join::Failed { is_required },
            None | Some(Fetch::Idle(_) | Fetch::Appended(_)) => Join::Start,
            Some(Fetch::Arrived(_)) => unreachable!("appended before anything is linked"),
        }
    }

    pub(crate) fn require(&mut self, id: Id) {
        if let Some(Fetch::Running { is_required, .. } | Fetch::Failed { is_required, .. }) =
            self.table.get_mut(&id)
        {
            *is_required = true;
        }
    }

    pub(crate) fn start(&mut self, id: Id, is_required: bool, waiter: Option<Waiter>) {
        let fetch = self.entry(id);
        let mut waiters = match core::mem::take(fetch) {
            Fetch::Idle(parked) => parked,
            Fetch::Failed { .. } | Fetch::Appended(_) => Vec::new(),
            Fetch::Running { .. } | Fetch::Arrived(_) => unreachable!("started twice"),
        };
        waiters.extend(waiter);
        *fetch = Fetch::Running {
            is_required,
            waiters,
        };
    }

    fn end(&mut self, id: Id, next: impl FnOnce(bool) -> Fetch) -> Ended {
        let fetch = self.entry(id);
        let (is_required, waiters) = match core::mem::take(fetch) {
            Fetch::Running {
                is_required,
                waiters,
            } => (is_required, waiters),
            // An `--offline` miss, or the package from `take_next`.
            Fetch::Idle(parked) => (true, parked),
            Fetch::Failed { .. } | Fetch::Arrived(_) | Fetch::Appended(_) => {
                unreachable!("ended twice")
            }
        };
        *fetch = next(is_required);
        Ended {
            is_required,
            waiters,
        }
    }

    /// Whoever asks next starts the task again.
    pub(crate) fn release(&mut self, id: Id) -> Ended {
        self.end(id, |_| Fetch::default())
    }

    pub(crate) fn fail(&mut self, id: Id, turn: u64) -> Ended {
        self.end(id, |is_required| Fetch::Failed { is_required, turn })
    }

    pub(crate) fn appended(&mut self, id: Id, package_id: PackageID) -> Vec<Waiter> {
        self.end(id, |_| Fetch::Appended(package_id)).waiters
    }

    pub(crate) fn arrive(&mut self, id: Id, package: ArrivedPackage) {
        let waiters = self.release(id).waiters;
        *self.entry(id) = Fetch::Arrived(Box::new((package, waiters)));
        self.arrived += 1;
    }

    /// `kept_in`: a failure of this iteration of the event loop is kept.
    pub(crate) fn forget_failure(&mut self, id: Id, kept_in: Option<u64>) {
        if let Some(fetch) = self.table.get_mut(&id)
            && matches!(*fetch, Fetch::Failed { turn, .. } if Some(turn) != kept_in)
        {
            *fetch = Fetch::default();
        }
    }

    /// Nothing may be running for a row.
    pub(crate) fn forget_rows(&mut self) {
        for id in &self.remote {
            if let Some(Fetch::Idle(parked)) = self.table.get_mut(id) {
                parked.clear();
            }
        }
    }

    /// `moved` returns false for a package that is gone. The next row starts its task again.
    pub(crate) fn renumber_packages(&mut self, moved: impl Fn(&mut PackageID) -> bool) {
        for fetch in self.table.values_mut() {
            if let Fetch::Appended(package_id) = fetch
                && !moved(package_id)
            {
                *fetch = Fetch::default();
            }
        }
    }

    pub(crate) fn has_remote(&self) -> bool {
        !self.remote.is_empty()
    }

    pub(crate) fn has_arrived(&self) -> bool {
        self.arrived > 0
    }

    /// The lowest row of each task that has started and has not failed.
    pub(crate) fn lowest_rows(&self, turn: RemoteTurn) -> impl Iterator<Item = (DependencyID, Id)> {
        self.remote.iter().filter_map(move |&id| {
            let waiters = match self.table.get(&id)? {
                Fetch::Arrived(arrived) => &arrived.1,
                Fetch::Running { waiters, .. } if turn == RemoteTurn::InOrder => waiters,
                Fetch::Running { .. }
                | Fetch::Idle(_)
                | Fetch::Failed { .. }
                | Fetch::Appended(_) => return None,
            };
            Some((rows(waiters).map(|row| row.id).min()?, id))
        })
    }

    /// The package whose turn it is, if it has arrived. `appended` returns who waits for it.
    pub(crate) fn take_next(
        &mut self,
        turn: RemoteTurn,
    ) -> Option<(DependencyID, Id, ArrivedPackage)> {
        if !self.has_arrived() {
            return None;
        }
        let (row, id) = self.lowest_rows(turn).min_by_key(|&(row, _)| row)?;
        let fetch = self.table.get_mut(&id)?;
        match core::mem::take(fetch) {
            Fetch::Arrived(arrived) => {
                let (package, waiters) = *arrived;
                *fetch = Fetch::Idle(waiters);
                self.arrived -= 1;
                Some((row, id, package))
            }
            running => {
                *fetch = running;
                None
            }
        }
    }
}
