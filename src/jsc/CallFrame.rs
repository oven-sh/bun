use core::ffi::{c_char, c_uint, c_void, CStr};
use core::marker::{PhantomData, PhantomPinned};

use crate::{JSGlobalObject, JSValue, JSValueRef, VirtualMachine, VM};
use bun_collections::IntegerBitSet;
use bun_str::ZStr;

/// Call Frame for JavaScript -> Native function calls. In Bun, it is
/// preferred to use the bindings generator instead of directly decoding
/// arguments. See `docs/project/bindgen.md`
#[repr(C)]
pub struct CallFrame {
    _p: [u8; 0],
    _m: PhantomData<(*mut u8, PhantomPinned)>,
}

impl CallFrame {
    /// A slice of all passed arguments to this function call.
    pub fn arguments(&self) -> &[JSValue] {
        // SAFETY: asUnsafeJSValueArray points at the JSC register file; offsets
        // OFFSET_FIRST_ARGUMENT..+argumentsCount() are valid JSValue slots per
        // JSC CallFrame layout (see asUnsafeJSValueArray doc comment).
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
        Iterator { rest: self.arguments() }
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
        (self as *const CallFrame).cast::<JSValue>()
    }

    /// This function is manually ported from JSC's equivalent function in C++
    /// See JavaScriptCore/interpreter/CallFrame.h
    fn argument_count_including_this(&self) -> u32 {
        // SAFETY: self points at the base of the JSC register array; the slot at
        // OFFSET_ARGUMENT_COUNT_INCLUDING_THIS is a valid Register.
        let registers: *const Register = (self as *const CallFrame).cast::<Register>();
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
        const _: () = assert!(MAX <= 15);
        // PERF(port): was `switch { inline 1...15 => |count| ... }` comptime monomorphization — profile in Phase B
        let count = slice.len().min(MAX);
        if count == 0 {
            Arguments { ptr: [JSValue::ZERO; MAX], len: 0 }
        } else {
            Arguments::<MAX>::init(count.min(MAX), slice.as_ptr())
        }
    }

    /// Do not use this function. Migration path:
    /// arguments_as_array::<n>()
    pub fn arguments_undef<const MAX: usize>(&self) -> Arguments<MAX> {
        let slice = self.arguments();
        const _: () = assert!(MAX <= 9);
        // PERF(port): was `switch { inline 1...9 => |count| ... }` comptime monomorphization — profile in Phase B
        let count = slice.len().min(MAX);
        if count == 0 {
            Arguments { ptr: [JSValue::UNDEFINED; MAX], len: 0 }
        } else {
            Arguments::<MAX>::init_undef(count.min(MAX), slice.as_ptr())
        }
    }

    pub fn is_from_bun_main(&self, vm: &VM) -> bool {
        // SAFETY: FFI call into JSC C++; both pointers are valid for the call duration.
        unsafe { Bun__CallFrame__isFromBunMain(self, vm) }
    }

    pub fn get_caller_src_loc(&self, global_this: &JSGlobalObject) -> CallerSrcLoc {
        let mut str = core::mem::MaybeUninit::<bun_str::String>::uninit();
        let mut line: c_uint = 0;
        let mut column: c_uint = 0;
        // SAFETY: FFI call writes into the three out-params; all pointers valid.
        unsafe {
            Bun__CallFrame__getCallerSrcLoc(
                self,
                global_this,
                str.as_mut_ptr(),
                &mut line,
                &mut column,
            );
        }
        CallerSrcLoc {
            // SAFETY: Bun__CallFrame__getCallerSrcLoc fully initializes `str`.
            str: unsafe { str.assume_init() },
            line,
            column,
        }
    }

