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
    /// An `--offline` miss that is reported, or a 404 for a workspace's name that nobody reports.
    Missing,
    /// A backfill has logged that it cannot build the URL.
    BadUrl,
}

impl ManifestState {
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

const _: () = assert!(size_of::<ManifestRequest>() <= 96);

#[derive(Default)]
pub(crate) struct ManifestRequests(Table<ManifestRequest>);

impl ManifestRequests {
    fn entry(&mut self, id: Id) -> &mut ManifestRequest {
        bun_core::handle_oom(self.0.get_or_put(id)).value_ptr
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

    /// Without a request on record, a failure is an error that stays in the log.
    pub(crate) fn reader(&self, id: Id) -> Reader {
        match *self.state(id) {
            ManifestState::InFlight { reader, .. } => reader,
            _ => Reader::RequiredBackfill,
        }
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
        let follow = match core::mem::replace(&mut request.state, arrived) {
            ManifestState::InFlight { follow, .. } => follow,
            _ => None,
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
    pub(crate) fn run_into_failure(
        &mut self,
        id: Id,
        row: WaitingRow,
    ) -> Option<&mut ManifestFailure> {
        let request = self.entry(id);
        request.rows.push(row);
        match &mut request.state {
            ManifestState::Failed(failure) => Some(failure),
            _ => None,
        }
    }

    pub(crate) fn missed(&mut self, id: Id, turn: u64) {
        if let Some(request) = self.0.get_mut(&id)
            && !matches!(request.state, ManifestState::Idle)
        {
            request.missed_in = Some(turn);
        }
    }

    /// A miss is remembered for the rest of its turn, a 404 for as long as a manifest is cached.
    pub(crate) fn forget_miss(&mut self, id: Id, turn: u64) {
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
            && i64::from(missing_until) <= bun_core::time::timestamp()
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
    /// Also a checkout that waits for its clone. Only the isolated linker ends it if that fails.
    Running {
        is_required: bool,
        waiters: Vec<Waiter>,
    },
    /// Nobody tries again until `forget_failure`.
    Failed {
        is_required: bool,
        turn: u64,
    },
    Arrived(Box<Arrived>),
    /// A row that comes later binds to this package.
    Appended(PackageID),
    /// It has ended well, and there is no package that a row could bind to.
    Done,
}

pub(crate) struct Arrived {
    pub(crate) package: ArrivedPackage,
    pub(crate) waiters: Vec<Waiter>,
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
    /// What it fetched is not the package that is missing.
    Ended,
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
        bun_core::handle_oom(self.table.get_or_put(id)).value_ptr
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
        let fetch = self.entry(id);
        if let Fetch::Done = fetch {
            *fetch = Fetch::default();
        }
        let (waiters, starts) = match fetch {
            Fetch::Appended(_) | Fetch::Done => return false,
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
            Fetch::Arrived(arrived) => (&mut arrived.waiters, false),
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
            Some(Fetch::Arrived(arrived)) => {
                arrived.waiters.extend(waiter.take());
                Join::Running
            }
            Some(&mut Fetch::Failed { is_required, .. }) => Join::Failed { is_required },
            Some(Fetch::Appended(_) | Fetch::Done) => Join::Ended,
            None | Some(Fetch::Idle(_)) => Join::Start,
        }
    }

    pub(crate) fn require_failed(&mut self, id: Id) {
        if let Some(Fetch::Failed { is_required, .. }) = self.table.get_mut(&id) {
            *is_required = true;
        }
    }

    /// Returns false if another task has the record. The caller starts nothing then.
    #[must_use]
    pub(crate) fn start(&mut self, id: Id, required: bool, waiter: Option<Waiter>) -> bool {
        let fetch = self.entry(id);
        let mut waiters = match fetch {
            Fetch::Idle(parked) => core::mem::take(parked),
            Fetch::Appended(_) | Fetch::Done => Vec::new(),
            Fetch::Running {
                is_required,
                waiters,
            } => {
                *is_required |= required;
                waiters.extend(waiter);
                return false;
            }
            Fetch::Failed { is_required, .. } => {
                *is_required |= required;
                return false;
            }
            Fetch::Arrived(arrived) => {
                arrived.waiters.extend(waiter);
                return false;
            }
        };
        waiters.extend(waiter);
        *fetch = Fetch::Running {
            is_required: required,
            waiters,
        };
        true
    }

    /// Leaves the record `Idle`.
    fn end(&mut self, id: Id) -> (&mut Fetch, Ended) {
        let fetch = bun_core::handle_oom(self.table.get_or_put(id)).value_ptr;
        let (is_required, waiters) = match core::mem::take(fetch) {
            Fetch::Running {
                is_required,
                waiters,
            } => (is_required, waiters),
            // An `--offline` miss.
            Fetch::Idle(parked) => (true, parked),
            Fetch::Failed { is_required, .. } => (is_required, Vec::new()),
            Fetch::Arrived(arrived) => {
                self.arrived -= 1;
                (true, arrived.waiters)
            }
            Fetch::Appended(_) | Fetch::Done => (true, Vec::new()),
        };
        let ended = Ended {
            is_required,
            waiters,
        };
        (fetch, ended)
    }

    /// Whoever asks next starts the task again.
    pub(crate) fn release(&mut self, id: Id) -> Ended {
        self.end(id).1
    }

    pub(crate) fn done(&mut self, id: Id) -> Vec<Waiter> {
        let (fetch, ended) = self.end(id);
        *fetch = Fetch::Done;
        ended.waiters
    }

    pub(crate) fn fail(&mut self, id: Id, turn: u64) -> Ended {
        let (fetch, ended) = self.end(id);
        let is_required = ended.is_required;
        *fetch = Fetch::Failed { is_required, turn };
        ended
    }

    /// After `release` or `take_next`.
    pub(crate) fn appended(&mut self, id: Id, package_id: PackageID) {
        let fetch = self.entry(id);
        debug_assert!(matches!(fetch, Fetch::Idle(parked) if parked.is_empty()));
        *fetch = Fetch::Appended(package_id);
    }

    pub(crate) fn arrive(&mut self, id: Id, package: ArrivedPackage) {
        let (fetch, ended) = self.end(id);
        let waiters = ended.waiters;
        *fetch = Fetch::Arrived(Box::new(Arrived { package, waiters }));
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
                *fetch = Fetch::Done;
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
                Fetch::Arrived(arrived) => &arrived.waiters,
                Fetch::Running { waiters, .. } if turn == RemoteTurn::InOrder => waiters,
                Fetch::Running { .. }
                | Fetch::Idle(_)
                | Fetch::Failed { .. }
                | Fetch::Appended(_)
                | Fetch::Done => return None,
            };
            Some((rows(waiters).map(|row| row.id).min()?, id))
        })
    }

    /// The package whose turn it is, if it has arrived.
    pub(crate) fn take_next(
        &mut self,
        turn: RemoteTurn,
    ) -> Option<(DependencyID, Id, Box<Arrived>)> {
        if !self.has_arrived() {
            return None;
        }
        let (row, id) = self.lowest_rows(turn).min_by_key(|&(row, _)| row)?;
        let fetch = self.table.get_mut(&id)?;
        match core::mem::take(fetch) {
            Fetch::Arrived(arrived) => {
                self.arrived -= 1;
                Some((row, id, arrived))
            }
            running => {
                *fetch = running;
                None
            }
        }
    }
}
