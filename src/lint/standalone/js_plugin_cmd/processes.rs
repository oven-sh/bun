//! Realms for JavaScript plugins that are processes of their own, talked to through pipes. Bun has a VM on each thread
//! instead: this is for the harness, which has no JavaScript in it.
//!
//! A message is a header of two numbers, the length of what follows and what it is, and then that many bytes. To a process:
//! the program ([`PROGRAM`]), a call (its kind), the answer to what it asked for (0). From a process: what it asks for (its
//! kind), what a call returns ([`RESULT`]).

use bun_lint::js_plugin::{Engine, Serve, Vm};
use bun_threading::{Condition, Guarded};

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
}

impl Process {
    fn send(&mut self, kind: u32, write: impl FnOnce(&mut Vec<u8>)) -> Result<(), Vec<u8>> {
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
        self.send(kind, |out| out.extend_from_slice(content))?;
        loop {
            match self.receive()? {
                (RESULT, result) => return Ok(result),
                (asked, details) => self.send(0, |out| serve(asked, &details, out))?,
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
}

/// Some processes. None is started before it is needed.
pub(crate) struct Processes<'e> {
    spawn: &'e Spawn<'e>,
    program: Vec<u8>,
    max: usize,
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
        };
        process.send(PROGRAM, |out| out.extend_from_slice(&self.program))?;
        Ok(process)
    }

    /// One less.
    fn lose(&self) {
        self.state.lock().count -= 1;
        self.is_idle.notify_one();
    }
}

impl Engine for Processes<'_> {
    fn with_vm(&self, then: &mut dyn FnMut(&mut dyn Vm)) -> Result<(), Vec<u8>> {
        let mut state = self.state.lock();
        let idle = loop {
            if let Some(process) = state.idle.pop() {
                break Some(process);
            }
            if state.count < self.max {
                state.count += 1;
                break None;
            }
            self.is_idle.wait_guarded(&mut state);
        };
        drop(state);
        let mut process = match idle {
            Some(process) => process,
            None => self.start().inspect_err(|_| self.lose())?,
        };
        then(&mut process);
        if process.has_failed {
            drop(process);
            self.lose();
        } else {
            self.state.lock().idle.push(process);
            self.is_idle.notify_one();
        }
        Ok(())
    }
}
