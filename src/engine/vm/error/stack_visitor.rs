use std::rc::Rc;

use bun_engine_bytecode::{CodeFlags, CodeKind, HandlerKind, Opcode, RawInstruction, Visibility};

use crate::{
    CallFrame, CellType, CodeBlock, CodeOrigin, CompiledCode, Cx, EntryRecord, Gc, JsCell,
    JsFunction, JsObject, LineColumn, RealmSlot, Value, ValueVec, Vm,
};

/// What a frame of WebAssembly code runs.
#[derive(Clone, Copy)]
pub struct WasmFrame {
    /// What `Hooks::wasm_names` finds the names in.
    pub names: Option<Gc<JsCell>>,
    pub function_index: u32,
    pub visibility: Visibility,
    /// `None` for a stub.
    pub tier: Option<WasmTier>,
    /// The function that has inlined this one comes next.
    pub is_inlined: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum WasmTier {
    Interpreter,
    Baseline,
    Optimized,
    OptimizedForLoopEntry,
    StubFromScript,
    StubToScript,
}

/// What a profiler has seen WebAssembly code run.
pub struct SampledWasmFrame {
    pub name: bun_engine_text::StringRef,
    pub tier: WasmTier,
}

impl SampledWasmFrame {
    pub fn stub(tier: WasmTier) -> SampledWasmFrame {
        let name = bun_engine_text::StringRef::from_literal("wasm-stub");
        SampledWasmFrame { name, tier }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum FrameKind {
    Script,
    Eval,
    Function,
    Module,
    Native,
    Wasm,
}

/// A frame as the script sees it: a call that was inlined has one too, and so has a direct `eval`.
#[derive(Clone, Copy)]
pub struct VisitedFrame<'a> {
    pub machine_frame: &'a CallFrame,
    /// Where native code last called into generated code on the way to this frame.
    pub entry_frame: usize,
    /// The baseline one. `None` for native code.
    pub code_block: Option<Gc<CodeBlock>>,
    pub bytecode_offset: u32,
    pub inline_frame: Option<u32>,
    /// `None` for WebAssembly code.
    pub callee: Option<Gc<JsObject>>,
    pub wasm: Option<WasmFrame>,
    /// Into the code of a frame of WebAssembly.
    return_address: usize,
}

impl VisitedFrame<'_> {
    /// False for a frame of a script.
    pub fn catches_in_wasm(&self, vm: &Vm, thrown: Value) -> bool {
        self.wasm.is_some()
            && (vm.hooks().wasm_frame_catches)(self.machine_frame, self.return_address, thrown)
    }

    pub fn kind(&self) -> FrameKind {
        match self.code_block.map(|it| it.body().kind()) {
            Some(CodeKind::Script) => FrameKind::Script,
            Some(CodeKind::Eval) => FrameKind::Eval,
            Some(CodeKind::Module) => FrameKind::Module,
            Some(CodeKind::Call | CodeKind::Construct) => FrameKind::Function,
            None if self.wasm.is_some() => FrameKind::Wasm,
            None => FrameKind::Native,
        }
    }

    #[inline]
    pub fn visibility(&self) -> Visibility {
        if let Some(code_block) = self.code_block {
            return code_block.executable().visibility();
        }
        if let Some(wasm) = self.wasm {
            return wasm.visibility;
        }
        let function = self.callee.and_then(Gc::downcast::<JsFunction>);
        function.map_or(Visibility::Public, |it| it.executable().visibility())
    }

    /// Whether stack traces leave it out.
    #[inline]
    pub fn is_private(&self) -> bool {
        self.visibility() != Visibility::Public
            && !crate::options().show_private_scripts_in_stack_traces
    }

    pub fn line_column(&self) -> Option<LineColumn> {
        Some(self.code_block?.line_column(self.bytecode_offset))
    }

    /// What the function was called with, or has since stored in its parameters. Without `this`.
    pub fn copy_arguments(&self, out: &mut ValueVec) {
        let compiled = self.machine_frame.code_block().and_then(|it| it.compiled());
        if self.inline_frame.is_none() {
            (self.machine_frame.arguments().iter()).for_each(|&argument| out.push(argument));
        }
        if let Some(compiled) = compiled {
            // SAFETY: the visitor has the index from the call site of the frame.
            unsafe { compiled.current_arguments(self.machine_frame, self.inline_frame, out) };
        }
    }
}

enum Next {
    /// Nothing of the machine frame has been visited.
    First,
    Origin(CodeOrigin),
    WasmInliner(u32),
}

pub struct StackVisitor<'a> {
    vm: &'a Vm,
    frame: Option<&'a CallFrame>,
    entry_frame: usize,
    /// Into the code of `frame`. Zero if that has called an operation, which has no frame.
    return_address: usize,
    next: Next,
    compiled: Option<Rc<dyn CompiledCode>>,
    visits_tail_deleted_frames: bool,
}

