//! One record for each tarball and git task: where it stands, and which rows wait for it.

use core::mem::take;

use bun_collections::{HashMap, IdentityContext, IdentityHash};
use bun_sys::Fd;

use super::{ArrivedPackage, RemoteTurn};
use crate::package_manager_task::{CheckoutId, CloneId, CommitId, PackageFetchId, TarballId};
use crate::{DependencyID, PackageID};

pub(super) type Table<I, V> = HashMap<I, V, IdentityContext<I>>;

pub(super) fn entry<I: IdentityHash, V: Default>(table: &mut Table<I, V>, id: I) -> &mut V {
    bun_core::handle_oom(table.get_or_put(id)).value_ptr
}

/// A dependency that is resolved again when the task that it waits for has ended.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct WaitingRow {
    pub(crate) id: DependencyID,
    pub(crate) is_import: bool,
}

pub(super) type Rows = Vec<WaitingRow>;

/// How a row needs a task.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Need {
    /// A peer before the peer pass. It starts nothing, because the tree may provide it.
    Deferred,
    Optional,
    Required,
}

/// An iteration of the event loop.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Turn(pub(super) u64);

/// No task has `id`. The holder starts it, or parks its rows.
#[must_use]
pub(crate) struct Claim<I> {
    id: I,
    task: Running,
}

impl<I: Copy> Claim<I> {
    fn new(id: I, rows: Rows, is_required: bool) -> Self {
        let task = Running { is_required, rows };
        Claim { id, task }
    }

    pub(crate) fn id(&self) -> I {
        self.id
    }

    pub(crate) fn is_required(&self) -> bool {
        self.task.is_required
    }
}

/// Only whoever starts the task looks up whether the install needs it.
#[must_use]
pub(crate) struct Unweighed<I> {
    id: I,
    rows: Rows,
}

impl<I: Copy> Unweighed<I> {
    pub(crate) fn weigh(self, is_required: bool) -> Claim<I> {
        Claim::new(self.id, self.rows, is_required)
    }
}

/// What a task carries. `Copy`, because a streamed download and its extraction both carry it.
#[derive(Clone, Copy)]
#[must_use]
pub(crate) struct Started<I>(I);

impl<I: Copy> Started<I> {
    pub(crate) fn id(self) -> I {
        self.0
    }
}

impl<I: Into<PackageFetchId>> Started<I> {
    pub(crate) fn of_package(self) -> Started<PackageFetchId> {
        Started(self.0.into())
    }
}

/// The task is over, and the holder says what becomes of the record and of its rows.
#[must_use]
pub(crate) struct Ended<I> {
    id: I,
    is_required: bool,
    rows: Rows,
}

impl<I> Ended<I> {
    pub(crate) fn is_required(&self) -> bool {
        self.is_required
    }

    pub(crate) fn has_rows(&self) -> bool {
        !self.rows.is_empty()
    }

    /// Leaves the record `Idle`: whoever asks next starts the task again.
    #[must_use]
    pub(crate) fn release(self) -> Rows {
        self.rows
    }
}

/// It is listed already if it asked ahead of its turn, or waited for the peer pass.
fn list(rows: &mut Rows, row: Option<WaitingRow>) {
    rows.extend(row.filter(|row| !rows.contains(row)));
}

/// Returns the rows that the task is for, if `need` starts it.
fn claim(parked: &mut Rows, row: Option<WaitingRow>, need: Need) -> Option<Rows> {
    list(parked, row);
    (need != Need::Deferred).then(|| take(parked))
}

struct Running {
    is_required: bool,
    rows: Rows,
}

impl Running {
    fn join(&mut self, row: Option<WaitingRow>, need: Need) {
        self.is_required |= need == Need::Required;
        list(&mut self.rows, row);
    }

    fn end<I>(self, id: I) -> Ended<I> {
        let Running { is_required, rows } = self;
        Ended {
            id,
            is_required,
            rows,
        }
    }

    #[cold]
    fn never_started() -> Self {
        debug_assert!(false, "a result of no task");
        Running {
            is_required: true,
            rows: Rows::new(),
        }
    }
}

