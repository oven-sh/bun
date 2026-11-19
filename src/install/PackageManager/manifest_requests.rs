//! One record for each manifest that is requested: where it stands, and which rows need it.

use core::mem::take;

use super::fetch_table::{Rows, Table, Turn, WaitingRow, entry};
use super::{ManifestFailure, Wanted};
use crate::package_manager_task::ManifestId;

/// Who a manifest is requested for. A later one takes over from an earlier one.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Reader {
    /// `populate_manifest_cache`, whose caller finds a failure in the log as a warning.
    OptionalBackfill,
    RequiredBackfill,
    /// A failure is kept for the rows that run into it.
    Rows,
}

pub(crate) enum ManifestState {
    /// The rows ran into a failure that the runtime has forgotten. The next request is theirs too.
    Idle(Rows),
    InFlight(InFlight),
    Arrived(Origin),
    Failed(FailedManifest),
    /// An `--offline` miss that is reported, or a 404 for a workspace's name that nobody reports.
    Missing,
}

#[derive(Clone, Copy)]
pub(crate) enum Origin {
    /// After a 304, a version that the copy lacks may have been published since.
    Cache,
    Registry,
}

pub(crate) struct InFlight {
    reader: Reader,
    follow: Option<Wanted>,
    /// The queue tries its rows again, so it does not list them.
    rows: Rows,
}

pub(crate) struct FailedManifest {
    failure: ManifestFailure,
    needed_by: Rows,
}

const _: () = assert!(size_of::<ManifestState>() <= 80);

impl Default for ManifestState {
    fn default() -> Self {
        Self::Idle(Rows::new())
    }
}

impl ManifestState {
    pub(crate) fn is_missing(&self) -> bool {
        match self {
            Self::Failed(failed) => failed.failure.missing_until.is_some(),
            Self::Missing => true,
            Self::Idle(_) | Self::InFlight(_) | Self::Arrived(_) => false,
        }
    }

    fn take_rows(&mut self) -> Rows {
        match self {
            Self::Idle(rows) => take(rows),
            Self::InFlight(request) => take(&mut request.rows),
            Self::Failed(failed) => take(&mut failed.needed_by),
            Self::Arrived(_) | Self::Missing => Rows::new(),
        }
    }
}

impl InFlight {
    pub(crate) fn join(&mut self, reader: Reader, import: Option<WaitingRow>) {
        self.reader = reader.max(self.reader);
        self.rows.extend(import);
    }

    pub(crate) fn follow(&mut self, wanted: Wanted) {
        self.follow = Some(wanted);
    }
}

impl FailedManifest {
    pub(crate) fn failure(&self) -> &ManifestFailure {
        &self.failure
    }

    pub(crate) fn needed_by(&self) -> &[WaitingRow] {
        &self.needed_by
    }

    /// Lists `row`, for `log_held` and for a later request of the runtime.
    pub(crate) fn run_into(&mut self, row: WaitingRow) -> &mut ManifestFailure {
        self.needed_by.push(row);
        &mut self.failure
    }
}

