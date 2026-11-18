//! From the tree to a program.

mod boundary;
pub(crate) mod character;
mod distribute;
mod emit;
mod factor;
pub(crate) mod graph;
mod groups;
mod lower;
mod lower_repeat;
pub(crate) mod memory;

use bun_engine_text::Text;

use crate::Error;
use crate::analysis::decide_backtracking;
use crate::program::{Program, Verified, Width, verify};
use crate::tree::Tree;
use graph::Graph;
use memory::StackLimit;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mode {
    /// Finds where the match starts and ends.
    MatchOnly,
    Captures,
}

pub struct Options<'a> {
    pub width: Width,
    pub mode: Mode,
    /// A subject like those to come, or nothing.
    pub sample: Text<'a>,
    /// The lowest address that the native stack may reach.
    pub stack_limit: usize,
}

/// What a program does besides matching.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Purpose {
    Usual,
    /// Counts the turns of repeated groups.
    Counting,
    /// Does not go on from where it has been before.
    Memoizing,
}

/// Keeps its memory from one pattern to the next.
pub struct Compiler {
    graph: Graph,
    lowering: lower::Memory,
    emitting: emit::Memory,
    verifying: verify::Memory,
}

impl Default for Compiler {
    fn default() -> Compiler {
        Compiler {
            graph: Graph::new(),
            lowering: lower::Memory::new(),
            emitting: emit::Memory::new(),
            verifying: verify::Memory::new(),
        }
    }
}

impl Compiler {
    fn run(&mut self, purpose: Purpose, tree: &Tree, options: &Options<'_>) -> Result<(), Error> {
        let graph = &mut self.graph;
        let lowered = lower::lower(tree, options, purpose, graph, &mut self.lowering)?;
        decide_backtracking(graph, lowered.root, StackLimit(options.stack_limit))?;
        emit::emit(tree, graph, lowered, options, purpose, &mut self.emitting)?;
        debug_assert!(self.emitting.program().is_sound(&mut self.verifying));
        Ok(())
    }

    pub fn compile(&mut self, tree: &Tree, options: &Options<'_>) -> Result<Box<Program>, Error> {
        self.run(Purpose::Usual, tree, options)?;
        self.emitting.program().move_out()
    }

    /// For one that is not kept.
    pub fn compile_and_verify(
        &mut self,
        tree: &Tree,
        options: &Options<'_>,
    ) -> Option<Verified<'_>> {
        self.run(Purpose::Usual, tree, options).ok()?;
        self.emitting.program().verify_in(&mut self.verifying)
    }

    /// One of a purpose of its own, which the caller keeps.
    pub(crate) fn compile_for(
        &mut self,
        purpose: Purpose,
        tree: &Tree,
        options: &Options<'_>,
    ) -> Result<Box<Program>, Error> {
        self.run(purpose, tree, options)?;
        self.emitting.program().move_out()
    }

    /// Like [`Program::verify`].
    pub fn verify<'a>(&mut self, program: &'a Program) -> Option<Verified<'a>> {
        program.verify_in(&mut self.verifying)
    }

    /// Frees what a large pattern has left.
    pub fn trim(&mut self) {
        const NODES_KEPT: usize = 256;
        const BYTES_OF_PROGRAM_KEPT: usize = 1 << 13;
        if self.graph.capacity() > NODES_KEPT
            || self.emitting.program().size() > BYTES_OF_PROGRAM_KEPT
        {
            *self = Compiler::default();
        }
    }
}

pub fn compile(tree: &Tree, options: &Options<'_>) -> Result<Program, Error> {
    compile_for(Purpose::Usual, tree, options)
}

pub(crate) fn compile_for(
    purpose: Purpose,
    tree: &Tree,
    options: &Options<'_>,
) -> Result<Program, Error> {
    let mut compiler = Compiler::default();
    compiler.run(purpose, tree, options)?;
    Ok(compiler.emitting.into_program())
}
