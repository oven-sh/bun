use bun_engine_bytecode::{
    CodeFlags, CodeKind, DebugHook, EvalContext, FunctionKind, Opcode, RawInstruction, ScopeKind,
};
use bun_engine_text::StringRef;

use crate::{
    CallFrame, CellType, CodeBlock, Coroutine, Cx, Environment, EvalExecutable, FunctionExecutable,
    Gc, JsCell, JsFunction, JsObject, JsResult, RootVec, StackVisitor, Value, VisitedFrame,
    root_vec,
};

/// What a frame had when it was looked at.
#[derive(Clone, Copy)]
pub struct DebuggerFrame {
    /// Of the frame on the machine. Zero if there is none.
    pub address: usize,
    pub callee: Option<Gc<JsObject>>,
    pub code_block: Option<Gc<CodeBlock>>,
    pub bytecode_offset: u32,
    pub is_tail_deleted: bool,
    scope: Gc<JsCell>,
    this: This,
}

#[derive(Clone, Copy)]
enum This {
    /// In the nearest scope that has a slot for it.
    InScope,
    /// The scopes are those around the code, without its own. Undefined if there is no telling, `None` if unbound.
    Known(Option<Value>),
    /// The function around the code has not kept it.
    Lost,
}

impl CodeBlock {
    pub fn has_debug_hooks(&self) -> bool {
        self.body().flags().contains(CodeFlags::HAS_DEBUG_HOOKS)
    }

    /// Whether the instruction is a call in tail position that leaves the frame in place.
    pub(crate) fn keeps_frame_at(&self, bytecode_offset: u32) -> bool {
        const BOTH: CodeFlags = CodeFlags::HAS_DEBUG_HOOKS.union(CodeFlags::HAS_TAIL_CALLS);
        if !self.body().flags().contains(BOTH) {
            return false;
        }
        let bytes = self.body().instructions();
        let next = RawInstruction::read(bytes, bytecode_offset)
            .and_then(|call| RawInstruction::read(bytes, bytecode_offset + u32::from(call.size)));
        next.is_some_and(|it| {
            it.opcode == Opcode::Debug && it.words() == [DebugHook::DidReturnFromTailCall as u32]
        })
    }

    fn function_kind(&self) -> Option<FunctionKind> {
        let function = self.executable().downcast::<FunctionExecutable>()?;
        Some(function.info().kind())
    }

    fn eval_context(&self) -> EvalContext {
        let executable = self.executable();
        if let Some(function) = executable.downcast::<FunctionExecutable>() {
            return function.info().eval_context();
        }
        let eval = executable.downcast::<EvalExecutable>();
        let mut context = eval.map_or_default(|it| it.unit().context);
        let is_strict = self.body().flags().contains(CodeFlags::STRICT);
        context.set(EvalContext::STRICT, is_strict);
        context
    }
}

impl CallFrame {
    /// Of a frame that has called another.
    pub(super) fn is_kept_for_debugger(&self) -> bool {
        (self.code_block()).is_some_and(|it| {
            !it.is_optimized() && it.keeps_frame_at(it.bytecode_offset_of(self.call_site()))
        })
    }
}

impl DebuggerFrame {
    /// `first` and its callers, but for WebAssembly code.
    pub fn stack_from(cx: &Cx, first: usize) -> RootVec<DebuggerFrame> {
        let mut frames = root_vec();
        frames.extend(
            StackVisitor::frames_for_debugger(cx)
                .filter(|it| it.machine_frame.address() >= first)
                .filter_map(|it| Self::of(cx, &it)),
        );
        if let Some(innermost) = frames.first_mut() {
            innermost.is_tail_deleted = false;
        }
        frames
    }

    /// Stands in where no script is running.
    pub fn outside_of_code(cx: &Cx) -> DebuggerFrame {
        DebuggerFrame {
            address: 0,
            callee: None,
            code_block: None,
            bytecode_offset: 0,
            is_tail_deleted: false,
            scope: cx.global().cell(),
            this: This::Known(Some(cx.global_this().into())),
        }
    }

