//! Parses a module as its bytes arrive.

macro_rules! fail {
    ($parser:expr, $($reason:tt)*) => {
        return Err(Error::parse($parser.position(), format_args!($($reason)*)))
    };
}

macro_rules! ensure {
    ($parser:expr, $condition:expr, $($reason:tt)*) => {
        if !$condition {
            fail!($parser, $($reason)*);
        }
    };
}

/// `$read` gives an `Option`.
macro_rules! read {
    ($parser:expr, $read:expr, $($reason:tt)*) => {
        match $read {
            Some(value) => value,
            None => fail!($parser, $($reason)*),
        }
    };
}

mod bodies;
mod declarations;
mod section;
mod segments;
mod type_section;

use core::mem;
use std::collections::VecDeque;
use std::sync::{Arc, OnceLock};

use self::bodies::Batch;
pub use self::bodies::{Bodies, ValidatedBodies};
use self::section::Section;
use crate::alloc::{TryPush, shrink};
use crate::error::{Error, ErrorKind};
use crate::limits::{MAX_FUNCTION_SIZE, MAX_MODULE_SIZE};
use crate::module::{Chunk, CustomSection, Data, Features, FunctionFlags, Module, ModuleHeader};
use crate::reader::Reader;
use crate::validate::Scratch;

const MAGIC: &[u8; 4] = b"\0asm";
const VERSION: u32 = 1;
const PREAMBLE_SIZE: usize = 8;
const MAX_U32_SIZE: usize = 5;
/// A batch of bodies ends when it has this many bytes.
const FULL_BATCH_SIZE: usize = 32 << 10;
/// It does not wait for more input if it has this many.
const LEAST_BATCH_SIZE: usize = 8 << 10;

/// In the order that they have in a module.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum SectionKind {
    Begin,
    Type,
    Import,
    Function,
    Table,
    Memory,
    Exception,
    Global,
    Export,
    Start,
    Element,
    DataCount,
    Code,
    Data,
    Custom,
}

impl SectionKind {
    fn from_id(id: u8) -> Option<Self> {
        use SectionKind::*;
        const BY_ID: [SectionKind; 14] = [
            Custom, Type, Import, Function, Table, Memory, Global, Export, Start, Element, Code,
            Data, DataCount, Exception,
        ];
        BY_ID.get(usize::from(id)).copied()
    }
}

#[derive(Clone, Copy)]
enum State {
    Preamble,
    SectionId,
    SectionSize,
    SectionPayload { size: u32 },
    FunctionCount,
    FunctionSize,
    FunctionBody { size: u32 },
}

/// Errors have a fixed order, however the bytes arrive and whenever the bodies are validated: those of the parser
/// come first, then that of the first invalid function.
pub struct Parser {
    state: State,
    error: Option<Error>,
    /// The bytes that are in no chunk yet.
    buffer: Vec<u8>,
    buffer_start: usize,
    /// Where what `state` names starts.
    offset: usize,
    section: SectionKind,
    last_known_section: SectionKind,
    section_end: usize,
    /// Shared from the code section on.
    header: Arc<ModuleHeader>,
    function_count: u32,
    functions_read: u32,
    open_batch: Batch,
    /// Their bytes are in `buffer`.
    closed_batches: Vec<Batch>,
    ready: VecDeque<Bodies>,
    chunks: Vec<Chunk>,
    data: Vec<Data>,
    custom_sections: Vec<CustomSection>,
    scratch: Scratch,
}

impl Parser {
    pub fn new(features: Features) -> Self {
        Self {
            state: State::Preamble,
            error: None,
            buffer: Vec::new(),
            buffer_start: 0,
            offset: 0,
            section: SectionKind::Begin,
            last_known_section: SectionKind::Begin,
            section_end: 0,
            header: Arc::new(ModuleHeader::new(features)),
            function_count: 0,
            functions_read: 0,
            open_batch: Batch::default(),
            closed_batches: Vec::new(),
            ready: VecDeque::new(),
            chunks: Vec::new(),
            data: Vec::new(),
            custom_sections: Vec::new(),
            scratch: Scratch::default(),
        }
    }

    /// An error is final. Later calls return it again.
    pub fn feed(&mut self, bytes: &[u8]) -> Result<(), Error> {
        self.unless_failed(|parser| {
            parser.append(bytes)?;
            parser.advance()
        })
    }

    /// The same, without a copy if no earlier bytes are waiting for their rest.
    pub fn feed_owned(&mut self, bytes: Vec<u8>) -> Result<(), Error> {
        if !self.buffer.is_empty() {
            return self.feed(&bytes);
        }
        self.unless_failed(|parser| {
            parser.ensure_room_for(bytes.len())?;
            parser.buffer = bytes;
            parser.advance()
        })
    }