/// A tarball, or the checkout of a commit. Only a tarball stays `Failed`.
enum Fetch {
    /// With the rows that could not start it.
    Idle(Rows),
    /// Its `LockedCheckout` is with the clone.
    AwaitsClone,
    /// Its clone failed. A row starts it, and whoever joins gets no answer (#45623).
    Stranded(Rows),
    Running(Running),
    /// Nobody tries again until `forget_failure`.
    Failed {
        is_required: bool,
        turn: Turn,
    },
    Arrived(Box<Arrived>),
    /// A row that comes later binds to this package.
    Appended(PackageID),
    /// It has ended well, and there is no package that a row could bind to.
    Done,
}

struct Arrived {
    package: ArrivedPackage,
    ended: Ended<PackageFetchId>,
}

enum GitClone {
    Idle(Rows),
    Running(Running, Vec<LockedCheckout>),
    Cloned(Fd),
    /// It is reported.
    OfflineMiss,
}

enum GitCommit {
    Idle(Rows),
    Running(Running),
    Found(Vec<u8>),
}

const _: () = assert!(size_of::<Fetch>() == 32);

impl Default for Fetch {
    fn default() -> Self {
        Self::Idle(Rows::new())
    }
}

impl Default for GitClone {
    fn default() -> Self {
        Self::Idle(Rows::new())
    }
}

impl Default for GitCommit {
    fn default() -> Self {
        Self::Idle(Rows::new())
    }
}

/// The checkout of a package that the lockfile has. `dependency_id` may resolve to another one.
pub(crate) struct LockedCheckout {
    pub(crate) claim: Claim<CheckoutId>,
    pub(crate) dependency_id: DependencyID,
    pub(crate) package_id: PackageID,
}

/// Who wants a package of the lockfile in the cache.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Asker {
    /// `bun pm fetch`, `bun patch` and the runtime, which wait for every task.
    Cache,
    HoistedLinker,
    IsolatedLinker,
}

pub(crate) enum FailedFetch {
    Reported,
    Warned(Warned),
}

/// Only optional dependencies needed it when it failed.
pub(crate) struct Warned {
    id: PackageFetchId,
    turn: Turn,
}

#[must_use]
pub(crate) enum Step<T, I> {
    Done(T),
    Waits,
    Starts(Claim<I>),
}

#[must_use]
pub(crate) enum CloneFor {
    Cloned(Fd, LockedCheckout),
    Waits,
    Starts(Claim<CloneId>, LockedCheckout),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Remote {
    Clone(CloneId),
    Commit(CommitId),
    Package(PackageFetchId),
}

#[derive(Default)]
pub(crate) struct Fetches {
    packages: Table<PackageFetchId, Fetch>,
    clones: Table<CloneId, GitClone>,
    commits: Table<CommitId, GitCommit>,
    /// Every task that a row on a git, GitHub or tarball package has waited for.
    remote: Vec<Remote>,
    /// How many records are `Arrived`.
    arrived: usize,
}

impl Fetches {
    fn waited_for(&mut self, remote: Remote) {
        if !self.remote.contains(&remote) {
            self.remote.push(remote);
        }
    }

    pub(crate) fn has_failed(&self, id: TarballId) -> bool {
        matches!(self.packages.get(&id.into()), Some(Fetch::Failed { .. }))
    }

    pub(crate) fn appended_package(&self, id: PackageFetchId) -> Option<PackageID> {
        match *self.packages.get(&id)? {
            Fetch::Appended(package_id) => Some(package_id),
            Fetch::Idle(_)
            | Fetch::AwaitsClone
            | Fetch::Stranded(_)
            | Fetch::Running(_)
            | Fetch::Failed { .. }
            | Fetch::Arrived(_)
            | Fetch::Done => None,
        }
    }

    /// A dependency needs `id`. `row`: it has to be resolved to what the task brings.
    #[must_use]
    pub(crate) fn ask<I: Copy + Into<PackageFetchId>>(
        &mut self,
        id: I,
        row: Option<WaitingRow>,
        need: Need,
    ) -> Option<Claim<I>> {
        let rows = self.ask_package(id.into(), row, need)?;
        Some(Claim::new(id, rows, need == Need::Required))
    }

