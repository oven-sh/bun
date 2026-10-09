//! Realms for JavaScript plugins that are processes of their own, talked to through pipes. Bun has a VM on each thread
//! instead: this is for the harness, which has no JavaScript in it.
//!
//! A message is a header of two numbers, the length of what follows and what it is, and then that many bytes. To a process:
//! the program ([`PROGRAM`]), a call (its kind), the answer to what it asked for (0). From a process: what it asks for (its
//! kind), what a call returns ([`RESULT`]).

use bun_lint::js_plugin::{Demand, Engine, Serve, Vm};
use bun_threading::{Condition, Guarded};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread::ThreadId;
use std::time::Instant;

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
    /// When it was started, until it has been used for the first time.
    started: Option<Instant>,
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
    /// The threads that have one, each as often as it has one.
    users: Vec<ThreadId>,
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

    fn start(&self) -> Result<Process, Vec<u8>> {
        let mut process = Process {
            channel: (self.spawn)()?,
            buffer: Vec::new(),
            has_failed: false,
            started: Some(Instant::now()),
        };
        process.send(PROGRAM, &mut |out| out.extend_from_slice(&self.program))?;
        Ok(process)
    }

    /// One less.
    fn lose(&self) {
        self.state.lock().count -= 1;
        self.is_idle.notify_one();
    }
}

impl Engine for Processes<'_> {
    fn with_vm(&self, size: usize, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        let me = std::thread::current().id();
        let mut state = self.state.lock();
        // It has one, which it would wait for.
        let is_within = state.users.contains(&me);
        let idle = loop {
            if let Some(process) = state.idle.pop() {
                break Some(process);
            }
            let is_worth_it =
                !self.is_told.load(Ordering::Relaxed) || self.demand.is_worth_another(state.count);
            if (state.count < self.max && is_worth_it) || is_within {
                state.count += 1;
                break None;
            }
            self.is_idle.wait_guarded(&mut state);
        };
        state.users.push(me);
        drop(state);
        let started = match idle {
            Some(process) => Ok(process),
            None => self.start().inspect_err(|_| self.lose()),
        };
        let used = started.map(|mut process| {
            let since = Instant::now();
            then(&mut process);
            if !is_within {
                let started = process.started.take();
                (self.demand).note(size, since.elapsed(), started.map(|it| it.elapsed()));
            }
            process
        });
        let mut state = self.state.lock();
        if let Some(at) = state.users.iter().rposition(|it| *it == me) {
            state.users.swap_remove(at);
        }
        let process = used?;
        if process.has_failed {
            drop(state);
            drop(process);
            self.lose();
        } else {
            state.idle.push(process);
            // Each of those that wait looks whether another one is worth it by now.
            self.is_idle.notify_all();
        }
        Ok(())
    }

    fn expect(&self, _files: usize, size: u64, most: usize) {
        self.is_told.store(true, Ordering::Relaxed);
        self.demand.expect(size, most);
    }
}
