//! A function on its way through the compiler.

use core::cell::Cell;
use std::rc::Rc;
use std::sync::Arc;

use bun_engine_codegen::ir::Function;
use bun_engine_codegen::passes::{Analyses, Level};
use bun_engine_exec_memory::{Priority, link};
use bun_engine_platform::{clock, log};
use bun_engine_vm::{
    CodeBlock, Gc, InlineWatchpointSet, JsCell, Strong, Tier, Vm, Watcher, Watchpoint,
    counting_compile_time, options,
};

use bun_threading::Guarded;

use super::cells::Dependencies;
use super::code::Compiled;
use super::tiering::{give_up_on, name_of};
use super::{Thunks, probes, queue};
use crate::builder::{self, Built, Refusal, Running};
use crate::graph::{Assumption, Entry, FrameIndex, Graph, Knowledge};
use crate::lower::output::Output;
use crate::{lower, passes};

/// Keeps its memory from one function to the next.
#[derive(Default)]
pub(super) struct Compiler {
    analyses: Analyses,
    knowledge: Knowledge,
    lower: lower::Compiler,
}

impl Compiler {
    fn compile(&mut self, mut graph: Graph, records_origins: bool) -> Built<Output> {
        let thunks = Thunks::get().ok_or(Refusal::Unsupported)?;
        let observe = |pass: &str, function: &Function| {
            if options().dump_graphs {
                log(format_args!("after {pass}:\n{function:?}\n"));
            }
        };
        passes::optimize(&mut graph, &mut self.analyses, &mut self.knowledge, observe)?;
        (self.lower).compile(graph, thunks, records_origins, observe)
    }
}

pub(super) struct Plan {
    pub(super) code_block: Strong<Gc<CodeBlock>>,
    pub(super) level: Level,
    pub(super) entry: Entry,
    #[cfg_attr(rootcheck, rootcheck::allow("roots wherever they are"))]
    dependencies: Dependencies,
    output: Arc<Guarded<Option<Built<Output>>>>,
}

pub(super) fn tier_of(level: Level) -> Tier {
    match level {
        Level::Quick => Tier::QuickOptimized,
        Level::Full => Tier::FullyOptimized,
    }
}

struct Jettison;

impl Watcher for Jettison {
    fn fire(&self, vm: &Vm, owner: Gc<JsCell>, _: &Watchpoint) {
        give_up_on(vm, &owner.cast::<CodeBlock>(), "an assumption has failed");
    }
}

impl Plan {
    /// `here` is for compiling on this thread.
    pub(super) fn start(
        vm: &Vm,
        code_block: Gc<CodeBlock>,
        (level, entry): (Level, Entry),
        running: &Running<'_>,
        seed: u32,
        here: Option<&mut Compiler>,
    ) -> Built<Plan> {
        let started = clock::monotonic_seconds();
        let (graph, dependencies) =
            counting_compile_time(|| builder::build(vm, code_block, level, entry, running, seed))?;
        let built = clock::monotonic_seconds() - started;
        let is_reported = match level {
            Level::Quick => options().report_quick_compile_times,
            Level::Full => options().report_full_compile_times,
        };
        let name = is_reported.then(|| name_of(&code_block));
        let (records_origins, output) = (
            vm.records_code_origins().get(),
            Arc::new(Guarded::new(None)),
        );
        let result = Arc::clone(&output);
        let job = move |compiler: &mut Compiler| {
            let (started, values) = (clock::monotonic_seconds(), graph.function.value_count());
            let output = counting_compile_time(|| compiler.compile(graph, records_origins));
            if let (Some(name), Ok(output)) = (name, &output) {
                log(format_args!(
                    "Optimized {name} {level:?} {entry:?}: {values} values, {} bytes, {:.3} + {:.3} ms\n",
                    output.code.bytes().len(),
                    built * 1e3,
                    (clock::monotonic_seconds() - started) * 1e3,
                ));
            }
            *result.lock() = Some(output);
        };
        match here {
            Some(compiler) => job(compiler),
            None => queue::schedule(level, Box::new(job)),
        }
        Ok(Plan {
            code_block: Strong::new(vm, code_block),
            level,
            entry,
            dependencies,
            output,
        })
    }

    pub(super) fn is_done(&self) -> bool {
        self.output.lock().is_some()
    }

    fn for_each_assumed(
        &self,
        vm: &Vm,
        output: &Output,
        mut visit: impl FnMut(&InlineWatchpointSet),
    ) {
        for &assumption in &output.assumptions {
            match assumption {
                Assumption::Stable(shape) => {
                    visit(self.dependencies.shapes[shape.0 as usize].transition_watchpoints());
                }
                Assumption::Realm(address, which) => {
                    let mut realms = self.dependencies.realms.iter();
                    let realm = realms.find(|it| it.address() == address);
                    visit(realm.expect("of the graph").watchpoints(vm, which));
                }
            }
        }
    }

    /// For a plan that is done. `None` if the world has changed meanwhile.
    pub(super) fn finish(self, vm: &Vm) -> Built<Option<Gc<CodeBlock>>> {
        let output = self.output.lock().take().expect("done")?;
        let _defer = vm.heap.defer_collection();
        let dependencies = &self.dependencies;
        let mut holds = (dependencies.watchpoints.iter()).all(|set| set.is_still_valid());
        self.for_each_assumed(vm, &output, |set| holds &= set.is_still_valid());
        if !holds {
            return Ok(None);
        }
        let handle =
            link(&output.code, Priority::Optional, |_| 0).map_err(|_| Refusal::TooLarge)?;
        let (code_block, tier) = (self.code_block.get(vm), tier_of(self.level));
        handle.describe(|| format!("{:?} {}", self.level, name_of(&code_block)));
        if options().dump_disassembly {
            let (name, start) = (name_of(&code_block), handle.start());
            // SAFETY: just linked.
            let code = unsafe { core::slice::from_raw_parts(start as *const u8, handle.len()) };
            log(format_args!("code of {name} at {start:#x}: {code:02x?}\n"));
        }
        let replacement = code_block.create_replacement(vm, tier);
        // SAFETY: the code block owns the code, which owns the watchpoint.
        let watchpoint = unsafe { Watchpoint::new(&replacement, Jettison) };
        (dependencies.watchpoints.iter()).for_each(|set| set.add(&watchpoint));
        self.for_each_assumed(vm, &output, |set| set.add(&watchpoint));
        let named = (dependencies.shapes.iter().map(|shape| shape.address()))
            .chain(dependencies.weak.iter().map(|cell| cell.address()));
        let compiled = Compiled {
            entry: handle.address(output.entry),
            tables: output.tables,
            handle,
            kind: self.entry,
            kept: dependencies.strong.iter().map(|it| it.address()).collect(),
            named: named.collect(),
            shape_count: dependencies.shapes.len(),
            has_lost_named: Cell::new(false),
            exits_taken: Cell::new(0),
            _names: dependencies.names.as_slice().into(),
            _watchpoint: watchpoint,
        };
        probes::did_install(vm, &compiled);
        if compiled.tables.writes_profiles {
            // This code may not live to see to them.
            let frames = (0..compiled.tables.frames.len() as u32).map(FrameIndex);
            frames.for_each(|it| compiled.code_block_of(it).write_barrier_for_cell());
        }
        let entry = compiled.entry;
        // SAFETY: made by the plan for this code.
        unsafe { replacement.set_compiled(tier, Rc::new(compiled), entry) };
        Ok(Some(replacement))
    }
}