    fn ask_package(
        &mut self,
        id: PackageFetchId,
        row: Option<WaitingRow>,
        need: Need,
    ) -> Option<Rows> {
        if row.is_some() {
            self.waited_for(Remote::Package(id));
        }
        match entry(&mut self.packages, id) {
            Fetch::Idle(parked) | Fetch::Stranded(parked) => return claim(parked, row, need),
            Fetch::Running(running) => running.join(row, need),
            Fetch::Arrived(arrived) => list(&mut arrived.ended.rows, row),
            Fetch::Failed { is_required, .. } => *is_required |= need == Need::Required,
            // A row binds before it asks, and it asks for a checkout once the clone is there.
            Fetch::AwaitsClone | Fetch::Appended(_) | Fetch::Done => {}
        }
        None
    }

    /// A package of the lockfile is not in the cache.
    pub(crate) fn join<I: Copy + Into<PackageFetchId>>(
        &mut self,
        id: I,
        asker: Asker,
    ) -> Result<Option<Unweighed<I>>, FailedFetch> {
        let rows = self.join_package(id.into(), asker)?;
        Ok(rows.map(|rows| Unweighed { id, rows }))
    }

    fn join_package(
        &mut self,
        id: PackageFetchId,
        asker: Asker,
    ) -> Result<Option<Rows>, FailedFetch> {
        match entry(&mut self.packages, id) {
            Fetch::Idle(parked) => Ok(Some(take(parked))),
            Fetch::AwaitsClone | Fetch::Stranded(_) | Fetch::Running(_) | Fetch::Arrived(_) => {
                Ok(None)
            }
            &mut Fetch::Failed { is_required, turn } => Err(match is_required {
                true => FailedFetch::Reported,
                false => FailedFetch::Warned(Warned { id, turn }),
            }),
            // What it fetched is not the package that is missing.
            Fetch::Appended(_) | Fetch::Done => match asker {
                Asker::IsolatedLinker => Ok(Some(Rows::new())),
                // No answer comes, and they go on without the package (#45623).
                Asker::Cache | Asker::HoistedLinker => Ok(None),
            },
        }
    }

    pub(crate) fn raise(&mut self, Warned { id, turn }: Warned) {
        let is_required = true;
        (self.packages).insert(id, Fetch::Failed { is_required, turn });
    }

    pub(crate) fn park(&mut self, Claim { id, task }: Claim<impl Into<PackageFetchId>>) {
        self.packages.insert(id.into(), Fetch::Idle(task.rows));
    }

    pub(crate) fn strand(&mut self, Claim { id, task }: Claim<CheckoutId>) {
        self.packages.insert(id.into(), Fetch::Stranded(task.rows));
    }

    pub(crate) fn start<I: Copy + Into<PackageFetchId>>(
        &mut self,
        Claim { id, task }: Claim<I>,
    ) -> Started<I> {
        self.packages.insert(id.into(), Fetch::Running(task));
        Started(id)
    }

    pub(crate) fn finish<I: Copy + Into<PackageFetchId>>(
        &mut self,
        Started(id): Started<I>,
    ) -> Ended<I> {
        self.finish_package(id.into()).end(id)
    }

    fn finish_package(&mut self, id: PackageFetchId) -> Running {
        match take(entry(&mut self.packages, id)) {
            Fetch::Running(running) => running,
            Fetch::Idle(_)
            | Fetch::AwaitsClone
            | Fetch::Stranded(_)
            | Fetch::Failed { .. }
            | Fetch::Arrived(_)
            | Fetch::Appended(_)
            | Fetch::Done => Running::never_started(),
        }
    }

    #[must_use]
    pub(crate) fn fail(&mut self, ended: Ended<TarballId>, turn: Turn) -> Rows {
        let is_required = ended.is_required;
        (self.packages).insert(ended.id.into(), Fetch::Failed { is_required, turn });
        ended.rows
    }

