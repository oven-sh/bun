//! The requests of a session, in the order in which the server answers them, and the statements they run.

use core::cell::Cell;
use std::collections::VecDeque;

use bun_ptr::{JsCell, RefPtr};

use super::AnyPostgresError;

pub const MAX_PIPELINE_SIZE: usize = u16::MAX as usize;

enum State<E> {
    /// `stored`: the server can have a statement of that name.
    Unparsed {
        stored: bool,
    },
    Parsing {
        stored: bool,
    },
    Prepared,
    Failed(E),
}

/// `E`: what it failed with. `C`: what the host makes of its columns.
#[derive(bun_ptr::CellRefCounted)]
pub struct Statement<E, C> {
    ref_count: Cell<u32>,
    /// Empty: the unnamed statement, which no other request runs.
    pub name: Box<[u8]>,
    /// The type Parse declares for each parameter. 0 leaves it to the server.
    pub declared: Box<[u32]>,
    described: JsCell<Box<[u32]>>,
    state: JsCell<State<E>>,
    pub columns: C,
}

impl<E, C> Statement<E, C> {
    /// `id`: `None` is the unnamed statement.
    pub fn new(id: Option<u64>, declared: Box<[u32]>, columns: C) -> RefPtr<Self> {
        let name = id.map(|id| format!("P{id}").into_bytes().into());
        RefPtr::new(Statement {
            ref_count: Cell::new(1),
            name: name.unwrap_or_default(),
            declared,
            described: JsCell::default(),
            state: JsCell::new(State::Unparsed { stored: false }),
            columns,
        })
    }

    pub fn is_named(&self) -> bool {
        !self.name.is_empty()
    }

    pub fn is_unparsed(&self) -> bool {
        matches!(self.state.get(), State::Unparsed { .. })
    }

    pub fn failure(&self) -> Option<&E> {
        match self.state.get() {
            State::Failed(error) => Some(error),
            _ => None,
        }
    }

    /// The requests that wait for the statement get the same answer.
    pub fn fail(&self, error: E) {
        self.state.set(State::Failed(error));
    }

    /// Each type is the one Parse declared, or the one the server chose where Parse declared none.
    pub fn accepts(&self, types: &[Option<u32>]) -> bool {
        types.len() == self.declared.len()
            && (types.iter().zip(&self.declared).enumerate()).all(|(i, (wanted, &declared))| {
                wanted.is_none_or(|oid| {
                    oid == declared || (declared == 0 && self.described().get(i) == Some(&oid))
                })
            })
    }

    /// A read replaces them: not to be held across user code.
    pub fn described(&self) -> &[u32] {
        self.described.get()
    }

    pub fn take_described(&self) -> Box<[u32]> {
        self.described.take()
    }

    /// The server's types once it has described the statement, until then the declared ones.
    pub fn parameter_types(&self) -> &[u32] {
        match self.described() {
            [] => &self.declared,
            described => described,
        }
    }
}

#[derive(Clone, Copy)]
pub enum Protocol {
    Simple,
    Extended {
        /// Parse and Describe go out first, and Bind waits for the server's parameter types.
        describe_first: bool,
    },
}

/// `describing`: the batch has a Describe that is not answered yet.
#[derive(Clone, Copy)]
enum Stage {
    Queued,
    /// Its Bind goes out after the next ReadyForQuery.
    Preparing {
        describing: bool,
    },
    /// Nothing of the statement has run.
    Binding {
        describing: bool,
    },
    Running,
    /// It has a result, and the next ReadyForQuery ends it.
    Answered,
}

#[derive(Clone, Copy)]
enum Reply {
    Deliver,
    /// A CancelRequest is on its way: the server's answer settles it.
    Cancelling,
    /// `cancel()` was called and no CancelRequest could be sent for it so far.
    OwesCancel {
        rejected: bool,
    },
    /// The host keeps the server's error: user code hears of it as it hears of a result.
    FailAtReady,
    /// User code has seen it rejected.
    Skip,
}

/// Names a request of a [`Pipeline`]. Only `push` makes one, each greater than the last, so the queue is sorted.
#[derive(Clone, Copy, PartialEq, Eq)]
#[must_use]
pub struct Turn(u64);

pub struct Entry<R, E, C> {
    turn: Turn,
    pub request: R,
    pub statement: RefPtr<Statement<E, C>>,
    protocol: Protocol,
    stage: Stage,
    reply: Reply,
    /// The server refused its Bind because the named statement was lost or stale.
    retried: bool,
}

impl<R, E, C> Entry<R, E, C> {
    pub fn turn(&self) -> Turn {
        self.turn
    }

    pub fn keeps_error(&self) -> bool {
        matches!(self.reply, Reply::FailAtReady)
    }

