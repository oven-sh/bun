//! A call is prepared here and made by the tier.

use core::mem::MaybeUninit;

use bun_engine_bytecode::{Op, Operand, Register, Specialization, op};
use bun_engine_macros::native_abi;
use bun_engine_vm::call::{CallTarget, MAX_ARGUMENTS, native_call_entry};
use bun_engine_vm::code::metadata;
use bun_engine_vm::ic::CallProfile;
use bun_engine_vm::{CallFrame, Cx, JsFunction, JsResult, ProxyObject, Value, Vm, errors, options};

use super::{Frame, decode};

/// An instruction that a callee returns to.
pub(crate) trait Returns: Op {
    /// Where the result goes, and its profile.
    fn result(self) -> Option<(Register, u32)>;
}

macro_rules! returns {
    ($($Getter:ident)*; $($Setter:ident)*) => {
        $(impl Returns for op::$Getter {
            #[inline(always)]
            fn result(self) -> Option<(Register, u32)> {
                Some((self.dst, self.metadata))
            }
        })*

        $(impl Returns for op::$Setter {
            #[inline(always)]
            fn result(self) -> Option<(Register, u32)> {
                None
            }
        })*
    };
}

/// Those that may call a getter, and those that may call a setter.
macro_rules! with_accesses {
    ($then:ident) => {
        $then!(
            GetById GetByIdDirect GetByIdWithThis GetLength GetHasInstance GetByVal GetByValWithThis ForInGet;
            PutById PutByVal ForInPut
        );
    };
}

pub(crate) use with_accesses;

with_accesses!(returns);
returns!(ResumeGenerator;);

pub(crate) trait AnyCall: Returns {
    const SPECIALIZATION: Specialization;
    const IS_TAIL: bool;

    /// Starts with a `metadata::Call`.
    fn metadata(self) -> u32;
    fn callee(self) -> Operand;
    /// Or `new.target`.
    fn this(self) -> Operand;
}

pub(crate) trait FixedCall: AnyCall {
    fn frame(self) -> u32;
    /// With `this`.
    fn count(self) -> u32;
    /// Those that the instruction stores.
    fn arguments(self) -> [Option<Operand>; 2];
}

