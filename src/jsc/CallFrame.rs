use alloc::borrow::Cow;
use core::ffi::{c_char, c_uint, c_void};
use core::marker::{PhantomData, PhantomPinned};

use crate::virtual_machine::VirtualMachine;
use crate::{JSGlobalObject, JSValue, VM};
use bun_collections::IntegerBitSet;
use bun_core::ZStr;

#[allow(deprecated)]
use crate::c_api::JSValueRef;

bun_opaque::opaque_ffi! {
    /// Call Frame for JavaScript -> Native function calls. In Bun, it is
    /// preferred to use the bindings generator instead of directly decoding
    /// arguments. See `docs/project/bindgen.md`
    pub struct CallFrame;
}

impl CallFrame {
    /// A slice of all passed arguments to this function call.
    pub fn arguments(&self) -> &[JSValue] {
        // SAFETY: asUnsafeJSValueArray points at the JSC register file; offsets
        // OFFSET_FIRST_ARGUMENT..+argumentsCount() are valid JSValue slots per
        // JSC CallFrame layout (see asUnsafeJSValueArray doc comment). The base
        // is derived from `&self` via pointer arithmetic, so it is provably
        // non-null — use bare `from_raw_parts` to avoid a dead null-branch on
        // the hottest per-JS-call path.
        unsafe {
            core::slice::from_raw_parts(
                self.as_unsafe_js_value_array().add(OFFSET_FIRST_ARGUMENT),
                self.arguments_count() as usize,
            )
        }
    }

    /// Usage: `let [arg1, arg2] = call_frame.arguments_as_array::<2>();`
    pub fn arguments_as_array<const COUNT: usize>(&self) -> [JSValue; COUNT] {
        let slice = self.arguments();
        let mut value: [JSValue; COUNT] = [JSValue::UNDEFINED; COUNT];
        let n = (self.arguments_count() as usize).min(COUNT);
        value[0..n].copy_from_slice(&slice[0..n]);
        value
    }

    /// This function protects out-of-bounds access by returning undefined
    pub fn argument(&self, i: usize) -> JSValue {
        if (self.arguments_count() as usize) > i {
            self.arguments()[i]
        } else {
            JSValue::UNDEFINED
        }
    }

    pub fn arguments_count(&self) -> u32 {
        self.argument_count_including_this() - 1
    }

    /// When this CallFrame belongs to a constructor, this value is not the `this`
    /// value, but instead the value of `new.target`.
    pub fn this(&self) -> JSValue {
        // SAFETY: OFFSET_THIS_ARGUMENT is a valid slot in the JSC register file.
        unsafe { *self.as_unsafe_js_value_array().add(OFFSET_THIS_ARGUMENT) }
    }

    /// `JSValue` for the current function being called.
    pub fn callee(&self) -> JSValue {
        // SAFETY: OFFSET_CALLEE is a valid slot in the JSC register file.
        unsafe { *self.as_unsafe_js_value_array().add(OFFSET_CALLEE) }
    }