    /// Functions that have arrived completely. Each is handed out once.
    pub fn take_bodies(&mut self) -> Option<Bodies> {
        self.ready.pop_front()
    }

    pub fn finish(mut self) -> Result<UnvalidatedModule, Error> {
        self.unless_failed(|parser| {
            parser.ensure_complete()?;
            parser.seal(parser.offset)
        })?;
        Ok(UnvalidatedModule {
            ready: self.ready,
            module: Module {
                header: self.header,
                chunks: self.chunks,
                functions: Vec::new(),
                data: self.data,
                custom_sections: self.custom_sections,
                names: OnceLock::new(),
                branch_hints: OnceLock::new(),
            },
        })
    }

    fn unless_failed(
        &mut self,
        work: impl FnOnce(&mut Self) -> Result<(), Error>,
    ) -> Result<(), Error> {
        if self.error.is_none() {
            self.error = work(self).err();
        }
        self.error.clone().map_or(Ok(()), Err)
    }

    fn position(&self) -> usize {
        self.offset
    }

    fn ensure_room_for(&self, count: usize) -> Result<(), Error> {
        ensure!(
            self,
            count <= MAX_MODULE_SIZE - (self.buffer_start + self.buffer.len()),
            "module size is too large, maximum {MAX_MODULE_SIZE}"
        );
        Ok(())
    }

    fn append(&mut self, bytes: &[u8]) -> Result<(), Error> {
        self.ensure_room_for(bytes.len())?;
        let needed = self.buffer.len() + bytes.len();
        if needed > self.buffer.capacity() {
            let awaited = match self.state {
                State::SectionPayload { size } | State::FunctionBody { size } => {
                    self.offset - self.buffer_start + size as usize
                }
                _ => usize::MAX,
            };
            let capacity = needed.max(awaited.min(self.buffer.len() * 2));
            let reserved = self.buffer.try_reserve_exact(capacity - self.buffer.len());
            reserved.map_err(|_| self.out_of_memory())?;
        }
        self.buffer.extend_from_slice(bytes);
        Ok(())
    }

    #[cold]
    fn out_of_memory(&self) -> Error {
        Error::parse(
            self.offset,
            format_args!("can't allocate enough memory for the module"),
        )
    }

    fn advance(&mut self) -> Result<(), Error> {
        while let Some(state) = self.step()? {
            self.state = state;
        }
        if self.open_batch.size() >= LEAST_BATCH_SIZE {
            self.close_batch()?;
        }
        let done = if self.functions_read < self.function_count {
            self.open_batch.start
        } else {
            self.offset
        };
        // What is done does not move again when the buffer grows.
        if !self.closed_batches.is_empty() || done - self.buffer_start >= FULL_BATCH_SIZE {
            self.seal(done)?;
        }
        Ok(())
    }

    #[inline]
    fn unread(&self) -> &[u8] {
        &self.buffer[self.offset - self.buffer_start..]
    }

    /// `None` if more bytes are needed.
    #[inline]
    fn step(&mut self) -> Result<Option<State>, Error> {
        let available = self.unread().len();
        match self.state {
            State::Preamble if available >= PREAMBLE_SIZE => self.preamble().map(Some),
            State::SectionId if available >= 1 => self.section_id().map(Some),
            State::SectionPayload { size } if available >= size as usize => {
                self.section_payload(size as usize).map(Some)
            }
            State::FunctionBody { size } if available >= size as usize => {
                self.function_body(size as usize).map(Some)
            }
            State::SectionSize => self.with_number(Self::section_size),
            State::FunctionCount => self.with_number(Self::function_count),
            State::FunctionSize => self.with_number(Self::function_size),
            _ => Ok(None),
        }
    }

    /// `next` gets the number and the offset after it.
    #[inline(always)]
    fn with_number(
        &mut self,
        next: impl FnOnce(&mut Self, u32, usize) -> Result<State, Error>,
    ) -> Result<Option<State>, Error> {
        let mut reader = Reader::new(self.unread(), 0);
        let Some(number) = reader.u32() else {
            return match reader.bytes().len() {
                ..MAX_U32_SIZE => Ok(None),
                _ => Err(self.missing()),
            };
        };
        let end = self.offset + reader.position();
        let state = next(self, number, end)?;
        self.offset = end;
        Ok(Some(state))
    }

