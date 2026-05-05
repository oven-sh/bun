use core::fmt;
use std::sync::Arc;

use bun_core::{Output, deprecated};
use bun_jsc::{
    CallFrame, JSGlobalObject, JSValue, JsError, JsResult, VirtualMachine, ZigString,
    ConsoleObject, JSFunction, JSPropertyIterator, JSArrayIterator, JSString,
    Jest::{self, bun_test, DescribeScope, TestRunner},
};
use bun_str::{self as bun_string, strings};
use crate::test_runner::diff_format::DiffFormatter;

// TODO(port): re-export matcher modules
pub use crate::expect::to_be::to_be;
// (full list below in impl Expect)

#[derive(Default, Clone, Copy)]
pub struct Counter {
    pub expected: u32,
    pub actual: u32,
}

/// Helper to retrieve matcher flags from a jsvalue of a class like ExpectAny, ExpectStringMatching, etc.
pub fn get_matcher_flags<T: FlagsGetCached>(value: JSValue) -> Flags {
    if let Some(flags_value) = T::flags_get_cached(value) {
        if !flags_value.is_empty() {
            return Flags::from_bitset(flags_value.to_int32());
        }
    }
    Flags::default()
}

// TODO(port): trait stub for `flagsGetCached` codegen accessor used by get_matcher_flags
pub trait FlagsGetCached {
    fn flags_get_cached(value: JSValue) -> Option<JSValue>;
}

/// https://jestjs.io/docs/expect
// To support async tests, we need to track the test ID
#[bun_jsc::JsClass]
pub struct Expect {
    pub flags: Flags,
    pub parent: Option<Arc<bun_test::BunTest::RefData>>,
    pub custom_label: bun_str::String,
}

pub struct TestScope<'a> {
    pub test_id: TestRunner::Test::ID,
    pub describe: &'a DescribeScope,
}

#[repr(u2)] // TODO(port): Rust has no u2; encoded inside Flags packed repr
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum Promise {
    #[default]
    None = 0,
    Resolves = 1,
    Rejects = 2,
}

#[repr(u8)] // TODO(port): Zig used u5; encoded inside Flags packed repr
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum AsymmetricMatcherConstructorType {
    #[default]
    None = 0,
    Symbol = 1,
    String = 2,
    Object = 3,
    Array = 4,
    BigInt = 5,
    Boolean = 6,
    Number = 7,
    Promise = 8,
    InstanceOf = 9,
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn AsymmetricMatcherConstructorType__fromJS(
        global_object: *const JSGlobalObject,
        value: JSValue,
    ) -> i8;
}

impl AsymmetricMatcherConstructorType {
    pub fn from_js(global_object: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        // SAFETY: FFI call with valid &JSGlobalObject; JSValue is Copy/repr(transparent)
        let result = unsafe { AsymmetricMatcherConstructorType__fromJS(global_object, value) };
        if result == -1 {
            return Err(JsError::Thrown);
        }
        // SAFETY: C++ guarantees result is in 0..=9 when != -1
        Ok(unsafe { core::mem::transmute::<u8, Self>(result as u8) })
    }
}

/// note: keep this struct in sync with C++ implementation (at bindings.cpp)
// Zig: packed struct(u8) { promise: u2, not: bool, asymmetric_matcher_constructor_type: u5 }
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct Flags(pub u8);

pub type FlagsCppType = u8;
const _: () = assert!(core::mem::size_of::<Flags>() == core::mem::size_of::<FlagsCppType>());

impl Flags {
    const PROMISE_MASK: u8 = 0b0000_0011;
    const NOT_MASK: u8 = 0b0000_0100;
    const AMCT_SHIFT: u8 = 3;

    #[inline]
    pub fn promise(self) -> Promise {
        // SAFETY: bits 0..2 always hold a valid Promise discriminant
        unsafe { core::mem::transmute::<u8, Promise>(self.0 & Self::PROMISE_MASK) }
    }
    #[inline]
    pub fn set_promise(&mut self, p: Promise) {
        self.0 = (self.0 & !Self::PROMISE_MASK) | (p as u8);
    }
    #[inline]
    pub fn not(self) -> bool {
        (self.0 & Self::NOT_MASK) != 0
    }
    #[inline]
    pub fn set_not(&mut self, v: bool) {
        self.0 = (self.0 & !Self::NOT_MASK) | ((v as u8) << 2);
    }
    #[inline]
    pub fn asymmetric_matcher_constructor_type(self) -> AsymmetricMatcherConstructorType {
        // SAFETY: bits 3..8 always hold a valid discriminant
        unsafe { core::mem::transmute::<u8, AsymmetricMatcherConstructorType>(self.0 >> Self::AMCT_SHIFT) }
    }
    #[inline]
    pub fn set_asymmetric_matcher_constructor_type(&mut self, t: AsymmetricMatcherConstructorType) {
        self.0 = (self.0 & 0b0000_0111) | ((t as u8) << Self::AMCT_SHIFT);
    }

    #[inline]
    pub fn encode(self) -> FlagsCppType {
        self.0
    }
    #[inline]
    pub fn decode(bitset: FlagsCppType) -> Self {
        Self(bitset)
    }
    #[inline]
    pub fn from_bitset(bitset: i32) -> Self {
        Self(bitset as u8)
    }
}

impl Expect {
    pub fn increment_expect_call_counter(&mut self) {
        let Some(parent) = self.parent.as_ref() else { return }; // not in bun:test
        let Some(mut buntest_strong) = parent.bun_test() else { return }; // the test file this expect() call was for is no longer
        let buntest = buntest_strong.get();
        if let Some(sequence) = parent.phase.sequence(buntest) {
            // found active sequence
            sequence.expect_call_count = sequence.expect_call_count.saturating_add(1);
        } else {
            // in concurrent group or otherwise failed to get the sequence; increment the expect call count in the reporter directly
            if let Some(reporter) = buntest.reporter.as_mut() {
                reporter.summary().expectations = reporter.summary().expectations.saturating_add(1);
            }
        }
    }

    pub fn bun_test(&self) -> Option<bun_test::BunTestPtr> {
        let parent = self.parent.as_ref()?;
        parent.bun_test()
    }