/// What a row finds that has no manifest to read.
pub(crate) enum Lookup<'a> {
    NotRequested(Unrequested),
    InFlight(&'a mut InFlight),
    Failed(&'a mut FailedManifest),
    NothingWillCome,
}

/// What a row finds whose version is not in the manifest that it has read.
pub(crate) enum Refetch {
    /// The registry has sent the document in this run.
    Pointless,
    Asked,
    Due(Unrequested),
}

/// No request for `id` is in flight. Dropping it leaves the record as it is.
#[must_use]
pub(crate) struct Unrequested {
    id: ManifestId,
}

impl Unrequested {
    pub(crate) fn id(&self) -> ManifestId {
        self.id
    }
}

/// A request whose response is in. Its holder says what becomes of the record.
#[must_use]
pub(crate) struct Answered {
    id: ManifestId,
    request: InFlight,
}

impl Answered {
    pub(crate) fn reader(&self) -> Reader {
        self.request.reader
    }
}

#[derive(Default)]
pub(crate) struct ManifestRequests {
    requests: Table<ManifestId, ManifestState>,
    /// For the runtime: the event loop iteration in which a lookup found nothing.
    missed_in: Table<ManifestId, Turn>,
}

impl ManifestRequests {
    pub(crate) fn state(&self, id: ManifestId) -> &ManifestState {
        (self.requests.get(&id)).unwrap_or(const { &ManifestState::Idle(Rows::new()) })
    }

    pub(crate) fn look_up(&mut self, id: ManifestId) -> Lookup<'_> {
        match self.requests.get_mut(&id) {
            None | Some(ManifestState::Idle(_)) => Lookup::NotRequested(Unrequested { id }),
            Some(ManifestState::InFlight(request)) => Lookup::InFlight(request),
            Some(ManifestState::Failed(failed)) => Lookup::Failed(failed),
            Some(ManifestState::Arrived(_) | ManifestState::Missing) => Lookup::NothingWillCome,
        }
    }

    pub(crate) fn refetch(&self, id: ManifestId) -> Refetch {
        match self.state(id) {
            ManifestState::Arrived(Origin::Registry) => Refetch::Pointless,
            // With a fresh manifest in memory, that is the request of an earlier `Due`.
            ManifestState::InFlight(_) | ManifestState::Failed(_) => Refetch::Asked,
            ManifestState::Idle(_)
            | ManifestState::Arrived(Origin::Cache)
            | ManifestState::Missing => Refetch::Due(Unrequested { id }),
        }
    }

    #[must_use]
    pub(crate) fn take_rows(&mut self, id: ManifestId) -> Rows {
        (self.requests.get_mut(&id)).map_or(Rows::new(), ManifestState::take_rows)
    }

    pub(crate) fn sent(
        &mut self,
        Unrequested { id }: Unrequested,
        reader: Reader,
        import: Option<WaitingRow>,
    ) {
        let state = entry(&mut self.requests, id);
        let mut rows = state.take_rows();
        rows.extend(import);
        *state = ManifestState::InFlight(InFlight {
            reader,
            follow: None,
            rows,
        });
    }

    /// The caller has logged that it cannot build the URL.
    pub(crate) fn not_sent(&mut self, Unrequested { id }: Unrequested) {
        let state = entry(&mut self.requests, id);
        *state = ManifestState::Failed(FailedManifest {
            failure: ManifestFailure::already_reported(),
            needed_by: state.take_rows(),
        });
    }

    pub(crate) fn finish(&mut self, id: ManifestId) -> Answered {
        let request = match take(entry(&mut self.requests, id)) {
            ManifestState::InFlight(request) => request,
            mut unrequested @ (ManifestState::Idle(_)
            | ManifestState::Arrived(_)
            | ManifestState::Failed(_)
            | ManifestState::Missing) => {
                debug_assert!(false, "a response to no request");
                InFlight {
                    reader: Reader::RequiredBackfill,
                    follow: None,
                    rows: unrequested.take_rows(),
                }
            }
        };
        Answered { id, request }
    }

    pub(crate) fn sent_again(&mut self, Answered { id, request }: Answered) {
        self.requests.insert(id, ManifestState::InFlight(request));
    }

    #[must_use]
    pub(crate) fn arrived(
        &mut self,
        Answered { id, request }: Answered,
        origin: Origin,
    ) -> (Option<Wanted>, Rows) {
        (self.requests).insert(id, ManifestState::Arrived(origin));
        (request.follow, request.rows)
    }

    #[must_use]
    pub(crate) fn failed(
        &mut self,
        Answered { id, request }: Answered,
        failure: ManifestFailure,
    ) -> Rows {
        let needed_by = Rows::new();
        let failed = FailedManifest { failure, needed_by };
        self.requests.insert(id, ManifestState::Failed(failed));
        request.rows
    }

    pub(crate) fn unreported_404(&mut self, Answered { id, .. }: Answered, turn: Turn) {
        self.missing(id, turn);
    }

    pub(crate) fn offline_miss(&mut self, Unrequested { id }: Unrequested, turn: Turn) {
        self.missing(id, turn);
    }

    fn missing(&mut self, id: ManifestId, turn: Turn) {
        self.requests.insert(id, ManifestState::Missing);
        self.missed_in.insert(id, turn);
    }

    /// Without a request there is nothing to forget.
    pub(crate) fn missed(&mut self, id: ManifestId, turn: Turn) {
        if !matches!(self.state(id), ManifestState::Idle(_)) {
            self.missed_in.insert(id, turn);
        }
    }

    /// A miss is remembered for the rest of its turn, a 404 for as long as a manifest is cached.
    pub(crate) fn forget_miss(&mut self, id: ManifestId, turn: Turn) {
        if (self.missed_in.get(&id)).is_none_or(|&missed_in| missed_in == turn) {
            return;
        }
        let state = entry(&mut self.requests, id);
        let is_kept = match state {
            ManifestState::InFlight(_) => true,
            ManifestState::Failed(failed) => (failed.failure.missing_until)
                .is_some_and(|until| i64::from(until) > bun_core::time::timestamp()),
            ManifestState::Idle(_) | ManifestState::Arrived(_) | ManifestState::Missing => false,
        };
        if !is_kept {
            *state = ManifestState::Idle(state.take_rows());
            self.missed_in.remove(&id);
        }
    }

    pub(crate) fn forget_rows(&mut self) {
        (self.requests.values_mut()).for_each(|state| drop(state.take_rows()));
    }

    /// Nothing may be in flight.
    pub(crate) fn clear(&mut self) {
        self.requests.clear();
        self.missed_in.clear();
    }
}