    fn of(cx: &Cx, visited: &VisitedFrame<'_>) -> Option<DebuggerFrame> {
        let callee = visited.callee?;
        let machine_frame = visited.machine_frame;
        let mut frame = DebuggerFrame {
            address: machine_frame.address(),
            callee: Some(callee),
            code_block: visited.code_block,
            bytecode_offset: visited.bytecode_offset,
            is_tail_deleted: false,
            scope: callee.realm().unwrap_or_else(|| cx.global()).cell(),
            this: This::Known(Some(Value::UNDEFINED)),
        };
        let Some(code_block) = visited.code_block else {
            if machine_frame.code_block().is_none() {
                frame.this = This::Known(Some(machine_frame.this_value()));
            }
            return Some(frame);
        };
        let offset = visited.bytecode_offset;
        let is_interpretable = (machine_frame.code_block()).is_some_and(|it| !it.is_optimized());
        let register = (code_block.body().scope_register_at(offset)).filter(|_| is_interpretable);
        // SAFETY: code that is not optimized has it there, and what has a code block is one of these.
        frame.scope = unsafe {
            match register {
                Some(register) => {
                    Gc::from_address(machine_frame.slot(register.offset() as isize).get() as usize)
                }
                None => JsFunction::scope_of(callee.cell()),
            }
        };
        frame.is_tail_deleted = code_block.keeps_frame_at(offset);
        let inherits_this = match code_block.body().kind() {
            CodeKind::Eval | CodeKind::Module => true,
            _ => code_block.function_kind() == Some(FunctionKind::Arrow),
        };
        if (code_block.eval_context()).contains(EvalContext::LACKS_THIS) {
            frame.this = This::Lost;
        } else if register.is_some() || inherits_this {
            frame.this = This::InScope;
        } else if visited.inline_frame.is_none()
            && Coroutine::of_frame(machine_frame).is_none()
            && code_block.opcode_at(offset) != Some(Opcode::CreateThis)
            && (is_interpretable || code_block.body().kind() != CodeKind::Construct)
        {
            frame.this = This::Known(machine_frame.this_value_or_empty());
        }
        Some(frame)
    }

    /// The innermost: an `Environment`, or the global object.
    pub fn scope(&self) -> Gc<JsCell> {
        self.scope
    }

    fn environments(&self) -> impl Iterator<Item = Gc<Environment>> + use<> {
        let first = self.scope.downcast::<Environment>();
        first.into_iter().flat_map(|first| first.chain())
    }

    pub fn this_value(&self, cx: &Cx) -> Value {
        let this = match self.this {
            This::Known(this) => this.unwrap_or_default(),
            This::InScope => return self.this_in_scope(),
            This::Lost => Value::UNDEFINED,
        };
        let is_strict = |it: Gc<CodeBlock>| it.body().flags().contains(CodeFlags::STRICT);
        if self.code_block.is_some_and(is_strict) {
            return this;
        }
        let realm = crate::scope::realm_of_scope(self.scope);
        this.to_sloppy_this(cx.in_realm_shared(realm)).into()
    }

    fn this_in_scope(&self) -> Value {
        for environment in self.environments() {
            if let Some(slot) = environment.template().scope().this_slot() {
                return environment.get(slot).unwrap_or_default();
            }
            if environment.template().scope().kind() == ScopeKind::Module {
                return Value::UNDEFINED;
            }
        }
        crate::scope::realm_of_scope(self.scope)
            .global_this()
            .into()
    }

    /// Whether the code sees the lexical bindings of the global scope.
    pub fn sees_global_lexicals(&self) -> bool {
        let function = self
            .callee
            .filter(|it| it.cell_type() == CellType::Function);
        !function.is_some_and(|it| it.cast::<JsFunction>().is_native_or_builtin())
    }

    /// As a direct `eval` would. Undefined if the frame has no code.
    pub fn evaluate(&self, cx: &mut Cx, text: StringRef) -> JsResult<Value> {
        let Some(code_block) = self.code_block else {
            return Ok(Value::UNDEFINED);
        };
        let cx = cx.in_realm(code_block.global());
        for environment in self.environments() {
            (environment.template().foreign_write_watchpoints()).invalidate(cx);
        }
        let mut context = code_block.eval_context() | EvalContext::BY_DEBUGGER;
        if let This::Known(_) = self.this {
            context -= EvalContext::IN_FUNCTION | EvalContext::IN_METHOD;
        }
        let with_this = |this| Environment::create_for_this(cx, self.scope, this).cell();
        let scope = match self.this {
            This::InScope => self.scope,
            This::Known(None) if context.contains(EvalContext::IN_DERIVED_CONSTRUCTOR) => {
                with_this(None)
            }
            This::Known(_) | This::Lost => with_this(Some(self.this_value(cx))),
        };
        context -= EvalContext::LACKS_THIS;
        let origin = code_block.executable().provider().clone();
        crate::code::evaluate_in_scope(cx, text, &origin, scope, context)
    }
}
