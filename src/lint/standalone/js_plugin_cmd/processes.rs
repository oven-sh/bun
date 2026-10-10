//! Realms for JavaScript plugins that are processes of their own, talked to through pipes. Bun has a VM on each thread
//! instead: this is for the harness, which has no JavaScript in it.
//!
//! A message is a header of two numbers, the length of what follows and what it is, and then that many bytes. To a process:
//! the program ([`PROGRAM`]), a call (its kind), the answer to what it asked for (0). From a process: what it asks for (its
//! kind), what a call returns ([`RESULT`]).

use bun_lint::js_plugin::{Demand, Engine, HEAVY, Serve, Vm};
use bun_threading::{Condition, Guarded};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::ThreadId;

const PROGRAM: u32 = 100;
const RESULT: u32 = 100;

/// What a process is started with: `bun -e BOOTSTRAP`. It reads what [`Channel::send`] sends from the file descriptor 3, and
/// what it writes to 4 is for [`Channel::receive`]. Both are pipes that block.
pub(crate) const BOOTSTRAP: &str = include_str!("bootstrap.js");

/// Both ends of the pipes to a process. Dropping it closes them, at which the process ends.
pub(crate) trait Channel: Send {
    /// Writes all of `bytes`.
    fn send(&mut self, bytes: &[u8]) -> Result<(), Vec<u8>>;
    /// Reads until `into` is full.
    fn receive(&mut self, into: &mut [u8]) -> Result<(), Vec<u8>>;
}

/// Starts `bun` with [`BOOTSTRAP`].
pub(crate) type Spawn<'e> = dyn Fn() -> Result<Box<dyn Channel>, Vec<u8>> + Sync + 'e;

struct Process {
    channel: Box<dyn Channel>,
    /// To write messages in.
    buffer: Vec<u8>,
    has_failed: bool,
    /// The one that all [`HEAVY`] files go to: the first.
    is_for_heavy: bool,
}

impl Process {
    fn send(&mut self, kind: u32, write: &mut dyn FnMut(&mut Vec<u8>)) -> Result<(), Vec<u8>> {
        self.buffer.clear();
        self.buffer.extend_from_slice(&[0; 4]);
        self.buffer.extend_from_slice(&kind.to_le_bytes());
        write(&mut self.buffer);
        let len = (self.buffer.len() - 8) as u32;
        self.buffer[..4].copy_from_slice(&len.to_le_bytes());
        self.channel.send(&self.buffer)
    }

    fn receive(&mut self) -> Result<(u32, Vec<u8>), Vec<u8>> {
        let mut header = [0; 8];
        self.channel.receive(&mut header)?;
        let [a, b, c, d, kind @ ..] = header;
        let mut content = vec![0; u32::from_le_bytes([a, b, c, d]) as usize];
        self.channel.receive(&mut content)?;
        Ok((u32::from_le_bytes(kind), content))
    }

    fn converse(
        &mut self,
        kind: u32,
        content: &[u8],
        serve: &mut Serve,
    ) -> Result<Vec<u8>, Vec<u8>> {
        self.send(kind, &mut |out| out.extend_from_slice(content))?;
        loop {
            match self.receive()? {
                (RESULT, result) => return Ok(result),
                (asked, details) => self.send(0, &mut |out| serve(asked, &details, out))?,
            }
        }
    }
}

impl Vm for Process {
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>> {
        self.converse(kind, content, serve)
            .inspect_err(|_| self.has_failed = true)
    }
}

#[derive(Default)]
struct State {
    idle: Vec<Process>,
    /// How many processes there are, idle or not.
    count: usize,
    /// Which thread has which. `None`: it is being called.
    lent: Vec<(ThreadId, Option<Process>)>,
    has_one_for_heavy: bool,
    /// How many are kept: [`Engine::keep_vm`].
    kept: usize,
}

/// The process that a thread has. As with an engine of `bun lint`, what asks for one further down on that thread has the same.
struct Lent<'p, 'e> {
    by: &'p Processes<'e>,
    to: ThreadId,
}

impl Vm for Lent<'_, '_> {
    fn call(&mut self, kind: u32, content: &[u8], serve: &mut Serve) -> Result<Vec<u8>, Vec<u8>> {
        let slot = |state: &State| state.lent.iter().position(|it| it.0 == self.to);
        let mut state = self.by.state.lock();
        let mut process = (slot(&state).and_then(|at| state.lent[at].1.take()))
            .ok_or(b"The process for JavaScript plugins is being called.".as_slice())?;
        drop(state);
        let returned = process.call(kind, content, serve);
        let mut state = self.by.state.lock();
        if let Some(at) = slot(&state) {
            state.lent[at].1 = Some(process);
        }
        returned
    }
}

