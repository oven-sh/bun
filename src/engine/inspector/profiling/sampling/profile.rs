//! The samples as paths in a tree of calls, which has a frame once however often it was seen.

use bun_engine_bytecode::Specialization;
use bun_engine_text::StringRef;
use bun_engine_vm::{
    Executable, FastHashMap, FunctionExecutable, Gc, LineColumn, ProgramExecutable, RootVec,
    ScriptExecutable, SourceProviderRef, Tier, Visitor, Vm, WasmTier, root_vec,
};

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[repr(u8)]
pub enum SampledFrameKind {
    /// A script, a module, `eval` code or a function, native ones too.
    Executable,
    Wasm,
    /// Something else that can be called.
    Host,
    RegExp,
    /// What a frame of another kind has called.
    NativeCode,
    Unknown,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub(super) enum Location {
    None,
    Script {
        tier: Tier,
        specialization: Specialization,
        /// The offset in the bytecode, and what it stands for.
        instruction: Option<(u32, LineColumn)>,
    },
    Wasm(WasmTier),
}

pub(super) type NodeIndex = u32;

#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) struct Node {
    pub(super) caller: Option<NodeIndex>,
    /// Of an inlined call, the frame that it has been inlined into.
    pub(super) inliner: Option<NodeIndex>,
    pub(super) kind: SampledFrameKind,
    pub(super) name: StringRef,
    /// The address, or zero.
    pub(super) executable: usize,
    pub(super) location: Location,
}

struct Sample {
    timestamp: f64,
    innermost: NodeIndex,
}

/// Whoever has it keeps the executables alive.
#[derive(Default)]
pub(super) struct CallTree {
    nodes: Vec<Node>,
    indices: FastHashMap<Node, NodeIndex>,
    samples: Vec<Sample>,
}

impl CallTree {
    pub(super) fn add_node(&mut self, node: Node) -> NodeIndex {
        *self.indices.entry(node).or_insert_with_key(|node| {
            self.nodes.push(node.clone());
            self.nodes.len() as NodeIndex - 1
        })
    }

    pub(super) fn add_sample(&mut self, timestamp: f64, innermost: NodeIndex) {
        self.samples.push(Sample {
            timestamp,
            innermost,
        });
    }

    pub(super) fn visit(&self, visitor: &mut Visitor) {
        for node in &self.nodes {
            // SAFETY: zero, or kept alive so far.
            unsafe { visitor.append_word(node.executable as u64) };
        }
    }

    /// In the order in which they were taken.
    pub(super) fn traces(&self) -> impl ExactSizeIterator<Item = Trace<'_>> {
        self.samples.iter().map(|sample| Trace {
            timestamp: sample.timestamp,
            innermost: self.frame(sample.innermost),
        })
    }

    fn frame(&self, index: NodeIndex) -> SampledFrame<'_> {
        SampledFrame { tree: self, index }
    }
}

/// Samples that the profiler has let go of.
pub struct Profile<'a> {
    tree: CallTree,
    _executables: RootVec<usize>,
    _vm: &'a Vm,
}

impl<'a> Profile<'a> {
    pub(super) fn new(vm: &'a Vm, tree: CallTree) -> Profile<'a> {
        let mut executables = root_vec();
        executables.extend(tree.nodes.iter().map(|node| node.executable));
        Profile {
            tree,
            _executables: executables,
            _vm: vm,
        }
    }

    pub(super) fn tree(&self) -> &CallTree {
        &self.tree
    }

    /// In the order in which they were taken.
    pub fn traces(&self) -> impl ExactSizeIterator<Item = Trace<'_>> {
        self.tree.traces()
    }
}

#[derive(Clone, Copy)]
pub struct Trace<'a> {
    /// On the clock of `monotonic_seconds`.
    pub timestamp: f64,
    pub innermost: SampledFrame<'a>,
}

impl<'a> Trace<'a> {
    /// Innermost first.
    pub fn frames(self) -> impl Iterator<Item = SampledFrame<'a>> {
        core::iter::successors(Some(self.innermost), |frame| frame.caller())
    }
}

#[derive(Clone, Copy)]
pub struct SampledFrame<'a> {
    tree: &'a CallTree,
    index: NodeIndex,
}

impl<'a> SampledFrame<'a> {
    fn node(self) -> &'a Node {
        &self.tree.nodes[self.index as usize]
    }

    /// The same for the same frame with the same callers. Counts from zero, and is above that of the caller.
    pub fn index(self) -> u32 {
        self.index
    }

    pub fn caller(self) -> Option<SampledFrame<'a>> {
        Some(self.tree.frame(self.node().caller?))
    }

    pub(super) fn inliner(self) -> Option<SampledFrame<'a>> {
        Some(self.tree.frame(self.node().inliner?))
    }

    pub(super) fn location(self) -> Location {
        self.node().location
    }

    pub fn kind(self) -> SampledFrameKind {
        self.node().kind
    }

    pub fn name(self) -> &'a StringRef {
        &self.node().name
    }

    pub fn executable(self) -> Option<Gc<Executable>> {
        let address = self.node().executable;
        // SAFETY: kept alive by whoever has the tree.
        (address != 0).then(|| unsafe { Gc::from_address(address) })
    }

    /// Where it was.
    pub fn position(self) -> Option<LineColumn> {
        match self.location() {
            Location::Script { instruction, .. } => Some(instruction?.1),
            Location::None | Location::Wasm(_) => None,
        }
    }

    /// The source, and the part of it that the code was made from.
    pub(super) fn source(self) -> Option<(SourceProviderRef, core::ops::Range<u32>)> {
        let executable = self.executable()?.downcast::<ScriptExecutable>()?;
        if let Some(function) = executable.downcast::<FunctionExecutable>() {
            let (provider, start) = (function.code_provider(), function.parameters_start());
            let end = match function.info().range().end {
                end if end > start => end,
                _ => provider.text().len() as u32,
            };
            return Some((provider, start..end));
        }
        let provider = executable.provider().clone();
        let range = (executable.downcast::<ProgramExecutable>())
            .map_or_else(|| 0..provider.text().len() as u32, |script| script.range());
        Some((provider, range))
    }

    pub fn source_provider(self) -> Option<SourceProviderRef> {
        Some(self.source()?.0)
    }

    pub(crate) fn source_id(self) -> usize {
        const NONE: usize = u32::MAX as usize;
        self.source_provider().map_or(NONE, |it| it.id())
    }

    /// Of a function, where the parameters start.
    pub fn start_of_code(self) -> Option<LineColumn> {
        let (provider, range) = self.source()?;
        Some(provider.position_in_document(range.start))
    }

    pub fn url(self) -> StringRef {
        let url = self.source_provider().and_then(|provider| {
            let url = provider.url().filter(|url| !url.is_empty()).cloned();
            url.or_else(|| provider.source_url_directive())
        });
        url.unwrap_or_default()
    }
}
