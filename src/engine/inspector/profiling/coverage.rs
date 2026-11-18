//! Which parts of a source have run, and how often. All ranges include their last character.

use core::cell::{Cell, RefCell};
use core::cmp::Reverse;
use core::ops::Range;
use std::collections::BTreeMap;
use std::rc::Rc;

use bun_engine_bytecode::{
    Code, CodeKind, CoverageBlock, CoverageKind, FunctionInfo, FunctionKind,
};
use bun_engine_vm::{
    CoverageCount, FastHashMap, FunctionExecutable, ProgramExecutable, ScriptExecutable, Vm,
};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
struct Span {
    start: i32,
    end: i32,
}

impl Span {
    fn of(range: Range<u32>) -> Span {
        Span {
            start: range.start as i32,
            end: range.end as i32 - 1,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(C)]
pub struct BlockRange {
    pub start: i32,
    pub end: i32,
    pub has_executed: bool,
    pub is_in_loop_header: bool,
    pub execution_count: usize,
}

impl BlockRange {
    fn new(span: Span, execution_count: u64, is_in_loop_header: bool) -> BlockRange {
        BlockRange {
            start: span.start,
            end: span.end,
            has_executed: execution_count != 0,
            is_in_loop_header,
            execution_count: execution_count as usize,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum CodeRangeKind {
    Script,
    Module,
    Function,
    /// Of a generator or of an async function.
    SuspendableBody,
    StaticBlock,
}

/// A part of a source that is entered from elsewhere.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(C)]
pub struct CodeRange {
    pub start: u32,
    pub end: u32,
    pub kind: CodeRangeKind,
    pub has_executed: bool,
}

/// Whether the range of a block has the text of the blocks and functions that are inside it.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Gaps {
    Without,
    With,
}

struct Block {
    count: CoverageCount,
    kind: CoverageKind,
    /// Sorted.
    gaps: Vec<Span>,
}

impl Block {
    fn for_each_range_between_gaps(&self, span: Span, mut visit: impl FnMut(Span)) {
        let mut start = span.start;
        for gap in &self.gaps {
            if start < gap.start {
                let end = gap.start - 1;
                visit(Span { start, end });
            }
            start = gap.end + 1;
        }
        if start <= span.end {
            visit(Span { start, ..span });
        }
    }
}

#[derive(Default)]
struct Blocks(BTreeMap<Span, Block>);

impl Blocks {
    /// What is in one of these is not reported: nothing has looked at it yet. Sorted, and none is inside another.
    fn bodies_not_begun(&self) -> Vec<Span> {
        let not_begun = (self.0.iter())
            .filter(|(_, it)| it.kind == CoverageKind::SuspendableBody && it.count.get() == 0);
        not_begun.map(|(&span, _)| span).collect()
    }
}

fn is_inside_any(bodies: &[Span], span: Span) -> bool {
    let before = bodies.partition_point(|body| body.start <= span.start);
    bodies[..before].last().is_some_and(|it| span.end <= it.end)
}

/// What code that was compiled for it has counted, by the id of the source.
#[derive(Default)]
pub struct Coverage {
    blocks: RefCell<FastHashMap<usize, Blocks>>,
    /// Whether each has been entered.
    entered: RefCell<FastHashMap<usize, BTreeMap<(Span, CodeRangeKind), bool>>>,
    enable_count: Cell<u32>,
}

impl Coverage {
    pub fn of(vm: &Vm) -> Rc<Coverage> {
        vm.extension()
    }

    /// Code that is compiled from now on counts. True if it did not before.
    pub fn enable(&self, vm: &Vm) -> bool {
        self.enable_count.update(|count| count.saturating_add(1));
        !vm.collects_coverage().replace(true)
    }

    /// Undoes an `enable`. True if that was the last, which drops the counts.
    pub fn disable(&self, vm: &Vm) -> bool {
        let Some(count) = self.enable_count.get().checked_sub(1) else {
            return false;
        };
        self.enable_count.set(count);
        if count == 0 {
            vm.collects_coverage().set(false);
            self.blocks.take();
        }
        count == 0
    }

    pub fn source_ids(&self) -> Vec<usize> {
        self.blocks.borrow().keys().copied().collect()
    }

    pub fn code_ranges(&self, source_id: usize) -> Vec<CodeRange> {
        let range = |span: Span, kind, has_executed| CodeRange {
            start: span.start as u32,
            end: span.end as u32,
            kind,
            has_executed,
        };
        let (blocks, entered) = (self.blocks.borrow(), self.entered.borrow());
        let blocks = blocks.get(&source_id);
        let hidden = blocks.map_or_default(Blocks::bodies_not_begun);
        let bodies = (blocks.into_iter().flat_map(|it| &it.0))
            .filter(|(_, block)| block.kind == CoverageKind::SuspendableBody)
            .map(|(&span, it)| range(span, CodeRangeKind::SuspendableBody, it.count.get() != 0));
        (entered.get(&source_id).into_iter().flatten())
            .filter(|&(&(span, _), &was_entered)| was_entered || !is_inside_any(&hidden, span))
            .map(|(&(span, kind), &was_entered)| range(span, kind, was_entered))
            .chain(bodies)
            .collect()
    }

    /// Of the code that has been entered.
    pub fn counted_blocks(&self, source_id: usize, gaps: Gaps) -> Vec<BlockRange> {
        let mut ranges = Vec::new();
        let blocks = self.blocks.borrow();
        let Some(blocks) = blocks.get(&source_id) else {
            return ranges;
        };
        let hidden = blocks.bodies_not_begun();
        for (&span, block) in &blocks.0 {
            if is_inside_any(&hidden, span) {
                continue;
            }
            let is_in_loop_header = block.kind == CoverageKind::LoopHeader;
            let mut add =
                |it| ranges.push(BlockRange::new(it, block.count.get(), is_in_loop_header));
            match gaps {
                Gaps::With => add(span),
                Gaps::Without => block.for_each_range_between_gaps(span, add),
            }
        }
        ranges
    }

    fn counted_blocks_and(
        &self,
        source_id: usize,
        gaps: Gaps,
        includes: impl Fn(&CodeRange) -> bool,
    ) -> Vec<BlockRange> {
        if !self.blocks.borrow().contains_key(&source_id) {
            return Vec::new();
        }
        let mut ranges = self.counted_blocks(source_id, gaps);
        ranges.extend(
            self.code_ranges(source_id)
                .into_iter()
                .filter(includes)
                .map(|it| {
                    let (start, end) = (it.start as i32, it.end as i32);
                    BlockRange::new(Span { start, end }, it.has_executed.into(), false)
                }),
        );
        ranges
    }

    /// With the parts of functions and classes that are entered on their own and have not been.
    pub fn blocks(&self, source_id: usize, gaps: Gaps) -> Vec<BlockRange> {
        self.counted_blocks_and(source_id, gaps, |range| {
            use CodeRangeKind::{StaticBlock, SuspendableBody};
            !range.has_executed && matches!(range.kind, SuspendableBody | StaticBlock)
        })
    }

    /// A range of code counts as one execution if it has been entered.
    pub fn blocks_and_code_ranges(&self, source_id: usize) -> Vec<BlockRange> {
        self.counted_blocks_and(source_id, Gaps::Without, |_| true)
    }

    fn note_code_ranges(&self, executable: &ScriptExecutable, code: &Code) {
        let of_function = |function: &FunctionInfo| {
            let kind = match function.kind() {
                FunctionKind::StaticBlock => CodeRangeKind::StaticBlock,
                _ => CodeRangeKind::Function,
            };
            (function.is_written()).then(|| (Span::of(function.range()), kind))
        };
        let whole = |kind| Some((Span::of(0..range_of(executable).len() as u32), kind));
        let own = match code.body.kind() {
            CodeKind::Script => whole(CodeRangeKind::Script),
            CodeKind::Module => whole(CodeRangeKind::Module),
            CodeKind::Eval => None,
            CodeKind::Call | CodeKind::Construct => (executable.downcast::<FunctionExecutable>())
                .and_then(|function| of_function(function.info())),
        };
        if own.is_none() && code.functions.is_empty() {
            return;
        }
        let mut entered = self.entered.borrow_mut();
        let entered = entered.entry(executable.provider().id()).or_default();
        entered.extend(own.map(|range| (range, true)));
        for inner in code.functions.iter().filter_map(of_function) {
            entered.entry(inner).or_default();
        }
    }

    fn add_blocks(&self, executable: &ScriptExecutable, code: &Code) -> Box<[CoverageCount]> {
        let descriptions = code.body.coverage_blocks();
        if descriptions.is_empty() {
            return Box::default();
        }
        let spans = descriptions.iter().map(|block| {
            let end = match block.end {
                0 => range_of(executable).end as i32 - 1,
                end => end - 1,
            };
            // A text without a token starts after its end.
            let start = block.start.min(end);
            Span { start, end }
        });
        let functions = code.functions.iter().filter(|it| it.is_written());
        let mut nested: Vec<(Span, bool)> = (spans.clone().map(|span| (span, false)))
            .chain(functions.map(|function| (Span::of(function.range()), true)))
            .collect();
        nested.sort_unstable_by_key(|&(span, _)| (span.start, Reverse(span.end)));

        let mut blocks = self.blocks.borrow_mut();
        let blocks = blocks.entry(executable.provider().id()).or_default();
        let add = |(span, description): (Span, &CoverageBlock)| {
            let block = blocks.0.entry(span).or_insert_with(|| Block {
                count: CoverageCount::default(),
                kind: description.kind,
                gaps: Vec::new(),
            });
            block.kind = description.kind;
            block.gaps.extend(outermost_inside(span, &nested));
            block.gaps.sort_unstable();
            block.gaps.dedup();
            Rc::clone(&block.count)
        };
        spans.zip(descriptions).map(add).collect()
    }
}

fn range_of(executable: &ScriptExecutable) -> Range<u32> {
    if let Some(function) = executable.downcast::<FunctionExecutable>() {
        function.info().range()
    } else if let Some(script) = executable.downcast::<ProgramExecutable>() {
        script.range()
    } else {
        0..executable.provider().text().len() as u32
    }
}

/// `nested` has blocks and, marked, functions. Of two that start together, the one that the other is in comes first.
fn outermost_inside(block: Span, nested: &[(Span, bool)]) -> impl Iterator<Item = Span> {
    let mut rest = &nested[nested.partition_point(|(it, _)| it.start < block.start)..];
    core::iter::from_fn(move || {
        loop {
            let (&(inner, is_function), after) = rest.split_first()?;
            if inner.start > block.end {
                return None;
            }
            if is_function || inner != block {
                rest = &after[after.partition_point(|(it, _)| it.start <= inner.end)..];
                return Some(inner);
            }
            rest = after;
        }
    })
}

/// For `Hooks::cover`.
pub fn cover(vm: &Vm, executable: &ScriptExecutable, code: &Code) -> Box<[CoverageCount]> {
    let coverage = Coverage::of(vm);
    coverage.note_code_ranges(executable, code);
    coverage.add_blocks(executable, code)
}
