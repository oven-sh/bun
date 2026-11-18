//! Finds out what the words of raw frames stand for. What a frame referred to is alive until the collection that follows
//! the sample ends, and this runs before that. Allocates nothing in the heap.

use core::ops::Range;

use bun_engine_bytecode::{FunctionKind, Opcode, Visibility};
use bun_engine_text::{StringRef, Text, names};
use bun_engine_vm::{
    CellKind, CellType, CodeBlock, CodeOrigin, Executable, FunctionExecutable, Gc,
    InternalFunction, Intrinsic, JsBoundFunction, JsFunction, JsObject, JsString, ModuleExecutable,
    NativeExecutable, RealmSlot, RegExp, SampledWasmFrame, Tier, Value, Vm, WasmTier, call,
    options,
};
use smallvec::SmallVec;

use super::native_symbol;
use super::profile::{CallTree, Location, Node, NodeIndex, SampledFrameKind};
use super::sampler::{RawSample, RawSamples};
use super::walker::RawFrame;

/// The words are not those of a frame.
struct NoFrame;

struct Resolver<'a> {
    vm: &'a Vm,
    tree: &'a mut CallTree,
    static_code: Range<usize>,
}

fn name_of_executable(executable: Gc<Executable>) -> StringRef {
    if let Some(function) = executable.downcast::<FunctionExecutable>() {
        function.name().clone()
    } else if let Some(native) = executable.downcast::<NativeExecutable>() {
        native.name().clone()
    } else if executable.is::<ModuleExecutable>() {
        StringRef::from_literal("(module)")
    } else {
        StringRef::from_literal("(program)")
    }
}

/// What `name` will be when something asks for it.
fn original_name(function: Gc<JsFunction>) -> StringRef {
    let executable = function.script_executable();
    let name = executable.map_or_else(|| function.name(), |it| it.name().clone());
    let prefix = match executable.map(|it| it.info().kind()) {
        Some(FunctionKind::Getter) => Text::from_ascii("get "),
        Some(FunctionKind::Setter) => Text::from_ascii("set "),
        None if function.is::<JsBoundFunction>() => names::boundPrefix.text(),
        _ => return name,
    };
    StringRef::try_concat(&[prefix, name.text()]).unwrap_or(name)
}

/// `None` if it says nothing.
fn name_of_callee(callee: Gc<JsObject>) -> Option<StringRef> {
    let property = |name| {
        let value = callee.get_direct(name)?.downcast::<JsString>()?;
        Some(value.to_string_without_resolving()).filter(|it| !it.is_empty())
    };
    let name = property(names::displayName).or_else(|| property(names::name));
    let name = name.or_else(|| match callee.downcast::<JsFunction>() {
        Some(function) => (!function.has_reified_name()).then(|| original_name(function)),
        None => Some(callee.downcast::<InternalFunction>()?.name()),
    });
    name.filter(|it| !it.is_empty())
}

fn offset_of_pointer(code_block: &CodeBlock, pointer: usize) -> Option<u32> {
    let offset = pointer.wrapping_sub(code_block.instructions_ptr().addr());
    (offset < code_block.body().instructions().len()).then_some(offset as u32)
}

fn not_inlined(bytecode_offset: u32) -> CodeOrigin {
    CodeOrigin {
        bytecode_offset,
        inline_frame: None,
    }
}

fn origin_of_call_site(code_block: &CodeBlock, call_site: u32) -> Option<CodeOrigin> {
    if code_block.is_optimized() {
        let compiled = code_block.compiled()?;
        return (compiled.has_call_site(call_site))
            .then(|| compiled.origin_of_call_site(call_site));
    }
    let offset = code_block.bytecode_offset_of(call_site);
    ((offset as usize) < code_block.body().instructions().len()).then(|| not_inlined(offset))
}

fn is_wasm(frame: &RawFrame) -> bool {
    frame.callee & Value::NATIVE_CALLEE_TAG == Value::NATIVE_CALLEE_TAG
}

