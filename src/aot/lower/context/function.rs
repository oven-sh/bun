use rustc_hash::FxHashMap;

use super::FileLowering;
use crate::builtins::id::BuiltinId;
use crate::diagnostic_codes::Code;
use crate::ir::generated::{BlockFrequency, BlockRole, ECMAMode, FunctionFlags};
use crate::ir::{
    BlockId, DeclaredType, Edge, FunctionBuilder, FunctionId, FunctionKey, Handler, Type, TypeId,
    ValueId,
};
use crate::lower::appended_pieces::AppendedPiece;
use crate::lower::captures;
use crate::lower::class::Birth;
use crate::lower::control::ControlState;
use crate::lower::convert;
use crate::lower::generator::CoroutineState;
use crate::lower::object::ListsInside;
use crate::lower::scope::ScopeState;
use crate::lower::self_tail_calls::SelfTailLoop;
use crate::lower::super_calls::CheckOfClass;

/// The `require` of a site that a call of createRequire made. It requires the module, not the module object of the file.
#[derive(Clone, Copy)]
pub(in crate::lower) enum CreatedRequire {
    Variable(bun_sema::hir::ExprId),
    /// The callee makes it. `Value` as soon as the callee is evaluated.
    Callee,
    Value(ValueId),
}

pub(crate) struct FunctionLowering<'f, 'a, 'c, 'p, 's> {
    pub(crate) file: &'f mut FileLowering<'a, 'c, 'p, 's>,
    pub(crate) builder: FunctionBuilder,
    pub(crate) function: FunctionId,
    pub(crate) key: FunctionKey,
    pub(crate) returned: DeclaredType,
    pub(crate) scopes: ScopeState,
    pub(crate) control: ControlState,
    pub(crate) coroutine: CoroutineState,
    pub(in crate::lower) callees_read_on_answers: FxHashMap<ValueId, ValueId>,
    pub(in crate::lower) is_call_in_tail_position: bool,
    pub(in crate::lower) object_created_for_maker: Option<bun_sema::hir::ExprId>,
    pub(in crate::lower) names_that_maker_stores_under: Vec<bun_sema::atom::Atom>,
    pub(in crate::lower) only_argument_of_construction: Option<bun_sema::hir::ExprId>,
    pub(in crate::lower) lists_inside_literals:
        std::cell::RefCell<FxHashMap<bun_sema::hir::ExprId, ListsInside>>,
    pub(in crate::lower) birth: Option<Birth>,
    pub(in crate::lower) statements_lowered_at_super_call:
        smallvec::SmallVec<[bun_sema::hir::StmtId; 8]>,
    pub(in crate::lower) counted_expression: Option<u32>,
    pub(in crate::lower) does_file_name_library_modules: Option<bool>,
    pub(in crate::lower) created_require_of_site: Option<CreatedRequire>,
    pub(in crate::lower) destructured_position: Option<u32>,
    pub(in crate::lower) step_before_test: Option<bun_sema::hir::ExprId>,
    /// From the outermost on.
    pub(in crate::lower) loose_loops: Vec<crate::lower::statement::LooseLoop>,
    pub(in crate::lower) self_tail_loop: Option<SelfTailLoop>,
    pub(in crate::lower) suspending_arm: Option<super::super::statement::SuspendingArm>,
    pub(in crate::lower) check_of_class: Option<CheckOfClass>,
    /// Variables declared by `var type = typeof value` in the statement lists around the current statement, and before it.
    pub(in crate::lower) typeof_variables: smallvec::SmallVec<[bun_sema::bind::SymbolId; 4]>,
    pub(in crate::lower) appended_pieces: smallvec::SmallVec<[AppendedPiece; 1]>,
    handler: Option<Handler>,
    position: u32,
    nesting_depth: u32,
    has_reported_nesting: bool,
}

impl<'f, 'a, 'c, 'p, 's> FunctionLowering<'f, 'a, 'c, 'p, 's> {
    #[inline(always)]
    pub(crate) fn begin(
        file: &'f mut FileLowering<'a, 'c, 'p, 's>,
        function: FunctionId,
    ) -> FunctionLowering<'f, 'a, 'c, 'p, 's> {
        let header = file.function_header(function).clone();
        let key = file.function_key(function);
        let position = header.position;
        let returned = header.results.first().copied();
        let scratch = file.task.scratch.take().unwrap_or_default();
        let builder = FunctionBuilder::new(header, scratch);
        let mut lowering = FunctionLowering {
            file,
            builder,
            function,
            key,
            returned: returned.unwrap_or_else(DeclaredType::untyped),
            scopes: ScopeState::default(),
            control: ControlState::default(),
            coroutine: CoroutineState::default(),
            callees_read_on_answers: FxHashMap::default(),
            is_call_in_tail_position: false,
            object_created_for_maker: None,
            names_that_maker_stores_under: Vec::new(),
            only_argument_of_construction: None,
            lists_inside_literals: Default::default(),
            birth: None,
            statements_lowered_at_super_call: smallvec::SmallVec::new(),
            counted_expression: None,
            does_file_name_library_modules: None,
            created_require_of_site: None,
            destructured_position: None,
            step_before_test: None,
            loose_loops: Vec::new(),
            self_tail_loop: None,
            suspending_arm: None,
            check_of_class: None,
            typeof_variables: smallvec::SmallVec::new(),
            appended_pieces: smallvec::SmallVec::new(),
            handler: None,
            position,
            nesting_depth: 0,
            has_reported_nesting: false,
        };
        lowering.builder.set_position(Some(position));
        captures::unpack_captures(&mut lowering);
        lowering
    }

    #[inline(always)]
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
        file.task.scratch = Some(scratch);
        file.fragment.define_function(function, finished);
    }

    #[inline]
    pub(crate) fn set_position(&mut self, position: u32) {
        let position = self.file.hir.written_position(position);
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

    pub(crate) fn expect_type(&mut self, value: ValueId, expected: TypeId) -> ValueId {
        convert::expect_type(self, value, expected)
    }

    pub(crate) fn expect_builtin(&mut self, value: ValueId, builtin: BuiltinId) -> ValueId {
        let expected = if builtin == BuiltinId::ModuleObjectExports {
            let own_file = self.file.file;
            match self.file.module_exports_layout(own_file) {
                Some(layout) => Type::layout(layout),
                None => return value,
            }
        } else {
            match Type::value_of_builtin(builtin) {
                Some(expected) => expected,
                None => return value,
            }
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

    #[inline]
    pub(crate) fn enter_nesting(&mut self, position: u32) -> bool {
        if !self.file.queries.is_stack_low() && bun_core::StackCheck::init().is_safe_to_recurse() {
            self.nesting_depth += 1;
            return true;
        }
        self.refuse_nesting(position)
    }

    #[cold]
    #[inline(never)]
    fn refuse_nesting(&mut self, position: u32) -> bool {
        if !self.has_reported_nesting {
            self.has_reported_nesting = true;
            self.file.queries.answer_nothing_from_now_on();
            let span = self.file.span_at(position);
            let depth = self.nesting_depth.to_string();
            self.file
                .diagnostics
                .report(Code::NestedTooDeeply, span, &[depth.as_bytes()]);
        }
        false
    }

    #[inline]
    pub(crate) fn leave_nesting(&mut self) {
        debug_assert!(self.nesting_depth > 0, "enter_nesting returned true");
        self.nesting_depth -= 1;
    }
}
