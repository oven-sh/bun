//! How the loops of a function nest.

use core::convert::Infallible;

use bun_engine_wasm_format::{
    BlockType, Catches, Flow, FunctionBody, Visit, VisitControl, VisitMemory, VisitNumeric,
    VisitReference, VisitVariable, VisitVector,
};

const NONE: u32 = u32::MAX;

pub(super) struct Nesting {
    parents: Box<[u32]>,
}

impl Nesting {
    pub(super) fn new(body: &FunctionBody<'_>) -> Self {
        let mut scan = Scan {
            parents: vec![NONE; body.facts().loop_count as usize],
            innermost: vec![NONE],
        };
        if scan.parents.len() > 1 {
            let Ok(()) = body.driver().run(&mut scan);
        }
        Self {
            parents: scan.parents.into(),
        }
    }

    /// The loops around `inner`, from the inside.
    pub(super) fn around(&self, inner: u32) -> impl Iterator<Item = u32> {
        let parent = |&index: &u32| Some(self.parents[index as usize]).filter(|&it| it != NONE);
        core::iter::successors(parent(&inner), parent)
    }

    pub(super) fn is_inside(&self, inner: u32, outer: u32) -> bool {
        self.around(inner).any(|index| index == outer)
    }
}

struct Scan {
    parents: Vec<u32>,
    /// For each open block the innermost loop around its code.
    innermost: Vec<u32>,
}

impl Scan {
    fn innermost(&self) -> u32 {
        self.innermost.last().copied().unwrap_or(NONE)
    }

    fn open(&mut self, innermost: u32) -> Result<(), Infallible> {
        self.innermost.push(innermost);
        Ok(())
    }

    fn close(&mut self) -> Result<(), Infallible> {
        self.innermost.pop();
        Ok(())
    }
}

impl Visit for Scan {
    type Error = Infallible;

    #[inline(always)]
    fn unhandled(&mut self) -> Result<(), Infallible> {
        Ok(())
    }
}

impl VisitControl for Scan {
    fn block(&mut self, _: BlockType) -> Result<(), Infallible> {
        self.open(self.innermost())
    }

    fn if_(&mut self, _: BlockType) -> Result<(), Infallible> {
        self.open(self.innermost())
    }

    fn try_(&mut self, _: BlockType) -> Result<(), Infallible> {
        self.open(self.innermost())
    }

    fn try_table(&mut self, _: BlockType, _: Catches<'_>) -> Result<(), Infallible> {
        self.open(self.innermost())
    }

    fn loop_(&mut self, _: BlockType, index: u32) -> Result<(), Infallible> {
        self.parents[index as usize] = self.innermost();
        self.open(index)
    }

    fn end(&mut self, _: Flow) -> Result<(), Infallible> {
        self.close()
    }

    fn delegate(&mut self, _: u32, _: Flow) -> Result<(), Infallible> {
        self.close()
    }
}

impl VisitVariable for Scan {}
impl VisitNumeric for Scan {}
impl VisitMemory for Scan {}
impl VisitReference for Scan {}
impl VisitVector for Scan {}