    /// Of a required package. Returns false if it is reported already.
    #[must_use]
    pub(crate) fn offline_miss(&mut self, id: TarballId, turn: Turn) -> bool {
        let fetch = entry(&mut self.packages, id.into());
        match fetch {
            Fetch::Failed { .. } => return false,
            Fetch::Idle(_) | Fetch::Stranded(_) | Fetch::Appended(_) | Fetch::Done => {
                let is_required = true;
                *fetch = Fetch::Failed { is_required, turn };
            }
            // The task ends the record.
            Fetch::AwaitsClone | Fetch::Running(_) | Fetch::Arrived(_) => {}
        }
        true
    }

    pub(crate) fn done(&mut self, Ended { id, .. }: Ended<PackageFetchId>) {
        self.packages.insert(id, Fetch::Done);
    }

    pub(crate) fn arrive(&mut self, ended: Ended<PackageFetchId>, package: ArrivedPackage) {
        let id = ended.id;
        let arrived = Box::new(Arrived { package, ended });
        self.packages.insert(id, Fetch::Arrived(arrived));
        self.arrived += 1;
    }

    #[must_use]
    pub(crate) fn appended(&mut self, ended: Ended<PackageFetchId>, package_id: PackageID) -> Rows {
        self.packages.insert(ended.id, Fetch::Appended(package_id));
        ended.rows
    }

    /// A failure is kept for the iteration of the event loop in which it happened.
    pub(crate) fn forget_failure(&mut self, id: TarballId, now: Turn) {
        if let Some(fetch) = self.packages.get_mut(&id.into())
            && matches!(*fetch, Fetch::Failed { turn, .. } if turn != now)
        {
            *fetch = Fetch::default();
        }
    }

    /// Whoever asks next starts the task again, if it is over.
    pub(crate) fn forget(&mut self, id: TarballId) {
        let Some(fetch) = self.packages.get_mut(&id.into()) else {
            return;
        };
        match fetch {
            Fetch::Idle(_)
            | Fetch::Stranded(_)
            | Fetch::Failed { .. }
            | Fetch::Appended(_)
            | Fetch::Done => *fetch = Fetch::default(),
            Fetch::AwaitsClone | Fetch::Running(_) | Fetch::Arrived(_) => {}
        }
    }

    /// `moved` returns false for a package that is gone. Whoever asks next starts its task again.
    pub(crate) fn renumber_packages(&mut self, moved: impl Fn(&mut PackageID) -> bool) {
        for fetch in self.packages.values_mut() {
            if let Fetch::Appended(package_id) = fetch
                && !moved(package_id)
            {
                *fetch = Fetch::default();
            }
        }
    }

    pub(crate) fn is_cloned(&self, id: CloneId) -> bool {
        matches!(self.clones.get(&id), Some(GitClone::Cloned(_)))
    }

    pub(crate) fn clone_is_optional(&self, Started(id): Started<CloneId>) -> bool {
        matches!(self.clones.get(&id), Some(GitClone::Running(running, _)) if !running.is_required)
    }

    pub(crate) fn ask_clone(
        &mut self,
        id: CloneId,
        row: WaitingRow,
        need: Need,
    ) -> Step<Fd, CloneId> {
        let claimed = match entry(&mut self.clones, id) {
            &mut GitClone::Cloned(repo) => return Step::Done(repo),
            GitClone::Idle(parked) => claim(parked, Some(row), need),
            GitClone::Running(running, _) => {
                running.join(Some(row), need);
                None
            }
            GitClone::OfflineMiss => None,
        };
        self.waited_for(Remote::Clone(id));
        claimed.map_or(Step::Waits, |rows| {
            Step::Starts(Claim::new(id, rows, need == Need::Required))
        })
    }

    /// With `--offline`, the caller has found the repository in the cache.
    pub(crate) fn clone_for(&mut self, id: CloneId, checkout: LockedCheckout) -> CloneFor {
        let is_required = checkout.claim.is_required();
        let rows = match entry(&mut self.clones, id) {
            &mut GitClone::Cloned(repo) => return CloneFor::Cloned(repo, checkout),
            GitClone::Running(running, checkouts) => {
                running.is_required |= is_required;
                (self.packages).insert(checkout.claim.id.into(), Fetch::AwaitsClone);
                checkouts.push(checkout);
                return CloneFor::Waits;
            }
            GitClone::Idle(parked) => take(parked),
            GitClone::OfflineMiss => Rows::new(),
        };
        CloneFor::Starts(Claim::new(id, rows, is_required), checkout)
    }