pub(crate) trait VarargsCall: AnyCall {
    fn argument_count(self, f: Frame<'_>) -> usize;
    fn load_arguments(self, cx: &mut Cx, f: Frame<'_>, target: &mut [MaybeUninit<Value>]);
}

macro_rules! calls {
    ($($Op:ident, $specialization:ident, $is_tail:literal, $this:ident;)*) => {$(
        returns!($Op;);

        impl AnyCall for op::$Op {
            const SPECIALIZATION: Specialization = Specialization::$specialization;
            const IS_TAIL: bool = $is_tail;

            #[inline(always)]
            fn metadata(self) -> u32 {
                self.metadata
            }

            #[inline(always)]
            fn callee(self) -> Operand {
                self.callee.into()
            }

            #[inline(always)]
            fn this(self) -> Operand {
                self.$this.into()
            }
        }
    )*};
}

calls! {
    Call, Call, false, this;
    Call1, Call, false, this;
    Call2, Call, false, this;
    TailCall, Call, true, this;
    Construct, Construct, false, new_target;
    SuperConstruct, Construct, false, new_target;
    CallVarargs, Call, false, this;
    TailCallVarargs, Call, true, this;
    ConstructVarargs, Construct, false, new_target;
    SuperConstructVarargs, Construct, false, new_target;
    CallWithSpread, Call, false, this;
    TailCallWithSpread, Call, true, this;
}

macro_rules! fixed_calls {
    ($($Op:ident, |$op:ident| $count:expr, $arguments:expr;)*) => {$(
        impl FixedCall for op::$Op {
            #[inline(always)]
            fn frame(self) -> u32 {
                self.frame
            }

            #[inline(always)]
            #[allow(unused_variables)]
            fn count(self) -> u32 {
                let $op = self;
                $count
            }

            #[inline(always)]
            #[allow(unused_variables)]
            fn arguments(self) -> [Option<Operand>; 2] {
                let $op = self;
                $arguments
            }
        }
    )*};
}

fixed_calls! {
    Call, |op| op.count, [None, None];
    Call1, |op| 2, [Some(op.first), None];
    Call2, |op| 3, [Some(op.first), Some(op.second)];
    TailCall, |op| op.count, [None, None];
    Construct, |op| op.count, [None, None];
    SuperConstruct, |op| op.count, [None, None];
}

macro_rules! list_calls {
    ($($Op:ident, |$op:ident| $skip:expr;)*) => {$(
        impl VarargsCall for op::$Op {
            #[inline(always)]
            #[allow(unused_variables)]
            fn argument_count(self, f: Frame<'_>) -> usize {
                let $op = self;
                match f.get_or_empty(self.arguments) {
                    Some(list) => bun_engine_vm::argument_list_length(list, $skip),
                    None => {
                        f.code_block.note_argument_count(f.header);
                        f.header.rest(self.skip_in_frame as usize).len()
                    }
                }
            }

            #[inline(always)]
            #[allow(unused_variables)]
            fn load_arguments(self, cx: &mut Cx, f: Frame<'_>, target: &mut [MaybeUninit<Value>]) {
                let $op = self;
                match f.get_or_empty(self.arguments) {
                    Some(list) => bun_engine_vm::load_argument_list(&cx.no_gc(), list, $skip, target),
                    None => {
                        target.write_copy_of_slice(f.header.rest(self.skip_in_frame as usize));
                    }
                }
            }
        }
    )*};
}

list_calls! {
    CallVarargs, |op| op.skip_in_list;
    TailCallVarargs, |op| op.skip_in_list;
    ConstructVarargs, |op| 0;
    SuperConstructVarargs, |op| 0;
}

macro_rules! spread_calls {
    ($($Op:ident)*) => {$(
        impl VarargsCall for op::$Op {
            fn argument_count(self, f: Frame<'_>) -> usize {
                let (parts, forwarded) = (f.run(self.this.nth(1), self.count - 1), f.header.rest(self.skip_in_frame as usize));
                if parts.contains(&None) {
                    f.code_block.note_argument_count(f.header);
                }
                bun_engine_vm::spread_argument_count(parts, forwarded)
            }

            fn load_arguments(self, _: &mut Cx, f: Frame<'_>, target: &mut [MaybeUninit<Value>]) {
                let (parts, forwarded) = (f.run(self.this.nth(1), self.count - 1), f.header.rest(self.skip_in_frame as usize));
                bun_engine_vm::load_spread_arguments(parts, forwarded, target);
            }
        }
    )*};
}

spread_calls!(CallWithSpread TailCallWithSpread);

/// What to call, and what to pass in the register of the executable.
#[repr(C)]
pub struct PreparedCall {
    /// Zero if it threw.
    pub entry: usize,
    pub executable: usize,
}

impl PreparedCall {
    const THREW: PreparedCall = PreparedCall {
        entry: 0,
        executable: 0,
    };
}

pub(crate) const fn frame_words(count_including_this: usize) -> usize {
    (CallFrame::HEADER_WORDS + count_including_this).next_multiple_of(2)
}

/// # Safety
/// `new_frame` has room for a header.
#[inline(always)]
pub(crate) unsafe fn write_header(
    new_frame: *mut u64,
    code_block: usize,
    callee: u64,
    count: u64,
    this: u64,
) {
    let header = [code_block as u64, callee, count, this];
    // SAFETY: the caller's.
    unsafe {
        new_frame
            .byte_add(CallFrame::OFFSET_OF_CODE_BLOCK)
            .cast::<[u64; 4]>()
            .write(header);
    }
}

#[inline(always)]
fn find_target<O: AnyCall>(op: O, cx: &mut Cx, f: Frame<'_>) -> JsResult<(Value, CallTarget)> {
    let (callee, profile) = (
        f.get(op.callee()),
        &f.entry::<metadata::Call>(op.metadata()).profile,
    );
    let Some(mut target) = CallTarget::find(callee, O::SPECIALIZATION) else {
        return Err(errors::throw_failed_call(cx, callee, O::SPECIALIZATION));
    };
    let address = callee.to_bits() as usize;
    if profile.callee().bits() != address
        && profile.executable().bits() != target.executable
        && !profile.try_count(address, target.executable)
    {
        if profile.executable().bits() != CallProfile::MEGAMORPHIC {
            target = target.on_clean_stack(cx, O::SPECIALIZATION);
        }
        profile.record(f.code_block, callee, O::SPECIALIZATION);
    }
    if O::OPCODE.metadata() == Some(bun_engine_bytecode::MetadataKind::SuperConstruct)
        && let Some(new_target) = f.get(op.this()).as_cell()
    {
        let entry = f.entry::<metadata::SuperConstruct>(op.metadata());
        entry.new_target.record(f.code_block, &new_target);
    }
    if O::SPECIALIZATION == Specialization::Call
        && let Some(proxy) = callee.downcast::<ProxyObject>()
        && let Some(callee) = proxy.transparent_call_target(cx).map(Value::from)
        && let Some(target) = CallTarget::find(callee, Specialization::Call)
    {
        return Ok((callee, target));
    }
    Ok((callee, target))
}

/// Fills the frame that the instruction names.
#[native_abi]
pub type PrepareFixedCall = unsafe fn(vm: &Vm, frame: &CallFrame, start: *const u8) -> PreparedCall;

#[native_abi]
#[inline(never)]
pub(crate) unsafe fn prepare_fixed_call<O: FixedCall>(
    vm: &Vm,
    frame: &CallFrame,
    start: *const u8,
) -> PreparedCall {
    // SAFETY: the caller's, and the new frame is among the locals.
    unsafe {
        let (op, (cx, f)) = (decode::<O>(start), Frame::enter(vm, frame, start));
        let Ok((callee, target)) = find_target(op, cx, f) else {
            return PreparedCall::THREW;
        };
        let (callee, this) = (callee.to_bits(), f.get(op.this()).to_bits());
        let arguments = op.arguments().map(|it| it.map(|it| f.get(it)));
        for (index, argument) in (0..).zip(arguments.into_iter().flatten()) {
            f.set(Register::outgoing_argument(op.frame(), index), argument);
        }
        let new_frame = frame.slot(-(op.frame() as isize)).as_ptr();
        write_header(
            new_frame,
            target.code_block,
            callee,
            op.count().into(),
            this,
        );
        PreparedCall {
            entry: target.entry,
            executable: target.executable,
        }
    }
}

/// The address of the new frame, which is below the locals, or zero if it threw. The caller moves the stack pointer
/// below it and goes on with `FillVarargsFrame`.
#[native_abi]
pub type SizeVarargsFrame = unsafe fn(vm: &Vm, frame: &CallFrame, start: *const u8) -> usize;

#[native_abi]
#[inline(never)]
pub(crate) unsafe fn size_varargs_frame<O: VarargsCall>(
    vm: &Vm,
    frame: &CallFrame,
    start: *const u8,
) -> usize {
    // SAFETY: the caller's.
    let (op, (cx, f)) = unsafe { (decode::<O>(start), Frame::enter(vm, frame, start)) };
    let count = op.argument_count(f);
    let words = f.code_block.locals() as usize + frame_words(count.min(MAX_ARGUMENTS) + 1);
    let new_frame = frame.address().saturating_sub(words * size_of::<u64>());
    if count > MAX_ARGUMENTS || new_frame < vm.soft_stack_limit() {
        let _ = cx.throw_stack_overflow();
        return 0;
    }
    new_frame
}

#[native_abi]
pub type FillVarargsFrame =
    unsafe fn(vm: &Vm, frame: &CallFrame, start: *const u8, new_frame: *mut u64) -> PreparedCall;

#[native_abi]
#[inline(never)]
pub(crate) unsafe fn fill_varargs_frame<O: VarargsCall>(
    vm: &Vm,
    frame: &CallFrame,
    start: *const u8,
    new_frame: *mut u64,
) -> PreparedCall {
    // SAFETY: the caller's. Nothing has run since the frame was sized.
    unsafe {
        let (op, (cx, f)) = (decode::<O>(start), Frame::enter(vm, frame, start));
        let Ok((callee, target)) = find_target(op, cx, f) else {
            return PreparedCall::THREW;
        };
        let count = op.argument_count(f);
        let arguments = new_frame.byte_add(CallFrame::OFFSET_OF_ARGUMENTS).cast();
        op.load_arguments(cx, f, core::slice::from_raw_parts_mut(arguments, count));
        let (callee, this) = (callee.to_bits(), f.get(op.this()).to_bits());
        write_header(new_frame, target.code_block, callee, count as u64 + 1, this);
        PreparedCall {
            entry: target.entry,
            executable: target.executable,
        }
    }
}

/// `new_frame` is complete but for the linkage.
pub(crate) fn makes_tail_call(entry: usize, new_frame: &CallFrame) -> bool {
    let is_worth_a_profile = || {
        let callee = new_frame.callee().cast::<JsFunction>();
        callee.intrinsic().picks_kind_of_number()
            && new_frame.arguments().iter().all(|it| it.is_number())
    };
    options().use_tail_calls && !(entry == native_call_entry() && is_worth_a_profile())
}

/// Puts `new_frame` in the place of `frame`, and returns where it starts now.
///
/// # Safety
/// `new_frame` is complete but for the linkage, and nothing of `frame` is needed any more.
#[native_abi]
pub unsafe fn replace_frame(frame: &CallFrame, new_frame: *const u64) -> usize {
    // SAFETY: the caller's. The callee owns all words of its frame.
    unsafe {
        let parameters = frame.code_block().map_or(0, |it| it.parameters());
        let old_count = frame.argument_count_including_this().max(parameters) as usize;
        let new_count = (*new_frame.cast::<CallFrame>()).argument_count_including_this() as usize;
        let linkage = [frame.caller_address(), frame.return_address()];
        let moved = frame_words(old_count) as isize - frame_words(new_count) as isize;
        let target = frame.slot(moved).as_ptr();
        core::ptr::copy(new_frame, target, CallFrame::HEADER_WORDS + new_count);
        target.cast::<[usize; 2]>().write(linkage);
        target.addr()
    }
}