    pub fn is_cancelling(&self) -> bool {
        matches!(self.reply, Reply::Cancelling)
    }

    pub fn is_simple(&self) -> bool {
        matches!(self.protocol, Protocol::Simple)
    }

    /// Its response is skipped until ReadyForQuery.
    pub fn is_rejected(&self) -> bool {
        use Reply::*;
        matches!(
            self.reply,
            OwesCancel { rejected: true } | FailAtReady | Skip
        )
    }

    /// Lets go of the statement, which the host's cache evicts only when nothing holds it.
    pub fn into_request(self) -> R {
        self.request
    }

    fn owes_cancel(&self) -> bool {
        matches!(self.reply, Reply::OwesCancel { .. })
    }
}

#[derive(Clone, Copy)]
pub enum Step {
    Query,
    /// `close`: the name is taken. `bind`: in the same batch.
    Parse {
        close: bool,
        bind: bool,
    },
    Bind,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    Canceled,
    StaleStatement,
    Other,
}

pub enum OnError {
    /// The head keeps its place: nothing is written until its ReadyForQuery, then it.
    Retry {
        cancelled: bool,
    },
    Fail {
        keep_error: bool,
        cached: Cached,
    },
}

/// What becomes of a statement in the host's cache.
#[derive(Debug, PartialEq, Eq)]
pub enum Cached {
    Keep,
    Forget,
    /// The server has it.
    Close,
}

pub enum OnCancel<T> {
    Unqueued(T),
    /// `may_run`: its Bind or its Query is written.
    InFlight {
        may_run: bool,
    },
}

pub struct Pipeline<R, E, C> {
    queue: VecDeque<Entry<R, E, C>>,
    pushed: u64,
    /// How many have their Bind or their Query written: the front of `queue`.
    written: usize,
    pipelining: bool,
    /// From a Parse to its answer. After an error, to the ReadyForQuery.
    parsing: bool,
    /// A CancelRequest can still arrive, so nothing it could stop is written.
    cancel_in_flight: bool,
    /// Of the last ReadyForQuery.
    transaction_status: u8,
}

impl<R, E, C> Pipeline<R, E, C> {
    pub fn new(pipelining: bool) -> Self {
        Pipeline {
            queue: VecDeque::new(),
            pushed: 0,
            written: 0,
            pipelining,
            parsing: false,
            cancel_in_flight: false,
            transaction_status: b'I',
        }
    }

    pub fn push(
        &mut self,
        request: R,
        statement: RefPtr<Statement<E, C>>,
        protocol: Protocol,
    ) -> Turn {
        if let Protocol::Simple = protocol {
            // The Query message stands for its Parse.
            statement.state.set(State::Parsing { stored: false });
        }
        let turn = Turn(self.pushed);
        self.pushed += 1;
        self.queue.push_back(Entry {
            turn,
            request,
            statement,
            protocol,
            stage: Stage::Queued,
            reply: Reply::Deliver,
            retried: false,
        });
        turn
    }

    pub fn pop(&mut self) -> Option<Entry<R, E, C>> {
        self.written = self.written.saturating_sub(1);
        self.queue.pop_front()
    }

    pub fn head(&self) -> Result<&Entry<R, E, C>, AnyPostgresError> {
        self.queue.front().ok_or(AnyPostgresError::ExpectedRequest)
    }

    fn head_mut(&mut self) -> Result<&mut Entry<R, E, C>, AnyPostgresError> {
        let head = self.queue.front_mut();
        head.ok_or(AnyPostgresError::ExpectedRequest)
    }

    pub fn is_empty(&self) -> bool {
        self.queue.is_empty()
    }

    pub fn is_busy(&self) -> bool {
        !self.is_empty() || self.cancel_in_flight
    }

    pub fn has_written(&self) -> bool {
        self.written != 0
    }

    /// Also while a request that user code has seen rejected can still change it.
    pub fn in_transaction(&self) -> bool {
        self.transaction_status != b'I' || self.head().is_ok_and(Entry::is_rejected)
    }

    /// `None`: it has left the queue.
    fn find(&mut self, turn: Turn) -> Option<(usize, &mut Entry<R, E, C>)> {
        let position = self.queue.partition_point(|it| it.turn.0 < turn.0);
        let entry = self.queue.get_mut(position).filter(|it| it.turn == turn)?;
        Some((position, entry))
    }

    /// `None`: it has left the queue, or user code has seen it rejected.
    pub fn live(&mut self, turn: Turn) -> Option<&R> {
        let (_, entry) = self.find(turn)?;
        (!entry.is_rejected()).then_some(&entry.request)
    }