impl<'a> StackVisitor<'a> {
    /// Innermost first.
    #[inline]
    pub fn frames(vm: &'a Vm) -> StackVisitor<'a> {
        StackVisitor {
            vm,
            frame: vm.top_call_frame(),
            entry_frame: vm.top_entry_frame(),
            return_address: 0,
            next: Next::First,
            compiled: None,
            visits_tail_deleted_frames: false,
        }
    }

    /// With those that a tail call would have removed.
    pub(crate) fn frames_for_debugger(vm: &'a Vm) -> StackVisitor<'a> {
        StackVisitor {
            visits_tail_deleted_frames: true,
            ..Self::frames(vm)
        }
    }

    /// Without those that `first` has called.
    pub fn frames_from(vm: &'a Vm, first: *const CallFrame) -> StackVisitor<'a> {
        let mut visitor = Self::frames(vm);
        while visitor.frame.is_some_and(|it| !core::ptr::eq(it, first)) {
            visitor.leave_machine_frame();
        }
        visitor
    }

    #[inline(always)]
    fn leave_machine_frame(&mut self) {
        let Some(frame) = self.frame else { return };
        let mut caller = frame.caller_address();
        self.return_address = frame.return_address();
        if caller == self.entry_frame {
            // SAFETY: further up the stack.
            let record = unsafe { EntryRecord::of(caller) };
            caller = record.previous_top_call_frame;
            self.entry_frame = record.previous_top_entry_frame;
            self.return_address = 0;
        }
        // SAFETY: as above.
        self.frame = (caller != 0).then(|| unsafe { CallFrame::from_address(caller) });
        self.next = Next::First;
    }

    #[cold]
    fn visit_wasm(&mut self, frame: &'a CallFrame) -> VisitedFrame<'a> {
        let depth = match self.next {
            Next::WasmInliner(depth) => depth,
            _ => 0,
        };
        let wasm = (self.vm.hooks().wasm_frame)(self.vm, frame, self.return_address, depth);
        let (entry_frame, return_address) = (self.entry_frame, self.return_address);
        if wasm.is_inlined {
            self.next = Next::WasmInliner(depth + 1);
        } else {
            self.leave_machine_frame();
        }
        VisitedFrame {
            machine_frame: frame,
            entry_frame,
            code_block: None,
            bytecode_offset: 0,
            inline_frame: None,
            callee: None,
            wasm: Some(wasm),
            return_address,
        }
    }

    /// `root` is that of the machine frame.
    #[inline]
    fn code_block_at(&self, origin: CodeOrigin, root: Gc<CodeBlock>) -> Gc<CodeBlock> {
        match (&self.compiled, origin.inline_frame) {
            (Some(compiled), Some(index)) => compiled.inline_frame(self.vm, index).code_block,
            _ => root,
        }
    }

    #[inline(never)]
    fn visit_inlined(
        &mut self,
        frame: &'a CallFrame,
        bytecode_offset: u32,
        index: u32,
    ) -> VisitedFrame<'a> {
        let compiled = self.compiled.as_deref().expect("only it inlines");
        let mut inlined = compiled.inline_frame(self.vm, index);
        let visited = VisitedFrame {
            machine_frame: frame,
            entry_frame: self.entry_frame,
            code_block: Some(inlined.code_block),
            bytecode_offset,
            inline_frame: Some(index),
            // SAFETY: the origin is that of the call site of the frame.
            callee: unsafe { compiled.inline_callee(frame, index) }.as_object(),
            wasm: None,
            return_address: 0,
        };
        while inlined.is_tail_call {
            let Some(caller) = inlined.caller.inline_frame else {
                self.leave_machine_frame();
                return visited;
            };
            inlined = compiled.inline_frame(self.vm, caller);
        }
        self.next = Next::Origin(inlined.caller);
        visited
    }
}

/// Of a frame without a code block: its code is being linked, or has found no room on the stack.
#[inline]
fn has_not_begun(callee: Gc<JsObject>) -> bool {
    match callee.downcast::<JsFunction>() {
        Some(function) => !function.is_native(),
        None => callee.cell_type() == CellType::Callee,
    }
}

impl<'a> Iterator for StackVisitor<'a> {
    type Item = VisitedFrame<'a>;

    #[inline]
    fn next(&mut self) -> Option<VisitedFrame<'a>> {
        loop {
            let frame = self.frame?;
            if frame.has_native_callee() {
                return Some(self.visit_wasm(frame));
            }
            let mut visited = VisitedFrame {
                machine_frame: frame,
                entry_frame: self.entry_frame,
                code_block: None,
                bytecode_offset: 0,
                inline_frame: None,
                callee: Some(frame.callee()),
                wasm: None,
                return_address: 0,
            };
            let Some(code_block) = frame.code_block() else {
                self.leave_machine_frame();
                if has_not_begun(frame.callee()) {
                    continue;
                }
                return Some(visited);
            };
            let origin = match self.next {
                Next::Origin(origin) => origin,
                _ => {
                    self.compiled = code_block.compiled_if_optimized();
                    let origin = match &self.compiled {
                        Some(compiled) => compiled.origin_of_call_site(frame.call_site()),
                        None => CodeOrigin {
                            bytecode_offset: code_block.bytecode_offset_of(frame.call_site()),
                            inline_frame: None,
                        },
                    };
                    if self.return_address == 0
                        && let innermost = self.code_block_at(origin, code_block)
                        && innermost.opcode_at(origin.bytecode_offset) == Some(Opcode::DirectEval)
                        && let Some(eval) =
                            (innermost.global()).slot_if_initialized(RealmSlot::eval_function)
                    {
                        self.next = Next::Origin(origin);
                        visited.callee = eval.as_object();
                        return Some(visited);
                    }
                    origin
                }
            };
            if let Some(index) = origin.inline_frame {
                return Some(self.visit_inlined(frame, origin.bytecode_offset, index));
            }
            let has_called = self.return_address != 0;
            self.leave_machine_frame();
            if ((has_called && code_block.keeps_frame_at(origin.bytecode_offset))
                || code_block.has_left_body_at(origin.bytecode_offset))
                && !self.visits_tail_deleted_frames
            {
                continue;
            }
            visited.code_block = Some(code_block.baseline());
            visited.bytecode_offset = origin.bytecode_offset;
            return Some(visited);
        }
    }
}

impl CodeBlock {
    /// What an `await` or the last step of code that awaits calls, it calls on behalf of the promise.
    #[inline(always)]
    fn has_left_body_at(&self, bytecode_offset: u32) -> bool {
        self.body().flags().contains(CodeFlags::SUSPENDS)
            && matches!(
                self.opcode_at(bytecode_offset),
                Some(Opcode::Await | Opcode::AsyncReturn)
            )
    }

    #[inline(always)]
    fn compiled_if_optimized(&self) -> Option<Rc<dyn CompiledCode>> {
        if self.is_optimized() {
            self.compiled()
        } else {
            None
        }
    }

    pub fn opcode_at(&self, bytecode_offset: u32) -> Option<Opcode> {
        let bytes = self.body().instructions();
        match Opcode::from_byte(*bytes.get(bytecode_offset as usize)?)? {
            Opcode::Wide16Prefix | Opcode::Wide32Prefix => {
                RawInstruction::read(bytes, bytecode_offset).map(|it| it.opcode)
            }
            opcode => Some(opcode),
        }
    }
}

impl Vm {
    /// Whether what is thrown now ends in a handler that takes the value and forgets where it came from.
    pub(super) fn is_sure_to_catch(&self, thrown: Value) -> bool {
        let entry_frame = self.top_entry_frame();
        let catches = |frame: VisitedFrame<'_>| {
            let Some(code_block) = frame.code_block else {
                return frame.catches_in_wasm(self, thrown);
            };
            code_block.body().handlers().iter().any(|handler| {
                matches!(
                    handler.kind,
                    HandlerKind::Catch | HandlerKind::SynthesizedCatch
                ) && handler.range.contains(&frame.bytecode_offset)
            })
        };
        StackVisitor::frames(self)
            .take_while(|frame| frame.entry_frame == entry_frame)
            .any(catches)
    }
}

impl Cx {
    /// For what a call throws before the context of the callee is there or after it has gone. The innermost `skip`
    /// frames are those of the callee.
    pub(super) fn in_realm_of_caller(&self, skip: usize) -> &Cx {
        let caller = StackVisitor::frames(self).nth(skip);
        match caller.and_then(|it| it.callee?.realm()) {
            Some(realm) => self.in_realm_shared(realm),
            None => self,
        }
    }

    /// Whether the innermost code is a constructor at the last of the steps that `[[Construct]]` takes.
    pub(super) fn is_leaving_constructor(&self) -> bool {
        let next_opcode = |frame: VisitedFrame<'_>| {
            let code_block = frame
                .code_block
                .filter(|it| it.body().kind() == CodeKind::Construct)?;
            let bytes = code_block.body().instructions();
            let current = RawInstruction::read(bytes, frame.bytecode_offset)?;
            code_block.opcode_at(frame.bytecode_offset + u32::from(current.size))
        };
        StackVisitor::frames(self).next().and_then(next_opcode) == Some(Opcode::Return)
    }
}

impl Vm {
    /// Of the calls from native code that have one and have not returned, innermost first.
    pub fn entry_contexts(&self) -> impl Iterator<Item = Value> {
        // SAFETY: on the stack.
        let at = |entry_frame| (entry_frame != 0).then(|| unsafe { EntryRecord::of(entry_frame) });
        let innermost = at(self.top_entry_frame());
        core::iter::successors(innermost, move |it| at(it.previous_top_entry_frame))
            .filter_map(EntryRecord::context)
    }
}
