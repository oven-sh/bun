use std::mem::take;

use rustc_hash::{FxHashMap, FxHashSet};

use super::FileLowering;
use crate::builtins::id::BuiltinId;
use crate::diagnostic_codes::Code;
use crate::ir::generated::{BlockFrequency, BlockRole, ECMAMode, FunctionFlags, LimitId};
use crate::ir::{
    BlockId, DeclaredType, Edge, FunctionBuilder, FunctionId, FunctionKey, Handler, Type, TypeId,
    ValueId,
};
use crate::lower::captures;
use crate::lower::control::ControlState;
use crate::lower::convert::{self, Int32FlowDescription};
use crate::lower::generator::CoroutineState;
use crate::lower::scope::ScopeState;

pub(crate) struct FunctionLowering<'f, 'a, 'c, 'p, 's> {
    pub(crate) file: &'f mut FileLowering<'a, 'c, 'p, 's>,
    pub(crate) builder: FunctionBuilder,
    pub(crate) function: FunctionId,
    pub(crate) key: FunctionKey,
    pub(crate) returned: DeclaredType,
    pub(crate) scopes: ScopeState,
    pub(crate) control: ControlState,
    pub(crate) coroutine: CoroutineState,
    pub(in crate::lower) described_int32_flow: Option<Int32FlowDescription>,
    // The type of what a reference names, by the value that was read, where the checker's narrower type of the reference was not sent.
    pub(in crate::lower) unclaimed_narrowings: FxHashMap<ValueId, TypeId>,
    // The constants that stand for members of enums.
    pub(in crate::lower) enum_constants: FxHashSet<ValueId>,
    handler: Option<Handler>,
    position: u32,
    nesting_depth: u32,
    has_reported_nesting: bool,
}

impl<'f, 'a, 'c, 'p, 's> FunctionLowering<'f, 'a, 'c, 'p, 's> {
    pub(crate) fn begin(
        file: &'f mut FileLowering<'a, 'c, 'p, 's>,
        function: FunctionId,
    ) -> FunctionLowering<'f, 'a, 'c, 'p, 's> {
        let header = file.function_header(function).clone();
        let key = file.function_key(function);
        let position = header.position;
        let returned = header.results.first().copied();
        let builder = FunctionBuilder::new(header, take(&mut file.scratch));
        let mut lowering = FunctionLowering {
            file,
            builder,
            function,
            key,
            returned: returned.unwrap_or_else(DeclaredType::untyped),
            scopes: ScopeState::default(),
            control: ControlState::default(),
            coroutine: CoroutineState::default(),
            described_int32_flow: None,
            unclaimed_narrowings: FxHashMap::default(),
            enum_constants: FxHashSet::default(),
            handler: None,
            position,
            nesting_depth: 0,
            has_reported_nesting: false,
        };
        lowering.builder.set_position(Some(position));
        lowering.continue_in_new_block();
        captures::unpack_captures(&mut lowering);
        lowering
    }

    pub(crate) fn finish(self) {
        debug_assert!(self.handler.is_none(), "every handler was left");
        debug_assert_eq!(self.nesting_depth, 0, "every nesting level was left");
        let FunctionLowering {
            file,
            builder,
            function,
            ..
        } = self;
        let (finished, scratch) = builder.finish();
        file.scratch = scratch;
        file.fragment.define_function(function, finished);
    }

    pub(crate) fn set_position(&mut self, position: u32) {
        self.position = position;
        self.builder.set_position(Some(position));
    }

    pub(crate) fn position(&self) -> u32 {
        self.position
    }

    pub(crate) fn mode(&self) -> ECMAMode {
        let is_strict = match self.innermost_scope().some() {
            Some(innermost) => self.file.bound.is_strict_scope(innermost),
            None => !self
                .builder
                .function()
                .flags
                .contains(FunctionFlags::IS_SLOPPY),
        };
        if is_strict {
            ECMAMode::Strict
        } else {
            ECMAMode::Sloppy
        }
    }

    // Nothing tests an expected type here. A use that wants to rely on it has its own guard.
    pub(crate) fn expect_type(&mut self, value: ValueId, expected: TypeId) -> ValueId {
        convert::expect_type(self, value, expected)
    }

    pub(crate) fn expect_builtin(&mut self, value: ValueId, builtin: BuiltinId) -> ValueId {
        // The exports of a module are an object that its body makes, or whatever it puts in the place of that.
        let expected = if builtin == BuiltinId::ModuleObjectExports {
            let own_file = self.file.file;
            match self.file.module_exports_layout(own_file) {
                Some(layout) => Type::layout(layout),
                None => return value,
            }
        } else {
            Type::builtin(builtin)
        };
        let expected = self.file.fragment.types.intern(expected);
        self.expect_type(value, expected)
    }

    pub(crate) fn create_block(&mut self) -> BlockId {
        self.create_block_under(self.handler)
    }

    pub(crate) fn create_block_under(&mut self, handler: Option<Handler>) -> BlockId {
        self.builder.create_block(handler)
    }

    pub(crate) fn create_unlikely_block(&mut self) -> BlockId {
        let block = self.create_block();
        self.builder.set_frequency(block, BlockFrequency::Unlikely);
        block
    }

    pub(crate) fn jump(&mut self, block: BlockId) {
        self.builder.jump(Edge::to(block));
    }

    pub(crate) fn jump_with(&mut self, block: BlockId, arguments: &[ValueId]) {
        self.builder.jump(Edge::with_arguments(block, arguments));
    }

    pub(crate) fn continue_in(&mut self, block: BlockId) {
        self.builder.seal(block);
        self.builder.switch_to(block);
    }

    pub(crate) fn continue_in_new_block(&mut self) {
        let block = self.create_block();
        self.jump(block);
        self.continue_in(block);
    }

    pub(crate) fn begin_unreachable_block(&mut self) {
        debug_assert!(!self.builder.is_open(), "the block before it has ended");
        let block = self.create_block();
        self.continue_in(block);
    }

    pub(crate) fn handler(&self) -> Option<Handler> {
        self.handler
    }

    pub(crate) fn create_handler(&mut self, role: BlockRole, subject: Option<ValueId>) -> Handler {
        self.builder.create_handler(role, subject, self.handler)
    }

    pub(crate) fn enter_handler(&mut self, handler: Handler) -> Option<Handler> {
        let outer = self.handler.replace(handler);
        self.continue_in_new_block();
        outer
    }

    pub(crate) fn leave_handler(&mut self, outer: Option<Handler>) {
        self.handler = outer;
        self.continue_in_new_block();
    }

    pub(crate) fn enter_nesting(&mut self, position: u32) -> bool {
        if self.file.has_chain_past_nesting_limit {
            return false;
        }
        let maximum = self.file.inputs.limits.get(LimitId::MaxNestingDepth);
        if u64::from(self.nesting_depth) < maximum && !self.file.queries.is_stack_low() {
            self.nesting_depth += 1;
            return true;
        }
        if !self.has_reported_nesting {
            self.has_reported_nesting = true;
            self.file.gave_up(LimitId::MaxNestingDepth, position);
            let span = self.file.span_at(position);
            let depth = maximum.to_string();
            self.file
                .diagnostics
                .report(Code::NestedTooDeeply, span, &[depth.as_bytes()]);
        }
        false
    }

    pub(crate) fn leave_nesting(&mut self) {
        debug_assert!(self.nesting_depth > 0, "enter_nesting returned true");
        self.nesting_depth -= 1;
    }
}
