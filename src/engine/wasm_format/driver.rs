//! Runs a visitor over code that was validated.

use core::convert::Infallible;
use core::ops::Range;

use crate::decode::{Context, Decoder, Run};
use crate::index::{CodeIndex, FuncIndex, MemoryIndex, TableIndex, TypeIndex};
use crate::module::{FunctionFacts, ModuleHeader};
use crate::ops::{Catches, Flow};
use crate::reader::Reader;
use crate::types::{BlockType, FuncType, ValType};
use crate::visitor::{
    Visit, VisitControl, VisitMemory, VisitNumeric, VisitReference, VisitVariable, VisitVector,
    Visitor,
};

/// A function that is valid.
#[derive(Clone, Copy)]
pub struct FunctionBody<'a> {
    header: &'a ModuleHeader,
    bytes: &'a [u8],
    code: CodeIndex,
    facts: FunctionFacts,
}

impl<'a> FunctionBody<'a> {
    pub(crate) fn new(
        header: &'a ModuleHeader,
        code: CodeIndex,
        bytes: &'a [u8],
        facts: FunctionFacts,
    ) -> Self {
        Self {
            header,
            bytes,
            code,
            facts,
        }
    }

    pub fn header(&self) -> &'a ModuleHeader {
        self.header
    }

    pub fn code_index(&self) -> CodeIndex {
        self.code
    }

    pub fn func_index(&self) -> FuncIndex {
        self.header.func_index(self.code)
    }

    pub fn type_index(&self) -> TypeIndex {
        self.header.func_type_index(self.func_index())
    }

    pub fn func_type(&self) -> FuncType<'a> {
        self.header.func_type(self.func_index())
    }

    /// What the offsets of instructions count in.
    pub fn bytes(&self) -> &'a [u8] {
        self.bytes
    }

    pub fn facts(&self) -> &FunctionFacts {
        &self.facts
    }

    /// The locals after the parameters: how many in a row, which can be none, and of what type.
    pub fn local_groups(&self) -> impl ExactSizeIterator<Item = (u32, ValType)> + use<'a> {
        let (header, mut reader) = (self.header, Reader::new(self.bytes, 0));
        let groups = reader.u32().expect("the body was validated");
        (0..groups).map(move |_| {
            let group = reader.u32().zip(header.value_type(&mut reader));
            group.expect("the body was validated")
        })
    }

    pub fn driver(&self) -> Driver<'a> {
        self.driver_at(self.facts.code_offset)
    }

    /// From the instruction at `offset` to the end of its block. Calls and loops count from there.
    pub fn driver_at(&self, offset: u32) -> Driver<'a> {
        Driver::new(self.header, self.bytes, offset)
    }
}

/// Visits the instructions that can be reached, in order.
///
/// After an instruction that does not go on to the next, or if [`Visit::flow`] says so, it skips to the `else`,
/// `catch`, `catch_all`, `delegate` or `end` of the innermost block and visits that with [`Flow::Dead`].
/// A visitor may run another driver on itself from one of its methods.
#[derive(Clone, Copy)]
pub struct Driver<'a> {
    reader: Reader<'a>,
    cx: Context<'a>,
}

impl<'a> Driver<'a> {
    pub(crate) fn new(header: &'a ModuleHeader, bytes: &'a [u8], offset: u32) -> Self {
        Self {
            reader: Reader::new(bytes, offset as usize),
            cx: Context::new(header),
        }
    }

    /// Of the next instruction.
    pub fn offset(&self) -> u32 {
        self.reader.position() as u32
    }

    /// After an error of the visitor, another call goes on behind the instruction that caused it.
    pub fn run<V: Visitor>(&mut self, visitor: &mut V) -> Result<(), V::Error> {
        if self.cx.depth == 0 {
            return Ok(());
        }
        let mut cx = self.cx;
        let mut decoder = Decoder::<Run<V::Error>>::new(self.reader, &mut cx);
        if decoder.cx.dead != 0 {
            decoder.skip_dead_code();
        }
        let result = decoder.run(visitor);
        self.reader = decoder.reader;
        self.cx = cx;
        result
    }
}

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    pub struct LoopFlags: u8 {
        /// Tail calls do not count.
        const CALLS = 1 << 0;
        const GROWS_MEMORY = 1 << 1;
        const GROWS_TABLE = 1 << 2;
        const HAS_INNER_LOOP = 1 << 3;
    }
}

#[derive(Clone, Default)]
struct Loop {
    assigned: Range<u32>,
    flags: LoopFlags,
}

/// What the loops of a function change, inner loops included. It can be used for one function after the other.
#[derive(Default)]
pub struct LoopEffects {
    loops: Vec<Loop>,
    assigned: Vec<u32>,
    /// By local: the number of loops that had started when it was last put in `assigned`.
    last_noted: Vec<u32>,
    started: u32,
    /// For each open block the index of the innermost loop around its code.
    innermost: Vec<Option<u32>>,
}