    /// The error for not getting what `state` names.
    #[cold]
    fn missing(&self) -> Error {
        let section = self.section;
        let error = |reason| Error::parse(self.offset, reason);
        match self.state {
            State::Preamble => error(format_args!(
                "expected a module of at least {PREAMBLE_SIZE} bytes"
            )),
            State::SectionId => error(format_args!("can't get section byte")),
            State::SectionSize => error(format_args!("can't get {section:?} section's length")),
            State::SectionPayload { size } => error(format_args!(
                "{section:?} section of size {size} would overflow Module's size"
            )),
            State::FunctionCount => error(format_args!("can't get Code section's count")),
            State::FunctionSize => error(format_args!(
                "can't get {}th Code function's size",
                self.functions_read
            )),
            State::FunctionBody { size } => error(format_args!(
                "Code function's size {size} exceeds the module's remaining size"
            )),
        }
    }

    fn ensure_complete(&self) -> Result<(), Error> {
        if !matches!(self.state, State::SectionId) {
            return Err(self.missing());
        }
        let (parsed, declared) = (self.function_count, self.header.code_count());
        ensure!(
            self,
            parsed == declared,
            "Number of functions parsed ({parsed}) does not match the number of declared functions ({declared})"
        );
        let count = self.data.len();
        if let Some(declared) = self.header.data_count {
            ensure!(
                self,
                count == declared as usize,
                "Data section's count {count} is different from Data Count section's count {declared}"
            );
        }
        Ok(())
    }

    fn preamble(&mut self) -> Result<State, Error> {
        let mut reader = Reader::new(self.unread(), 0);
        ensure!(
            self,
            reader.array().as_ref() == Some(MAGIC),
            "module doesn't start with '\\0asm'"
        );
        let version = reader.array().map_or(0, u32::from_le_bytes);
        ensure!(
            self,
            version == VERSION,
            "unexpected version number {version} expected {VERSION}"
        );
        self.offset += PREAMBLE_SIZE;
        Ok(State::SectionId)
    }

    fn section_id(&mut self) -> Result<State, Error> {
        let id = Reader::new(self.unread(), 0)
            .u7()
            .ok_or_else(|| self.missing())?;
        let section = read!(self, SectionKind::from_id(id), "invalid section");
        let last = self.last_known_section;
        ensure!(
            self,
            last < section,
            "invalid section order, {last:?} followed by {section:?}"
        );
        self.section = section;
        if section != SectionKind::Custom {
            self.last_known_section = section;
        }
        self.offset += 1;
        Ok(State::SectionSize)
    }

    fn section_size(&mut self, size: u32, end: usize) -> Result<State, Error> {
        self.section_end = end + size as usize;
        Ok(match self.section {
            SectionKind::Code => State::FunctionCount,
            _ => State::SectionPayload { size },
        })
    }

    fn ensure_section_ends_at(&self, end: usize) -> Result<(), Error> {
        let section = self.section;
        ensure!(
            self,
            end == self.section_end,
            "parsing ended before the end of {section:?} section"
        );
        Ok(())
    }

    fn section_payload(&mut self, size: usize) -> Result<State, Error> {
        let payload = &self.buffer[self.offset - self.buffer_start..][..size];
        let mut section = Section::new(payload, self.offset, &mut self.scratch);
        match self.section {
            SectionKind::Custom => section.custom(&mut self.custom_sections)?,
            SectionKind::Data => section.data(&self.header, &mut self.data)?,
            kind => {
                let header = Arc::get_mut(&mut self.header).expect("no code before this section");
                match kind {
                    SectionKind::Type => section.types(header)?,
                    SectionKind::Import => section.imports(header)?,
                    SectionKind::Function => section.funcs(header)?,
                    SectionKind::Table => section.tables(header)?,
                    SectionKind::Memory => section.memories(header)?,
                    SectionKind::Exception => section.tags(header)?,
                    SectionKind::Global => section.globals(header)?,
                    SectionKind::Export => section.exports(header)?,
                    SectionKind::Start => section.start(header)?,
                    SectionKind::Element => section.elems(header)?,
                    SectionKind::DataCount => section.data_count(header)?,
                    _ => unreachable!(),
                }
            }
        }
        let end = section.position();
        self.ensure_section_ends_at(end)?;
        self.offset = end;
        Ok(State::SectionId)
    }

    fn function_count(&mut self, count: u32, end: usize) -> Result<State, Error> {
        let declared = self.header.code_count();
        ensure!(
            self,
            count != u32::MAX,
            "Code section's count is too big {count}"
        );
        ensure!(
            self,
            count == declared,
            "Code section count {count} exceeds the declared number of functions {declared}"
        );
        self.function_count = count;
        if count == 0 {
            self.ensure_section_ends_at(end)?;
            return Ok(State::SectionId);
        }
        self.open_batch = Batch::starting(0, end);
        Ok(State::FunctionSize)
    }

