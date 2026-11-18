//! Exceptions.

use bun_engine_bytecode::op;
use bun_engine_codegen::ir::Value as Ssa;

use super::Builder;
use crate::graph::Kind;

impl Builder<'_> {
    pub(super) fn throw(&mut self, value: Ssa) {
        let value = self.graph.root(value);
        self.node(Kind::Throw, &[value], 0);
        self.end_block();
    }

    pub(super) fn generator_throw(&mut self, op: op::GeneratorThrow) {
        let (generator, exception) = (self.get(op.generator), self.get(op.exception));
        self.complete(generator);
        self.throw(exception);
    }
}