    pub fn describe_frame(&self) -> &ZStr {
        // SAFETY: FFI returns a NUL-terminated C string with lifetime tied to the frame.
        unsafe { ZStr::from_ptr(Bun__CallFrame__describeFrame(self)) }
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
    number: f64, // double
    integer: i64, // integer
}

#[repr(C)]
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
        // SAFETY: all-zero is a valid [JSValue; MAX] (JSValue is #[repr(transparent)] i64).
        let mut args: [JSValue; MAX] = unsafe { core::mem::zeroed() };
        // SAFETY: caller guarantees `ptr[0..i]` is valid; i <= MAX.
        args[0..i].copy_from_slice(unsafe { core::slice::from_raw_parts(ptr, i) });
        Self { ptr: args, len: i }
    }

    #[inline]
    pub fn init_undef(i: usize, ptr: *const JSValue) -> Self {
        let mut args: [JSValue; MAX] = [JSValue::UNDEFINED; MAX];
        // SAFETY: caller guarantees `ptr[0..i]` is valid; i <= MAX.
        args[0..i].copy_from_slice(unsafe { core::slice::from_raw_parts(ptr, i) });
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
    pub str: bun_str::String,
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
    pub remaining: &'a [JSValue],
    pub vm: &'a VirtualMachine,
    // TODO(port): non-AST arena field — Node.fs callers allocate temp strings here; revisit ownership in Phase B
    pub arena: bun_alloc::Arena,
    pub all: &'a [JSValue],
    pub threw: bool,
    pub protected: IntegerBitSet<32>,
    pub will_be_async: bool,
}

impl<'a> ArgumentsSlice<'a> {
    pub fn unprotect(&mut self) {
        let mut iter = self.protected.iter();
        while let Some(i) = iter.next() {
            self.all[i].unprotect();
        }
        self.protected = IntegerBitSet::<32>::empty();
    }

    pub fn protect_eat(&mut self) {
        if self.remaining.is_empty() {
            return;
        }
        let index = self.all.len() - self.remaining.len();
        self.protected.set(index);
        self.all[index].protect();
        self.eat();
    }

    pub fn protect_eat_next(&mut self) -> Option<JSValue> {
        if self.remaining.is_empty() {
            return None;
        }
        self.next_eat()
    }

    pub fn from(vm: &'a VirtualMachine, slice: &'a [JSValueRef]) -> ArgumentsSlice<'a> {
        // SAFETY: JSValueRef and JSValue have identical layout (both are encoded i64);
        // mirrors Zig @ptrCast(slice.ptr).
        let as_values =
            unsafe { core::slice::from_raw_parts(slice.as_ptr().cast::<JSValue>(), slice.len()) };
        Self::init(vm, as_values)
    }

    pub fn init(vm: &'a VirtualMachine, slice: &'a [JSValue]) -> ArgumentsSlice<'a> {
        ArgumentsSlice {
            remaining: slice,
            vm,
            all: slice,
            arena: bun_alloc::Arena::new(),
            threw: false,
            protected: IntegerBitSet::<32>::empty(),
            will_be_async: false,
        }
    }

    pub fn init_async(vm: &'a VirtualMachine, slice: &'a [JSValue]) -> ArgumentsSlice<'a> {
        // TODO(port): Zig duped `slice` into a heap allocation for `remaining` here
        // (bun.default_allocator.dupe) but never freed it in deinit; preserving
        // borrowed-slice semantics for now — revisit if async callers need owned copy.
        ArgumentsSlice {
            remaining: slice,
            vm,
            all: slice,
            arena: bun_alloc::Arena::new(),
            threw: false,
            protected: IntegerBitSet::<32>::empty(),
            will_be_async: false,
        }
    }

    #[inline]
    pub fn len(&self) -> u16 {
        self.remaining.len() as u16
    }

    pub fn eat(&mut self) {
        if self.remaining.is_empty() {
            return;
        }
        self.remaining = &self.remaining[1..];
    }

    /// Peek the next argument without eating it
    pub fn next(&mut self) -> Option<JSValue> {
        if self.remaining.is_empty() {
            return None;
        }
        Some(self.remaining[0])
    }

    pub fn next_eat(&mut self) -> Option<JSValue> {
        if self.remaining.is_empty() {
            return None;
        }
        let v = self.remaining[0];
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
unsafe extern "C" {
    fn Bun__CallFrame__isFromBunMain(cf: *const CallFrame, vm: *const VM) -> bool;
    fn Bun__CallFrame__getCallerSrcLoc(
        cf: *const CallFrame,
        global: *const JSGlobalObject,
        out_str: *mut bun_str::String,
        out_line: *mut c_uint,
        out_column: *mut c_uint,
    );
    fn Bun__CallFrame__describeFrame(cf: *const CallFrame) -> *const c_char;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/CallFrame.zig (304 lines)
//   confidence: medium
//   todos:      3
//   notes:      ArgumentsSlice gets <'a> per LIFETIMES.tsv; arena kept as bun_alloc::Arena (non-AST crate, flagged inline for Phase-B ownership review); init_async dupe semantics flagged; Arguments<MAX> init demoted from comptime i to runtime
// ──────────────────────────────────────────────────────────────────────────