    /// Return a basic iterator.
    pub fn iterate(&self) -> Iterator<'_> {
        Iterator {
            rest: self.arguments(),
        }
    }

    /// From JavaScriptCore/interpreter/CallFrame.h
    ///
    ///   |          ......            |   |
    ///   +----------------------------+   |
    ///   |           argN             |   v  lower address
    ///   +----------------------------+
    ///   |           arg1             |
    ///   +----------------------------+
    ///   |           arg0             |
    ///   +----------------------------+
    ///   |           this             |
    ///   +----------------------------+
    ///   | argumentCountIncludingThis |
    ///   +----------------------------+
    ///   |          callee            |
    ///   +----------------------------+
    ///   |        codeBlock           |
    ///   +----------------------------+
    ///   |      return-address        |
    ///   +----------------------------+
    ///   |       callerFrame          |
    ///   +----------------------------+  <- callee's cfr is pointing this address
    ///   |          local0            |
    ///   +----------------------------+
    ///   |          local1            |
    ///   +----------------------------+
    ///   |          localN            |
    ///   +----------------------------+
    ///   |          ......            |
    ///
    /// The proper return type of this should be []Register, but
    #[inline]
    fn as_unsafe_js_value_array(&self) -> *const JSValue {
        // SAFETY: CallFrame is an opaque handle whose address IS the base of the
        // JSC register array; reinterpreting &self as *const JSValue mirrors the
        // Zig @ptrCast(@alignCast(self)).
        std::ptr::from_ref::<CallFrame>(self).cast::<JSValue>()
    }

    /// This function is manually ported from JSC's equivalent function in C++
    /// See JavaScriptCore/interpreter/CallFrame.h
    fn argument_count_including_this(&self) -> u32 {
        // SAFETY: self points at the base of the JSC register array; the slot at
        // OFFSET_ARGUMENT_COUNT_INCLUDING_THIS is a valid Register.
        let registers: *const Register = std::ptr::from_ref::<CallFrame>(self).cast::<Register>();
        // argumentCountIncludingThis takes the register at the defined offset, then
        // calls 'ALWAYS_INLINE int32_t Register::unboxedInt32() const',
        // which in turn calls 'ALWAYS_INLINE int32_t Register::payload() const'
        // which accesses `.encodedValue.asBits.payload`
        // JSC stores and works with value as signed, but it is always 1 or more.
        unsafe {
            u32::try_from(
                (*registers.add(OFFSET_ARGUMENT_COUNT_INCLUDING_THIS))
                    .encoded_value
                    .as_bits
                    .payload,
            )
            .unwrap()
        }
    }

    /// Do not use this function. Migration path:
    /// arguments(n).ptr[k] -> arguments_as_array::<n>()[k]
    /// arguments(n).slice() -> arguments()
    /// arguments(n).mut() -> `let mut args = arguments_as_array::<n>(); &mut args`
    pub fn arguments_old<const MAX: usize>(&self) -> Arguments<MAX> {
        let slice = self.arguments();
        debug_assert!(MAX <= 15);
        // PERF(port): was `switch { inline 1...15 => |count| ... }` comptime monomorphization — profile in Phase B
        let count = slice.len().min(MAX);
        if count == 0 {
            Arguments {
                ptr: [JSValue::ZERO; MAX],
                len: 0,
            }
        } else {
            Arguments::<MAX>::init(count.min(MAX), slice.as_ptr())
        }
    }

    /// Do not use this function. Migration path:
    /// arguments_as_array::<n>()
    pub fn arguments_undef<const MAX: usize>(&self) -> Arguments<MAX> {
        let slice = self.arguments();
        debug_assert!(MAX <= 9);
        // PERF(port): was `switch { inline 1...9 => |count| ... }` comptime monomorphization — profile in Phase B
        let count = slice.len().min(MAX);
        if count == 0 {
            Arguments {
                ptr: [JSValue::UNDEFINED; MAX],
                len: 0,
            }
        } else {
            Arguments::<MAX>::init_undef(count.min(MAX), slice.as_ptr())
        }
    }

    pub fn is_from_bun_main(&self, vm: &VM) -> bool {
        Bun__CallFrame__isFromBunMain(self, vm)
    }

    pub fn get_caller_src_loc(&self, global_this: &JSGlobalObject) -> CallerSrcLoc {
        let mut str = bun_core::String::default();
        let mut line: c_uint = 0;
        let mut column: c_uint = 0;
        Bun__CallFrame__getCallerSrcLoc(self, global_this, &mut str, &mut line, &mut column);
        CallerSrcLoc { str, line, column }
    }

    pub fn describe_frame(&self) -> &ZStr {
        // SAFETY: FFI returns a NUL-terminated C string with lifetime tied to the frame.
        unsafe {
            let p = Bun__CallFrame__describeFrame(self);
            let len = bun_core::ffi::cstr(p).to_bytes().len();
            ZStr::from_raw(p.cast::<u8>(), len)
        }
    }
}

// These constants are from JSC::CallFrameSlot in JavaScriptCore/interpreter/CallFrame.h
const OFFSET_CODE_BLOCK: usize = 2;
const OFFSET_CALLEE: usize = OFFSET_CODE_BLOCK + 1;
const OFFSET_ARGUMENT_COUNT_INCLUDING_THIS: usize = OFFSET_CALLEE + 1;
const OFFSET_THIS_ARGUMENT: usize = OFFSET_ARGUMENT_COUNT_INCLUDING_THIS + 1;
const OFFSET_FIRST_ARGUMENT: usize = OFFSET_THIS_ARGUMENT + 1;