    /// Returns true if the caller has to report it. An optional miss resets the report.
    #[must_use]
    pub(crate) fn offline_clone_miss(&mut self, id: CloneId, is_required: bool) -> bool {
        let clone = entry(&mut self.clones, id);
        match (&*clone, is_required) {
            (GitClone::Idle(_), true) => *clone = GitClone::OfflineMiss,
            (GitClone::OfflineMiss, false) => *clone = GitClone::default(),
            (GitClone::OfflineMiss, true) => return false,
            (GitClone::Idle(_), false) | (GitClone::Running(..) | GitClone::Cloned(_), _) => {}
        }
        is_required
    }

    pub(crate) fn park_clone(&mut self, Claim { id, task }: Claim<CloneId>) {
        self.clones.insert(id, GitClone::Idle(task.rows));
    }

    pub(crate) fn start_clone(
        &mut self,
        Claim { id, task }: Claim<CloneId>,
        checkout: Option<LockedCheckout>,
    ) -> Started<CloneId> {
        if let Some(checkout) = &checkout {
            (self.packages).insert(checkout.claim.id.into(), Fetch::AwaitsClone);
        }
        let checkouts = Vec::from_iter(checkout);
        (self.clones).insert(id, GitClone::Running(task, checkouts));
        Started(id)
    }

    pub(crate) fn finish_clone(
        &mut self,
        Started(id): Started<CloneId>,
    ) -> (Ended<CloneId>, Vec<LockedCheckout>) {
        let (running, checkouts) = match take(entry(&mut self.clones, id)) {
            GitClone::Running(running, checkouts) => (running, checkouts),
            GitClone::Idle(_) | GitClone::Cloned(_) | GitClone::OfflineMiss => {
                (Running::never_started(), Vec::new())
            }
        };
        (running.end(id), checkouts)
    }

    #[must_use]
    pub(crate) fn cloned(&mut self, ended: Ended<CloneId>, repo: Fd) -> Rows {
        self.clones.insert(ended.id, GitClone::Cloned(repo));
        ended.rows
    }

    pub(crate) fn commit_is_optional(&self, Started(id): Started<CommitId>) -> bool {
        matches!(self.commits.get(&id), Some(GitCommit::Running(running)) if !running.is_required)
    }

    pub(crate) fn ask_commit(
        &mut self,
        id: CommitId,
        row: WaitingRow,
        need: Need,
    ) -> Step<Vec<u8>, CommitId> {
        let claimed = match entry(&mut self.commits, id) {
            GitCommit::Found(sha) => return Step::Done(sha.clone()),
            GitCommit::Idle(parked) => claim(parked, Some(row), need),
            GitCommit::Running(running) => {
                running.join(Some(row), need);
                None
            }
        };
        self.waited_for(Remote::Commit(id));
        claimed.map_or(Step::Waits, |rows| {
            Step::Starts(Claim::new(id, rows, need == Need::Required))
        })
    }

    pub(crate) fn start_commit(
        &mut self,
        Claim { id, task }: Claim<CommitId>,
    ) -> Started<CommitId> {
        self.commits.insert(id, GitCommit::Running(task));
        Started(id)
    }

    pub(crate) fn finish_commit(&mut self, Started(id): Started<CommitId>) -> Ended<CommitId> {
        match take(entry(&mut self.commits, id)) {
            GitCommit::Running(running) => running,
            GitCommit::Idle(_) | GitCommit::Found(_) => Running::never_started(),
        }
        .end(id)
    }

    #[must_use]
    pub(crate) fn found(&mut self, ended: Ended<CommitId>, sha: Vec<u8>) -> Rows {
        self.commits.insert(ended.id, GitCommit::Found(sha));
        ended.rows
    }