impl Resolver<'_> {
    fn live<T: CellKind>(&self, word: usize) -> Option<Gc<T>> {
        self.vm.heap.live_cell_at(word)?.downcast()
    }

    fn is_interpreted(&self, frame: &RawFrame, code_block: &CodeBlock) -> bool {
        !code_block.is_optimized() && self.static_code.contains(&frame.address)
    }

    fn add_plain(
        &mut self,
        caller: Option<NodeIndex>,
        kind: SampledFrameKind,
        name: StringRef,
    ) -> NodeIndex {
        self.tree.add_node(Node {
            caller,
            inliner: None,
            kind,
            name,
            executable: 0,
            location: Location::None,
        })
    }

    fn describe_wasm(&self, frame: &RawFrame) -> Option<SampledWasmFrame> {
        let describe = self.vm.hooks().sampled_wasm_frame;
        describe(self.vm, frame.code_block, frame.callee, frame.address)
    }

    fn add_wasm(&mut self, caller: Option<NodeIndex>, wasm: SampledWasmFrame) -> NodeIndex {
        self.tree.add_node(Node {
            caller,
            inliner: None,
            kind: SampledFrameKind::Wasm,
            name: wasm.name,
            executable: 0,
            location: Location::Wasm(wasm.tier),
        })
    }

    fn add_without_code_block(
        &mut self,
        caller: Option<NodeIndex>,
        callee: Option<Gc<JsObject>>,
    ) -> NodeIndex {
        let name = callee.and_then(name_of_callee);
        let Some(function) = callee.and_then(Gc::downcast::<JsFunction>) else {
            let (kind, fallback) = match callee {
                Some(callee) if callee.is_callable() => (SampledFrameKind::Host, "(host)"),
                _ => (SampledFrameKind::Unknown, "(unknown)"),
            };
            let name = name.unwrap_or_else(|| StringRef::from_literal(fallback));
            return self.add_plain(caller, kind, name);
        };
        let executable = function.executable();
        if executable.intrinsic() == Intrinsic::WasmFunction {
            return self.add_wasm(caller, SampledWasmFrame::stub(WasmTier::StubFromScript));
        }
        let name = name.unwrap_or_else(|| name_of_executable(executable));
        // A helper of built-ins counts as a part of them.
        if let Some(caller) = caller
            && name.is_empty()
            && executable.visibility() != Visibility::Public
        {
            return caller;
        }
        self.tree.add_node(Node {
            caller,
            inliner: None,
            kind: SampledFrameKind::Executable,
            name,
            executable: executable.address(),
            location: Location::None,
        })
    }

    /// With the calls that it has inlined on the way to `origin`.
    fn add_script(
        &mut self,
        caller: Option<NodeIndex>,
        frame: &RawFrame,
        code_block: Gc<CodeBlock>,
        origin: Option<CodeOrigin>,
    ) -> NodeIndex {
        let tier = if self.is_interpreted(frame, &code_block) {
            Tier::Interpreter
        } else {
            code_block.tier()
        };
        let node = |caller, inliner, name: Option<_>, code: Gc<CodeBlock>, offset: Option<u32>| {
            let executable = code.executable().upcast();
            Node {
                caller,
                inliner,
                kind: SampledFrameKind::Executable,
                name: name.unwrap_or_else(|| name_of_executable(executable)),
                executable: executable.address(),
                location: Location::Script {
                    tier,
                    specialization: code.specialization(),
                    instruction: offset.map(|offset| (offset, code.line_column(offset))),
                },
            }
        };
        let mut inlined = SmallVec::<[_; 8]>::new();
        let mut origin = origin;
        while let Some(CodeOrigin {
            bytecode_offset,
            inline_frame: Some(index),
        }) = origin
            && let Some(compiled) = code_block.compiled()
        {
            inlined.push((index, bytecode_offset));
            origin = Some(compiled.inline_frame(self.vm, index).caller);
        }
        let name = self.live(frame.callee as usize).and_then(name_of_callee);
        let offset = origin.map(|origin| origin.bytecode_offset);
        let machine = (self.tree).add_node(node(caller, None, name, code_block, offset));
        let mut innermost = machine;
        if let Some(compiled) = code_block.compiled() {
            for (index, offset) in inlined.into_iter().rev() {
                let code = compiled.inline_frame(self.vm, index).code_block;
                let node = node(Some(innermost), Some(machine), None, code, Some(offset));
                innermost = self.tree.add_node(node);
            }
        }
        innermost
    }

    /// `exact` says where in its code the frame is, if more than its call site does.
    fn add_frame(
        &mut self,
        caller: Option<NodeIndex>,
        frame: &RawFrame,
        has_called_out: bool,
        exact: impl FnOnce(&CodeBlock) -> Option<CodeOrigin>,
    ) -> Result<NodeIndex, NoFrame> {
        if is_wasm(frame) {
            let wasm = self.describe_wasm(frame).ok_or(NoFrame)?;
            return Ok(self.add_wasm(caller, wasm));
        }
        if frame.code_block == 0 {
            let callee = self.live::<JsObject>(frame.callee as usize);
            // A program that is being linked.
            if callee.is_some_and(|it| it.cell_type() == CellType::Callee) {
                return caller.ok_or(NoFrame);
            }
            return Ok(self.add_without_code_block(caller, callee));
        }
        let code_block = self.live::<CodeBlock>(frame.code_block).ok_or(NoFrame)?;
        let origin =
            exact(&code_block).or_else(|| origin_of_call_site(&code_block, frame.call_site));
        let node = self.add_script(caller, frame, code_block, origin);
        if has_called_out
            && let Some(origin) = origin.filter(|it| it.inline_frame.is_none())
            && code_block.opcode_at(origin.bytecode_offset) == Some(Opcode::DirectEval)
            && let Some(eval) = (code_block.global()).slot_if_initialized(RealmSlot::eval_function)
        {
            return Ok(self.add_without_code_block(Some(node), eval.as_object()));
        }
        Ok(node)
    }

    /// A native frame is below the locals of the frame that it is for, where the header of a callee may have stayed.
    fn is_call_frame(&self, sample: &RawSample, first: &RawFrame, second: &RawFrame) -> bool {
        let Some(size) = sample.first.doubtful_size else {
            return true;
        };
        let code_of = |frame: &RawFrame| self.live::<CodeBlock>(frame.code_block);
        let Some(caller) = code_of(second).filter(|it| !is_wasm(second) && !it.is_optimized())
        else {
            return true;
        };
        let is_running =
            |code: Gc<CodeBlock>| offset_of_pointer(&code, sample.bytecode_pointer).is_some();
        if size <= caller.locals() as usize * size_of::<Value>() {
            true
        } else if sample.first.has_return_address {
            sample.first.is_top_call_frame
        } else {
            !is_running(caller)
                && (sample.first.is_top_call_frame || code_of(first).is_some_and(is_running))
        }
    }

    /// The innermost, and those outside it.
    fn split<'b>(
        &self,
        sample: &RawSample,
        frames: &'b [RawFrame],
    ) -> Option<(RawFrame, &'b [RawFrame])> {
        match frames {
            [first, second, rest @ ..] if !self.is_call_frame(sample, first, second) => {
                let address = first.address;
                Some((RawFrame { address, ..*second }, rest))
            }
            [first, rest @ ..] => Some((*first, rest)),
            [] => None,
        }
    }

    fn add_innermost(
        &mut self,
        caller: Option<NodeIndex>,
        sample: &RawSample,
        frame: &RawFrame,
    ) -> Result<NodeIndex, NoFrame> {
        let is_in_static_code = self.static_code.contains(&frame.address);
        let node = self.add_frame(caller, frame, sample.first.has_called_out, |code_block| {
            if is_in_static_code {
                let offset = offset_of_pointer(code_block, sample.bytecode_pointer);
                return offset
                    .filter(|_| !code_block.is_optimized())
                    .map(not_inlined);
            }
            // A call may be the last instruction that was made for its origin.
            let address = frame
                .address
                .wrapping_sub(sample.first.has_return_address.into());
            code_block.origin_of_address(address)
        })?;
        if let Some(regexp) = self.live::<RegExp>(sample.regexp) {
            let name = regexp.to_literal_text();
            return Ok(self.add_plain(Some(node), SampledFrameKind::RegExp, name));
        }
        if sample.first.has_called_out && options().collect_extra_sampling_data {
            let name = native_symbol::name_at(sample.program_counter);
            let name = name.unwrap_or_else(|| StringRef::from_literal("(unknown C PC)"));
            return Ok(self.add_plain(Some(node), SampledFrameKind::NativeCode, name));
        }
        Ok(node)
    }
}

pub(super) fn resolve(vm: &Vm, raw: &RawSamples, tree: &mut CallTree) {
    let mut resolver = Resolver {
        vm,
        tree,
        static_code: call::code_in_call_frames(),
    };
    // One sample has most of its outer frames in common with the one before. Outermost first.
    let mut path: Vec<(RawFrame, NodeIndex)> = Vec::new();
    for sample in &raw.samples {
        let Some((innermost, outer)) = resolver.split(sample, &raw.frames[sample.frames.clone()])
        else {
            continue;
        };
        let pairs = path.iter().zip(outer.iter().rev());
        path.truncate(pairs.take_while(|((known, _), new)| known == *new).count());
        let mut add = || {
            for frame in outer.iter().rev().skip(path.len()) {
                let caller = path.last().map(|&(_, node)| node);
                path.push((*frame, resolver.add_frame(caller, frame, true, |_| None)?));
            }
            resolver.add_innermost(path.last().map(|&(_, node)| node), sample, &innermost)
        };
        if let Ok(node) = add() {
            resolver.tree.add_sample(sample.timestamp, node);
        }
    }
}