    /// What the backend is at work on.
    pub fn running(&self, turn: Turn) -> Option<&Entry<R, E, C>> {
        let head = self.queue.front();
        head.filter(|head| head.turn == turn && !matches!(head.stage, Stage::Queued))
    }

    /// `None` too while a CancelRequest that is owed or on its way could stop it by mistake.
    fn unwritten(&self) -> Option<&Entry<R, E, C>> {
        let last = self.written.checked_sub(1);
        let last = last.and_then(|last| self.queue.get(last));
        if self.cancel_in_flight || last.is_some_and(Entry::owes_cancel) {
            return None;
        }
        let next = self.queue.get(self.written)?;
        matches!(next.stage, Stage::Queued).then_some(next)
    }

    /// `None`: the first unwritten request has to wait, and nothing is written past it. No step: it is never written.
    pub fn next(&self, buffered: usize) -> Option<(&Entry<R, E, C>, Option<Step>)> {
        let next = self.unwritten()?;
        let idle = self.written == 0;
        let step = match (next.protocol, next.statement.state.get()) {
            _ if next.is_rejected() => return Some((next, None)),
            (_, State::Failed(_)) => return Some((next, None)),
            (Protocol::Simple, _) => idle.then_some(Step::Query)?,
            (_, State::Parsing { .. }) => return None,
            (_, State::Prepared) => (idle || self.has_room(buffered)).then_some(Step::Bind)?,
            (Protocol::Extended { describe_first }, &State::Unparsed { stored }) => idle
                .then_some(Step::Parse {
                    close: stored,
                    bind: !describe_first,
                })?,
        };
        Some((next, Some(step)))
    }

    fn has_room(&self, buffered: usize) -> bool {
        self.pipelining
            && !self.parsing
            && buffered < MAX_PIPELINE_SIZE
            && !self.head().is_ok_and(Entry::is_simple)
    }

    /// `false`: user code ran meanwhile and it is not its turn any more. What was written has to go.
    pub fn wrote(&mut self, turn: Turn, step: Step) -> bool {
        let its_turn = self.unwritten().is_some_and(|next| next.turn == turn);
        let Some(entry) = self.queue.get_mut(self.written).filter(|_| its_turn) else {
            return false;
        };
        if let Step::Parse { close: stored, .. } = step {
            entry.statement.state.set(State::Parsing { stored });
            self.parsing = true;
        }
        entry.stage = match step {
            Step::Query => Stage::Running,
            Step::Bind => Stage::Binding { describing: false },
            Step::Parse { bind: true, .. } => Stage::Binding { describing: true },
            Step::Parse { bind: false, .. } => Stage::Preparing { describing: true },
        };
        self.written += usize::from(!matches!(entry.stage, Stage::Preparing { .. }));
        true
    }

    pub fn unqueue(&mut self, turn: Turn) -> Option<Entry<R, E, C>> {
        let written = self.written;
        let (position, _) = self.find(turn).filter(|(it, _)| *it >= written)?;
        self.queue.remove(position)
    }

    /// `Some`: the host rejects it now. It keeps its place until its ReadyForQuery.
    pub fn reject(&mut self, turn: Turn) -> Option<&R> {
        let (_, entry) = self.find(turn)?;
        entry.reply = match entry.reply {
            Reply::Deliver | Reply::Cancelling => Reply::Skip,
            Reply::OwesCancel { rejected: false } => Reply::OwesCancel { rejected: true },
            Reply::OwesCancel { rejected: true } | Reply::FailAtReady | Reply::Skip => return None,
        };
        Some(&entry.request)
    }

    /// The request that a result belongs to. `None`: nobody waits for it.
    pub fn executed(&self) -> Result<Option<&Entry<R, E, C>>, AnyPostgresError> {
        let head = self.head()?;
        if self.written == 0 {
            return Err(AnyPostgresError::UnexpectedMessage);
        }
        Ok((!head.is_rejected()).then_some(head))
    }

    pub fn on_result(&mut self) -> Result<(), AnyPostgresError> {
        self.head_mut()?.stage = Stage::Answered;
        Ok(())
    }

    pub fn on_parse_complete(&mut self) -> Result<(), AnyPostgresError> {
        let statement = &self.head()?.statement;
        if let State::Parsing { .. } = statement.state.get() {
            if !statement.declared.is_empty() {
                statement.state.set(State::Parsing { stored: true });
            } else {
                statement.state.set(State::Prepared);
                self.parsing = false;
            }
        }
        Ok(())
    }

    pub fn on_parameter_description(&mut self, types: Box<[u32]>) -> Result<(), AnyPostgresError> {
        let statement = &self.head()?.statement;
        statement.described.set(types);
        if let State::Parsing { .. } = statement.state.get() {
            statement.state.set(State::Prepared);
            self.parsing = false;
        }
        Ok(())
    }