impl LoopEffects {
    pub fn scan(&mut self, body: &FunctionBody<'_>) {
        self.loops.clear();
        self.assigned.clear();
        if body.facts.loop_count == 0 {
            return;
        }
        self.loops
            .resize(body.facts.loop_count as usize, Loop::default());
        self.last_noted.clear();
        self.last_noted.resize(body.facts.local_count as usize, 0);
        self.started = 0;
        self.innermost.clear();
        self.innermost.push(None);
        let Ok(()) = body.driver().run(&mut LoopScan(self));
    }

    /// A local that several inner loops assign is there several times.
    pub fn assigned_locals(&self, index: u32) -> &[u32] {
        let Range { start, end } = self.loops[index as usize].assigned;
        &self.assigned[start as usize..end as usize]
    }

    pub fn flags(&self, index: u32) -> LoopFlags {
        self.loops[index as usize].flags
    }
}

struct LoopScan<'a>(&'a mut LoopEffects);

impl LoopScan<'_> {
    fn innermost(&self) -> Option<u32> {
        self.0.innermost.last().copied().flatten()
    }

    fn open(&mut self) -> Result<(), Infallible> {
        let innermost = self.innermost();
        self.0.innermost.push(innermost);
        Ok(())
    }

    fn close(&mut self) -> Result<(), Infallible> {
        let inner = self.0.innermost.pop().flatten();
        if let Some(index) = inner
            && inner != self.innermost()
        {
            let ended = &mut self.0.loops[index as usize];
            ended.assigned.end = self.0.assigned.len() as u32;
            let flags = ended.flags | LoopFlags::HAS_INNER_LOOP;
            self.note(flags)?;
        }
        Ok(())
    }

    fn note(&mut self, flags: LoopFlags) -> Result<(), Infallible> {
        if let Some(index) = self.innermost() {
            self.0.loops[index as usize].flags |= flags;
        }
        Ok(())
    }

    #[inline]
    fn assign(&mut self, local: u32) -> Result<(), Infallible> {
        // What was noted since the last loop started is in the range of every open loop.
        let last_noted = &mut self.0.last_noted[local as usize];
        if *last_noted != self.0.started {
            *last_noted = self.0.started;
            self.0.assigned.push(local);
        }
        Ok(())
    }
}

impl Visit for LoopScan<'_> {
    type Error = Infallible;

    #[inline(always)]
    fn unhandled(&mut self) -> Result<(), Infallible> {
        Ok(())
    }
}

impl VisitControl for LoopScan<'_> {
    fn block(&mut self, _: BlockType) -> Result<(), Infallible> {
        self.open()
    }

    fn if_(&mut self, _: BlockType) -> Result<(), Infallible> {
        self.open()
    }

    fn try_(&mut self, _: BlockType) -> Result<(), Infallible> {
        self.open()
    }

    fn try_table(&mut self, _: BlockType, _: Catches<'_>) -> Result<(), Infallible> {
        self.open()
    }

    fn loop_(&mut self, _: BlockType, index: u32) -> Result<(), Infallible> {
        let start = self.0.assigned.len() as u32;
        self.0.loops[index as usize].assigned = start..start;
        self.0.started += 1;
        self.0.innermost.push(Some(index));
        Ok(())
    }

    fn end(&mut self, _: Flow) -> Result<(), Infallible> {
        self.close()
    }

    fn delegate(&mut self, _: u32, _: Flow) -> Result<(), Infallible> {
        self.close()
    }

    fn call(&mut self, _: FuncIndex, _: u32) -> Result<(), Infallible> {
        self.note(LoopFlags::CALLS)
    }

    fn call_indirect(&mut self, _: TypeIndex, _: TableIndex, _: u32) -> Result<(), Infallible> {
        self.note(LoopFlags::CALLS)
    }

    fn call_ref(&mut self, _: TypeIndex, _: u32) -> Result<(), Infallible> {
        self.note(LoopFlags::CALLS)
    }
}

impl VisitVariable for LoopScan<'_> {
    #[inline]
    fn local_set(&mut self, local: u32) -> Result<(), Infallible> {
        self.assign(local)
    }

    #[inline]
    fn local_tee(&mut self, local: u32) -> Result<(), Infallible> {
        self.assign(local)
    }
}

impl VisitMemory for LoopScan<'_> {
    fn memory_grow(&mut self, _: MemoryIndex) -> Result<(), Infallible> {
        self.note(LoopFlags::GROWS_MEMORY)
    }

    fn table_grow(&mut self, _: TableIndex) -> Result<(), Infallible> {
        self.note(LoopFlags::GROWS_TABLE)
    }
}

impl VisitNumeric for LoopScan<'_> {}
impl VisitReference for LoopScan<'_> {}
impl VisitVector for LoopScan<'_> {}