// Register defined in JavaScriptCore/interpreter/Register.h
#[repr(C)]
union Register {
    value: JSValue, // EncodedJSValue
    call_frame: *mut CallFrame,
    code_block: *mut c_void, // CodeBlock*
    /// EncodedValueDescriptor defined in JavaScriptCore/runtime/JSCJSValue.h
    encoded_value: EncodedValueDescriptor,
    number: f64,  // double
    integer: i64, // integer
}

#[repr(C)]
#[derive(Clone, Copy)]
union EncodedValueDescriptor {
    ptr: JSValue, // JSCell*
    as_bits: AsBits,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct AsBits {
    payload: i32,
    tag: i32,
}

pub struct Arguments<const MAX: usize> {
    pub ptr: [JSValue; MAX],
    pub len: usize,
}

impl<const MAX: usize> Arguments<MAX> {
    #[inline]
    pub fn init(i: usize, ptr: *const JSValue) -> Self {
        let mut args: [JSValue; MAX] = [JSValue::ZERO; MAX];
        // SAFETY: caller guarantees `ptr[0..i]` is valid; i <= MAX.
        args[0..i].copy_from_slice(unsafe { bun_core::ffi::slice(ptr, i) });
        Self { ptr: args, len: i }
    }

    #[inline]
    pub fn init_undef(i: usize, ptr: *const JSValue) -> Self {
        let mut args: [JSValue; MAX] = [JSValue::UNDEFINED; MAX];
        // SAFETY: caller guarantees `ptr[0..i]` is valid; i <= MAX.
        args[0..i].copy_from_slice(unsafe { bun_core::ffi::slice(ptr, i) });
        Self { ptr: args, len: i }
    }

    #[inline]
    pub fn slice(&self) -> &[JSValue] {
        &self.ptr[0..self.len]
    }

    #[inline]
    pub fn mut_(&mut self) -> &mut [JSValue] {
        &mut self.ptr[..]
    }
}

pub struct CallerSrcLoc {
    pub str: bun_core::String,
    pub line: c_uint,
    pub column: c_uint,
}

pub struct Iterator<'a> {
    pub rest: &'a [JSValue],
}

impl<'a> Iterator<'a> {
    pub fn next(&mut self) -> Option<JSValue> {
        if self.rest.is_empty() {
            return None;
        }
        let current = self.rest[0];
        self.rest = &self.rest[1..];
        Some(current)
    }
}

/// This is an advanced iterator struct which is used by various APIs. In
/// Node.fs, `will_be_async` is set to true which allows string/path APIs to
/// know if they have to do threadsafe clones.
///
/// Prefer `Iterator` for a simpler iterator.
pub struct ArgumentsSlice<'a> {
    /// Backing storage for the remaining-args view. Borrowed (`init`) or
    /// heap-owned dupe (`init_async`) — Zig's `initAsync` does
    /// `bun.default_allocator.dupe(jsc.JSValue, slice)` so the remaining slice
    /// survives the original CallFrame stack slot being reused before async
    /// work consumes the arguments. A borrowed `&'a [JSValue]` here would
    /// dangle in that case.
    remaining_buf: Cow<'a, [JSValue]>,
    /// Cursor into `remaining_buf`; advances on `eat()`. Replaces Zig's
    /// `remaining.ptr += 1` reslice (which a `Cow` can't express in-place).
    remaining_start: usize,
    pub vm: &'a VirtualMachine,
    /// Zig: `bun.ArenaAllocator` (= `std.heap.ArenaAllocator`), which is **lazy** —
    /// `init()` allocates nothing. The Rust `bun_alloc::Arena` is a `MimallocArena`
    /// whose `new()` calls `mi_heap_new()` eagerly, so we keep it `None` until a
    /// caller actually needs scratch storage (currently none do in the Rust port).
    pub arena: Option<bun_alloc::Arena>,
    pub all: &'a [JSValue],
    pub threw: bool,
    pub protected: IntegerBitSet<32>,
    pub will_be_async: bool,
}

impl<'a> ArgumentsSlice<'a> {
    /// View of arguments not yet consumed by `eat()`.
    #[inline]
    pub fn remaining(&self) -> &[JSValue] {
        &self.remaining_buf[self.remaining_start..]
    }