    pub fn on_row_description(&mut self) -> Result<(), AnyPostgresError> {
        let stage = &mut self.head_mut()?.stage;
        if let Stage::Preparing { describing } | Stage::Binding { describing } = stage {
            *describing = false;
        }
        Ok(())
    }

    /// And NoData.
    pub fn on_bind_complete(&mut self) -> Result<(), AnyPostgresError> {
        let head = self.head_mut()?;
        head.stage = match head.stage {
            Stage::Preparing { .. } => Stage::Preparing { describing: false },
            Stage::Binding { .. } => Stage::Running,
            stage => stage,
        };
        Ok(())
    }

    /// The request that it ends.
    pub fn on_ready_for_query(&mut self, transaction_status: u8) -> Option<Entry<R, E, C>> {
        self.transaction_status = transaction_status;
        self.parsing = false;
        let head = self.queue.front_mut()?;
        match head.stage {
            _ if head.is_rejected() => self.pop(),
            Stage::Answered => self.pop(),
            Stage::Preparing { .. } => {
                head.stage = Stage::Queued;
                None
            }
            // A pooler can send one that answers nothing.
            Stage::Queued | Stage::Binding { .. } | Stage::Running => None,
        }
    }

    /// With the request that it belongs to. `replace`: gives the statement of a retry.
    pub fn on_error(
        &mut self,
        kind: ErrorKind,
        error: E,
        replace: impl FnOnce(&Entry<R, E, C>) -> RefPtr<Statement<E, C>>,
    ) -> Option<(&Entry<R, E, C>, OnError)> {
        let head = self.queue.front_mut()?;
        let statement = &*head.statement;
        let lost = |stored| {
            if kind == ErrorKind::Canceled {
                // It says nothing about the statement: the next request parses it again.
                statement.state.set(State::Unparsed { stored });
                return Cached::Keep;
            }
            statement.fail(error);
            match (statement.is_named(), stored) {
                (false, _) => Cached::Keep,
                (true, false) => Cached::Forget,
                (true, true) => Cached::Close,
            }
        };
        let cached = match (statement.state.get(), head.stage) {
            (&State::Parsing { stored }, _) => lost(stored),
            // After BindComplete the same code comes from the query itself.
            (State::Prepared, Stage::Binding { .. })
                if kind == ErrorKind::StaleStatement && statement.is_named() =>
            {
                // A retry would run after what is written behind it, or get 25P02 in a transaction block.
                if self.written == 1 && self.transaction_status == b'I' && !head.retried {
                    head.statement = replace(head);
                    head.stage = Stage::Preparing { describing: false };
                    head.retried = true;
                    self.written = 0;
                    let cancelled = head.is_cancelling();
                    return Some((head, OnError::Retry { cancelled }));
                }
                Cached::Close
            }
            (
                State::Prepared,
                Stage::Preparing { describing: true } | Stage::Binding { describing: true },
            ) => lost(true),
            _ => Cached::Keep,
        };
        let keep_error = !head.is_rejected();
        if keep_error {
            head.reply = Reply::FailAtReady;
        }
        Some((head, OnError::Fail { keep_error, cached }))
    }

    pub fn cancel(&mut self, turn: Turn) -> Option<OnCancel<Entry<R, E, C>>> {
        let (position, entry) = self.find(turn)?;
        let rejected = match entry.reply {
            Reply::Deliver | Reply::Cancelling => false,
            Reply::OwesCancel { rejected } => rejected,
            Reply::FailAtReady => return None,
            // The host rejects a COPY TO STDOUT first.
            Reply::Skip => true,
        };
        if let Stage::Queued = entry.stage {
            return self.queue.remove(position).map(OnCancel::Unqueued);
        }
        entry.reply = Reply::OwesCancel { rejected };
        let may_run = position < self.written;
        Some(OnCancel::InFlight { may_run })
    }

    /// A CancelRequest stops whatever the backend is at work on: none goes out while somebody waits for a written request.
    #[inline]
    pub fn to_stop(&self) -> Option<Turn> {
        let head = self.queue.front()?;
        let mut written = self.queue.iter().take(self.written);
        (head.owes_cancel() && !self.cancel_in_flight && written.all(Entry::owes_cancel))
            .then_some(head.turn)
    }

    pub fn on_cancel_dialed(&mut self) {
        self.cancel_in_flight = true;
        if let Some(head) = self.queue.front_mut() {
            head.reply = match head.is_rejected() {
                true => Reply::Skip,
                false => Reply::Cancelling,
            };
        }
    }

    pub fn on_cancel_ended(&mut self) {
        self.cancel_in_flight = false;
    }
}