    pub const fn get_signature(
        matcher_name: &'static str,
        args: &'static str,
        not: bool,
    ) -> &'static bun_str::ZStr {
        // TODO(port): comptime string concatenation — use const_format::concatcp! in Phase B
        // const RECEIVED: &str = "<d>expect(<r><red>received<r><d>).<r>";
        // if not { RECEIVED ++ "not<d>.<r>" ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>" }
        // else   { RECEIVED ++ matcher_name ++ "<d>(<r>" ++ args ++ "<d>)<r>" }
        let _ = (matcher_name, args, not);
        bun_str::ZStr::from_static(b"<d>expect(<r><red>received<r><d>).<r>{TODO}\0")
    }

    pub fn throw_pretty_matcher_error(
        global_this: &JSGlobalObject,
        custom_label: bun_str::String,
        matcher_name: impl fmt::Display,
        matcher_params: impl fmt::Display,
        flags: Flags,
        message_fmt: &'static str,
        message_args: fmt::Arguments<'_>,
    ) -> JsError {
        // PERF(port): was comptime bool dispatch on Output.enable_ansi_colors_stderr — profile in Phase B
        let colors = Output::enable_ansi_colors_stderr();
        let chain: &str = match flags.promise() {
            Promise::Resolves => {
                if flags.not() {
                    Output::pretty_fmt("resolves<d>.<r>not<d>.<r>", colors)
                } else {
                    Output::pretty_fmt("resolves<d>.<r>", colors)
                }
            }
            Promise::Rejects => {
                if flags.not() {
                    Output::pretty_fmt("rejects<d>.<r>not<d>.<r>", colors)
                } else {
                    Output::pretty_fmt("rejects<d>.<r>", colors)
                }
            }
            Promise::None => {
                if flags.not() {
                    Output::pretty_fmt("not<d>.<r>", colors)
                } else {
                    ""
                }
            }
        };
        // PERF(port): was comptime bool dispatch on use_default_label — profile in Phase B
        if custom_label.is_empty() {
            // TODO(port): comptime fmt-string concatenation with autoFormatLabel; reconstruct in Phase B
            let _ = (chain, &matcher_name, &matcher_params, message_fmt);
            global_this.throw_pretty(
                "<d>expect(<r><red>received<r><d>).<r>{}{}({})\n\n{}",
                format_args!("{chain}{matcher_name}({matcher_params})\n\n{message_args}"),
            )
        } else {
            // TODO(port): comptime fmt-string concatenation
            global_this.throw_pretty(
                "{}\n\n{}",
                format_args!("{custom_label}\n\n{message_args}"),
            )
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_not(this: &mut Self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        this.flags.set_not(!this.flags.not());
        this_value
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_resolves(
        this: &mut Self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        match this.flags.promise() {
            Promise::Resolves | Promise::None => this.flags.set_promise(Promise::Resolves),
            Promise::Rejects => {
                return Err(global_this.throw("Cannot chain .resolves() after .rejects()", format_args!("")));
            }
        }
        Ok(this_value)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_rejects(
        this: &mut Self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        match this.flags.promise() {
            Promise::None | Promise::Rejects => this.flags.set_promise(Promise::Rejects),
            Promise::Resolves => {
                return Err(global_this.throw("Cannot chain .rejects() after .resolves()", format_args!("")));
            }
        }
        Ok(this_value)
    }

    pub fn get_value(
        &self,
        global_this: &JSGlobalObject,
        this_value: JSValue,
        matcher_name: &[u8],
        matcher_params_fmt: &'static str,
    ) -> JsResult<JSValue> {
        let Some(value) = Self::js::captured_value_get_cached(this_value) else {
            return Err(global_this.throw(
                "Internal error: the expect(value) was garbage collected but it should not have been!",
                format_args!(""),
            ));
        };
        value.ensure_still_alive();

        // PERF(port): was comptime bool dispatch — profile in Phase B
        let matcher_params = Output::pretty_fmt(matcher_params_fmt, Output::enable_ansi_colors_stderr());
        Self::process_promise(
            self.custom_label.clone(),
            self.flags,
            global_this,
            value,
            bstr::BStr::new(matcher_name),
            matcher_params,
            false,
        )
    }

    /// Processes the async flags (resolves/rejects), waiting for the async value if needed.
    /// If no flags, returns the original value
    /// If either flag is set, waits for the result, and returns either it as a JSValue, or null if the expectation failed (in which case if silent is false, also throws a js exception)
    pub fn process_promise(
        custom_label: bun_str::String,
        flags: Flags,
        global_this: &JSGlobalObject,
        value: JSValue,
        matcher_name: impl fmt::Display,
        matcher_params: impl fmt::Display,
        silent: bool,
    ) -> JsResult<JSValue> {
        // PERF(port): was comptime monomorphization on `silent` and `resolution` — profile in Phase B
        match flags.promise() {
            resolution @ (Promise::Resolves | Promise::Rejects) => {
                if let Some(promise) = value.as_any_promise() {
                    let vm = global_this.vm();
                    promise.set_handled(vm);

                    global_this.bun_vm().wait_for_promise(promise);

                    let new_value = promise.result(vm);
                    match promise.status() {
                        bun_jsc::PromiseStatus::Fulfilled => match resolution {
                            Promise::Resolves => {}
                            Promise::Rejects => {
                                if !silent {
                                    let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
                                    let message = "Expected promise that rejects<r>\nReceived promise that resolved: <red>{f}<r>\n";
                                    return Err(Self::throw_pretty_matcher_error(
                                        global_this,
                                        custom_label,
                                        matcher_name,
                                        matcher_params,
                                        flags,
                                        message,
                                        format_args!("{}", value.to_fmt(&mut formatter)),
                                    ));
                                }
                                return Err(JsError::Thrown);
                            }
                            Promise::None => unreachable!(),
                        },
                        bun_jsc::PromiseStatus::Rejected => match resolution {
                            Promise::Rejects => {}
                            Promise::Resolves => {
                                if !silent {
                                    let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
                                    let message = "Expected promise that resolves<r>\nReceived promise that rejected: <red>{f}<r>\n";
                                    return Err(Self::throw_pretty_matcher_error(
                                        global_this,
                                        custom_label,
                                        matcher_name,
                                        matcher_params,
                                        flags,
                                        message,
                                        format_args!("{}", value.to_fmt(&mut formatter)),
                                    ));
                                }
                                return Err(JsError::Thrown);
                            }
                            Promise::None => unreachable!(),
                        },
                        bun_jsc::PromiseStatus::Pending => unreachable!(),
                    }

                    new_value.ensure_still_alive();
                    Ok(new_value)
                } else {
                    if !silent {
                        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
                        let message = "Expected promise<r>\nReceived: <red>{f}<r>\n";
                        return Err(Self::throw_pretty_matcher_error(
                            global_this,
                            custom_label,
                            matcher_name,
                            matcher_params,
                            flags,
                            message,
                            format_args!("{}", value.to_fmt(&mut formatter)),
                        ));
                    }
                    Err(JsError::Thrown)
                }
            }
            _ => Ok(value),
        }
    }

    pub fn is_asymmetric_matcher(value: JSValue) -> bool {
        if ExpectCustomAsymmetricMatcher::from_js(value).is_some() { return true; }
        if ExpectAny::from_js(value).is_some() { return true; }
        if ExpectAnything::from_js(value).is_some() { return true; }
        if ExpectStringMatching::from_js(value).is_some() { return true; }
        if ExpectCloseTo::from_js(value).is_some() { return true; }
        if ExpectObjectContaining::from_js(value).is_some() { return true; }
        if ExpectStringContaining::from_js(value).is_some() { return true; }
        if ExpectArrayContaining::from_js(value).is_some() { return true; }
        false
    }

    /// Called by C++ when matching with asymmetric matchers
    #[unsafe(no_mangle)]
    pub extern "C" fn Expect_readFlagsAndProcessPromise(
        instance_value: JSValue,
        global_this: *const JSGlobalObject,
        out_flags: *mut FlagsCppType,
        value: *mut JSValue,
        any_constructor_type: *mut u8,
    ) -> bool {
        // SAFETY: called from C++ with valid pointers
        let global_this = unsafe { &*global_this };
        let flags: Flags = 'flags: {
            if let Some(instance) = ExpectCustomAsymmetricMatcher::from_js(instance_value) {
                break 'flags instance.flags;
            } else if let Some(instance) = ExpectAny::from_js(instance_value) {
                // SAFETY: any_constructor_type is a valid out-ptr provided by C++ caller
                unsafe { *any_constructor_type = instance.flags.asymmetric_matcher_constructor_type() as u8 };
                break 'flags instance.flags;
            } else if let Some(instance) = ExpectAnything::from_js(instance_value) {
                break 'flags instance.flags;
            } else if let Some(instance) = ExpectStringMatching::from_js(instance_value) {
                break 'flags instance.flags;
            } else if let Some(instance) = ExpectCloseTo::from_js(instance_value) {
                break 'flags instance.flags;
            } else if let Some(instance) = ExpectObjectContaining::from_js(instance_value) {
                break 'flags instance.flags;
            } else if let Some(instance) = ExpectStringContaining::from_js(instance_value) {
                break 'flags instance.flags;
            } else if let Some(instance) = ExpectArrayContaining::from_js(instance_value) {
                break 'flags instance.flags;
            } else {
                break 'flags Flags::default();
            }
        };

        // SAFETY: out_flags is a valid out-ptr provided by C++ caller
        unsafe { *out_flags = flags.encode() };

        // (note that matcher_name/matcher_args are not used because silent=true)
        // SAFETY: value is a valid in/out-ptr provided by C++ caller
        let v = unsafe { *value };
        match Self::process_promise(bun_str::String::empty(), flags, global_this, v, "", "", true) {
            Ok(new) => {
                // SAFETY: value is a valid in/out-ptr provided by C++ caller
                unsafe { *value = new };
                true
            }
            Err(_) => false,
        }
    }

    pub fn get_snapshot_name(&self, hint: &[u8]) -> Result<Vec<u8>, bun_core::Error> {
        // TODO(port): narrow error set
        let parent = self.parent.as_ref().ok_or(bun_core::err!("NoTest"))?;
        let mut buntest_strong = parent.bun_test().ok_or(bun_core::err!("TestNotActive"))?;
        let buntest = buntest_strong.get();
        let execution_entry = parent
            .phase
            .entry(buntest)
            .ok_or(bun_core::err!("SnapshotInConcurrentGroup"))?;

        let test_name: &[u8] = execution_entry.base.name.as_deref().unwrap_or(b"(unnamed)");

        let mut length: usize = 0;
        let mut curr_scope = execution_entry.base.parent;
        while let Some(scope) = curr_scope {
            if let Some(name) = scope.base.name.as_deref() {
                if !name.is_empty() {
                    length += name.len() + 1;
                }
            }
            curr_scope = scope.base.parent;
        }
        length += test_name.len();
        if !hint.is_empty() {
            length += hint.len() + 2;
        }

        let mut buf = vec![0u8; length];

        let mut index = buf.len();
        if !hint.is_empty() {
            index -= hint.len();
            buf[index..].copy_from_slice(hint);
            index -= test_name.len() + 2;
            buf[index..index + test_name.len()].copy_from_slice(test_name);
            buf[index + test_name.len()..index + test_name.len() + 2].copy_from_slice(b": ");
        } else {
            index -= test_name.len();
            buf[index..].copy_from_slice(test_name);
        }
        // copy describe scopes in reverse order
        curr_scope = execution_entry.base.parent;
        while let Some(scope) = curr_scope {
            if let Some(name) = scope.base.name.as_deref() {
                if !name.is_empty() {
                    index -= name.len() + 1;
                    buf[index..index + name.len()].copy_from_slice(name);
                    buf[index + name.len()] = b' ';
                }
            }
            curr_scope = scope.base.parent;
        }

        Ok(buf)
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called by codegen finalize on mutator thread; `this` is the m_ctx Box payload
        unsafe {
            (*this).custom_label.deref_();
            // parent: Option<Arc<RefData>> — drop will deref
            drop(Box::from_raw(this));
        }
    }

    #[bun_jsc::host_fn]
    pub fn call(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();
        let value = if arguments.len() < 1 { JSValue::UNDEFINED } else { arguments[0] };

        let mut custom_label = bun_str::String::empty();
        if arguments.len() > 1 {
            if arguments[1].is_string() || arguments[1].implements_to_string(global_this)? {
                let label = arguments[1].to_bun_string(global_this)?;
                if global_this.has_exception() {
                    return Ok(JSValue::ZERO);
                }
                custom_label = label;
            }
        }

        let active_execution_entry_ref = if let Some(buntest_strong_) = bun_test::clone_active_strong() {
            let mut buntest_strong = buntest_strong_;
            let state = buntest_strong.get().get_current_state_data();
            Some(bun_test::BunTest::ref_(&buntest_strong, state))
        } else {
            None
        };
        // errdefer: scopeguard would deinit active_execution_entry_ref on error;
        // here ownership moves into Expect on success, and Box drop handles error path.
        // TODO(port): errdefer — verify no leak path between here and to_js()

        let expect = Box::new(Expect {
            flags: Flags::default(),
            custom_label,
            parent: active_execution_entry_ref,
        });
        let expect_ptr = Box::into_raw(expect);
        // SAFETY: to_js takes ownership of the m_ctx pointer
        let expect_js_value = unsafe { (*expect_ptr).to_js(global_this) };
        expect_js_value.ensure_still_alive();
        Self::js::captured_value_set_cached(expect_js_value, global_this, value);
        expect_js_value.ensure_still_alive();

        // SAFETY: expect_ptr is the m_ctx payload kept alive by expect_js_value (ensure_still_alive above)
        unsafe { (*expect_ptr).post_match(global_this) };
        Ok(expect_js_value)
    }

    pub fn throw(
        &self,
        global_this: &JSGlobalObject,
        signature: &'static str,
        fmt: &'static str,
        args: fmt::Arguments<'_>,
    ) -> JsError {
        // TODO(port): comptime string concatenation of signature ++ fmt
        if self.custom_label.is_empty() {
            global_this.throw_pretty(
                const_format::concatcp!("{signature}{fmt}"), // placeholder
                args,
            )
        } else {
            global_this.throw_pretty("{}\n{}", format_args!("{}{}", self.custom_label, args))
        }
    }

    #[bun_jsc::host_fn]
    pub fn constructor(global_this: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Expect> {
        Err(global_this.throw("expect() cannot be called with new", format_args!("")))
    }

    // pass here has a leading underscore to avoid name collision with the pass variable in other functions
    #[bun_jsc::host_fn(method)]
    pub fn _pass(
        this: &mut Self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let _post = scopeguard::guard((), |_| this.post_match(global_this));
        // TODO(port): defer this.postMatch — borrowck reshape needed; see PORT NOTE below

        let arguments_ = call_frame.arguments_old(1);
        let arguments = arguments_.slice();

        let mut _msg: ZigString = ZigString::EMPTY;

        if !arguments.is_empty() {
            let value = arguments[0];
            value.ensure_still_alive();

            if !value.is_string() {
                return Err(global_this.throw_invalid_argument_type("pass", "message", "string"));
            }

            value.to_zig_string(&mut _msg, global_this)?;
        } else {
            _msg = ZigString::from_bytes(b"passes by .pass() assertion");
        }

        this.increment_expect_call_counter();

        let not = this.flags.not();
        let mut pass = true;

        if not { pass = !pass; }
        if pass { return Ok(JSValue::UNDEFINED); }

        let msg = _msg.to_slice();

        if not {
            let signature = Self::get_signature("pass", "", true);
            return Err(this.throw(global_this, signature, "\n\n{s}\n", format_args!("{}", bstr::BStr::new(msg.slice()))));
        }

        // should never reach here
        Ok(JSValue::ZERO)
    }

    #[bun_jsc::host_fn(method)]
    pub fn fail(
        this: &mut Self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let _post = scopeguard::guard((), |_| this.post_match(global_this));
        // TODO(port): defer this.postMatch — borrowck reshape

        let arguments_ = call_frame.arguments_old(1);
        let arguments = arguments_.slice();

        let mut _msg: ZigString = ZigString::EMPTY;

        if !arguments.is_empty() {
            let value = arguments[0];
            value.ensure_still_alive();

            if !value.is_string() {
                return Err(global_this.throw_invalid_argument_type("fail", "message", "string"));
            }

            value.to_zig_string(&mut _msg, global_this)?;
        } else {
            _msg = ZigString::from_bytes(b"fails by .fail() assertion");
        }

        this.increment_expect_call_counter();

        let not = this.flags.not();
        let mut pass = false;

        if not { pass = !pass; }
        if pass { return Ok(JSValue::UNDEFINED); }

        let msg = _msg.to_slice();

        let signature = Self::get_signature("fail", "", true);
        Err(this.throw(global_this, signature, "\n\n{s}\n", format_args!("{}", bstr::BStr::new(msg.slice()))))
    }
}

// Re-export individual matcher implementations (thin re-exports)
pub use crate::expect::to_be::to_be;
pub use crate::expect::to_be_array::to_be_array;
pub use crate::expect::to_be_array_of_size::to_be_array_of_size;
pub use crate::expect::to_be_boolean::to_be_boolean;
pub use crate::expect::to_be_close_to::to_be_close_to;
pub use crate::expect::to_be_date::to_be_date;
pub use crate::expect::to_be_defined::to_be_defined;
pub use crate::expect::to_be_empty::to_be_empty;
pub use crate::expect::to_be_empty_object::to_be_empty_object;
pub use crate::expect::to_be_even::to_be_even;
pub use crate::expect::to_be_false::to_be_false;
pub use crate::expect::to_be_falsy::to_be_falsy;
pub use crate::expect::to_be_finite::to_be_finite;
pub use crate::expect::to_be_function::to_be_function;
pub use crate::expect::to_be_greater_than::to_be_greater_than;
pub use crate::expect::to_be_greater_than_or_equal::to_be_greater_than_or_equal;
pub use crate::expect::to_be_instance_of::to_be_instance_of;
pub use crate::expect::to_be_integer::to_be_integer;
pub use crate::expect::to_be_less_than::to_be_less_than;
pub use crate::expect::to_be_less_than_or_equal::to_be_less_than_or_equal;
pub use crate::expect::to_be_nan::to_be_nan;
pub use crate::expect::to_be_negative::to_be_negative;
pub use crate::expect::to_be_nil::to_be_nil;
pub use crate::expect::to_be_null::to_be_null;
pub use crate::expect::to_be_number::to_be_number;
pub use crate::expect::to_be_object::to_be_object;
pub use crate::expect::to_be_odd::to_be_odd;
pub use crate::expect::to_be_one_of::to_be_one_of;
pub use crate::expect::to_be_positive::to_be_positive;
pub use crate::expect::to_be_string::to_be_string;
pub use crate::expect::to_be_symbol::to_be_symbol;
pub use crate::expect::to_be_true::to_be_true;
pub use crate::expect::to_be_truthy::to_be_truthy;
pub use crate::expect::to_be_type_of::to_be_type_of;
pub use crate::expect::to_be_undefined::to_be_undefined;
pub use crate::expect::to_be_valid_date::to_be_valid_date;
pub use crate::expect::to_be_within::to_be_within;
pub use crate::expect::to_contain::to_contain;
pub use crate::expect::to_contain_all_keys::to_contain_all_keys;
pub use crate::expect::to_contain_all_values::to_contain_all_values;
pub use crate::expect::to_contain_any_keys::to_contain_any_keys;
pub use crate::expect::to_contain_any_values::to_contain_any_values;
pub use crate::expect::to_contain_equal::to_contain_equal;
pub use crate::expect::to_contain_key::to_contain_key;
pub use crate::expect::to_contain_keys::to_contain_keys;
pub use crate::expect::to_contain_value::to_contain_value;
pub use crate::expect::to_contain_values::to_contain_values;
pub use crate::expect::to_end_with::to_end_with;
pub use crate::expect::to_equal::to_equal;
pub use crate::expect::to_equal_ignoring_whitespace::to_equal_ignoring_whitespace;
pub use crate::expect::to_have_been_called::to_have_been_called;
pub use crate::expect::to_have_been_called_once::to_have_been_called_once;
pub use crate::expect::to_have_been_called_times::to_have_been_called_times;
pub use crate::expect::to_have_been_called_with::to_have_been_called_with;
pub use crate::expect::to_have_been_last_called_with::to_have_been_last_called_with;
pub use crate::expect::to_have_been_nth_called_with::to_have_been_nth_called_with;
pub use crate::expect::to_have_last_returned_with::to_have_last_returned_with;
pub use crate::expect::to_have_length::to_have_length;
pub use crate::expect::to_have_nth_returned_with::to_have_nth_returned_with;
pub use crate::expect::to_have_property::to_have_property;
pub use crate::expect::to_have_returned::to_have_returned;
pub use crate::expect::to_have_returned_times::to_have_returned_times;
pub use crate::expect::to_have_returned_with::to_have_returned_with;
pub use crate::expect::to_include::to_include;
pub use crate::expect::to_include_repeated::to_include_repeated;
pub use crate::expect::to_match::to_match;
pub use crate::expect::to_match_inline_snapshot::to_match_inline_snapshot;
pub use crate::expect::to_match_object::to_match_object;
pub use crate::expect::to_match_snapshot::to_match_snapshot;
pub use crate::expect::to_satisfy::to_satisfy;
pub use crate::expect::to_start_with::to_start_with;
pub use crate::expect::to_strict_equal::to_strict_equal;
pub use crate::expect::to_throw::to_throw;
pub use crate::expect::to_throw_error_matching_inline_snapshot::to_throw_error_matching_inline_snapshot;
pub use crate::expect::to_throw_error_matching_snapshot::to_throw_error_matching_snapshot;

pub struct TrimResult<'a> {
    pub trimmed: &'a [u8],
    pub start_indent: Option<&'a [u8]>,
    pub end_indent: Option<&'a [u8]>,
}

impl Expect {
    pub fn get_value_as_to_throw(
        &self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<(Option<JSValue>, JSValue)> {
        let vm = global_this.bun_vm();

        let mut return_value_from_function: JSValue = JSValue::ZERO;

        if !value.js_type().is_function() {
            if self.flags.promise() != Promise::None {
                return Ok((Some(value), return_value_from_function));
            }
            return Err(global_this.throw("Expected value must be a function", format_args!("")));
        }

        let mut return_value: JSValue = JSValue::ZERO;

        // Drain existing unhandled rejections
        vm.global.handle_rejected_promises();

        let mut scope = vm.unhandled_rejection_scope();
        let prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
        vm.unhandled_pending_rejection_to_capture = Some(&mut return_value as *mut JSValue);
        vm.on_unhandled_rejection = VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;
        return_value_from_function = match value.call(global_this, JSValue::UNDEFINED, &[]) {
            Ok(v) => v,
            Err(err) => global_this.take_exception(err),
        };
        vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;

        vm.global.handle_rejected_promises();

        if return_value.is_empty() {
            return_value = return_value_from_function;
        }

        if let Some(promise) = return_value.as_any_promise() {
            vm.wait_for_promise(promise);
            scope.apply(vm);
            match promise.unwrap(global_this.vm(), bun_jsc::UnwrapMode::MarkHandled) {
                bun_jsc::PromiseUnwrap::Fulfilled(_) => {
                    return Ok((None, return_value_from_function));
                }
                bun_jsc::PromiseUnwrap::Rejected(rejected) => {
                    // since we know for sure it rejected, we should always return the error
                    return Ok((Some(rejected.to_error().unwrap_or(rejected)), return_value_from_function));
                }
                bun_jsc::PromiseUnwrap::Pending => unreachable!(),
            }
        }

        if return_value != return_value_from_function {
            if let Some(existing) = return_value_from_function.as_any_promise() {
                existing.set_handled(global_this.vm());
            }
        }

        scope.apply(vm);

        Ok((
            return_value.to_error().or_else(|| return_value_from_function.to_error()),
            return_value_from_function,
        ))
    }

    pub fn fn_to_err_string_or_undefined(
        &self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<Option<JSValue>> {
        let (err_value, _) = self.get_value_as_to_throw(global_this, value)?;

        let Some(mut err_value_res) = err_value else { return Ok(None) };
        if err_value_res.is_any_error() {
            let message: JSValue = err_value_res
                .get_truthy_comptime(global_this, "message")?
                .unwrap_or(JSValue::UNDEFINED);
            err_value_res = message;
        } else {
            err_value_res = JSValue::UNDEFINED;
        }
        Ok(Some(err_value_res))
    }

    pub fn trim_leading_whitespace_for_inline_snapshot<'a>(
        str_in: &'a [u8],
        trimmed_buf: &'a mut [u8],
    ) -> TrimResult<'a> {
        debug_assert!(trimmed_buf.len() == str_in.len());
        // PORT NOTE: reshaped for borrowck — track dst as an index into trimmed_buf instead of a moving slice
        let mut src = str_in;
        let trimmed_buf_len = trimmed_buf.len();
        let mut dst_idx: usize = 0;
        let give_up_1 = TrimResult { trimmed: str_in, start_indent: None, end_indent: None };
        // if the line is all whitespace, trim fully
        // the first line containing a character determines the max trim count

        // read first line (should be all-whitespace)
        let Some(first_newline) = bun_str::strings::index_of(src, b"\n") else { return give_up_1 };
        for &ch in &src[..first_newline] {
            if ch != b' ' && ch != b'\t' { return give_up_1; }
        }
        src = &src[first_newline + 1..];

        // read first real line and get indent
        let indent_len = src
            .iter()
            .position(|&ch| ch != b' ' && ch != b'\t')
            .unwrap_or(src.len());
        let indent_str = &src[..indent_len];
        // TODO(port): give_up_2 borrows both str_in and indent_str; with dst_idx tracking we can rebuild it at each return site
        macro_rules! give_up_2 {
            () => {
                TrimResult { trimmed: str_in, start_indent: Some(indent_str), end_indent: Some(indent_str) }
            };
        }
        if indent_len == 0 { return give_up_2!(); } // no indent to trim; save time
        // we're committed now
        trimmed_buf[dst_idx] = b'\n';
        dst_idx += 1;
        src = &src[indent_len..];
        let Some(nl) = bun_str::strings::index_of(src, b"\n") else { return give_up_2!(); };
        let second_newline = nl + 1;
        trimmed_buf[dst_idx..dst_idx + second_newline].copy_from_slice(&src[..second_newline]);
        src = &src[second_newline..];
        dst_idx += second_newline;

        while !src.is_empty() {
            // try read indent
            let max_indent_len = src.len().min(indent_len);
            let line_indent_len = src[..max_indent_len]
                .iter()
                .position(|&ch| ch != b' ' && ch != b'\t')
                .unwrap_or(max_indent_len);
            src = &src[line_indent_len..];

            if line_indent_len < max_indent_len {
                if src.is_empty() {
                    // perfect; done
                    break;
                }
                if src[0] == b'\n' {
                    // this line has less indentation than the first line, but it's empty so that's okay.
                    trimmed_buf[dst_idx] = b'\n';
                    src = &src[1..];
                    dst_idx += 1;
                    continue;
                }
                // this line had less indentation than the first line, but wasn't empty. give up.
                return give_up_2!();
            } else {
                // this line has the same or more indentation than the first line. copy it.
                let line_newline = match bun_str::strings::index_of(src, b"\n") {
                    Some(n) => n + 1,
                    None => {
                        // this is the last line. if it's not all whitespace, give up
                        for &ch in src {
                            if ch != b' ' && ch != b'\t' { return give_up_2!(); }
                        }
                        break;
                    }
                };
                trimmed_buf[dst_idx..dst_idx + line_newline].copy_from_slice(&src[..line_newline]);
                src = &src[line_newline..];
                dst_idx += line_newline;
            }
        }
        let Some(c) = str_in.iter().rposition(|&b| b == b'\n') else { return give_up_2!(); }; // there has to have been at least a single newline to get here
        let end_indent = c + 1;
        for &c in &str_in[end_indent..] {
            if c != b' ' && c != b'\t' { return give_up_2!(); } // we already checked, but the last line is not all whitespace again
        }

        // done
        TrimResult {
            trimmed: &trimmed_buf[..trimmed_buf_len - (trimmed_buf_len - dst_idx)],
            // PORT NOTE: equivalent to trimmed_buf[0 .. trimmed_buf.len - dst.len]; with index tracking dst.len == trimmed_buf_len - dst_idx
            start_indent: Some(indent_str),
            end_indent: Some(&str_in[end_indent..]),
        }
        // TODO(port): borrowck — returning slices of both str_in and trimmed_buf; verify lifetime 'a covers both
    }

    pub fn inline_snapshot(
        this: &mut Self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        value: JSValue,
        property_matchers: Option<JSValue>,
        result: Option<&[u8]>,
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        // jest counts inline snapshots towards the snapshot counter for some reason
        let Some(runner) = Jest::runner() else {
            let signature = Self::get_signature(fn_name, "", false);
            return Err(this.throw(global_this, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n", format_args!("")));
        };
        match runner.snapshots.add_count(this, b"") {
            Ok(_) => {}
            Err(e) if e == bun_core::err!("OutOfMemory") => return Err(JsError::OutOfMemory),
            Err(e) if e == bun_core::err!("NoTest") => {}
            Err(e) if e == bun_core::err!("SnapshotInConcurrentGroup") => {}
            Err(e) if e == bun_core::err!("TestNotActive") => {}
            Err(_) => {}
        }

        let update = runner.snapshots.update_snapshots;
        let mut needs_write = false;

        let mut pretty_value: Vec<u8> = Vec::new();
        this.match_and_fmt_snapshot(global_this, value, property_matchers, &mut pretty_value, fn_name)?;

        let mut start_indent: Option<Box<[u8]>> = None;
        let mut end_indent: Option<Box<[u8]>> = None;
        if let Some(saved_value) = result {
            let mut buf = vec![0u8; saved_value.len()];
            let trim_res = Self::trim_leading_whitespace_for_inline_snapshot(saved_value, &mut buf);

            if strings::eql_long(&pretty_value, trim_res.trimmed, true) {
                runner.snapshots.passed += 1;
                return Ok(JSValue::UNDEFINED);
            } else if update {
                runner.snapshots.passed += 1;
                needs_write = true;
                start_indent = trim_res.start_indent.map(Box::<[u8]>::from);
                end_indent = trim_res.end_indent.map(Box::<[u8]>::from);
            } else {
                runner.snapshots.failed += 1;
                let signature = Self::get_signature(fn_name, "<green>expected<r>", false);
                // TODO(port): comptime string concatenation signature ++ "\n\n{f}\n"
                let diff_format = DiffFormatter {
                    received_string: Some(&pretty_value),
                    expected_string: Some(trim_res.trimmed),
                    global_this,
                    ..Default::default()
                };
                return Err(global_this.throw_pretty(signature, format_args!("\n\n{}\n", diff_format)));
            }
        } else {
            needs_write = true;
        }

        if needs_write {
            if bun_core::ci::is_ci() {
                if !update {
                    let signature = Self::get_signature(fn_name, "", false);
                    // Only creating new snapshots can reach here (updating with mismatches errors earlier with diff)
                    return Err(this.throw(
                        global_this,
                        signature,
                        "\n\n<b>Matcher error<r>: Inline snapshot creation is disabled in CI environments unless --update-snapshots is used.\nTo override, set the environment variable CI=false.\n\nReceived: {s}",
                        format_args!("{}", bstr::BStr::new(&pretty_value)),
                    ));
                }
            }
            let Some(mut buntest_strong) = this.bun_test() else {
                let signature = Self::get_signature(fn_name, "", false);
                return Err(this.throw(global_this, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n", format_args!("")));
            };
            let buntest = buntest_strong.get();

            // 1. find the src loc of the snapshot
            let srcloc = call_frame.get_caller_src_loc(global_this);
            let file_id = buntest.file_id;
            let fget = runner.files.get(file_id);

            if !srcloc.str.eql_utf8(fget.source.path.text) {
                let signature = Self::get_signature(fn_name, "", false);
                return Err(this.throw(
                    global_this,
                    signature,
                    "\n\n<b>Matcher error<r>: Inline snapshot matchers must be called from the test file:\n  Expected to be called from file: <green>\"{f}\"<r>\n  {s} called from file: <red>\"{f}\"<r>\n",
                    format_args!(
                        "{:?} {} {:?}",
                        bstr::BStr::new(fget.source.path.text),
                        fn_name,
                        // TODO(port): std.zig.fmtString — escaped string display
                        bstr::BStr::new(srcloc.str.to_utf8().slice()),
                    ),
                ));
            }

            // 2. save to write later
            runner.snapshots.add_inline_snapshot_to_write(file_id, crate::test_runner::snapshot::InlineSnapshotToWrite {
                line: srcloc.line,
                col: srcloc.column,
                value: core::mem::take(&mut pretty_value).into_boxed_slice(),
                has_matchers: property_matchers.is_some(),
                is_added: result.is_none(),
                kind: fn_name,
                start_indent,
                end_indent,
            })?;
        }

        Ok(JSValue::UNDEFINED)
    }

    pub fn match_and_fmt_snapshot(
        &self,
        global_this: &JSGlobalObject,
        value: JSValue,
        property_matchers: Option<JSValue>,
        pretty_value: &mut impl bun_io::Write,
        fn_name: &'static str,
    ) -> JsResult<()> {
        if let Some(_prop_matchers) = property_matchers {
            if !value.is_object() {
                let signature = Self::get_signature(fn_name, "<green>properties<r><d>, <r>hint", false);
                return Err(self.throw(global_this, signature, "\n\n<b>Matcher error: <red>received<r> values must be an object when the matcher has <green>properties<r>\n", format_args!("")));
            }

            let prop_matchers = _prop_matchers;

            if !value.jest_deep_match(prop_matchers, global_this, true)? {
                // TODO: print diff with properties from propertyMatchers
                let signature = Self::get_signature(fn_name, "<green>propertyMatchers<r>", false);
                // TODO(port): comptime string concatenation
                let mut formatter = ConsoleObject::Formatter::new(global_this);
                return Err(global_this.throw_pretty(
                    signature,
                    format_args!(
                        "\n\nExpected <green>propertyMatchers<r> to match properties from received object\n\nReceived: {}\n",
                        value.to_fmt(&mut formatter)
                    ),
                ));
            }
        }

        if value.jest_snapshot_pretty_format(pretty_value, global_this).is_err() {
            let mut formatter = ConsoleObject::Formatter::new(global_this);
            return Err(global_this.throw(
                "Failed to pretty format value: {f}",
                format_args!("{}", value.to_fmt(&mut formatter)),
            ));
        }
        Ok(())
    }

    pub fn snapshot(
        this: &mut Self,
        global_this: &JSGlobalObject,
        value: JSValue,
        property_matchers: Option<JSValue>,
        hint: &[u8],
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        let mut pretty_value: Vec<u8> = Vec::new();
        this.match_and_fmt_snapshot(global_this, value, property_matchers, &mut pretty_value, fn_name)?;

        let runner = Jest::runner().expect("unreachable");
        let existing_value = match runner.snapshots.get_or_put(this, &pretty_value, hint) {
            Ok(v) => v,
            Err(err) => {
                let Some(mut buntest_strong) = this.bun_test() else {
                    return Err(global_this.throw("Snapshot matchers cannot be used outside of a test", format_args!("")));
                };
                let buntest = buntest_strong.get();
                let test_file_path = runner.files.get(buntest.file_id).source.path.text;
                return Err(match err {
                    e if e == bun_core::err!("FailedToOpenSnapshotFile") => {
                        global_this.throw("Failed to open snapshot file for test file: {s}", format_args!("{}", bstr::BStr::new(test_file_path)))
                    }
                    e if e == bun_core::err!("FailedToMakeSnapshotDirectory") => {
                        global_this.throw("Failed to make snapshot directory for test file: {s}", format_args!("{}", bstr::BStr::new(test_file_path)))
                    }
                    e if e == bun_core::err!("FailedToWriteSnapshotFile") => {
                        global_this.throw("Failed write to snapshot file: {s}", format_args!("{}", bstr::BStr::new(test_file_path)))
                    }
                    e if e == bun_core::err!("SyntaxError") || e == bun_core::err!("ParseError") => {
                        global_this.throw("Failed to parse snapshot file for: {s}", format_args!("{}", bstr::BStr::new(test_file_path)))
                    }
                    e if e == bun_core::err!("SnapshotCreationNotAllowedInCI") => {
                        let snapshot_name = runner.snapshots.last_error_snapshot_name.take();
                        if let Some(name) = snapshot_name {
                            global_this.throw(
                                "Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nSnapshot name: \"{s}\"\nReceived: {s}",
                                format_args!("{} {}", bstr::BStr::new(&name), bstr::BStr::new(&pretty_value)),
                            )
                        } else {
                            global_this.throw(
                                "Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nReceived: {s}",
                                format_args!("{}", bstr::BStr::new(&pretty_value)),
                            )
                        }
                    }
                    e if e == bun_core::err!("SnapshotInConcurrentGroup") => {
                        global_this.throw("Snapshot matchers are not supported in concurrent tests", format_args!(""))
                    }
                    e if e == bun_core::err!("TestNotActive") => {
                        global_this.throw("Snapshot matchers are not supported after the test has finished executing", format_args!(""))
                    }
                    _ => {
                        let mut formatter = ConsoleObject::Formatter::new(global_this);
                        global_this.throw("Failed to snapshot value: {f}", format_args!("{}", value.to_fmt(&mut formatter)))
                    }
                });
            }
        };

        if let Some(saved_value) = existing_value {
            if strings::eql_long(&pretty_value, saved_value, true) {
                runner.snapshots.passed += 1;
                return Ok(JSValue::UNDEFINED);
            }

            runner.snapshots.failed += 1;
            let signature = Self::get_signature(fn_name, "<green>expected<r>", false);
            // TODO(port): comptime string concatenation signature ++ "\n\n{f}\n"
            let diff_format = DiffFormatter {
                received_string: Some(&pretty_value),
                expected_string: Some(saved_value),
                global_this,
                ..Default::default()
            };
            return Err(global_this.throw_pretty(signature, format_args!("\n\n{}\n", diff_format)));
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_static_not(global_this: &JSGlobalObject, _: JSValue, _: JSValue) -> JsResult<JSValue> {
        let mut f = Flags::default();
        f.set_not(true);
        ExpectStatic::create(global_this, f)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_static_resolves_to(global_this: &JSGlobalObject, _: JSValue, _: JSValue) -> JsResult<JSValue> {
        let mut f = Flags::default();
        f.set_promise(Promise::Resolves);
        ExpectStatic::create(global_this, f)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_static_rejects_to(global_this: &JSGlobalObject, _: JSValue, _: JSValue) -> JsResult<JSValue> {
        let mut f = Flags::default();
        f.set_promise(Promise::Rejects);
        ExpectStatic::create(global_this, f)
    }

    #[bun_jsc::host_fn]
    pub fn any(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectAny::call(global_this, call_frame)
    }

    #[bun_jsc::host_fn]
    pub fn anything(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectAnything::call(global_this, call_frame)
    }

    #[bun_jsc::host_fn]
    pub fn close_to(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectCloseTo::call(global_this, call_frame)
    }

    #[bun_jsc::host_fn]
    pub fn object_containing(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectObjectContaining::call(global_this, call_frame)
    }

    #[bun_jsc::host_fn]
    pub fn string_containing(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectStringContaining::call(global_this, call_frame)
    }

    #[bun_jsc::host_fn]
    pub fn string_matching(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectStringMatching::call(global_this, call_frame)
    }

    #[bun_jsc::host_fn]
    pub fn array_containing(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectArrayContaining::call(global_this, call_frame)
    }

    /// Implements `expect.extend({ ... })`
    #[bun_jsc::host_fn]
    pub fn extend(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old(1).slice();

        if args.is_empty() || !args[0].is_object() {
            return Err(global_this.throw_pretty(
                "<d>expect.<r>extend<d>(<r>matchers<d>)<r>\n\nExpected an object containing matchers\n",
                format_args!(""),
            ));
        }

        // SAFETY: FFI call with valid &JSGlobalObject
        let mut expect_proto = unsafe { Expect__getPrototype(global_this) };
        let mut expect_constructor = Self::js::get_constructor(global_this);
        // SAFETY: FFI call with valid &JSGlobalObject
        let mut expect_static_proto = unsafe { ExpectStatic__getPrototype(global_this) };

        // SAFETY: already checked that args[0] is an object
        let matchers_to_register = args[0].get_object().expect("unreachable");
        {
            let mut iter = JSPropertyIterator::init(
                global_this,
                matchers_to_register,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                    own_properties_only: false,
                },
            )?;

            while let Some(matcher_name) = iter.next()? {
                let matcher_fn: JSValue = iter.value;

                if !matcher_fn.js_type().is_function() {
                    let type_name = if matcher_fn.is_null() {
                        bun_str::String::static_("null")
                    } else {
                        bun_str::String::init(matcher_fn.js_type_string(global_this).get_zig_string(global_this))
                    };
                    return Err(global_this.throw_invalid_arguments(
                        "expect.extend: `{f}` is not a valid matcher. Must be a function, is \"{f}\"",
                        format_args!("{} {}", matcher_name, type_name),
                    ));
                }

                // Mutate the Expect/ExpectStatic prototypes/constructor with new instances of JSCustomExpectMatcherFunction.
                // Even though they point to the same native functions for all matchers,
                // multiple instances are created because each instance will hold the matcher_fn as a property

                // SAFETY: FFI call with valid global, &bun_str::String, host-fn ptr, and JSValue
                let wrapper_fn = unsafe {
                    Bun__JSWrappingFunction__create(
                        global_this,
                        &matcher_name,
                        bun_jsc::to_js_host_fn(Self::apply_custom_matcher),
                        matcher_fn,
                        true,
                    )
                };

                expect_proto.put_may_be_index(global_this, &matcher_name, wrapper_fn)?;
                expect_constructor.put_may_be_index(global_this, &matcher_name, wrapper_fn)?;
                expect_static_proto.put_may_be_index(global_this, &matcher_name, wrapper_fn)?;
            }
        }

        global_this.bun_vm().auto_garbage_collect();

        Ok(JSValue::UNDEFINED)
    }

    #[cold]
    fn throw_invalid_matcher_error(
        global_this: &JSGlobalObject,
        matcher_name: bun_str::String,
        result: JSValue,
    ) -> JsError {
        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);

        const FMT: &str = concat!(
            "Unexpected return from matcher function `{f}`.\n",
            "Matcher functions should return an object in the following format:\n",
            "  {{message?: string | function, pass: boolean}}\n",
            "'{f}' was returned",
        );
        // PERF(port): was comptime bool dispatch — profile in Phase B
        let err = global_this.create_error_instance(
            Output::pretty_fmt(FMT, Output::enable_ansi_colors_stderr()),
            format_args!("{} {}", matcher_name, result.to_fmt(&mut formatter)),
        );
        // TODO(port): handle JsResult from toJS in throw path
        err.put(
            global_this,
            ZigString::static_("name"),
            bun_str::String::static_("InvalidMatcherError").to_js(global_this).unwrap_or(JSValue::UNDEFINED),
        );
        global_this.throw_value(err)
    }

    /// Execute the custom matcher for the given args (the left value + the args passed to the matcher call).
    /// This function is called both for symmetric and asymmetric matching.
    /// If silent=false, throws an exception in JS if the matcher result didn't result in a pass (or if the matcher result is invalid).
    pub fn execute_custom_matcher(
        global_this: &JSGlobalObject,
        matcher_name: bun_str::String,
        matcher_fn: JSValue,
        args: &[JSValue],
        flags: Flags,
        silent: bool,
    ) -> JsResult<bool> {
        // prepare the this object
        let matcher_context = Box::new(ExpectMatcherContext { flags });
        let matcher_context = Box::into_raw(matcher_context);
        // SAFETY: to_js takes ownership of m_ctx
        let matcher_context_jsvalue = unsafe { (*matcher_context).to_js(global_this) };
        matcher_context_jsvalue.ensure_still_alive();

        // call the custom matcher implementation
        let mut result = matcher_fn.call(global_this, matcher_context_jsvalue, args)?;
        // support for async matcher results
        if let Some(promise) = result.as_any_promise() {
            let vm = global_this.vm();
            promise.set_handled(vm);

            global_this.bun_vm().wait_for_promise(promise);

            result = promise.result(vm);
            result.ensure_still_alive();
            debug_assert!(!result.is_empty());
            match promise.status() {
                bun_jsc::PromiseStatus::Pending => unreachable!(),
                bun_jsc::PromiseStatus::Fulfilled => {}
                bun_jsc::PromiseStatus::Rejected => {
                    // TODO: rewrite this code to use .then() instead of blocking the event loop
                    VirtualMachine::get().run_error_handler(result, None);
                    return Err(global_this.throw(
                        "Matcher `{f}` returned a promise that rejected",
                        format_args!("{}", matcher_name),
                    ));
                }
            }
        }

        let mut pass: bool;
        let message: JSValue;

        // Parse and validate the custom matcher result, which should conform to: { pass: boolean, message?: () => string }
        let is_valid = 'valid: {
            if result.is_object() {
                if let Some(pass_value) = result.get(global_this, "pass")? {
                    pass = pass_value.to_boolean();

                    if let Some(message_value) = result.fast_get(global_this, bun_jsc::BuiltinName::Message)? {
                        if !message_value.is_string() && !message_value.is_callable() {
                            break 'valid false;
                        }
                        message = message_value;
                    } else {
                        message = JSValue::UNDEFINED;
                    }

                    break 'valid true;
                }
            }
            // initialize to keep Rust happy on the !is_valid path
            pass = false;
            message = JSValue::UNDEFINED;
            false
        };
        if !is_valid {
            return Err(Self::throw_invalid_matcher_error(global_this, matcher_name, result));
        }

        if flags.not() { pass = !pass; }
        if pass || silent { return Ok(pass); }

        // handle failure
        let mut message_text: bun_str::String = bun_str::String::dead();
        if message.is_undefined() {
            message_text = bun_str::String::static_("No message was specified for this matcher.");
        } else if message.is_string() {
            message_text = message.to_bun_string(global_this)?;
        } else {
            if cfg!(debug_assertions) {
                debug_assert!(message.is_callable()); // checked above
            }

            let message_result = message.call_with_global_this(global_this, &[])?;
            message_text = bun_str::String::from_js(message_result, global_this)?;
        }

        let matcher_params = CustomMatcherParamsFormatter {
            colors: Output::enable_ansi_colors_stderr(),
            global_this,
            matcher_fn,
        };
        Err(Self::throw_pretty_matcher_error(
            global_this,
            bun_str::String::empty(),
            matcher_name,
            matcher_params,
            Flags::default(),
            "{f}",
            format_args!("{}", message_text),
        ))
    }

    /// Function that is run for either `expect.myMatcher()` call or `expect().myMatcher` call,
    /// and we can known which case it is based on if the `callFrame.this()` value is an instance of Expect
    #[bun_jsc::host_fn]
    pub fn apply_custom_matcher(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let _gc = scopeguard::guard((), |_| global_this.bun_vm().auto_garbage_collect());

        // retrieve the user-provided matcher function (matcher_fn)
        let func: JSValue = call_frame.callee();
        let mut matcher_fn: JSValue = get_custom_matcher_fn(func, global_this).unwrap_or(JSValue::UNDEFINED);
        if !matcher_fn.js_type().is_function() {
            return Err(global_this.throw(
                "Internal consistency error: failed to retrieve the matcher function for a custom matcher!",
                format_args!(""),
            ));
        }
        matcher_fn.ensure_still_alive();

        // try to retrieve the Expect instance
        let this_value: JSValue = call_frame.this();
        let Some(expect) = Expect::from_js(this_value) else {
            // if no Expect instance, assume it is a static call (`expect.myMatcher()`), so create an ExpectCustomAsymmetricMatcher instance
            return ExpectCustomAsymmetricMatcher::create(global_this, call_frame, matcher_fn);
        };

        // if we got an Expect instance, then it's a non-static call (`expect().myMatcher`),
        // so now execute the symmetric matching

        // retrieve the matcher name
        let matcher_name = matcher_fn.get_name(global_this)?;

        let matcher_params = CustomMatcherParamsFormatter {
            colors: Output::enable_ansi_colors_stderr(),
            global_this,
            matcher_fn,
        };

        // retrieve the captured expected value
        let Some(mut value) = Self::js::captured_value_get_cached(this_value) else {
            return Err(global_this.throw(
                "Internal consistency error: failed to retrieve the captured value",
                format_args!(""),
            ));
        };
        value = Self::process_promise(
            expect.custom_label.clone(),
            expect.flags,
            global_this,
            value,
            &matcher_name,
            &matcher_params,
            false,
        )?;
        value.ensure_still_alive();

        expect.increment_expect_call_counter();

        // prepare the args array
        let args = call_frame.arguments();
        // PERF(port): was stack-fallback allocator — profile in Phase B
        let mut matcher_args = bun_jsc::MarkedArgumentBuffer::new();
        matcher_args.append(value);
        // PERF(port): was assume_capacity
        for arg in args {
            matcher_args.append(*arg);
        }

        let _ = Self::execute_custom_matcher(global_this, matcher_name, matcher_fn, matcher_args.as_slice(), expect.flags, false)?;

        Ok(this_value)
    }

    pub const ADD_SNAPSHOT_SERIALIZER: fn(&JSGlobalObject, &CallFrame) -> JsResult<JSValue> = Self::not_implemented_static_fn;

    #[bun_jsc::host_fn]
    pub fn has_assertions(global_this: &JSGlobalObject, _call_frame: &CallFrame) -> JsResult<JSValue> {
        let _gc = scopeguard::guard((), |_| global_this.bun_vm().auto_garbage_collect());

        let Some(mut buntest_strong) = bun_test::clone_active_strong() else {
            return Err(global_this.throw("expect.assertions() must be called within a test", format_args!("")));
        };
        let buntest = buntest_strong.get();
        let state_data = buntest.get_current_state_data();
        let Some(execution) = state_data.sequence(buntest) else {
            return Err(global_this.throw("expect.assertions() is not supported in the describe phase, in concurrent tests, between tests, or after test execution has completed", format_args!("")));
        };
        if !matches!(execution.expect_assertions, bun_test::ExpectAssertions::Exact(_)) {
            execution.expect_assertions = bun_test::ExpectAssertions::AtLeastOne;
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub fn assertions(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let _gc = scopeguard::guard((), |_| global_this.bun_vm().auto_garbage_collect());

        let arguments_ = call_frame.arguments_old(1);
        let arguments = arguments_.slice();

        if arguments.is_empty() {
            return Err(global_this.throw_invalid_arguments("expect.assertions() takes 1 argument", format_args!("")));
        }

        let expected: JSValue = arguments[0];

        if !expected.is_number() {
            let mut fmt = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
            return Err(global_this.throw(
                "Expected value must be a non-negative integer: {f}",
                format_args!("{}", expected.to_fmt(&mut fmt)),
            ));
        }

        let expected_assertions: f64 = expected.to_number(global_this)?;
        if expected_assertions.round() != expected_assertions
            || expected_assertions.is_infinite()
            || expected_assertions.is_nan()
            || expected_assertions < 0.0
            || expected_assertions > u32::MAX as f64
        {
            let mut fmt = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
            return Err(global_this.throw(
                "Expected value must be a non-negative integer: {f}",
                format_args!("{}", expected.to_fmt(&mut fmt)),
            ));
        }

        let unsigned_expected_assertions: u32 = expected_assertions as u32;

        let Some(mut buntest_strong) = bun_test::clone_active_strong() else {
            return Err(global_this.throw("expect.assertions() must be called within a test", format_args!("")));
        };
        let buntest = buntest_strong.get();
        let state_data = buntest.get_current_state_data();
        let Some(execution) = state_data.sequence(buntest) else {
            return Err(global_this.throw("expect.assertions() is not supported in the describe phase, in concurrent tests, between tests, or after test execution has completed", format_args!("")));
        };
        execution.expect_assertions = bun_test::ExpectAssertions::Exact(unsigned_expected_assertions);

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn not_implemented_jsc_fn(_this: &mut Self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Err(global_this.throw("Not implemented", format_args!("")))
    }

    #[bun_jsc::host_fn]
    pub fn not_implemented_static_fn(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Err(global_this.throw("Not implemented", format_args!("")))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn not_implemented_jsc_prop(_this: &Self, _: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Err(global_this.throw("Not implemented", format_args!("")))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn not_implemented_static_prop(global_this: &JSGlobalObject, _: JSValue, _: JSValue) -> JsResult<JSValue> {
        Err(global_this.throw("Not implemented", format_args!("")))
    }

    pub fn post_match(&self, global_this: &JSGlobalObject) {
        let vm = global_this.bun_vm();
        vm.auto_garbage_collect();
    }

    #[bun_jsc::host_fn]
    pub fn do_unreachable(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arg = callframe.arguments_old(1).ptr[0];

        if arg.is_empty_or_undefined_or_null() {
            let error_value = bun_str::String::init("reached unreachable code").to_error_instance(global_this);
            error_value.put(global_this, ZigString::static_("name"), bun_str::String::init("UnreachableError").to_js(global_this)?);
            return Err(global_this.throw_value(error_value));
        }

        if arg.is_string() {
            let error_value = arg.to_bun_string(global_this)?.to_error_instance(global_this);
            error_value.put(global_this, ZigString::static_("name"), bun_str::String::init("UnreachableError").to_js(global_this)?);
            return Err(global_this.throw_value(error_value));
        }

        Err(global_this.throw_value(arg))
    }
}

pub struct CustomMatcherParamsFormatter<'a> {
    pub colors: bool,
    pub global_this: &'a JSGlobalObject,
    pub matcher_fn: JSValue,
}

impl fmt::Display for CustomMatcherParamsFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        // try to detect param names from matcher_fn (user function) source code
        if let Some(source_str) = JSFunction::get_source_code(self.matcher_fn) {
            let source_slice = source_str.to_utf8();

            let source: &[u8] = source_slice.slice();
            if let Some(lparen) = source.iter().position(|&b| b == b'(') {
                if let Some(rparen_rel) = source[lparen..].iter().position(|&b| b == b')') {
                    let rparen = lparen + rparen_rel;
                    let params_str = &source[lparen + 1..rparen];
                    let mut param_index: usize = 0;
                    for param_name in params_str.split(|&b| b == b',') {
                        if param_index > 0 {
                            // skip the first param from the matcher_fn, which is the received value
                            if param_index > 1 {
                                writer.write_str(if self.colors {
                                    Output::pretty_fmt("<r><d>, <r><green>", true)
                                } else {
                                    ", "
                                })?;
                            } else if self.colors {
                                writer.write_str("<green>")?;
                            }
                            let param_name_trimmed = bun_str::strings::trim(param_name, b" ");
                            if !param_name_trimmed.is_empty() {
                                write!(writer, "{}", bstr::BStr::new(param_name_trimmed))?;
                            } else {
                                write!(writer, "arg{}", param_index - 1)?;
                            }
                        }
                        param_index += 1;
                    }
                    if param_index > 1 && self.colors {
                        writer.write_str("<r>")?;
                    }
                    return Ok(()); // don't do fallback
                }
            }
        }

        // fallback
        // PERF(port): was comptime bool dispatch — profile in Phase B
        writer.write_str(Output::pretty_fmt("<green>...args<r>", self.colors))
    }
}

/// Static instance of expect, holding a set of flags.
/// Returned for example when executing `expect.not`
#[bun_jsc::JsClass]
pub struct ExpectStatic {
    pub flags: Flags,
}

impl ExpectStatic {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload
        unsafe { drop(Box::from_raw(this)) };
    }

    pub fn create(global_this: &JSGlobalObject, flags: Flags) -> JsResult<JSValue> {
        let expect = Box::into_raw(Box::new(ExpectStatic { flags }));
        // SAFETY: to_js takes ownership of m_ctx
        let value = unsafe { (*expect).to_js(global_this) };
        value.ensure_still_alive();
        Ok(value)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_not(this: &Self, _: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut flags = this.flags;
        flags.set_not(!this.flags.not());
        Self::create(global_this, flags)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_resolves_to(this: &Self, _: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut flags = this.flags;
        if flags.promise() != Promise::None {
            return Err(Self::async_chaining_error(global_this, flags, b"resolvesTo"));
        }
        flags.set_promise(Promise::Resolves);
        Self::create(global_this, flags)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_rejects_to(this: &Self, _: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut flags = this.flags;
        if flags.promise() != Promise::None {
            return Err(Self::async_chaining_error(global_this, flags, b"rejectsTo"));
        }
        flags.set_promise(Promise::Rejects);
        Self::create(global_this, flags)
    }

    #[cold]
    fn async_chaining_error(global_this: &JSGlobalObject, flags: Flags, name: &[u8]) -> JsError {
        let str = match flags.promise() {
            Promise::Resolves => "resolvesTo",
            Promise::Rejects => "rejectsTo",
            _ => unreachable!(),
        };
        global_this.throw(
            "expect.{s}: already called expect.{s} on this chain",
            format_args!("{} {}", bstr::BStr::new(name), str),
        )
    }

    fn create_asymmetric_matcher_with_flags<T: AsymmetricMatcherClass>(
        this: &Self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        //const this: *ExpectStatic = ExpectStatic.fromJS(callFrame.this());
        let instance_jsvalue = T::call(global_this, call_frame)?;
        if !instance_jsvalue.is_empty() && !instance_jsvalue.is_any_error() {
            let Some(instance) = T::from_js(instance_jsvalue) else {
                return Err(global_this.throw_out_of_memory());
            };
            *instance.flags_mut() = this.flags;
        }
        Ok(instance_jsvalue)
    }

    #[bun_jsc::host_fn(method)]
    pub fn anything(this: &mut Self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectAnything>(this, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn any(this: &mut Self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectAny>(this, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn array_containing(this: &mut Self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectArrayContaining>(this, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn close_to(this: &mut Self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectCloseTo>(this, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn object_containing(this: &mut Self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectObjectContaining>(this, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn string_containing(this: &mut Self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectStringContaining>(this, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn string_matching(this: &mut Self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectStringMatching>(this, global_this, call_frame)
    }
}

// TODO(port): trait stub for createAsymmetricMatcherWithFlags generic
pub trait AsymmetricMatcherClass {
    fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue>;
    fn from_js(value: JSValue) -> Option<&'static mut Self>;
    fn flags_mut(&mut self) -> &mut Flags;
}

#[bun_jsc::JsClass]
pub struct ExpectAnything {
    pub flags: Flags,
}

impl ExpectAnything {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn]
    pub fn call(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let anything = Box::into_raw(Box::new(ExpectAnything { flags: Flags::default() }));

        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        let anything_js_value = unsafe { (*anything).to_js(global_this) };
        anything_js_value.ensure_still_alive();

        let vm = global_this.bun_vm();
        vm.auto_garbage_collect();

        Ok(anything_js_value)
    }
}

#[bun_jsc::JsClass]
pub struct ExpectStringMatching {
    pub flags: Flags,
}

impl ExpectStringMatching {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn]
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments();

        if args.is_empty() || (!args[0].is_string() && !args[0].is_reg_exp()) {
            const FMT: &str = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string or regular expression\n";
            return Err(global_this.throw_pretty(FMT, format_args!("")));
        }

        let test_value = args[0];

        let string_matching = Box::into_raw(Box::new(ExpectStringMatching { flags: Flags::default() }));

        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        let string_matching_js_value = unsafe { (*string_matching).to_js(global_this) };
        Self::js::test_value_set_cached(string_matching_js_value, global_this, test_value);

        let vm = global_this.bun_vm();
        vm.auto_garbage_collect();
        Ok(string_matching_js_value)
    }
}

#[bun_jsc::JsClass]
pub struct ExpectCloseTo {
    pub flags: Flags,
}

impl ExpectCloseTo {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn]
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old(2).slice();

        if args.is_empty() || !args[0].is_number() {
            return Err(global_this.throw_pretty(
                "<d>expect.<r>closeTo<d>(<r>number<d>, precision?)<r>\n\nExpected a number value",
                format_args!(""),
            ));
        }
        let number_value = args[0];

        let mut precision_value: JSValue = if args.len() > 1 { args[1] } else { JSValue::UNDEFINED };
        if precision_value.is_undefined() {
            precision_value = JSValue::js_number_from_int32(2); // default value from jest
        }
        if !precision_value.is_number() {
            return Err(global_this.throw_pretty(
                "<d>expect.<r>closeTo<d>(number, <r>precision?<d>)<r>\n\nPrecision must be a number or undefined",
                format_args!(""),
            ));
        }

        let instance = Box::into_raw(Box::new(ExpectCloseTo { flags: Flags::default() }));

        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        let instance_jsvalue = unsafe { (*instance).to_js(global_this) };
        number_value.ensure_still_alive();
        precision_value.ensure_still_alive();
        Self::js::number_value_set_cached(instance_jsvalue, global_this, number_value);
        Self::js::digits_value_set_cached(instance_jsvalue, global_this, precision_value);

        let vm = global_this.bun_vm();
        vm.auto_garbage_collect();
        Ok(instance_jsvalue)
    }
}

#[bun_jsc::JsClass]
pub struct ExpectObjectContaining {
    pub flags: Flags,
}

impl ExpectObjectContaining {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn]
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old(1).slice();

        if args.is_empty() || !args[0].is_object() {
            const FMT: &str = "<d>expect.<r>objectContaining<d>(<r>object<d>)<r>\n\nExpected an object\n";
            return Err(global_this.throw_pretty(FMT, format_args!("")));
        }

        let object_value = args[0];

        let instance = Box::into_raw(Box::new(ExpectObjectContaining { flags: Flags::default() }));

        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        let instance_jsvalue = unsafe { (*instance).to_js(global_this) };
        Self::js::object_value_set_cached(instance_jsvalue, global_this, object_value);

        let vm = global_this.bun_vm();
        vm.auto_garbage_collect();
        Ok(instance_jsvalue)
    }
}

#[bun_jsc::JsClass]
pub struct ExpectStringContaining {
    pub flags: Flags,
}

impl ExpectStringContaining {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn]
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old(1).slice();

        if args.is_empty() || !args[0].is_string() {
            const FMT: &str = "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string\n";
            return Err(global_this.throw_pretty(FMT, format_args!("")));
        }

        let string_value = args[0];

        let string_containing = Box::into_raw(Box::new(ExpectStringContaining { flags: Flags::default() }));

        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        let string_containing_js_value = unsafe { (*string_containing).to_js(global_this) };
        Self::js::string_value_set_cached(string_containing_js_value, global_this, string_value);

        let vm = global_this.bun_vm();
        vm.auto_garbage_collect();
        Ok(string_containing_js_value)
    }
}

#[bun_jsc::JsClass]
pub struct ExpectAny {
    pub flags: Flags,
}

impl ExpectAny {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn]
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let _arguments = call_frame.arguments_old(1);
        let arguments: &[JSValue] = &_arguments.ptr[.._arguments.len];

        if arguments.is_empty() {
            return Err(global_this.throw(
                "any() expects to be passed a constructor function. Please pass one or use anything() to match any object.",
                format_args!(""),
            ));
        }

        let constructor = arguments[0];
        constructor.ensure_still_alive();
        if !constructor.is_constructor() {
            const FMT: &str = "<d>expect.<r>any<d>(<r>constructor<d>)<r>\n\nExpected a constructor\n";
            return Err(global_this.throw_pretty(FMT, format_args!("")));
        }

        let asymmetric_matcher_constructor_type = AsymmetricMatcherConstructorType::from_js(global_this, constructor)?;

        // I don't think this case is possible, but just in case!
        if global_this.has_exception() {
            return Err(JsError::Thrown);
        }

        let mut flags = Flags::default();
        flags.set_asymmetric_matcher_constructor_type(asymmetric_matcher_constructor_type);
        let any = Box::into_raw(Box::new(ExpectAny { flags }));

        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        let any_js_value = unsafe { (*any).to_js(global_this) };
        any_js_value.ensure_still_alive();
        Self::js::constructor_value_set_cached(any_js_value, global_this, constructor);
        any_js_value.ensure_still_alive();

        let vm = global_this.bun_vm();
        vm.auto_garbage_collect();

        Ok(any_js_value)
    }
}

#[bun_jsc::JsClass]
pub struct ExpectArrayContaining {
    pub flags: Flags,
}

impl ExpectArrayContaining {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn]
    pub fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old(1).slice();

        if args.is_empty() || !args[0].js_type().is_array() {
            const FMT: &str = "<d>expect.<r>arrayContaining<d>(<r>array<d>)<r>\n\nExpected a array\n";
            return Err(global_this.throw_pretty(FMT, format_args!("")));
        }

        let array_value = args[0];

        let array_containing = Box::into_raw(Box::new(ExpectArrayContaining { flags: Flags::default() }));

        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        let array_containing_js_value = unsafe { (*array_containing).to_js(global_this) };
        Self::js::array_value_set_cached(array_containing_js_value, global_this, array_value);

        let vm = global_this.bun_vm();
        vm.auto_garbage_collect();
        Ok(array_containing_js_value)
    }
}

/// An instantiated asymmetric custom matcher, returned from calls to `expect.toCustomMatch(...)`
///
/// Reference: `AsymmetricMatcher` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
/// (but only created for *custom* matchers, as built-ins have their own classes)
#[bun_jsc::JsClass]
pub struct ExpectCustomAsymmetricMatcher {
    pub flags: Flags,
}

impl ExpectCustomAsymmetricMatcher {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    /// Implements the static call of the custom matcher (`expect.myCustomMatcher(<args>)`),
    /// which creates an asymmetric matcher instance (`ExpectCustomAsymmetricMatcher`).
    /// This will not run the matcher, but just capture the args etc.
    pub fn create(global_this: &JSGlobalObject, call_frame: &CallFrame, matcher_fn: JSValue) -> JsResult<JSValue> {
        let flags: Flags;

        // try to retrieve the ExpectStatic instance (to get the flags)
        if let Some(expect_static) = ExpectStatic::from_js(call_frame.this()) {
            flags = expect_static.flags;
        } else {
            // if it's not an ExpectStatic instance, assume it was called from the Expect constructor, so use the default flags
            flags = Flags::default();
        }

        // create the matcher instance
        let instance = Box::into_raw(Box::new(ExpectCustomAsymmetricMatcher { flags: Flags::default() }));

        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        let instance_jsvalue = unsafe { (*instance).to_js(global_this) };
        instance_jsvalue.ensure_still_alive();

        // store the flags
        // SAFETY: instance is the m_ctx payload kept alive by instance_jsvalue (ensure_still_alive above)
        unsafe { (*instance).flags = flags };

        // store the user-provided matcher function into the instance
        Self::js::matcher_fn_set_cached(instance_jsvalue, global_this, matcher_fn);

        // capture the args as a JS array saved in the instance, so the matcher can be executed later on with them
        let args = call_frame.arguments();
        let array = JSValue::create_empty_array(global_this, args.len())?;
        for (i, arg) in args.iter().enumerate() {
            array.put_index(global_this, i as u32, *arg)?;
        }
        Self::js::captured_args_set_cached(instance_jsvalue, global_this, array);
        array.ensure_still_alive();

        // return the same instance, now fully initialized including the captured args (previously it was incomplete)
        Ok(instance_jsvalue)
    }

    fn execute_impl(
        this: &Self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
        received: JSValue,
    ) -> JsResult<bool> {
        // retrieve the user-provided matcher implementation function (the function passed to expect.extend({ ... }))
        let Some(matcher_fn) = Self::js::matcher_fn_get_cached(this_value) else {
            return Err(global_this.throw(
                "Internal consistency error: the ExpectCustomAsymmetricMatcher(matcherFn) was garbage collected but it should not have been!",
                format_args!(""),
            ));
        };
        matcher_fn.ensure_still_alive();
        if !matcher_fn.js_type().is_function() {
            return Err(global_this.throw(
                "Internal consistency error: the ExpectCustomMatcher(matcherFn) is not a function!",
                format_args!(""),
            ));
        }

        // retrieve the matcher name
        let matcher_name = matcher_fn.get_name(global_this)?;

        // retrieve the asymmetric matcher args
        // if null, it means the function has not yet been called to capture the args, which is a misuse of the matcher
        let Some(captured_args) = Self::js::captured_args_get_cached(this_value) else {
            return Err(global_this.throw(
                "expect.{f} misused, it needs to be instantiated by calling it with 0 or more arguments",
                format_args!("{}", matcher_name),
            ));
        };
        captured_args.ensure_still_alive();

        // prepare the args array as `[received, ...captured_args]`
        let args_count = captured_args.get_length(global_this)?;
        // PERF(port): was stack-fallback allocator — profile in Phase B
        let mut matcher_args = bun_jsc::MarkedArgumentBuffer::new();
        matcher_args.append(received);
        // PERF(port): was assume_capacity
        for i in 0..args_count {
            matcher_args.append(captured_args.get_index(global_this, i as u32)?);
        }

        Expect::execute_custom_matcher(global_this, matcher_name, matcher_fn, matcher_args.as_slice(), this.flags, true)
    }

    /// Function called by c++ function "matchAsymmetricMatcher" to execute the custom matcher against the provided leftValue
    #[unsafe(no_mangle)]
    pub extern "C" fn ExpectCustomAsymmetricMatcher__execute(
        this: *mut Self,
        this_value: JSValue,
        global_this: *const JSGlobalObject,
        received: JSValue,
    ) -> bool {
        // SAFETY: called from C++ with valid pointers
        unsafe { Self::execute_impl(&*this, this_value, &*global_this, received) }.unwrap_or(false)
    }

    #[bun_jsc::host_fn(method)]
    pub fn asymmetric_match(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(1).slice();
        let received_value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        let matched = Self::execute_impl(this, callframe.this(), global_this, received_value)?;
        Ok(JSValue::from(matched))
    }

    fn maybe_clear<const DONT_THROW: bool>(global_this: &JSGlobalObject, err: JsError) -> JsResult<bool> {
        if DONT_THROW {
            global_this.clear_exception();
            return Ok(false);
        }
        Err(err)
    }

    /// Calls a custom implementation (if provided) to stringify this asymmetric matcher, and returns true if it was provided and it succeed
    pub fn custom_print<const DONT_THROW: bool>(
        _this: &Self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
        writer: &mut impl bun_io::Write,
    ) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set (mixes JsError and io::Error)
        let Some(matcher_fn) = Self::js::matcher_fn_get_cached(this_value) else { return Ok(false) };
        let fn_value = match matcher_fn.get(global_this, "toAsymmetricMatcher") {
            Ok(v) => v,
            Err(e) => return Ok(Self::maybe_clear::<DONT_THROW>(global_this, e)?),
        };
        if let Some(fn_value) = fn_value {
            if fn_value.js_type().is_function() {
                let Some(captured_args) = Self::js::captured_args_get_cached(this_value) else { return Ok(false) };
                // PERF(port): was stack-fallback allocator — profile in Phase B
                let args_len = match captured_args.get_length(global_this) {
                    Ok(n) => n,
                    Err(e) => return Ok(Self::maybe_clear::<DONT_THROW>(global_this, e)?),
                };
                let _ = args_len;
                let mut args = bun_jsc::MarkedArgumentBuffer::new();
                let mut iter = match captured_args.array_iterator(global_this) {
                    Ok(it) => it,
                    Err(e) => return Ok(Self::maybe_clear::<DONT_THROW>(global_this, e)?),
                };
                loop {
                    match iter.next() {
                        Ok(Some(arg)) => args.append(arg), // PERF(port): was assume_capacity
                        Ok(None) => break,
                        Err(e) => return Ok(Self::maybe_clear::<DONT_THROW>(global_this, e)?),
                    }
                }

                let result = match matcher_fn.call(global_this, this_value, args.as_slice()) {
                    Ok(r) => r,
                    Err(e) => return Ok(Self::maybe_clear::<DONT_THROW>(global_this, e)?),
                };
                let s = match result.to_bun_string(global_this) {
                    Ok(s) => s,
                    Err(e) => return Ok(Self::maybe_clear::<DONT_THROW>(global_this, e)?),
                };
                write!(writer, "{}", s)?;
            }
        }
        Ok(false)
    }

    #[bun_jsc::host_fn(method)]
    pub fn to_asymmetric_matcher(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        // PERF(port): was stack-fallback allocator — profile in Phase B
        let mut mutable_string = bun_str::MutableString::init_2048()?;

        // TODO(port): customPrint signature mismatch — Zig passes `dontThrow` but the call here omits it (Zig bug? defaults?)
        let printed = Self::custom_print::<false>(this, callframe.this(), global_this, &mut mutable_string.writer())?;
        if printed {
            return bun_str::String::init(mutable_string.slice()).to_js(global_this);
        }
        ExpectMatcherUtils::print_value(global_this, /* TODO(port): Zig passes `this` here but printValue expects JSValue */ JSValue::UNDEFINED, None)
    }
}

/// Reference: `MatcherContext` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
#[bun_jsc::JsClass]
pub struct ExpectMatcherContext {
    pub flags: Flags,
}

impl ExpectMatcherContext {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_utils(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call with valid &JSGlobalObject
        unsafe { ExpectMatcherUtils__getSingleton(global_this) }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_is_not(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(this.flags.not())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_promise(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match this.flags.promise() {
            Promise::Rejects => bun_str::String::static_("rejects").to_js(global_this),
            Promise::Resolves => bun_str::String::static_("resolves").to_js(global_this),
            _ => bun_str::String::empty().to_js(global_this),
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_expand(_this: &Self, _global_this: &JSGlobalObject) -> JSValue {
        // TODO: this should return whether running tests in verbose mode or not (jest flag --expand), but bun currently doesn't have this switch
        JSValue::FALSE
    }

    #[bun_jsc::host_fn(method)]
    pub fn equals(_this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(3);
        if arguments.len < 2 {
            return Err(global_this.throw(
                "expect.extends matcher: this.util.equals expects at least 2 arguments",
                format_args!(""),
            ));
        }
        let args = arguments.slice();
        Ok(JSValue::from(args[0].jest_deep_equals(args[1], global_this)?))
    }
}

/// Reference: `MatcherUtils` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
#[bun_jsc::JsClass]
pub struct ExpectMatcherUtils {}

impl ExpectMatcherUtils {
    #[unsafe(no_mangle)]
    pub extern "C" fn ExpectMatcherUtils_createSigleton(global_this: *const JSGlobalObject) -> JSValue {
        // SAFETY: called from C++ with valid global
        let global_this = unsafe { &*global_this };
        let instance = Box::into_raw(Box::new(ExpectMatcherUtils {}));
        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        unsafe { (*instance).to_js(global_this) }
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    fn print_value(
        global_this: &JSGlobalObject,
        value: JSValue,
        color_or_null: Option<&'static str>,
    ) -> JsResult<JSValue> {
        // TODO(port): narrow error set
        // PERF(port): was stack-fallback allocator — profile in Phase B
        let mut mutable_string = bun_str::MutableString::init_2048()?;

        // TODO(port): BufferedWriter wrapper
        let mut writer = mutable_string.writer();

        if let Some(color) = color_or_null {
            if Output::enable_ansi_colors_stderr() {
                writer.write_all(Output::pretty_fmt(color, true).as_bytes())?;
            }
        }

        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
        write!(writer, "{}", value.to_fmt(&mut formatter))?;

        if color_or_null.is_some() {
            if Output::enable_ansi_colors_stderr() {
                writer.write_all(Output::pretty_fmt("<r>", true).as_bytes())?;
            }
        }

        // buffered_writer.flush() — no-op with direct Vec writer

        bun_str::String::create_utf8_for_js(global_this, mutable_string.slice())
    }

    #[inline]
    fn print_value_catched(
        global_this: &JSGlobalObject,
        value: JSValue,
        color_or_null: Option<&'static str>,
    ) -> JSValue {
        Self::print_value(global_this, value, color_or_null)
            .unwrap_or_else(|_| global_this.throw_out_of_memory_value())
    }

    #[bun_jsc::host_fn(method)]
    pub fn stringify(_this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(1).slice();
        let value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        Ok(Self::print_value_catched(global_this, value, None))
    }

    #[bun_jsc::host_fn(method)]
    pub fn print_expected(_this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(1).slice();
        let value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        Ok(Self::print_value_catched(global_this, value, Some("<green>")))
    }

    #[bun_jsc::host_fn(method)]
    pub fn print_received(_this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(1).slice();
        let value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        Ok(Self::print_value_catched(global_this, value, Some("<red>")))
    }

    #[bun_jsc::host_fn(method)]
    pub fn matcher_hint(_this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(4).slice();

        if arguments.is_empty() || !arguments[0].is_string() {
            return Err(global_this.throw(
                "matcherHint: the first argument (matcher name) must be a string",
                format_args!(""),
            ));
        }
        let matcher_name = arguments[0].to_bun_string(global_this)?;

        let received = if arguments.len() > 1 { arguments[1] } else { bun_str::String::static_("received").to_js(global_this)? };
        let expected = if arguments.len() > 2 { arguments[2] } else { bun_str::String::static_("expected").to_js(global_this)? };
        let options = if arguments.len() > 3 { arguments[3] } else { JSValue::UNDEFINED };

        let mut is_not = false;
        let mut comment: Option<*mut JSString> = None; // TODO support
        let mut promise: Option<*mut JSString> = None; // TODO support
        let mut second_argument: Option<*mut JSString> = None; // TODO support
        // TODO support "chalk" colors (they are actually functions like: (value: string) => string;)
        //var second_argument_color: ?string = null;
        //var expected_color: ?string = null;
        //var received_color: ?string = null;

        if !options.is_undefined_or_null() {
            if !options.is_object() {
                return Err(global_this.throw(
                    "matcherHint: options must be an object (or undefined)",
                    format_args!(""),
                ));
            }
            if let Some(val) = options.get(global_this, "isNot")? {
                is_not = val.to_boolean();
            }
            if let Some(val) = options.get(global_this, "comment")? {
                comment = Some(val.to_js_string(global_this)?);
            }
            if let Some(val) = options.get(global_this, "promise")? {
                promise = Some(val.to_js_string(global_this)?);
            }
            if let Some(val) = options.get(global_this, "secondArgument")? {
                second_argument = Some(val.to_js_string(global_this)?);
            }
        }
        let _ = (comment, promise, second_argument);

        let diff_formatter = DiffFormatter {
            received: Some(received),
            expected: Some(expected),
            global_this,
            not: is_not,
            ..Default::default()
        };

        if is_not {
            let signature = Expect::get_signature("{f}", "<green>expected<r>", true);
            // TODO(port): comptime string concatenation signature ++ "\n\n{f}\n"
            JSValue::print_string_pretty(global_this, 2048, signature, format_args!("{}\n\n{}\n", matcher_name, diff_formatter))
        } else {
            let signature = Expect::get_signature("{f}", "<green>expected<r>", false);
            JSValue::print_string_pretty(global_this, 2048, signature, format_args!("{}\n\n{}\n", matcher_name, diff_formatter))
        }
    }
}

#[bun_jsc::JsClass]
pub struct ExpectTypeOf {}

impl ExpectTypeOf {
    pub fn finalize(this: *mut Self) {
        // SAFETY: m_ctx Box payload owned by JS wrapper; freed exactly once in finalize
        unsafe { drop(Box::from_raw(this)) };
    }

    pub fn create(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let expect = Box::into_raw(Box::new(ExpectTypeOf {}));
        // SAFETY: freshly leaked Box; wrapper takes ownership, freed in finalize
        let value = unsafe { (*expect).to_js(global_this) };
        value.ensure_still_alive();
        Ok(value)
    }

    #[bun_jsc::host_fn(method)]
    pub fn fn_one_argument_returns_void(_this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
    #[bun_jsc::host_fn(method)]
    pub fn fn_one_argument_returns_expect_type_of(_this: &mut Self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Self::create(global_this)
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_returns_expect_type_of(_this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Self::create(global_this)
    }

    #[bun_jsc::host_fn]
    pub fn constructor(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<*mut ExpectTypeOf> {
        Err(global_this.throw("expectTypeOf() cannot be called with new", format_args!("")))
    }
    #[bun_jsc::host_fn]
    pub fn call(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Self::create(global_this)
    }
}

pub mod mock {
    use super::*;

    pub fn jest_mock_iterator(global_this: &JSGlobalObject, value: JSValue) -> JsResult<JSArrayIterator> {
        let returns: JSValue = bun_jsc::cpp::JSMockFunction__getReturns(global_this, value)?;
        if !returns.js_type().is_array() {
            let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
            return Err(global_this.throw(
                "Expected value must be a mock function: {f}",
                format_args!("{}", value.to_fmt(&mut formatter)),
            ));
        }

        returns.array_iterator(global_this)
    }

    pub fn jest_mock_return_object_type(global_this: &JSGlobalObject, value: JSValue) -> JsResult<ReturnStatus> {
        if let Some(type_string) = value.fast_get(global_this, bun_jsc::BuiltinName::Type)? {
            if type_string.is_string() {
                if let Some(val) = ReturnStatus::MAP.from_js(global_this, type_string)? {
                    return Ok(val);
                }
            }
        }
        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
        Err(global_this.throw(
            "Expected value must be a mock function with returns: {f}",
            format_args!("{}", value.to_fmt(&mut formatter)),
        ))
    }

    pub fn jest_mock_return_object_value(global_this: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
        Ok(value.get(global_this, "value")?.unwrap_or(JSValue::UNDEFINED))
    }

    pub struct AllCallsWithArgsFormatter<'a> {
        pub global_this: &'a JSGlobalObject,
        pub calls: JSValue,
        // PORT NOTE: reshaped for borrowck — Display::fmt takes &self but we need &mut Formatter
        pub formatter: core::cell::RefCell<&'a mut ConsoleObject::Formatter>,
    }

    impl fmt::Display for AllCallsWithArgsFormatter<'_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            let mut formatter = self.formatter.borrow_mut();
            let mut printed_once = false;

            let calls_count = u32::try_from(
                self.calls
                    .get_length(self.global_this)
                    .map_err(|e| deprecated::js_error_to_write_error(e))?,
            )
            .unwrap();
            if calls_count == 0 {
                writer.write_str("(no calls)")?;
                return Ok(());
            }

            for i in 0..calls_count {
                if printed_once { writer.write_str("\n")?; }
                printed_once = true;

                write!(writer, "           {:>4}: ", i + 1)?;
                let call_args = self
                    .calls
                    .get_index(self.global_this, i)
                    .map_err(|e| deprecated::js_error_to_write_error(e))?;
                write!(writer, "{}", call_args.to_fmt(&mut **formatter))?;
            }
            Ok(())
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
    pub enum ReturnStatus {
        #[strum(serialize = "throw")]
        Throw,
        #[strum(serialize = "return")]
        Return,
        #[strum(serialize = "incomplete")]
        Incomplete,
    }

    impl ReturnStatus {
        // Zig: bun.ComptimeEnumMap(ReturnStatus)
        pub const MAP: phf::Map<&'static [u8], ReturnStatus> = phf::phf_map! {
            b"throw" => ReturnStatus::Throw,
            b"return" => ReturnStatus::Return,
            b"incomplete" => ReturnStatus::Incomplete,
        };
        // TODO(port): ComptimeEnumMap.fromJS — wrap phf lookup with JS string extraction
    }

    // Formatter for when there are multiple returns or errors
    pub struct AllCallsFormatter<'a> {
        pub global_this: &'a JSGlobalObject,
        pub returns: JSValue,
        // PORT NOTE: reshaped for borrowck — Display::fmt takes &self but we need &mut Formatter
        pub formatter: core::cell::RefCell<&'a mut ConsoleObject::Formatter>,
    }

    impl fmt::Display for AllCallsFormatter<'_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            let mut formatter = self.formatter.borrow_mut();
            let mut printed_once = false;

            let mut num_returns: i32 = 0;
            let mut num_calls: i32 = 0;

            let mut iter = self
                .returns
                .array_iterator(self.global_this)
                .map_err(|e| deprecated::js_error_to_write_error(e))?;
            loop {
                let next = iter.next().map_err(|e| deprecated::js_error_to_write_error(e))?;
                let Some(item) = next else { break };
                if printed_once { writer.write_str("\n")?; }
                printed_once = true;

                num_calls += 1;
                write!(writer, "           {:>2}: ", num_calls)?;

                let value = jest_mock_return_object_value(self.global_this, item)
                    .map_err(|e| deprecated::js_error_to_write_error(e))?;
                match jest_mock_return_object_type(self.global_this, item)
                    .map_err(|e| deprecated::js_error_to_write_error(e))?
                {
                    ReturnStatus::Return => {
                        write!(writer, "{}", value.to_fmt(&mut **formatter))?;
                        num_returns += 1;
                    }
                    ReturnStatus::Throw => {
                        write!(writer, "function call threw an error: {}", value.to_fmt(&mut **formatter))?;
                    }
                    ReturnStatus::Incomplete => {
                        write!(writer, "<incomplete call>")?;
                    }
                }
            }
            let _ = num_returns;
            Ok(())
        }
    }

    pub struct SuccessfulReturnsFormatter<'a> {
        pub global_this: &'a JSGlobalObject,
        pub successful_returns: &'a Vec<JSValue>,
        // PORT NOTE: reshaped for borrowck — Display::fmt takes &self but we need &mut Formatter
        pub formatter: core::cell::RefCell<&'a mut ConsoleObject::Formatter>,
    }

    impl fmt::Display for SuccessfulReturnsFormatter<'_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            let mut formatter = self.formatter.borrow_mut();
            let len = self.successful_returns.len();
            if len == 0 { return Ok(()); }

            let mut printed_once = false;

            for (idx, val) in self.successful_returns.iter().enumerate() {
                let i = idx + 1;
                if printed_once { writer.write_str("\n")?; }
                printed_once = true;

                write!(writer, "           {:>4}: ", i)?;
                write!(writer, "{}", val.to_fmt(&mut **formatter))?;
            }
            Ok(())
        }
    }
}

// Extract the matcher_fn from a JSCustomExpectMatcherFunction instance
#[inline]
fn get_custom_matcher_fn(this_value: JSValue, global_this: &JSGlobalObject) -> Option<JSValue> {
    // SAFETY: FFI call with valid JSValue and &JSGlobalObject
    let matcher_fn = unsafe { Bun__JSWrappingFunction__getWrappedFunction(this_value, global_this) };
    if matcher_fn.is_empty() { None } else { Some(matcher_fn) }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    /// JSValue.zero is used to indicate it was not a JSMockFunction
    /// If there were no calls, it returns an empty JSArray*
    fn JSMockFunction__getReturns(value: JSValue) -> JSValue;

    fn Bun__JSWrappingFunction__create(
        global_this: *const JSGlobalObject,
        symbol_name: *const bun_str::String,
        function_pointer: *const bun_jsc::JSHostFn,
        wrapped_fn: JSValue,
        strong: bool,
    ) -> JSValue;
    fn Bun__JSWrappingFunction__getWrappedFunction(this: JSValue, global_this: *const JSGlobalObject) -> JSValue;

    fn ExpectMatcherUtils__getSingleton(global_this: *const JSGlobalObject) -> JSValue;

    fn Expect__getPrototype(global_this: *const JSGlobalObject) -> JSValue;
    fn ExpectStatic__getPrototype(global_this: *const JSGlobalObject) -> JSValue;
}

// Exports: handled by #[unsafe(no_mangle)] on:
//   ExpectMatcherUtils_createSigleton, Expect_readFlagsAndProcessPromise, ExpectCustomAsymmetricMatcher__execute

#[cfg(test)]
mod tests {
    use super::*;

    fn test_trim_leading_whitespace_for_snapshot(src: &[u8], expected: &[u8]) {
        let mut cpy = vec![0u8; src.len()];

        let res = Expect::trim_leading_whitespace_for_inline_snapshot(src, &mut cpy);
        sanity_check(src, &res);

        assert_eq!(expected, res.trimmed);
    }

    fn sanity_check(input: &[u8], res: &TrimResult<'_>) {
        // sanity check: output has same number of lines & all input lines endWith output lines
        let mut input_iter = input.split(|&b| b == b'\n');
        let mut output_iter = res.trimmed.split(|&b| b == b'\n');
        loop {
            let next_input = input_iter.next();
            let next_output = output_iter.next();
            if next_input.is_none() {
                assert!(next_output.is_none());
                break;
            }
            assert!(next_output.is_some());
            assert!(next_input.unwrap().ends_with(next_output.unwrap()));
        }
    }

    #[allow(dead_code)]
    fn test_one(input: &[u8]) {
        let mut cpy = vec![0u8; input.len()];
        let res = Expect::trim_leading_whitespace_for_inline_snapshot(input, &mut cpy);
        sanity_check(input, &res);
    }

    #[test]
    fn trim_leading_whitespace_for_inline_snapshot() {
        test_trim_leading_whitespace_for_snapshot(
            b"\nHello, world!\n",
            b"\nHello, world!\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            b"\n  Hello, world!\n",
            b"\nHello, world!\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            b"\n  Object{\n    key: value\n  }\n",
            b"\nObject{\n  key: value\n}\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            b"\n  Object{\n  key: value\n\n  }\n",
            b"\nObject{\nkey: value\n\n}\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            b"\n    Object{\n  key: value\n  }\n",
            b"\n    Object{\n  key: value\n  }\n",
        );
        test_trim_leading_whitespace_for_snapshot(
            "\n  \"æ™\n\n  !!!!*5897yhduN\"'\\`Il\"\n".as_bytes(),
            "\n\"æ™\n\n!!!!*5897yhduN\"'\\`Il\"\n".as_bytes(),
        );
    }

    // TODO(port): fuzz test — std.testing.fuzz(testOne, .{})
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/test_runner/expect.zig (2271 lines)
//   confidence: medium
//   todos:      30
//   notes:      comptime fmt-string concat (getSignature/throw/throwPretty) needs const_format; Flags packed accessors hand-rolled; mock formatters wrap &mut ConsoleObject::Formatter in RefCell (callers must construct with RefCell::new)
// ──────────────────────────────────────────────────────────────────────────