    pub(crate) fn forget_rows(&mut self) {
        for fetch in self.packages.values_mut() {
            match fetch {
                Fetch::Idle(rows) | Fetch::Running(Running { rows, .. }) => rows.clear(),
                Fetch::Arrived(arrived) => arrived.ended.rows.clear(),
                Fetch::Stranded(_) => *fetch = Fetch::default(),
                Fetch::AwaitsClone | Fetch::Failed { .. } | Fetch::Appended(_) | Fetch::Done => {}
            }
        }
        for clone in self.clones.values_mut() {
            match clone {
                GitClone::Idle(rows) | GitClone::Running(Running { rows, .. }, _) => rows.clear(),
                GitClone::Cloned(_) | GitClone::OfflineMiss => {}
            }
        }
        for commit in self.commits.values_mut() {
            match commit {
                GitCommit::Idle(rows) | GitCommit::Running(Running { rows, .. }) => rows.clear(),
                GitCommit::Found(_) => {}
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
    pub(crate) fn lowest_rows(
        &self,
        turn: RemoteTurn,
    ) -> impl Iterator<Item = (DependencyID, Remote)> {
        let lowest = |rows: &Rows| rows.iter().map(|row| row.id).min();
        self.remote.iter().filter_map(move |&remote| {
            let running = match remote {
                Remote::Clone(id) => match self.clones.get(&id)? {
                    GitClone::Running(running, _) => running,
                    GitClone::Idle(_) | GitClone::Cloned(_) | GitClone::OfflineMiss => return None,
                },
                Remote::Commit(id) => match self.commits.get(&id)? {
                    GitCommit::Running(running) => running,
                    GitCommit::Idle(_) | GitCommit::Found(_) => return None,
                },
                Remote::Package(id) => match self.packages.get(&id)? {
                    Fetch::Running(running) => running,
                    Fetch::Arrived(arrived) => return Some((lowest(&arrived.ended.rows)?, remote)),
                    Fetch::Idle(_)
                    | Fetch::AwaitsClone
                    | Fetch::Stranded(_)
                    | Fetch::Failed { .. }
                    | Fetch::Appended(_)
                    | Fetch::Done => return None,
                },
            };
            match turn {
                RemoteTurn::InOrder => Some((lowest(&running.rows)?, remote)),
                RemoteTurn::NothingElseArrives => None,
            }
        })
    }

    /// The package whose turn it is, if it has arrived.
    pub(crate) fn take_next(
        &mut self,
        turn: RemoteTurn,
    ) -> Option<(DependencyID, Ended<PackageFetchId>, ArrivedPackage)> {
        if !self.has_arrived() {
            return None;
        }
        let (row, id) = match self.lowest_rows(turn).min_by_key(|&(row, _)| row)? {
            (row, Remote::Package(id)) => (row, id),
            (_, Remote::Clone(_) | Remote::Commit(_)) => return None,
        };
        let fetch = entry(&mut self.packages, id);
        match take(fetch) {
            Fetch::Arrived(arrived) => {
                self.arrived -= 1;
                Some((row, arrived.ended, arrived.package))
            }
            not_yet @ (Fetch::Idle(_)
            | Fetch::AwaitsClone
            | Fetch::Stranded(_)
            | Fetch::Running(_)
            | Fetch::Failed { .. }
            | Fetch::Appended(_)
            | Fetch::Done) => {
                *fetch = not_yet;
                None
            }
        }
    }
}

/// What a linker goes on with when a package is in the cache.
pub(crate) struct Waiters<W>(Table<PackageFetchId, Vec<W>>);

impl<W> Default for Waiters<W> {
    fn default() -> Self {
        Self(Table::default())
    }
}

impl<W> Waiters<W> {
    pub(crate) fn push(&mut self, id: PackageFetchId, waiter: W) {
        entry(&mut self.0, id).push(waiter);
    }

    #[must_use]
    pub(crate) fn take(&mut self, id: PackageFetchId) -> Vec<W> {
        self.0.get_mut(&id).map_or(Vec::new(), take)
    }
}