/// Some processes. None is started before it is needed.
pub(crate) struct Processes<'e> {
    spawn: &'e Spawn<'e>,
    program: Vec<u8>,
    max: usize,
    /// Whether [`Engine::expect`] was called. Else there are as many as are asked for.
    is_told: AtomicBool,
    demand: Demand,
    state: Guarded<State>,
    is_idle: Condition,
}

impl<'e> Processes<'e> {
    /// `max`: how many there can be at a time.
    pub(crate) fn new(spawn: &'e Spawn<'e>, max: usize) -> Processes<'e> {
        Processes {
            spawn,
            program: bun_lint::js_plugin::PROGRAM
                .iter()
                .flat_map(|it| it.1.bytes())
                .collect(),
            max: max.max(1),
            is_told: AtomicBool::new(false),
            demand: Demand::default(),
            state: Guarded::new(State::default()),
            is_idle: Condition::default(),
        }
    }

    /// Another program than [`bun_lint::js_plugin::PROGRAM`].
    pub(crate) fn set_program(&mut self, program: Vec<u8>) {
        self.program = program;
    }

    fn start(&self, is_for_heavy: bool) -> Result<Process, Vec<u8>> {
        let mut process = Process {
            channel: (self.spawn)()?,
            buffer: Vec::new(),
            has_failed: false,
            is_for_heavy,
        };
        process.send(PROGRAM, &mut |out| out.extend_from_slice(&self.program))?;
        Ok(process)
    }

    /// One less.
    fn lose(&self, was_for_heavy: bool) {
        let mut state = self.state.lock();
        state.has_one_for_heavy &= !was_for_heavy;
        state.count -= 1;
        drop(state);
        self.is_idle.notify_one();
    }
}

impl Processes<'_> {
    fn lend(
        &self,
        size: usize,
        is_heavy: bool,
        then: &mut dyn FnMut(&mut dyn Vm),
    ) -> Result<(), Vec<u8>> {
        let to = std::thread::current().id();
        let mut state = self.state.lock();
        if state.lent.iter().any(|it| it.0 == to) {
            drop(state);
            then(&mut Lent { by: self, to });
            return Ok(());
        }
        let idle = loop {
            let found = (state.idle.iter())
                .rposition(|it| it.is_for_heavy == is_heavy)
                .or_else(|| state.idle.len().checked_sub(1).filter(|_| !is_heavy));
            if let Some(found) = found {
                break Ok(state.idle.remove(found));
            }
            let is_worth_it = !self.is_told.load(Ordering::Relaxed)
                || (self.demand).is_worth_another(state.count - state.kept);
            let can_start = !is_heavy || !state.has_one_for_heavy;
            if can_start && state.count < self.max && is_worth_it {
                state.count += 1;
                break Err(!std::mem::replace(&mut state.has_one_for_heavy, true));
            }
            self.is_idle.wait_guarded(&mut state);
        };
        drop(state);
        let process = match idle {
            Ok(process) => process,
            Err(is_for_heavy) => {
                (self.start(is_for_heavy)).inspect_err(|_| self.lose(is_for_heavy))?
            }
        };
        let is_for_heavy = process.is_for_heavy;
        self.state.lock().lent.push((to, Some(process)));
        then(&mut Lent { by: self, to });
        self.demand.note(size);
        let mut state = self.state.lock();
        let at = state.lent.iter().position(|it| it.0 == to);
        match at.and_then(|at| state.lent.swap_remove(at).1) {
            Some(process) if !process.has_failed => {
                state.idle.push(process);
                // Each of those that wait looks whether another one is worth it by now.
                self.is_idle.notify_all();
            }
            _ => {
                drop(state);
                self.lose(is_for_heavy);
            }
        }
        Ok(())
    }
}

impl Engine for Processes<'_> {
    fn with_vm(&self, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        self.lend(size, size >= HEAVY, then)
    }

    fn keep_vm(&self, then: &mut dyn FnMut()) -> Result<(), Vec<u8>> {
        self.lend(0, true, &mut |_| {
            self.state.lock().kept += 1;
            self.is_idle.notify_all();
            then();
            self.state.lock().kept -= 1;
        })
    }

    fn may_come(&self, size: u64) {
        self.demand.may_come(size);
    }

    fn has_shown(&self, size: u64, comes: bool) {
        self.demand.has_shown(size, comes);
    }

    fn expect(&self, _files: usize, size: u64, most: usize) {
        self.is_told.store(true, Ordering::Relaxed);
        self.demand.expect(size, most);
    }
}