    /// Lazily create the scratch arena (Zig: `slice.arena.allocator()`).
    #[inline]
    pub fn arena(&mut self) -> &bun_alloc::Arena {
        self.arena.get_or_insert_with(bun_alloc::Arena::new)
    }

    pub fn unprotect(&mut self) {
        let mut iter = self.protected.iterator::<true, true>();
        while let Some(i) = iter.next() {
            self.all[i].unprotect();
        }
        self.protected = IntegerBitSet::<32>::init_empty();
    }

    pub fn protect_eat(&mut self) {
        if self.remaining().is_empty() {
            return;
        }
        // `remaining_buf.len() == all.len()` for both init variants, so
        // `all.len() - remaining().len()` reduces to `remaining_start` —
        // matching Zig's `self.all.len - self.remaining.len`.
        let index = self.all.len() - self.remaining().len();
        self.protected.set(index);
        self.all[index].protect();
        self.eat();
    }

    pub fn protect_eat_next(&mut self) -> Option<JSValue> {
        if self.remaining().is_empty() {
            return None;
        }
        self.next_eat()
    }

    pub fn from(vm: &'a VirtualMachine, slice: &'a [JSValueRef]) -> ArgumentsSlice<'a> {
        // SAFETY: JSValueRef and JSValue have identical layout (both are encoded i64);
        // mirrors Zig @ptrCast(slice.ptr).
        let as_values =
            unsafe { bun_core::ffi::slice(slice.as_ptr().cast::<JSValue>(), slice.len()) };
        Self::init(vm, as_values)
    }

    pub fn init(vm: &'a VirtualMachine, slice: &'a [JSValue]) -> ArgumentsSlice<'a> {
        ArgumentsSlice {
            remaining_buf: Cow::Borrowed(slice),
            remaining_start: 0,
            vm,
            all: slice,
            arena: None,
            threw: false,
            protected: IntegerBitSet::<32>::init_empty(),
            will_be_async: false,
        }
    }

    pub fn init_async(vm: &'a VirtualMachine, slice: &'a [JSValue]) -> ArgumentsSlice<'a> {
        // Spec (CallFrame.zig:258-265): `.remaining = bun.default_allocator.dupe(jsc.JSValue, slice)`.
        // `all` stays borrowed (matches Zig) so `protect_eat` index math holds.
        ArgumentsSlice {
            remaining_buf: Cow::Owned(slice.to_vec()),
            remaining_start: 0,
            vm,
            all: slice,
            arena: None,
            threw: false,
            protected: IntegerBitSet::<32>::init_empty(),
            will_be_async: false,
        }
    }

    #[inline]
    pub fn len(&self) -> u16 {
        self.remaining().len() as u16
    }

    pub fn eat(&mut self) {
        if self.remaining().is_empty() {
            return;
        }
        self.remaining_start += 1;
    }

    /// Peek the next argument without eating it
    pub fn next(&mut self) -> Option<JSValue> {
        self.remaining().first().copied()
    }

    pub fn next_eat(&mut self) -> Option<JSValue> {
        let v = self.remaining().first().copied()?;
        self.eat();
        Some(v)
    }
}

impl<'a> Drop for ArgumentsSlice<'a> {
    fn drop(&mut self) {
        self.unprotect();
        // arena dropped automatically
    }
}

// TODO(port): move to jsc_sys
//
// `CallFrame`/`VM`/`JSGlobalObject` are opaque `UnsafeCell`-backed ZST handles;
// `&T` is ABI-identical to non-null `*const T`. Out-params are exclusive `&mut`
// to plain `#[repr(C)]` PODs. `describeFrame` returns a raw C string that the
// caller must NUL-scan, so it stays `unsafe fn`.
unsafe extern "C" {
    safe fn Bun__CallFrame__isFromBunMain(cf: &CallFrame, vm: &VM) -> bool;
    safe fn Bun__CallFrame__getCallerSrcLoc(
        cf: &CallFrame,
        global: &JSGlobalObject,
        out_str: &mut bun_core::String,
        out_line: &mut c_uint,
        out_column: &mut c_uint,
    );
    fn Bun__CallFrame__describeFrame(cf: *const CallFrame) -> *const c_char;
}

// ported from: src/jsc/CallFrame.zig