    #[inline]
    fn function_size(&mut self, size: u32, _: usize) -> Result<State, Error> {
        ensure!(
            self,
            size <= MAX_FUNCTION_SIZE,
            "Code function's size {size} is too big"
        );
        Ok(State::FunctionBody { size })
    }

    #[inline]
    fn function_body(&mut self, size: usize) -> Result<State, Error> {
        let end = self.offset + size;
        self.functions_read += 1;
        self.open_batch.extend_to(end);
        let is_last = self.functions_read == self.function_count;
        if is_last {
            self.ensure_section_ends_at(end)?;
        }
        if is_last || self.open_batch.size() >= FULL_BATCH_SIZE {
            self.close_batch()?;
        }
        self.offset = end;
        Ok(if is_last {
            State::SectionId
        } else {
            State::FunctionSize
        })
    }

    fn close_batch(&mut self) -> Result<(), Error> {
        let next = Batch::starting(self.functions_read, self.open_batch.end);
        let closed = mem::replace(&mut self.open_batch, next);
        self.closed_batches
            .try_push(closed)
            .map_err(|_| self.out_of_memory())
    }

    /// Makes a chunk of the bytes before `end`.
    fn seal(&mut self, end: usize) -> Result<(), Error> {
        let size = end - self.buffer_start;
        if size == 0 {
            return Ok(());
        }
        let mut rest = Vec::new();
        let reserved = rest.try_reserve_exact(self.buffer.len() - size).is_ok()
            && self.chunks.try_reserve(1).is_ok()
            && self.ready.try_reserve(self.closed_batches.len()).is_ok();
        if !reserved {
            return Err(self.out_of_memory());
        }
        rest.extend_from_slice(&self.buffer[size..]);
        let mut bytes = mem::replace(&mut self.buffer, rest);
        bytes.truncate(size);
        shrink(&mut bytes);

        let chunk = Chunk {
            start: mem::replace(&mut self.buffer_start, end) as u32,
            bytes: Arc::new(bytes),
        };
        let batches = self.closed_batches.drain(..);
        let header = &self.header;
        self.ready
            .extend(batches.map(|batch| Bodies::new(header, &chunk, batch)));
        self.chunks.push(chunk);
        Ok(())
    }
}

/// All is valid but, perhaps, the functions.
pub struct UnvalidatedModule {
    ready: VecDeque<Bodies>,
    module: Module,
}

impl UnvalidatedModule {
    /// Those that were not taken from the parser.
    pub fn take_bodies(&mut self) -> Option<Bodies> {
        self.ready.pop_front()
    }

    /// Takes the outcomes in any order. Those behind an invalid function may be missing.
    pub fn complete(self, mut outcomes: Vec<ValidatedBodies>) -> Result<Module, Error> {
        let mut module = self.module;
        outcomes.sort_unstable_by_key(ValidatedBodies::first);
        let count = module.code_count() as usize;
        if module.functions.try_reserve_exact(count).is_err() {
            let reason = format_args!("can't allocate enough memory for {count} functions");
            return Err(Error::new(ErrorKind::Module, reason));
        }
        for outcome in outcomes {
            assert!(outcome.follows(&module.header, module.functions.len()));
            module.functions.append(&mut outcome.into_functions()?);
        }
        assert!(module.functions.len() == count);

        let flags = module.functions.iter().map(|function| function.facts.flags);
        let flags: FunctionFlags = flags.collect();
        if flags.contains(FunctionFlags::HAS_TRY | FunctionFlags::HAS_TRY_TABLE) {
            let reason = format_args!("Module uses both legacy exceptions and try_table");
            return Err(Error::new(ErrorKind::Module, reason));
        }
        Ok(module)
    }
}

impl Module {
    /// Parses and validates on this thread.
    pub fn new(bytes: Vec<u8>, features: Features) -> Result<Self, Error> {
        let mut parser = Parser::new(features);
        parser.feed_owned(bytes)?;
        let mut unvalidated = parser.finish()?;
        let mut scratch = Scratch::default();
        let mut outcomes = Vec::new();
        while let Some(bodies) = unvalidated.take_bodies() {
            let outcome = bodies.validate(&mut scratch);
            let failed = outcome.error().is_some();
            outcomes.push(outcome);
            if failed {
                break;
            }
        }
        unvalidated.complete(outcomes)
    }
}
