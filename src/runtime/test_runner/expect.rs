use crate::test_runner::jest::FileColumns as _;
use core::cell::Cell;
use core::fmt;

use bun_core::Output;
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSValue, JsError, JsResult,
    ConsoleObject, JSFunction, JSPropertyIterator,
};
use bun_jsc::{JsClass as _, StringJsc as _};
use bun_jsc::js_promise;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_core::strings;
use bun_ptr::RefPtr;

use super::bun_test::{self};
use super::diff_format::DiffFormatter;
use self::expect_deferred::{Asked, ExpectDeferred, Pass};
use super::execution::ExpectAssertions;
use super::jest::Jest;
use super::pretty_format::JestPrettyFormat;
use super::snapshot::{Format as SnapshotFormat, Outcome as SnapshotOutcome};
use super::expect::{JSValueTestExt, FormatterTestExt, make_formatter};
use crate::expect_throw as throw;

use bun_jsc::js_error_to_write_error;

// Matcher submodules are declared in `super::expect` (mod.rs); this file
// provides only the `Expect` payload + helpers they extend.

#[path = "expect_deferred.rs"]
pub(crate) mod expect_deferred;




/// https://jestjs.io/docs/expect
// To support async tests, we need to track the test ID
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; the only
// field mutated post-construction (`flags`, via the `.not`/`.resolves`/`.rejects`
// chaining getters) is `Cell`-wrapped so the codegen shim can hand out a shared
// `&*m_ctx` borrow without aliasing UB. `parent` and `custom_label` are
// read-only after `call()` constructs the wrapper.
#[bun_jsc::JsClass]
pub(crate) struct Expect {
    pub(crate) flags: Cell<Flags>,
    pub(crate) parent: Option<RefPtr<bun_test::RefData>>,
    pub(crate) custom_label: bun_core::String,
}


// Stored packed inside `Flags(u8)` bits 0..2, so `repr(u8)` here only
// governs the standalone discriminant size.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Promise {
    #[default]
    None = 0,
    Resolves = 1,
    Rejects = 2,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum AsymmetricMatcherConstructorType {
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

unsafe extern "C" {
    fn AsymmetricMatcherConstructorType__fromJS(
        global_object: *const JSGlobalObject,
        value: JSValue,
    ) -> i8;
}

impl AsymmetricMatcherConstructorType {
    fn from_js(global_object: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        // C++ side opens `DECLARE_THROW_SCOPE` and returns -1 ⟺ threw; under
        // `BUN_JSC_validateExceptionChecks=1` its dtor sets `m_needExceptionCheck`, so
        // open a validation scope here and assert the sentinel/exception biconditional
        // (`AsymmetricMatcherConstructorType__fromJS` is `zero_is_throw`-shaped
        // with -1 as the sentinel).
        bun_jsc::validation_scope!(scope, global_object);
        // SAFETY: FFI call with valid &JSGlobalObject; JSValue is Copy/repr(transparent)
        let result = unsafe { AsymmetricMatcherConstructorType__fromJS(global_object, value) };
        scope.assert_exception_presence_matches(result == -1);
        Ok(match result {
            -1 => return Err(JsError::Thrown),
            1 => Self::Symbol,
            2 => Self::String,
            3 => Self::Object,
            4 => Self::Array,
            5 => Self::BigInt,
            6 => Self::Boolean,
            7 => Self::Number,
            8 => Self::Promise,
            9 => Self::InstanceOf,
            // C++ contract: any non-(-1) value is one of the above; treat
            // 0 (and any future unknown) as `None` rather than UB.
            _ => Self::None,
        })
    }
}

/// note: keep this struct in sync with C++ implementation (at bindings.cpp)
// Bit layout: promise (bits 0..2), not (bit 2), asymmetric_matcher_constructor_type (bits 3..7), soft (bit 7).
#[repr(transparent)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct Flags(pub(crate) u8);

pub(crate) type FlagsCppType = u8;
const _: () = assert!(core::mem::size_of::<Flags>() == core::mem::size_of::<FlagsCppType>());

impl Flags {
    const PROMISE_MASK: u8 = 0b0000_0011;
    const NOT_MASK: u8 = 0b0000_0100;
    const AMCT_MASK: u8 = 0b0111_1000;
    const AMCT_SHIFT: u8 = 3;
    const SOFT_MASK: u8 = 0b1000_0000;

    #[inline]
    pub(crate) fn promise(self) -> Promise {
        // The bit pattern 3 is representable in the packed bits but
        // is not a valid discriminant — transmuting it would be instant UB. `Flags` is fed from C++ via
        // `from_bitset`/`decode`, so the bits are not statically constrained.
        match self.0 & Self::PROMISE_MASK {
            1 => Promise::Resolves,
            2 => Promise::Rejects,
            // 3 is `poll()`.
            _ => Promise::None,
        }
    }
    #[inline]
    pub(crate) fn set_promise(&mut self, p: Promise) {
        self.0 = (self.0 & !Self::PROMISE_MASK) | (p as u8);
    }
    #[inline]
    pub(crate) fn not(self) -> bool {
        (self.0 & Self::NOT_MASK) != 0
    }
    #[inline]
    pub(crate) fn set_not(&mut self, v: bool) {
        self.0 = (self.0 & !Self::NOT_MASK) | ((v as u8) << 2);
    }
    #[inline]
    pub(crate) fn asymmetric_matcher_constructor_type(self) -> AsymmetricMatcherConstructorType {
        // Values 10..=15 are representable in the packed bits but are not
        // valid discriminants, and `Flags` arrives from C++ via `from_bitset`, so
        // a checked match is required (transmute would be UB).
        match (self.0 & Self::AMCT_MASK) >> Self::AMCT_SHIFT {
            0 => AsymmetricMatcherConstructorType::None,
            1 => AsymmetricMatcherConstructorType::Symbol,
            2 => AsymmetricMatcherConstructorType::String,
            3 => AsymmetricMatcherConstructorType::Object,
            4 => AsymmetricMatcherConstructorType::Array,
            5 => AsymmetricMatcherConstructorType::BigInt,
            6 => AsymmetricMatcherConstructorType::Boolean,
            7 => AsymmetricMatcherConstructorType::Number,
            8 => AsymmetricMatcherConstructorType::Promise,
            9 => AsymmetricMatcherConstructorType::InstanceOf,
            _ => AsymmetricMatcherConstructorType::None,
        }
    }
    #[inline]
    pub(crate) fn set_asymmetric_matcher_constructor_type(&mut self, t: AsymmetricMatcherConstructorType) {
        self.0 = (self.0 & !Self::AMCT_MASK) | ((t as u8) << Self::AMCT_SHIFT);
    }
    /// `expect.poll()`, which excludes `.resolves` and `.rejects`.
    #[inline]
    pub(crate) fn poll(self) -> bool {
        (self.0 & Self::PROMISE_MASK) == Self::PROMISE_MASK
    }
    /// `expect.soft()`
    #[inline]
    pub(crate) fn soft(self) -> bool {
        (self.0 & Self::SOFT_MASK) != 0
    }
    /// Whether a matcher only has to be called: at most `.not` modifies it.
    #[inline]
    pub(crate) fn is_plain(self) -> bool {
        (self.0 & (Self::PROMISE_MASK | Self::SOFT_MASK)) == 0
    }

    #[inline]
    pub(crate) fn encode(self) -> FlagsCppType {
        self.0
    }
}

impl Expect {
    /// R-2 helper: read-modify-write the packed `Cell<Flags>` through `&self`.
    #[inline]
    pub(crate) fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    pub(crate) fn increment_expect_call_counter(&self) {
        self.add_to_expect_call_counter(1);
    }

    fn add_to_expect_call_counter(&self, count: i32) {
        let Some(parent) = self.parent.as_ref() else { return }; // not in bun:test
        let Some(buntest_strong) = parent.bun_test() else { return }; // the test file this expect() call was for is no longer
        let buntest = buntest_strong.get();
        if let Some(sequence) = parent.phase.sequence(buntest) {
            // found active sequence
            sequence.expect_call_count = sequence.expect_call_count.saturating_add_signed(count);
        } else {
            // in concurrent group or otherwise failed to get the sequence; increment the expect call count in the reporter directly
            if let Some(reporter) = buntest.reporter {
                // SAFETY: `reporter` is `Option<NonNull<CommandLineReporter>>`,
                // owned by `test_command` for the process lifetime, never
                // aliased mutably elsewhere here.
                unsafe {
                    let s = (*reporter.as_ptr()).summary();
                    s.expectations = s.expectations.saturating_add_signed(count);
                }
            }
        }
    }

    pub(crate) fn bun_test(&self) -> Option<bun_test::BunTestPtr> {
        let parent = self.parent.as_ref()?;
        parent.bun_test()
    }

    pub(crate) fn get_signature(
        matcher_name: &'static str,
        args: &'static str,
        not: bool,
    ) -> &'static str {
        // Rust has no compile-time string concat across runtime call sites
        // (all ~188 callers pass literals, but the `not` bool is runtime in
        // some), so emulate via a process-lifetime intern table: each unique
        // (matcher, args, not) triple is rendered exactly once and the boxed
        // str is owned by the static `CACHE` for the rest of the process.
        //
        // The `<tag>` → ANSI rewrite is applied here, once, and both colour
        // variants are cached; the returned header is ready to emit verbatim.
        // All inputs are `'static` template literals (never user data), so the
        // one-time markup pass can never touch user-supplied bytes.
        use bun_collections::HashMap;
        use std::sync::OnceLock;
        type Key = (&'static str, &'static str, bool);
        static CACHE: OnceLock<bun_threading::Guarded<HashMap<Key, [Box<str>; 2]>>> =
            OnceLock::new();
        let cache = CACHE.get_or_init(Default::default);
        let colors = Output::enable_ansi_colors_stderr();

        let mut map = cache.lock();
        if let Some(pair) = map.get(&(matcher_name, args, not)) {
            // SAFETY: `CACHE` is process-static and entries are never removed
            // or mutated, so the `Box<str>` allocation outlives the program.
            return unsafe { &*std::ptr::from_ref::<str>(pair[colors as usize].as_ref()) };
        }
        let render = |enabled: bool| -> Box<str> {
            #[allow(clippy::disallowed_methods)] // `args` is a `'static` template literal
            let params = Output::pretty_fmt_rt(args.as_bytes(), enabled);
            if enabled {
                if not {
                    format!(
                        bun_core::pretty_fmt!(
                            "<d>expect(<r><red>received<r><d>).<r>not<d>.<r>{}<d>(<r>{}<d>)<r>",
                            true
                        ),
                        matcher_name, params,
                    )
                } else {
                    format!(
                        bun_core::pretty_fmt!(
                            "<d>expect(<r><red>received<r><d>).<r>{}<d>(<r>{}<d>)<r>",
                            true
                        ),
                        matcher_name, params,
                    )
                }
            } else if not {
                format!(
                    bun_core::pretty_fmt!(
                        "<d>expect(<r><red>received<r><d>).<r>not<d>.<r>{}<d>(<r>{}<d>)<r>",
                        false
                    ),
                    matcher_name, params,
                )
            } else {
                format!(
                    bun_core::pretty_fmt!(
                        "<d>expect(<r><red>received<r><d>).<r>{}<d>(<r>{}<d>)<r>",
                        false
                    ),
                    matcher_name, params,
                )
            }
            .into_boxed_str()
        };
        let pair = [render(false), render(true)];
        let ptr = std::ptr::from_ref::<str>(pair[colors as usize].as_ref());
        map.insert((matcher_name, args, not), pair);
        // SAFETY: just inserted into process-static `CACHE`; never removed.
        unsafe { &*ptr }
    }

    pub(crate) fn throw_pretty_matcher_error(
        global_this: &JSGlobalObject,
        custom_label: &bun_core::String,
        matcher_name: impl fmt::Display,
        matcher_params: impl fmt::Display,
        flags: Flags,
        // Callers pre-render the message body (prose + substituted user data)
        // into a single `fmt::Arguments`. `<tag>` markers in the caller's
        // *template* must already be ANSI/stripped at the call site (via the
        // `throw!`-style compile-time pass); this sink emits `message`,
        // `matcher_name`, and `matcher_params` verbatim so user data containing
        // `<…>` is never scanned.
        message: fmt::Arguments<'_>,
    ) -> JsError {
        let colors = Output::enable_ansi_colors_stderr();
        let chain: &'static str = match flags.promise() {
            Promise::Resolves => {
                if flags.not() {
                    if colors {
                        bun_core::pretty_fmt!("resolves<d>.<r>not<d>.<r>", true)
                    } else {
                        bun_core::pretty_fmt!("resolves<d>.<r>not<d>.<r>", false)
                    }
                } else if colors {
                    bun_core::pretty_fmt!("resolves<d>.<r>", true)
                } else {
                    bun_core::pretty_fmt!("resolves<d>.<r>", false)
                }
            }
            Promise::Rejects => {
                if flags.not() {
                    if colors {
                        bun_core::pretty_fmt!("rejects<d>.<r>not<d>.<r>", true)
                    } else {
                        bun_core::pretty_fmt!("rejects<d>.<r>not<d>.<r>", false)
                    }
                } else if colors {
                    bun_core::pretty_fmt!("rejects<d>.<r>", true)
                } else {
                    bun_core::pretty_fmt!("rejects<d>.<r>", false)
                }
            }
            Promise::None => {
                if flags.not() {
                    if colors {
                        bun_core::pretty_fmt!("not<d>.<r>", true)
                    } else {
                        bun_core::pretty_fmt!("not<d>.<r>", false)
                    }
                } else {
                    ""
                }
            }
        };
        // Matches the semantics of `throw_rendered`: empty label → default
        // signature header, non-empty label → user's label header.
        if custom_label.is_empty() {
            // Apply markup to the header *template* pieces only; interpolate
            // `chain` (already ANSI/stripped above), `matcher_name`,
            // `matcher_params`, `message` verbatim.
            if colors {
                global_this.throw(format_args!(
                    bun_core::pretty_fmt!(
                        "<d>expect(<r><red>received<r><d>).<r>{}{}<d>(<r>{}<d>)<r>\n\n{}",
                        true
                    ),
                    chain, matcher_name, matcher_params, message,
                ))
            } else {
                global_this.throw(format_args!(
                    bun_core::pretty_fmt!(
                        "<d>expect(<r><red>received<r><d>).<r>{}{}<d>(<r>{}<d>)<r>\n\n{}",
                        false
                    ),
                    chain, matcher_name, matcher_params, message,
                ))
            }
        } else {
            global_this.throw(format_args!("{custom_label}\n\n{message}"))
        }
    }

    // `host_fn(getter)` shim passes `(&Self, &JSGlobalObject)` only,
    // but these getters also need `this_value` (returned to JS for chaining).
    // The shim is omitted (codegen owns the actual link name). R-2: mutation
    // of `flags` goes through `Cell` so the receiver is `&Self`.
    pub(crate) fn get_not(this: &Self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        this.update_flags(|f| f.set_not(!f.not()));
        this_value
    }

    // see `get_not` — `host_fn(getter)` shim signature mismatch.
    pub(crate) fn get_resolves(
        this: &Self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        if this.flags.get().poll() {
            return Err(global_this.throw(format_args!("expect.poll() does not support .resolves")));
        }
        match this.flags.get().promise() {
            Promise::Resolves | Promise::None => this.update_flags(|f| f.set_promise(Promise::Resolves)),
            Promise::Rejects => {
                return Err(global_this.throw(format_args!("Cannot chain .resolves() after .rejects()")));
            }
        }
        Ok(this_value)
    }

    // see `get_not` — `host_fn(getter)` shim signature mismatch.
    pub(crate) fn get_rejects(
        this: &Self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        if this.flags.get().poll() {
            return Err(global_this.throw(format_args!("expect.poll() does not support .rejects")));
        }
        match this.flags.get().promise() {
            Promise::None | Promise::Rejects => this.update_flags(|f| f.set_promise(Promise::Rejects)),
            Promise::Resolves => {
                return Err(global_this.throw(format_args!("Cannot chain .rejects() after .resolves()")));
            }
        }
        Ok(this_value)
    }

    pub(crate) fn get_value(
        &self,
        global_this: &JSGlobalObject,
        this_value: JSValue,
        // Every caller passes a string literal, so accept `&str`
        // (BStr::new below takes `AsRef<[u8]>`, so no copy).
        matcher_name: &str,
        matcher_params_fmt: &'static str,
    ) -> JsResult<JSValue> {
        let Some(value) = super::expect::js::captured_value_get_cached(this_value) else {
            return Err(global_this.throw2(
                "Internal error: the expect(value) was garbage collected but it should not have been!",
                (),
            ));
        };
        value.ensure_still_alive();

        #[allow(clippy::disallowed_methods)] // template is a runtime parameter
        let matcher_params = Output::pretty_fmt_rt(matcher_params_fmt, Output::enable_ansi_colors_stderr());
        Self::process_promise(
            &self.custom_label,
            self.flags.get(),
            global_this,
            value,
            Self::settled_promise(this_value),
            bstr::BStr::new(matcher_name),
            matcher_params,
            false,
        )
    }

    /// What `call_matcher` found `.resolves` / `.rejects` to be about. `None`: not a promise.
    fn settled_promise(this_value: JSValue) -> Option<bun_jsc::AnyPromise> {
        super::expect::js::result_value_get_cached(this_value)?.as_any_promise()
    }

    /// Shared failure path for the three `.resolves`/`.rejects` mismatch cases
    /// in `process_promise`. The body template's only markup is `<red>…<r>`
    /// around `received`, so it's applied here; `expected`/`label`/`received`
    /// are emitted verbatim.
    #[allow(clippy::too_many_arguments)]
    fn throw_promise_matcher_error(
        global_this: &JSGlobalObject,
        custom_label: &bun_core::String,
        matcher_name: impl fmt::Display,
        matcher_params: impl fmt::Display,
        flags: Flags,
        expected: &'static str,
        label: &'static str,
        received: impl fmt::Display,
    ) -> JsError {
        if Output::enable_ansi_colors_stderr() {
            Self::throw_pretty_matcher_error(
                global_this, custom_label, matcher_name, matcher_params, flags,
                format_args!(
                    bun_core::pretty_fmt!("{}<r>\n{}<red>{}<r>\n", true),
                    expected, label, received,
                ),
            )
        } else {
            Self::throw_pretty_matcher_error(
                global_this, custom_label, matcher_name, matcher_params, flags,
                format_args!(
                    bun_core::pretty_fmt!("{}<r>\n{}<red>{}<r>\n", false),
                    expected, label, received,
                ),
            )
        }
    }

    /// The promise that settles as `await value` does, or `None` when `value` is not thenable.
    fn promise_to_await(global_this: &JSGlobalObject, value: JSValue) -> JsResult<Option<bun_jsc::AnyPromise>> {
        if let Some(promise) = value.as_any_promise() {
            promise.set_handled(global_this.vm());
            if promise.status() != js_promise::Status::Pending {
                return Ok(Some(promise));
            }
        }
        let adopted = bun_jsc::JSPromise::create(global_this);
        adopted.set_handled();
        adopted.resolve(global_this, value)?;
        // `then` is called in a microtask, so only a value without one has fulfilled `adopted` by now.
        Ok((adopted.status() != js_promise::Status::Fulfilled).then_some(bun_jsc::AnyPromise::Normal(adopted)))
    }

    /// The promise `expect(received).resolves` / `.rejects` is about: `received`, or what it returns.
    fn received_promise(global_this: &JSGlobalObject, received: JSValue) -> JsResult<Option<bun_jsc::AnyPromise>> {
        match Self::promise_to_await(global_this, received)? {
            None if received.is_callable() => {
                Self::promise_to_await(global_this, received.call(global_this, JSValue::UNDEFINED, &[])?)
            }
            promise => Ok(promise),
        }
    }

    /// Processes the async flags (resolves/rejects).
    /// If no flags, returns the original value
    /// If either flag is set, returns what `promise`, which stands for `value` and has settled, settled with, or an error if the expectation failed (in which case if silent is false, also throws a js exception)
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn process_promise(
        custom_label: &bun_core::String,
        flags: Flags,
        global_this: &JSGlobalObject,
        value: JSValue,
        promise: Option<bun_jsc::AnyPromise>,
        matcher_name: impl fmt::Display,
        matcher_params: impl fmt::Display,
        silent: bool,
    ) -> JsResult<JSValue> {
        match flags.promise() {
            resolution @ (Promise::Resolves | Promise::Rejects) => {
                if let Some(promise) = promise {
                    let new_value = promise.result(global_this.vm());
                    match promise.status() {
                        js_promise::Status::Fulfilled => match resolution {
                            Promise::Resolves => {}
                            Promise::Rejects => {
                                if !silent {
                                    let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
                                    return Err(Self::throw_promise_matcher_error(
                                        global_this, custom_label, matcher_name, matcher_params, flags,
                                        "Expected promise that rejects",
                                        "Received promise that resolved: ",
                                        value.to_fmt(&mut formatter),
                                    ));
                                }
                                return Err(JsError::Thrown);
                            }
                            Promise::None => unreachable!(),
                        },
                        js_promise::Status::Rejected => match resolution {
                            Promise::Rejects => {}
                            Promise::Resolves => {
                                if !silent {
                                    let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
                                    return Err(Self::throw_promise_matcher_error(
                                        global_this, custom_label, matcher_name, matcher_params, flags,
                                        "Expected promise that resolves",
                                        "Received promise that rejected: ",
                                        value.to_fmt(&mut formatter),
                                    ));
                                }
                                return Err(JsError::Thrown);
                            }
                            Promise::None => unreachable!(),
                        },
                        js_promise::Status::Pending => unreachable!(),
                    }

                    new_value.ensure_still_alive();
                    Ok(new_value)
                } else {
                    if !silent {
                        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
                        return Err(Self::throw_promise_matcher_error(
                            global_this, custom_label, matcher_name, matcher_params, flags,
                            "Expected promise",
                            "Received: ",
                            value.to_fmt(&mut formatter),
                        ));
                    }
                    Err(JsError::Thrown)
                }
            }
            _ => Ok(value),
        }
    }

    pub(crate) fn is_asymmetric_matcher(value: JSValue) -> bool {
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
    ///
    /// # Safety
    /// `out_flags`, `value`, and `any_constructor_type` must be valid, properly
    /// aligned pointers for the duration of the call.
    #[unsafe(no_mangle)]
    pub(crate) unsafe extern "C" fn Expect_readFlagsAndProcessPromise(
        instance_value: JSValue,
        global_this: &JSGlobalObject,
        out_flags: *mut FlagsCppType,
        value: *mut JSValue,
        any_constructor_type: *mut u8,
    ) -> bool {
        // SAFETY: `from_js` returns the live `m_ctx` payload owned by `instance_value`.
        let flags: Flags = 'flags: { unsafe {
            if let Some(instance) = ExpectCustomAsymmetricMatcher::from_js(instance_value) {
                break 'flags (*instance).flags;
            } else if let Some(instance) = ExpectAny::from_js(instance_value) {
                let f = (*instance).flags.get();
                // SAFETY: any_constructor_type is a valid out-ptr provided by C++ caller
                *any_constructor_type = f.asymmetric_matcher_constructor_type() as u8;
                break 'flags f;
            } else if let Some(instance) = ExpectAnything::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectStringMatching::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectCloseTo::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectObjectContaining::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectStringContaining::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else if let Some(instance) = ExpectArrayContaining::from_js(instance_value) {
                break 'flags (*instance).flags.get();
            } else {
                break 'flags Flags::default();
            }
        } };

        // SAFETY: out_flags is a valid out-ptr provided by C++ caller
        unsafe { *out_flags = flags.encode() };

        // (note that matcher_name/matcher_args are not used because silent=true)
        // SAFETY: value is a valid in/out-ptr provided by C++ caller
        let v = unsafe { *value };
        let promise = match flags.promise() {
            Promise::None => None,
            _ => match Pass::settled(global_this, Asked::Promise, &mut || {
                Ok(Self::promise_to_await(global_this, v)?.map_or(JSValue::UNDEFINED, bun_jsc::AnyPromise::as_value))
            }) {
                Ok(promise) => promise,
                Err(_) => return false,
            },
        };
        match Self::process_promise(&bun_core::String::EMPTY, flags, global_this, v, promise, "", "", true) {
            Ok(new) => {
                // SAFETY: value is a valid in/out-ptr provided by C++ caller
                unsafe { *value = new };
                true
            }
            Err(_) => false,
        }
    }

    /// Whether the test that is running was registered through "vitest".
    pub(crate) fn is_in_vitest_test(&self, buntest: &mut bun_test::BunTest) -> bool {
        let sequence = self.parent.as_ref().and_then(|parent| parent.phase.sequence(buntest));
        // SAFETY: `buntest` owns the entries of its sequences.
        sequence.and_then(|sequence| sequence.test_entry).is_some_and(|test| unsafe { test.as_ref() }.calling.is_vitest())
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn call(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::call_in(global_this, callframe.arguments(), None)
    }

    /// `state`: the test the call belongs to, if not the one that is running.
    pub(crate) fn call_in(
        global_this: &JSGlobalObject,
        arguments: &[JSValue],
        state: Option<bun_test::RefDataValue>,
    ) -> JsResult<JSValue> {
        let value = if arguments.len() < 1 { JSValue::UNDEFINED } else { arguments[0] };

        let mut custom_label = bun_core::String::EMPTY;
        if arguments.len() > 1 {
            if arguments[1].is_string() || arguments[1].implements_to_string(global_this)? {
                custom_label = arguments[1].to_bun_string(global_this)?;
            }
        }

        let active_execution_entry_ref = if let Some(buntest_strong_) = bun_test::clone_active_strong() {
            let buntest_strong = buntest_strong_;
            let state = state.unwrap_or_else(|| buntest_strong.get().get_current_state_data());
            Some(bun_test::BunTest::ref_(&buntest_strong, state))
        } else {
            None
        };
        // The ref moves into `Expect` below and `to_js()` is infallible, so
        // there is no error path between ref creation and the wrapper taking
        // ownership.

        let expect = Expect {
            flags: Cell::new(Flags::default()),
            custom_label,
            parent: active_execution_entry_ref,
        };
        // `JsClass::to_js` boxes `self` and hands the pointer to `${T}__create`.
        let expect_js_value = expect.to_js(global_this);
        expect_js_value.ensure_still_alive();
        super::expect::js::captured_value_set_cached(expect_js_value, global_this, value);
        expect_js_value.ensure_still_alive();

        if let Some(expect_ptr) = Self::from_js(expect_js_value) {
            // SAFETY: `expect_ptr` is the live `m_ctx` payload of the just-created
            // wrapper, kept alive by `expect_js_value.ensure_still_alive()` above.
            unsafe { (*expect_ptr).post_match(global_this) };
        }
        Ok(expect_js_value)
    }

    /// `expect(...arguments)` with `flags` set, for a static function that `callframe` calls on `expect` or on the `expect` of a test context.
    fn call_with_flags(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        arguments: &[JSValue],
        flags: u8,
    ) -> JsResult<JSValue> {
        let state = super::test_context::TestContext::state_of_bound(callframe.this());
        let expect_js_value = Self::call_in(global_this, arguments, state)?;
        if let Some(expect_ptr) = Self::from_js(expect_js_value) {
            // SAFETY: `expect_js_value` is on the stack and owns the payload.
            unsafe { &*expect_ptr }.update_flags(|f| f.0 |= flags);
        }
        Ok(expect_js_value)
    }

    /// `expect.soft(value, message?)`
    pub(crate) fn soft(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::call_with_flags(global_this, callframe, callframe.arguments(), Flags::SOFT_MASK)
    }

    /// `expect.poll(function, { interval, timeout, message }?)`
    pub(crate) fn poll(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let [function, options] = callframe.arguments_as_array::<2>();
        if !function.is_callable() {
            return Err(global_this.throw_invalid_argument_type_value("fn", "function", function));
        }
        let (interval, timeout, message) = if options.is_object() {
            (
                options.get(global_this, "interval")?,
                options.get(global_this, "timeout")?,
                options.get(global_this, "message")?,
            )
        } else if options.is_undefined() {
            (None, None, None)
        } else {
            return Err(global_this.throw_invalid_argument_type_value("options", "object", options));
        };
        let times = [
            JSValue::js_number_from_int32(super::vi_wait::delay_ms(global_this, interval, 50)? as i32),
            JSValue::js_number_from_int32(super::vi_wait::delay_ms(global_this, timeout, 1000)? as i32),
        ];
        let expect_js_value = Self::call_with_flags(
            global_this,
            callframe,
            &[function, message.unwrap_or(JSValue::UNDEFINED)],
            Flags::PROMISE_MASK,
        )?;
        super::expect::js::result_value_set_cached(
            expect_js_value,
            global_this,
            JSValue::create_array_from_slice(global_this, &times)?,
        );
        Ok(expect_js_value)
    }

    /// Matcher failure sink. Invoked via the `throw!` macro — never directly
    /// — so the `<tag>` → ANSI rewrite has already been applied to the
    /// *template literal* at compile time; `args` therefore carries rendered
    /// user data and is emitted verbatim. `signature` is the pre-processed
    /// header returned by `get_signature` (ANSI or stripped, per stderr
    /// colour state). Nothing here scans bytes for `<…>` markers.
    pub(crate) fn throw_rendered(
        &self,
        global_this: &JSGlobalObject,
        signature: &'static str,
        args: fmt::Arguments<'_>,
    ) -> JsResult<JSValue> {
        use core::fmt::Write as _;
        let mut message = String::new();
        let rendered = if self.custom_label.is_empty() {
            write!(message, "{signature}{args}")
        } else {
            // custom_label is user-supplied; emit verbatim.
            write!(message, "{}{args}", self.custom_label)
        };
        // As in Jest, what a value throws while it is printed (a getter, a Proxy trap) is the error.
        if rendered.is_err() && global_this.has_exception() {
            return Err(JsError::Thrown);
        }
        Err(global_this.throw(format_args!("{message}")))
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn constructor(global_this: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Expect> {
        Err(global_this.throw(format_args!("expect() cannot be called with new")))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn pass(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // The guard owns the `&Self` and calls
        // post_match on drop so it runs on every exit path.
        let this = scopeguard::guard(self, |t| t.post_match(global_this));

        let arguments = call_frame.arguments();

        let message: bun_core::String = if !arguments.is_empty() {
            let value = arguments[0];

            if !value.is_string() {
                return Err(global_this.throw_invalid_argument_type("pass", "message", "string"));
            }

            value.to_bun_string(global_this)?
        } else {
            bun_core::String::static_("passes by .pass() assertion")
        };

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        let mut pass = true;

        if not { pass = !pass; }
        if pass { return Ok(JSValue::UNDEFINED); }

        if not {
            let signature = Self::get_signature("pass", "", true);
            return throw!(this, global_this, signature, "\n\n{}\n", message);
        }

        // should never reach here
        Ok(JSValue::ZERO)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn fail(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // The guard owns the `&Self` borrow
        // so `post_match` runs on every exit.
        let this = scopeguard::guard(self, |t| t.post_match(global_this));

        let arguments = call_frame.arguments();

        let message: bun_core::String = if !arguments.is_empty() {
            let value = arguments[0];

            if !value.is_string() {
                return Err(global_this.throw_invalid_argument_type("fail", "message", "string"));
            }

            value.to_bun_string(global_this)?
        } else {
            bun_core::String::static_("fails by .fail() assertion")
        };

        this.increment_expect_call_counter();

        let not = this.flags.get().not();
        let mut pass = false;

        if not { pass = !pass; }
        if pass { return Ok(JSValue::UNDEFINED); }

        let signature = Self::get_signature("fail", "", true);
        throw!(this, global_this, signature, "\n\n{}\n", message)
    }
}

/// What a snapshot matcher is given.
#[derive(Copy, Clone)]
pub(crate) enum Received {
    Value(JSValue),
    /// `toThrowErrorMatching*Snapshot()`: what the function threw, or the promise was rejected with.
    Thrown(JSValue),
}

pub(crate) struct TrimResult<'a> {
    pub(crate) trimmed: &'a [u8],
    pub(crate) start_indent: Option<&'a [u8]>,
    pub(crate) end_indent: Option<&'a [u8]>,
}

impl Expect {
    pub(crate) fn get_value_as_to_throw(
        &self,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<(Option<JSValue>, JSValue)> {
        // SAFETY: bun_vm() returns the live thread-local VirtualMachine; valid for this call.
        let vm = global_this.bun_vm().as_mut();

        if !value.js_type().is_function() {
            if self.flags.get().promise() != Promise::None {
                return Ok((Some(value), JSValue::ZERO));
            }
            return Err(global_this.throw(format_args!("Expected value must be a function")));
        }

        let mut captured_rejection: JSValue = JSValue::ZERO;
        let return_value_from_function = Pass::once(global_this, Asked::Call, &mut || {
            // Drain existing unhandled rejections
            let _ = vm.global().handle_rejected_promises();

            let scope = vm.unhandled_rejection_scope();
            let prev_unhandled_pending_rejection_to_capture = vm.unhandled_pending_rejection_to_capture;
            vm.unhandled_pending_rejection_to_capture = Some(&raw mut captured_rejection);
            vm.on_unhandled_rejection = VirtualMachine::on_quiet_unhandled_rejection_handler_capture_value;
            let returned = match value.call(global_this, JSValue::UNDEFINED, &[]) {
                Ok(v) => v,
                Err(err) => global_this.take_exception(err),
            };
            vm.unhandled_pending_rejection_to_capture = prev_unhandled_pending_rejection_to_capture;

            let _ = vm.global().handle_rejected_promises();
            scope.apply(vm);
            Ok(returned)
        })?;
        let return_value = Pass::once(global_this, Asked::Call, &mut || {
            Ok(if captured_rejection.is_empty() { return_value_from_function } else { captured_rejection })
        })?;

        if let Some(promise) = return_value.as_any_promise() {
            return match promise.unwrap(global_this.vm(), js_promise::UnwrapMode::MarkHandled) {
                js_promise::Unwrapped::Fulfilled(_) => Ok((None, return_value_from_function)),
                // since we know for sure it rejected, we should always return the error
                js_promise::Unwrapped::Rejected(rejected) => {
                    Ok((Some(rejected.to_error().unwrap_or(rejected)), return_value_from_function))
                }
                js_promise::Unwrapped::Pending => Err(Pass::wait_for(global_this, promise)),
            };
        }

        if return_value != return_value_from_function {
            if let Some(existing) = return_value_from_function.as_any_promise() {
                existing.set_handled(global_this.vm());
            }
        }

        Ok((
            return_value.to_error().or_else(|| return_value_from_function.to_error()),
            return_value_from_function,
        ))
    }

    /// What a snapshot of `received` holds in a file of `format`.
    fn value_to_snapshot(global_this: &JSGlobalObject, received: Received, format: SnapshotFormat) -> JsResult<JSValue> {
        let thrown = match received {
            Received::Value(value) => return Ok(value),
            Received::Thrown(thrown) => thrown,
        };
        match format {
            SnapshotFormat::Vitest => Ok(thrown),
            SnapshotFormat::Bun if !thrown.is_any_error() => Ok(JSValue::UNDEFINED),
            SnapshotFormat::Bun => Ok(thrown.get_truthy(global_this, "message")?.unwrap_or(JSValue::UNDEFINED)),
            SnapshotFormat::Jest => Self::message_with_causes(global_this, thrown),
        }
    }

    /// jest-snapshot `_toThrowErrorMatchingSnapshot`
    #[cold]
    fn message_with_causes(global_this: &JSGlobalObject, thrown: JSValue) -> JsResult<JSValue> {
        if !thrown.is_object() {
            return Ok(JSValue::UNDEFINED);
        }
        const MAX_CAUSES: usize = 100;
        let message = thrown.get(global_this, "message")?.unwrap_or(JSValue::UNDEFINED);
        let Some(mut cause) = thrown.get(global_this, "cause")? else {
            return Ok(message);
        };
        let mut text = message.to_bun_string(global_this)?.to_owned_slice();
        // Only compared: Jest goes round a cycle until the message is too long for a string.
        let mut seen = vec![thrown];
        while !seen.contains(&cause) && seen.len() <= MAX_CAUSES {
            let line = if cause.is_any_error() {
                cause.get(global_this, "message")?.unwrap_or(JSValue::UNDEFINED)
            } else if cause.is_string() {
                cause
            } else {
                break;
            };
            text.extend_from_slice(b"\nCause: ");
            text.extend_from_slice(&line.to_bun_string(global_this)?.to_owned_slice());
            seen.push(cause);
            match if cause.is_object() { cause.get(global_this, "cause")? } else { None } {
                Some(next) => cause = next,
                None => break,
            }
        }
        bun_jsc::bun_string_jsc::create_utf8_for_js(global_this, &text)
    }

    pub(crate) fn trim_leading_whitespace_for_inline_snapshot<'a>(
        str_in: &'a [u8],
        trimmed_buf: &'a mut [u8],
    ) -> TrimResult<'a> {
        debug_assert!(trimmed_buf.len() == str_in.len());
        // reshaped for borrowck — track dst as an index into trimmed_buf instead of a moving slice
        let mut src = str_in;
        let trimmed_buf_len = trimmed_buf.len();
        let mut dst_idx: usize = 0;
        let give_up_1 = TrimResult { trimmed: str_in, start_indent: None, end_indent: None };
        // if the line is all whitespace, trim fully
        // the first line containing a character determines the max trim count

        // read first line (should be all-whitespace)
        let Some(first_newline) = bun_core::index_of(src, b"\n") else { return give_up_1 };
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
        let Some(nl) = bun_core::index_of(src, b"\n") else { return give_up_2!(); };
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
                let line_newline = match bun_core::index_of(src, b"\n") {
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
        let Some(c) = strings::last_index_of_char(str_in, b'\n') else { return give_up_2!(); }; // there has to have been at least a single newline to get here
        let end_indent = c + 1;
        for &c in &str_in[end_indent..] {
            if c != b' ' && c != b'\t' { return give_up_2!(); } // we already checked, but the last line is not all whitespace again
        }

        // done
        TrimResult {
            trimmed: &trimmed_buf[..trimmed_buf_len - (trimmed_buf_len - dst_idx)],
            // equivalent to trimmed_buf[0 .. trimmed_buf.len - dst.len]; with index tracking dst.len == trimmed_buf_len - dst_idx
            start_indent: Some(indent_str),
            end_indent: Some(&str_in[end_indent..]),
        }
    }

    pub(crate) fn inline_snapshot(
        &self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        received: Received,
        property_matchers: Option<JSValue>,
        result: Option<&[u8]>,
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        let this = self;
        // jest counts inline snapshots towards the snapshot counter for some reason
        let Some(runner) = Jest::runner() else {
            let signature = Self::get_signature(fn_name, "", false);
            return throw!(this, global_this, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n");
        };
        let update = runner.snapshots.update_snapshots;
        let needs_write;

        // An inline snapshot does not say who wrote it: the runner that the test is written for, as far as that tells.
        let is_vitest = this.bun_test().is_some_and(|buntest| this.is_in_vitest_test(buntest.get()));
        let format = if is_vitest { SnapshotFormat::Vitest } else { SnapshotFormat::Bun };
        let mut pretty_value: Vec<u8> = Vec::new();
        let value = Self::value_to_snapshot(global_this, received, format)?;
        let (shown, same_as_older_bun) =
            this.match_and_fmt_snapshot(global_this, value, property_matchers, &mut pretty_value, fn_name, format)?;
        if this.bun_test().is_some() {
            match runner.snapshots.format_of(this).and_then(|format| runner.snapshots.add_count(this, format, b"")) {
                Ok(_) => {}
                Err(crate::Error::NoTest | crate::Error::SnapshotInConcurrentGroup | crate::Error::TestNotActive) => {}
                Err(err) => return Err(this.throw_snapshot_error(global_this, &err, b"")),
            }
        }

        let mut start_indent: Option<Box<[u8]>> = None;
        let mut end_indent: Option<Box<[u8]>> = None;
        if let Some(saved_value) = result {
            let mut buf = vec![0u8; saved_value.len()];
            let trim_res = Self::trim_leading_whitespace_for_inline_snapshot(saved_value, &mut buf);

            if format.matches(trim_res.trimmed, &pretty_value) {
                runner.snapshots.passed += 1;
                return Ok(JSValue::UNDEFINED);
            } else if update {
                runner.snapshots.passed += 1;
                needs_write = true;
                start_indent = trim_res.start_indent.map(Box::<[u8]>::from);
                end_indent = trim_res.end_indent.map(Box::<[u8]>::from);
            } else if Self::was_written_by_another(
                // Jest and Vitest print a value alike.
                match (received, is_vitest) {
                    (Received::Value(_), true) => &[],
                    (Received::Value(_), false) | (Received::Thrown(_), true) => &[SnapshotFormat::Jest],
                    (Received::Thrown(_), false) => &[SnapshotFormat::Jest, SnapshotFormat::Vitest],
                },
                !same_as_older_bun,
                global_this,
                if property_matchers.is_some() { Received::Value(shown) } else { received },
                property_matchers,
                trim_res.trimmed,
            )? {
                runner.snapshots.passed += 1;
                return Ok(JSValue::UNDEFINED);
            } else {
                runner.snapshots.failed += 1;
                let signature = Self::get_signature(fn_name, "<green>expected<r>", false);
                let diff_format = DiffFormatter::from_strings(&pretty_value, trim_res.trimmed, false);
                return throw!(this, global_this, signature, "\n\n{}\n", diff_format);
            }
        } else {
            needs_write = true;
        }

        if needs_write {
            if crate::cli::ci_info::is_ci() {
                if !update {
                    let signature = Self::get_signature(fn_name, "", false);
                    // Only creating new snapshots can reach here (updating with mismatches errors earlier with diff)
                    return throw!(
                        this, global_this, signature,
                        "\n\n<b>Matcher error<r>: Inline snapshot creation is disabled in CI environments unless --update-snapshots is used.\nTo override, set the environment variable CI=false.\n\nReceived: {}",
                        bstr::BStr::new(&pretty_value),
                    );
                }
            }
            let Some(buntest_strong) = this.bun_test() else {
                let signature = Self::get_signature(fn_name, "", false);
                return throw!(this, global_this, signature, "\n\n<b>Matcher error<r>: Snapshot matchers cannot be used outside of a test\n");
            };
            let buntest = buntest_strong.get();

            // 1. find the src loc of the snapshot
            let srcloc = ExpectDeferred::call_site(global_this, call_frame)
                .unwrap_or_else(|| call_frame.get_caller_src_loc(global_this));
            let file_id = buntest.file_id;
            // MultiArrayList::get requires MultiArrayElement (derive pending);
            // use the column accessor which already compiles in jest.rs.
            let fget_source_path_text = runner.files.items_source()[file_id as usize].path.text;

            if !srcloc.str.eql_utf8(fget_source_path_text) {
                let signature = Self::get_signature(fn_name, "", false);
                return throw!(
                    this, global_this, signature,
                    "\n\n<b>Matcher error<r>: Inline snapshot matchers must be called from the test file:\n  Expected to be called from file: <green>{:?}<r>\n  {} called from file: <red>{:?}<r>\n",
                    bstr::BStr::new(fget_source_path_text),
                    fn_name,
                    // `{:?}` on BStr renders a quoted, escaped string
                    bstr::BStr::new(srcloc.str.to_utf8().slice()),
                );
            }

            // 2. save to write later
            runner.snapshots.add_inline_snapshot_to_write(file_id, super::snapshot::InlineSnapshotToWrite {
                line: core::ffi::c_ulong::from(srcloc.line),
                col: core::ffi::c_ulong::from(srcloc.column),
                value: core::mem::take(&mut pretty_value).into_boxed_slice(),
                has_matchers: property_matchers.is_some(),
                is_added: result.is_none(),
                kind: fn_name.as_bytes(),
                start_indent,
                end_indent,
                is_in_vitest_test: is_vitest,
            })?;
        }

        Ok(JSValue::UNDEFINED)
    }

    /// Whether `saved`, which is not what `received` prints as, is what an older Bun or the runner of one of `formats`
    /// wrote for it. What printing throws here only says that it is not.
    #[cold]
    fn was_written_by_another(
        formats: &[SnapshotFormat],
        or_older_bun: bool,
        global_this: &JSGlobalObject,
        received: Received,
        property_matchers: Option<JSValue>,
        saved: &[u8],
    ) -> JsResult<bool> {
        for format in or_older_bun.then_some(None).into_iter().chain(formats.iter().copied().map(Some)) {
            let is_it = (|| {
                let value = Self::value_to_snapshot(global_this, received, format.unwrap_or(SnapshotFormat::Bun))?;
                let Some(format) = format else {
                    return JestPrettyFormat::did_older_bun_print(global_this, value, saved);
                };
                let mut printed: Vec<u8> = Vec::new();
                JestPrettyFormat::print_snapshot(global_this, value, property_matchers, &mut printed, format)?;
                Ok(printed == saved)
            })();
            match is_it {
                Ok(true) => return Ok(true),
                Ok(false) => {}
                Err(JsError::Thrown) if global_this.clear_exception_except_termination() => {}
                Err(err) => return Err(err),
            }
        }
        Ok(false)
    }

    /// What was printed, which has the matchers of `property_matchers`, and the result of `print_snapshot`.
    pub(crate) fn match_and_fmt_snapshot(
        &self,
        global_this: &JSGlobalObject,
        value: JSValue,
        property_matchers: Option<JSValue>,
        pretty_value: &mut Vec<u8>,
        fn_name: &'static str,
        format: SnapshotFormat,
    ) -> JsResult<(JSValue, bool)> {
        let mut value = value;
        if let Some(_prop_matchers) = property_matchers {
            if !value.is_object() {
                let signature = Self::get_signature(fn_name, "<green>properties<r><d>, <r>hint", false);
                return throw!(self, global_this, signature, "\n\n<b>Matcher error: <red>received<r> values must be an object when the matcher has <green>properties<r>\n").map(|_| (value, true));
            }

            let prop_matchers = _prop_matchers;

            let (matched, with_matchers) = value.jest_deep_match(prop_matchers, global_this, true)?;
            if !matched {
                // TODO: print diff with properties from propertyMatchers
                let signature = Self::get_signature(fn_name, "<green>propertyMatchers<r>", false);
                let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(false);
                return throw!(
                    self, global_this, signature,
                    "\n\nExpected <green>propertyMatchers<r> to match properties from received object\n\nReceived: {}\n",
                    value.to_fmt(&mut formatter),
                ).map(|_| (value, true));
            }
            value = with_matchers;
        }

        let same_as_older_bun = JestPrettyFormat::print_snapshot(global_this, value, property_matchers, pretty_value, format)?;
        Ok((value, same_as_older_bun))
    }

    pub(crate) fn snapshot(
        &self,
        global_this: &JSGlobalObject,
        received: Received,
        property_matchers: Option<JSValue>,
        hint: &[u8],
        fn_name: &'static str,
    ) -> JsResult<JSValue> {
        let runner = Jest::runner().expect("unreachable");
        let mut pretty_value: Vec<u8> = Vec::new();
        let format = match runner.snapshots.format_of(self) {
            Ok(format) => format,
            Err(err) => return Err(self.throw_snapshot_error(global_this, &err, &pretty_value)),
        };
        let value = Self::value_to_snapshot(global_this, received, format)?;
        let (shown, same_as_older_bun) =
            self.match_and_fmt_snapshot(global_this, value, property_matchers, &mut pretty_value, fn_name, format)?;

        match runner.snapshots.match_or_write(self, &pretty_value, hint) {
            Ok(SnapshotOutcome::Passed | SnapshotOutcome::Written) => Ok(JSValue::UNDEFINED),
            Ok(SnapshotOutcome::Mismatch { saved }) => {
                // Bun used to add to the files of Jest in its own format.
                let received = if property_matchers.is_some() { Received::Value(shown) } else { received };
                if format != SnapshotFormat::Vitest
                    && Self::was_written_by_another(&[], !same_as_older_bun, global_this, received, property_matchers, &saved)?
                {
                    runner.snapshots.passed += 1;
                    return Ok(JSValue::UNDEFINED);
                }
                runner.snapshots.failed += 1;
                let signature = Self::get_signature(fn_name, "<green>expected<r>", false);
                let diff_format = DiffFormatter::from_strings(&pretty_value, &saved, false);
                throw!(self, global_this, signature, "\n\n{}\n", diff_format)
            }
            Err(err) => Err(self.throw_snapshot_error(global_this, &err, &pretty_value)),
        }
    }

    #[cold]
    pub(crate) fn throw_snapshot_error(&self, global_this: &JSGlobalObject, err: &crate::Error, pretty_value: &[u8]) -> JsError {
        let runner = Jest::runner().expect("unreachable");
        let Some(buntest_strong) = self.bun_test() else {
            return global_this.throw(format_args!("Snapshot matchers cannot be used outside of a test"));
        };
        let buntest = buntest_strong.get();
        // MultiArrayList::get requires MultiArrayElement (derive pending); use column accessor.
        let test_file_path = runner.files.items_source()[buntest.file_id as usize].path.text;
        let test_file_path = bstr::BStr::new(test_file_path);
        match err {
            crate::Error::FailedToOpenSnapshotFile => {
                global_this.throw(format_args!("Failed to open snapshot file for test file: {test_file_path}"))
            }
            crate::Error::FailedToMakeSnapshotDirectory => {
                global_this.throw(format_args!("Failed to make snapshot directory for test file: {test_file_path}"))
            }
            crate::Error::FailedToWriteSnapshotFile => {
                global_this.throw(format_args!("Failed write to snapshot file: {test_file_path}"))
            }
            crate::Error::SyntaxError | crate::Error::ParseError => {
                global_this.throw(format_args!("Failed to parse snapshot file for: {test_file_path}"))
            }
            crate::Error::SnapshotCreationNotAllowedInCI => {
                let snapshot_name = runner.snapshots.last_error_snapshot_name.take();
                if let Some(name) = snapshot_name {
                    global_this.throw(format_args!(
                        "Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nSnapshot name: \"{}\"\nReceived: {}",
                        bstr::BStr::new(&name),
                        bstr::BStr::new(pretty_value),
                    ))
                } else {
                    global_this.throw(format_args!(
                        "Snapshot creation is disabled in CI environments unless --update-snapshots is used\nTo override, set the environment variable CI=false.\n\nReceived: {}",
                        bstr::BStr::new(pretty_value),
                    ))
                }
            }
            crate::Error::SnapshotInConcurrentGroup => {
                global_this.throw(format_args!("Snapshot matchers are not supported in concurrent tests"))
            }
            crate::Error::TestNotActive => {
                global_this.throw(format_args!("Snapshot matchers are not supported after the test has finished executing"))
            }
            _ => global_this.throw(format_args!("Failed to snapshot value: {}", bstr::BStr::new(pretty_value))),
        }
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen; static getter has no `&self`.
    pub(crate) fn get_static_not(
        global_this: &JSGlobalObject,
        _: JSValue,
        _: crate::generated_classes::PropertyName,
    ) -> JsResult<JSValue> {
        let mut f = Flags::default();
        f.set_not(true);
        ExpectStatic::create(global_this, f)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen; static getter has no `&self`.
    pub(crate) fn get_static_resolves_to(
        global_this: &JSGlobalObject,
        _: JSValue,
        _: crate::generated_classes::PropertyName,
    ) -> JsResult<JSValue> {
        let mut f = Flags::default();
        f.set_promise(Promise::Resolves);
        ExpectStatic::create(global_this, f)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen; static getter has no `&self`.
    pub(crate) fn get_static_rejects_to(
        global_this: &JSGlobalObject,
        _: JSValue,
        _: crate::generated_classes::PropertyName,
    ) -> JsResult<JSValue> {
        let mut f = Flags::default();
        f.set_promise(Promise::Rejects);
        ExpectStatic::create(global_this, f)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn any(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectAny::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn anything(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectAnything::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn close_to(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectCloseTo::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn object_containing(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectObjectContaining::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn string_containing(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectStringContaining::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn string_matching(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectStringMatching::call(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn array_containing(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        ExpectArrayContaining::call(global_this, call_frame)
    }

    /// Implements `expect.extend({ ... })`
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn extend(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments();

        if args.is_empty() || !args[0].is_object() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>extend<d>(<r>matchers<d>)<r>\n\nExpected an object containing matchers\n",
            ));
        }

        // SAFETY: FFI call with valid &JSGlobalObject
        let expect_proto = unsafe { Expect__getPrototype(global_this) };
        let expect_constructor = <Self as bun_jsc::JsClass>::get_constructor(global_this);
        // SAFETY: FFI call with valid &JSGlobalObject
        let expect_static_proto = unsafe { ExpectStatic__getPrototype(global_this) };

        // SAFETY: already checked that args[0] is an object
        let matchers_to_register = args[0].get_object().expect("unreachable");
        {
            let iter = JSPropertyIterator::init(
                global_this,
                matchers_to_register,
                bun_jsc::JSPropertyIteratorOptions {
                    skip_empty_name: false,
                    include_value: true,
                    own_properties_only: false,
                    observable: true,
                    only_non_index_properties: false,
                    include_symbols: false,
                },
            )?;

            while let Some((matcher_name, matcher_fn)) = iter.next()? {

                if !matcher_fn.js_type().is_function() {
                    // `import * as matchers from "a-commonjs-package"`
                    if matcher_name.eq_ascii(b"default") || matcher_name.eq_ascii(b"__esModule") {
                        continue;
                    }
                    let type_name = if matcher_fn.is_null() {
                        bun_core::StringView::static_("null")
                    } else {
                        matcher_fn.js_type_string(global_this)
                    };
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "expect.extend: `{}` is not a valid matcher. Must be a function, is \"{}\"",
                        matcher_name, type_name,
                    )));
                }

                // Mutate the Expect/ExpectStatic prototypes/constructor with new instances of JSCustomExpectMatcherFunction.
                // Even though they point to the same native functions for all matchers,
                // multiple instances are created because each instance will hold the matcher_fn as a property

                // `to_js_host_fn` returns an opaque closure, so emit an
                // explicit C-ABI shim and pass its address.
                bun_jsc::jsc_host_abi! {
                    unsafe fn __apply_custom_matcher_shim(
                        g: *mut bun_jsc::JSGlobalObject,
                        f: *mut bun_jsc::CallFrame,
                    ) -> JSValue {
                        // SAFETY: JSC guarantees both pointers are live for the call.
                        let (g, f) = unsafe { (&*g, &*f) };
                        bun_jsc::to_js_host_fn_result(g, Expect::apply_custom_matcher(g, f))
                    }
                }
                let host_fn_ptr: bun_jsc::JSHostFn = __apply_custom_matcher_shim;
                // SAFETY: FFI call with valid global, &bun_core::String, host-fn ptr, and JSValue.
                // C++ takes the function pointer **by value** (`NativeFunctionPtr`), not a
                // pointer-to-function-pointer — `JSHostFn` already is the
                // function-pointer type, so pass it directly.
                let wrapper_fn = unsafe {
                    Bun__JSWrappingFunction__create(
                        global_this,
                        &matcher_name,
                        host_fn_ptr,
                        matcher_fn,
                    )
                };

                expect_proto.put_may_be_index(global_this, &matcher_name, wrapper_fn)?;
                expect_constructor.put_may_be_index(global_this, &matcher_name, wrapper_fn)?;
                expect_static_proto.put_may_be_index(global_this, &matcher_name, wrapper_fn)?;
            }
        }

        // SAFETY: bun_vm() returns the live thread-local VirtualMachine.
        global_this.bun_vm().as_mut().auto_garbage_collect();

        Ok(JSValue::UNDEFINED)
    }

    #[cold]
    fn throw_invalid_matcher_error(
        global_this: &JSGlobalObject,
        matcher_name: &bun_core::String,
        result: JSValue,
    ) -> JsError {
        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);

        // The template has no `<tag>` markers so the colors branch is a no-op anyway.
        let err = global_this.create_error_instance(format_args!(
            "Unexpected return from matcher function `{}`.\n\
             Matcher functions should return an object in the following format:\n  \
             {{message?: string | function, pass: boolean}}\n\
             '{}' was returned",
            matcher_name,
            result.to_fmt(&mut formatter),
        ));
        match bun_core::String::static_("InvalidMatcherError").to_js(global_this) {
            Ok(name) => err.put(global_this, b"name", name),
            // An exception (e.g. OOM) is already pending from to_js; propagate it
            // instead of throwing the partially-constructed error.
            Err(js_err) => return js_err,
        }
        global_this.throw_value(err)
    }

    /// Execute the custom matcher for the given args (the left value + the args passed to the matcher call).
    /// This function is called both for symmetric and asymmetric matching.
    /// If silent=false, throws an exception in JS if the matcher result didn't result in a pass (or if the matcher result is invalid).
    pub(crate) fn execute_custom_matcher(
        global_this: &JSGlobalObject,
        custom_label: &bun_core::String,
        matcher_name: &bun_core::String,
        matcher_fn: JSValue,
        args: &[JSValue],
        flags: Flags,
        parent: Option<&RefPtr<bun_test::RefData>>,
        silent: bool,
    ) -> JsResult<bool> {
        // call the custom matcher implementation
        let mut result = Pass::once(global_this, Asked::Matcher, &mut || {
            matcher_fn.call(global_this, ExpectMatcherContext { flags, parent: parent.cloned() }.to_js(global_this), args)
        })?;
        // support for async matcher results
        if let Some(promise) = result.as_any_promise() {
            let vm = global_this.vm();
            promise.set_handled(vm);
            if promise.status() == js_promise::Status::Pending {
                return Err(Pass::wait_for(global_this, promise));
            }

            result = promise.result(vm);
            result.ensure_still_alive();
            debug_assert!(!result.is_empty());
            match promise.status() {
                js_promise::Status::Pending => unreachable!(),
                js_promise::Status::Fulfilled => {}
                js_promise::Status::Rejected => {
                    // SAFETY: per-use reborrow of the thread-local VM (see VirtualMachine::get docs).
                    VirtualMachine::get().as_mut().run_error_handler(result, None);
                    return Err(global_this.throw(format_args!(
                        "Matcher `{}` returned a promise that rejected",
                        matcher_name,
                    )));
                }
            }
        }

        let mut pass: bool = false;
        let mut message: JSValue = JSValue::UNDEFINED;

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
                    }

                    break 'valid true;
                }
            }
            false
        };
        if !is_valid {
            return Err(Self::throw_invalid_matcher_error(global_this, matcher_name, result));
        }

        if flags.not() { pass = !pass; }
        if pass || silent { return Ok(pass); }

        // handle failure
        if message.is_callable() {
            // Pass the global object itself as `this`.
            message = message.call_with_global_this(global_this, &[])?;
        }
        let message_text: bun_core::String = if message.to_boolean() {
            message.to_bun_string(global_this)?
        } else {
            bun_core::String::static_("No message was specified for this matcher.")
        };

        // As in Jest and vitest, the message is all there is: most matchers start it with `this.utils.matcherHint()`.
        Err(if custom_label.is_empty() {
            global_this.throw(format_args!("{message_text}"))
        } else {
            global_this.throw(format_args!("{custom_label}\n\n{message_text}"))
        })
    }

    /// Function that is run for either `expect.myMatcher()` call or `expect().myMatcher` call,
    /// and we can known which case it is based on if the `callFrame.this()` value is an instance of Expect
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn apply_custom_matcher(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns the live VM pointer for this global.
        let _gc = global_this.bun_vm().as_mut().auto_gc_on_drop();

        // try to retrieve the Expect instance
        let Some(expect_ptr) = Expect::from_js(call_frame.this()) else {
            // if no Expect instance, assume it is a static call (`expect.myMatcher()`), so create an ExpectCustomAsymmetricMatcher instance
            return ExpectCustomAsymmetricMatcher::create(global_this, call_frame, Self::custom_matcher_fn(global_this, call_frame)?);
        };
        // SAFETY: from_js returned a non-null live m_ctx pointer owned by the JS wrapper.
        // R-2: deref as shared (`&*`) — the matcher runs user JS, which can call another matcher on this same
        // `expect()` chain; aliased `&Expect` is sound, aliased `&mut Expect` is not.
        let expect = unsafe { &*expect_ptr };

        // if we got an Expect instance, then it's a non-static call (`expect().myMatcher`),
        // so now execute the symmetric matching
        expect.call_matcher(global_this, call_frame, Self::custom_matcher)
    }

    /// The user-provided matcher function (matcher_fn) of the custom matcher that `call_frame` calls.
    fn custom_matcher_fn(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let func: JSValue = call_frame.callee();
        let matcher_fn: JSValue = get_custom_matcher_fn(func, global_this).unwrap_or(JSValue::UNDEFINED);
        if !matcher_fn.js_type().is_function() {
            return Err(global_this.throw2(
                "Internal consistency error: failed to retrieve the matcher function for a custom matcher!",
                (),
            ));
        }
        Ok(matcher_fn)
    }

    fn custom_matcher(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let expect = self;
        let this_value: JSValue = call_frame.this();
        let matcher_fn = Self::custom_matcher_fn(global_this, call_frame)?;

        // retrieve the matcher name
        let matcher_name = matcher_fn.get_name(global_this)?;

        let matcher_params = CustomMatcherParamsFormatter {
            colors: Output::enable_ansi_colors_stderr(),
            matcher_fn,
        };

        // retrieve the captured expected value
        let Some(mut value) = super::expect::js::captured_value_get_cached(this_value) else {
            return Err(global_this.throw(format_args!(
                "Internal consistency error: failed to retrieve the captured value"
            )));
        };
        value = Self::process_promise(
            &expect.custom_label,
            expect.flags.get(),
            global_this,
            value,
            Self::settled_promise(this_value),
            &matcher_name,
            &matcher_params,
            false,
        )?;
        value.ensure_still_alive();

        expect.increment_expect_call_counter();

        // prepare the args array
        let args = call_frame.arguments();
        // MarkedArgumentBuffer::new is scoped (closure-borrow); collect into a Vec
        // since execute_custom_matcher takes &[JSValue].
        let mut matcher_args: Vec<JSValue> = Vec::with_capacity(args.len() + 1);
        matcher_args.push(value);
        for arg in args {
            matcher_args.push(*arg);
        }

        let _ = Self::execute_custom_matcher(global_this, &expect.custom_label, &matcher_name, matcher_fn, &matcher_args, expect.flags.get(), expect.parent.as_ref(), false)?;

        Ok(this_value)
    }

    // Rust has no associated const-fn aliases that satisfy
    // `Expect::add_snapshot_serializer(..)` UFCS, so forward.
    #[inline]
    pub(crate) fn add_snapshot_serializer(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        JestPrettyFormat::add_snapshot_serializer(global_this, call_frame)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn has_assertions(global_this: &JSGlobalObject, _call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::has_assertions_in(global_this, None)
    }

    /// `state`: as for `call_in`.
    pub(crate) fn has_assertions_in(global_this: &JSGlobalObject, state: Option<bun_test::RefDataValue>) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns the live VM pointer for this global.
        let _gc = global_this.bun_vm().as_mut().auto_gc_on_drop();

        let Some(buntest_strong) = bun_test::clone_active_strong() else {
            return Err(global_this.throw(format_args!("expect.assertions() must be called within a test")));
        };
        let buntest = buntest_strong.get();
        let state_data = state.unwrap_or_else(|| buntest.get_current_state_data());
        let Some(execution) = state_data.sequence(buntest) else {
            return Err(global_this.throw(format_args!("expect.assertions() is not supported in the describe phase, in concurrent tests, between tests, or after test execution has completed")));
        };
        if !matches!(execution.expect_assertions, ExpectAssertions::Exact(_)) {
            execution.expect_assertions = ExpectAssertions::AtLeastOne;
        }

        Ok(JSValue::UNDEFINED)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn assertions(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::assertions_in(global_this, call_frame, None)
    }

    /// `state`: as for `call_in`.
    pub(crate) fn assertions_in(
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
        state: Option<bun_test::RefDataValue>,
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns the live VM pointer for this global.
        let _gc = global_this.bun_vm().as_mut().auto_gc_on_drop();

        let arguments = call_frame.arguments();

        if arguments.is_empty() {
            return Err(global_this.throw_invalid_arguments(format_args!("expect.assertions() takes 1 argument")));
        }

        let expected: JSValue = arguments[0];

        if !expected.is_number() {
            let mut fmt = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
            return Err(global_this.throw(format_args!(
                "Expected value must be a non-negative integer: {}",
                expected.to_fmt(&mut fmt),
            )));
        }

        let expected_assertions: f64 = expected.to_number(global_this)?;
        if expected_assertions.round() != expected_assertions
            || expected_assertions.is_infinite()
            || expected_assertions.is_nan()
            || expected_assertions < 0.0
            || expected_assertions > u32::MAX as f64
        {
            let mut fmt = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
            return Err(global_this.throw(format_args!(
                "Expected value must be a non-negative integer: {}",
                expected.to_fmt(&mut fmt),
            )));
        }

        let unsigned_expected_assertions: u32 = expected_assertions as u32;

        let Some(buntest_strong) = bun_test::clone_active_strong() else {
            return Err(global_this.throw(format_args!("expect.assertions() must be called within a test")));
        };
        let buntest = buntest_strong.get();
        let state_data = state.unwrap_or_else(|| buntest.get_current_state_data());
        let Some(execution) = state_data.sequence(buntest) else {
            return Err(global_this.throw(format_args!("expect.assertions() is not supported in the describe phase, in concurrent tests, between tests, or after test execution has completed")));
        };
        execution.expect_assertions = ExpectAssertions::Exact(unsigned_expected_assertions);

        Ok(JSValue::UNDEFINED)
    }


    pub(crate) fn post_match(&self, global_this: &JSGlobalObject) {
        global_this.bun_vm().auto_garbage_collect();
    }

    /// The returned guard holds the
    /// `&Expect` borrow, re-lends it via `Deref`, and calls `post_match` on drop so every
    /// exit path (success, `?`, explicit `return Err`) triggers the GC sweep.
    pub(crate) fn post_match_guard<'a>(&'a self, global: &'a JSGlobalObject) -> PostMatchGuard<'a> {
        PostMatchGuard { expect: self, global }
    }

    /// Shared front-matter for `expect(received).toX(...)` matchers.
    ///
    /// Composes the four lines every hand-ported matcher repeats — currently
    /// stamped out in **four** different shapes (scopeguard-rebind,
    /// scopeguard-side-binding, inner-closure-then-`post_match`, and *missing
    /// entirely* in `toContainAllValues` / `toBeArrayOfSize`). Third member of
    /// the matcher-scaffold family alongside [`Self::run_unary_predicate`] and
    /// [`Self::mock_prologue`], for matchers that need the received value but
    /// are NOT a pure unary predicate and NOT a mock-function matcher.
    ///
    /// Returns `(guard, received_value, not)`. The guard derefs to `&Expect`
    /// and runs `post_match` on drop; `not` is `flags.not()` snapshotted once.
    /// Callers that don't need `not` until later destructure as `(this, v, _)`.
    #[inline]
    pub(crate) fn matcher_prelude<'a>(
        &'a self,
        global: &'a JSGlobalObject,
        this_value: JSValue,
        matcher_name: &str,
        matcher_params: &'static str,
    ) -> JsResult<(PostMatchGuard<'a>, JSValue, bool)> {
        let this = self.post_match_guard(global);
        let value = this.get_value(global, this_value, matcher_name, matcher_params)?;
        this.increment_expect_call_counter();
        let not = this.flags.get().not();
        Ok((this, value, not))
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn do_unreachable(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let [arg] = callframe.arguments_as_array::<1>();

        if arg.is_empty_or_undefined_or_null() {
            let error_value = global_this.create_error_instance(format_args!("reached unreachable code"));
            error_value.put(global_this, b"name", bun_core::String::static_("UnreachableError").to_js(global_this)?);
            return Err(global_this.throw_value(error_value));
        }

        if arg.is_string() {
            let error_value = arg.to_bun_string(global_this)?.to_error_instance(global_this);
            error_value.put(global_this, b"name", bun_core::String::static_("UnreachableError").to_js(global_this)?);
            return Err(global_this.throw_value(error_value));
        }

        Err(global_this.throw_value(arg))
    }
}

/// RAII guard returned by [`Expect::post_match_guard`]. Holds an `&Expect` for the
/// duration of a matcher body and runs `post_match` on drop —
/// shared by every `expect().toX()` matcher.
/// R-2: shared borrow only (no `DerefMut`); all `Expect` methods reachable from a
/// matcher body take `&self`.
pub(crate) struct PostMatchGuard<'a> {
    expect: &'a Expect,
    global: &'a JSGlobalObject,
}

impl core::ops::Deref for PostMatchGuard<'_> {
    type Target = Expect;
    #[inline]
    fn deref(&self) -> &Expect {
        self.expect
    }
}

impl Drop for PostMatchGuard<'_> {
    fn drop(&mut self) {
        self.expect.post_match(self.global);
    }
}

pub(crate) struct CustomMatcherParamsFormatter {
    pub(crate) colors: bool,
    pub(crate) matcher_fn: JSValue,
}

impl fmt::Display for CustomMatcherParamsFormatter {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        // try to detect param names from matcher_fn (user function) source code
        if let Some(source_str) = JSFunction::get_source_code(self.matcher_fn) {
            let source_slice = source_str.to_utf8();

            let source: &[u8] = source_slice.slice();
            if let Some(lparen) = strings::index_of_char_usize(source, b'(') {
                if let Some(rparen) = strings::index_of_char_pos(source, b')', lparen) {
                    let params_str = &source[lparen + 1..rparen];
                    let mut param_index: usize = 0;
                    for param_name in strings::split(params_str, b",") {
                        if param_index > 0 {
                            // skip the first param from the matcher_fn, which is the received value
                            if param_index > 1 {
                                if self.colors {
                                    writer.write_str(bun_core::pretty_fmt!("<r><d>, <r><green>", true))?;
                                } else {
                                    writer.write_str(", ")?;
                                }
                            } else if self.colors {
                                writer.write_str(bun_core::output::ansi::GREEN)?;
                            }
                            let param_name_trimmed = bun_core::trim(param_name, b" ");
                            if !param_name_trimmed.is_empty() {
                                write!(writer, "{}", bstr::BStr::new(param_name_trimmed))?;
                            } else {
                                write!(writer, "arg{}", param_index - 1)?;
                            }
                        }
                        param_index += 1;
                    }
                    if param_index > 1 && self.colors {
                        writer.write_str(bun_core::output::ansi::RESET)?;
                    }
                    return Ok(()); // don't do fallback
                }
            }
        }

        // fallback
        bun_core::write_pretty!(writer, self.colors, "<green>...args<r>")
    }
}

/// Static instance of expect, holding a set of flags.
/// Returned for example when executing `expect.not`
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectStatic {
    pub(crate) flags: Flags,
}

impl ExpectStatic {
    pub(crate) fn create(global_this: &JSGlobalObject, flags: Flags) -> JsResult<JSValue> {
        let value = ExpectStatic { flags }.to_js(global_this);
        value.ensure_still_alive();
        Ok(value)
    }

    // codegen passes `(&mut *this, this_value, global)` for `this: true` getters
    // (jest.classes.ts); the `#[host_fn(getter)]` proc-macro emits a 2-arg shim, so we drop
    // it here and match the generated signature directly. `this_value` is unused.
    pub(crate) fn get_not(this: &Self, _this_value: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut flags = this.flags;
        flags.set_not(!this.flags.not());
        Self::create(global_this, flags)
    }

    pub(crate) fn get_resolves_to(this: &Self, _this_value: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut flags = this.flags;
        if flags.promise() != Promise::None {
            return Err(Self::async_chaining_error(global_this, flags, b"resolvesTo"));
        }
        flags.set_promise(Promise::Resolves);
        Self::create(global_this, flags)
    }

    pub(crate) fn get_rejects_to(this: &Self, _this_value: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
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
        global_this.throw(format_args!(
            "expect.{}: already called expect.{} on this chain",
            bstr::BStr::new(name),
            str,
        ))
    }

    fn create_asymmetric_matcher_with_flags<T: AsymmetricMatcherClass + 'static>(
        this: &Self,
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        //const this: *ExpectStatic = ExpectStatic.fromJS(callFrame.this());
        let instance_jsvalue = T::invoke(global_this, call_frame)?;
        if !instance_jsvalue.is_any_error() {
            let Some(instance) = T::from_js_ptr(instance_jsvalue) else {
                return Err(global_this.throw_out_of_memory());
            };
            // SAFETY: from_js_ptr returns the live m_ctx payload owned by instance_jsvalue.
            let cell = unsafe { (*instance).flags_cell() };
            let mut flags = cell.get();
            flags.set_not(this.flags.not());
            flags.set_promise(this.flags.promise());
            cell.set(flags);
        }
        Ok(instance_jsvalue)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn anything(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectAnything>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn any(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectAny>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn array_containing(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectArrayContaining>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn close_to(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectCloseTo>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn object_containing(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectObjectContaining>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn string_containing(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectStringContaining>(self, global_this, call_frame)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn string_matching(&self, global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        Self::create_asymmetric_matcher_with_flags::<ExpectStringMatching>(self, global_this, call_frame)
    }
}

// Trait used by `create_asymmetric_matcher_with_flags` to dispatch to the
// per-matcher inherent `call()` and post-hoc patch `flags`. The trait method is
// named `invoke` (not `call`) to avoid E0034 ambiguity with each matcher's
// inherent `fn call`.
trait AsymmetricMatcherClass {
    fn invoke(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue>;
    fn from_js_ptr(value: JSValue) -> Option<*mut Self>;
    /// R-2: each asymmetric-matcher payload exposes its `Cell<Flags>` so
    /// `ExpectStatic::create_asymmetric_matcher_with_flags` can patch it
    /// post-construction without forming `&mut Self`.
    fn flags_cell(&self) -> &Cell<Flags>;
}

macro_rules! impl_asymmetric_matcher_class {
    ($($t:ty),* $(,)?) => {
        $(
            impl AsymmetricMatcherClass for $t {
                #[inline]
                fn invoke(g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
                    <$t>::call(g, f)
                }
                #[inline]
                fn from_js_ptr(value: JSValue) -> Option<*mut Self> {
                    <$t as bun_jsc::JsClass>::from_js(value)
                }
                #[inline]
                fn flags_cell(&self) -> &Cell<Flags> {
                    &self.flags
                }
            }
        )*
    };
}
impl_asymmetric_matcher_class!(
    ExpectAnything,
    ExpectAny,
    ExpectArrayContaining,
    ExpectCloseTo,
    ExpectObjectContaining,
    ExpectStringContaining,
    ExpectStringMatching,
);

// ─── unary-predicate matcher scaffold ────────────────────────────────────
// Dedups the 22 hand-rolled `expect/toBe*.rs` files (~1270 LOC → ~300 LOC) and
// fixes two latent bugs (throw_fmt wrapper drop; post_match-before-throw
// ordering).
impl Expect {
    /// Shared scaffold for zero-arg `expect(v).toBeX()` matchers whose pass/fail
    /// is a pure infallible predicate on the received `JSValue` and whose failure
    /// message is the stock `"\n\nReceived: <red>{value}<r>\n"`.
    ///
    /// Replaces ~45 LOC of identical boilerplate per matcher: post_match guard,
    /// `get_value`, `increment_expect_call_counter`, `not`-xor, formatter,
    /// `get_signature`, `throw`.
    #[inline]
    pub(crate) fn run_unary_predicate(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher_name: &'static str,
        pred: impl FnOnce(JSValue) -> bool,
    ) -> JsResult<JSValue> {
        let (this, value, not) = self.matcher_prelude(global, frame.this(), matcher_name, "")?;
        if pred(value) != not {
            return Ok(JSValue::UNDEFINED);
        }
        let mut formatter = make_formatter(global);
        let signature = Self::get_signature(matcher_name, "", not);
        throw!(
            this, global, signature,
            "\n\nReceived: <red>{}<r>\n",
            value.to_fmt(&mut formatter),
        )
    }

    /// Shared scaffold for one-arg `expect(v).toStartWith/toEndWith/toInclude(expected)`
    /// matchers: received and expected must both be strings, pass/fail is a pure
    /// `&[u8]`×`&[u8]` predicate (with empty `expected` always passing), and the
    /// failure message is the stock two-liner
    /// `"Expected to [not ]{verb}: <green>{expected}<r>\nReceived: <red>{value}<r>\n"`.
    ///
    /// Replaces ~100 LOC of byte-identical boilerplate per matcher: post_match
    /// guard, 1-arg check, expected-is-string check, `get_value`,
    /// `increment_expect_call_counter`, UTF-8 slice + predicate, `not`-xor, dual
    /// formatter, `get_signature`, `throw`.
    ///
    /// Normalizes an inherited inconsistency where `toInclude` passed `""`
    /// to `get_value`'s `matcher_params` while the other two passed
    /// `"<green>expected<r>"` — all three now use the latter (matches the
    /// signature already used in their failure messages).
    pub(crate) fn run_string_affix_matcher(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher_name: &'static str,
        verb: &'static str,
        pred: fn(&[u8], &[u8]) -> bool,
    ) -> JsResult<JSValue> {
        let this = self.post_match_guard(global);

        let arguments = frame.arguments();
        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("{matcher_name}() requires 1 argument")));
        }
        let expected = arguments[0];
        expected.ensure_still_alive();
        if !expected.is_string() {
            return Err(global.throw(format_args!(
                "{matcher_name}() requires the first argument to be a string"
            )));
        }

        let value = this.get_value(global, frame.this(), matcher_name, "<green>expected<r>")?;
        this.increment_expect_call_counter();

        let mut pass = value.is_string();
        if pass {
            let value_string = value.to_utf8(global)?;
            let expected_string = expected.to_utf8(global)?;
            pass = expected_string.slice().is_empty()
                || pred(value_string.slice(), expected_string.slice());
        }

        let not = this.flags.get().not();
        if not {
            pass = !pass;
        }
        if pass {
            return Ok(JSValue::UNDEFINED);
        }

        let mut f1 = make_formatter(global);
        let mut f2 = make_formatter(global);
        let signature = Self::get_signature(matcher_name, "<green>expected<r>", not);
        if not {
            throw!(
                this, global, signature,
                "\n\nExpected to not {}: <green>{}<r>\nReceived: <red>{}<r>\n",
                verb,
                expected.to_fmt(&mut f1),
                value.to_fmt(&mut f2),
            )
        } else {
            throw!(
                this, global, signature,
                "\n\nExpected to {}: <green>{}<r>\nReceived: <red>{}<r>\n",
                verb,
                expected.to_fmt(&mut f1),
                value.to_fmt(&mut f2),
            )
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Shared skeleton for the 8 jest-extended `toContain{Key,Keys,AllKeys,AnyKeys,
// Value,Values,AllValues,AnyValues}` matchers. ~70% of each matcher body was the
// same boilerplate (post_match defer, arg-count check, expect-counter,
// get_value, `.not` flip, dual-formatter failure throw); only the pass-loop
// differs. Sibling to `run_unary_predicate` / `run_string_affix_matcher`.
// ──────────────────────────────────────────────────────────────────────────

/// Where `expected.is_array()` runs relative to `get_value` — observable when
/// both would throw (Keys-family validates *after*, Values-family *before*).
#[derive(Clone, Copy)]
pub(crate) enum ExpectedArray {
    /// `toContainKey` / `toContainValue`: scalar `expected`, no array check.
    None,
    /// `toContain*Values`: array check happens before `get_value`.
    BeforeValue,
    /// `toContain*Keys`: array check happens after `get_value`.
    AfterValue,
}

/// Failure-message verb pair for [`Expect::contain_matcher`]. The `not` arm
/// reads `"Expected to not {not_verb}: …"`, the plain arm `"Expected to
/// {verb}: …"`. For most matchers both are `"contain"`; the All/Any variants
/// override to `"contain all keys"` etc.
#[derive(Clone, Copy)]
pub(crate) struct ContainMsgs {
    pub(crate) verb: &'static str,
    pub(crate) not_verb: &'static str,
}
impl ContainMsgs {
    /// `"Expected to [not ]contain: …"` — toContainKey(s)/AnyKeys/Value(s).
    pub(crate) const CONTAIN: Self = Self { verb: "contain", not_verb: "contain" };
}

/// Result of a [`Expect::contain_matcher`] body closure: the pass/fail bit and
/// an optional override for the `Received:` value printed on failure
/// (`toContainAllKeys` prints `keys(value)` instead of `value`).
pub(crate) struct ContainOutcome {
    pub(crate) pass: bool,
    pub(crate) received_override: Option<JSValue>,
}
impl ContainOutcome {
    #[inline]
    pub(crate) fn pass(pass: bool) -> Self {
        Self { pass, received_override: None }
    }
}

impl Expect {
    /// Shared body for the eight `toContain{Key,Keys,AllKeys,AnyKeys,Value,
    /// Values,AllValues,AnyValues}` matchers. Handles the common envelope —
    /// `post_match` guard, 1-arg check, counter bump, `get_value`,
    /// optional `expected.is_array()` validation (positioned per
    /// [`ExpectedArray`]), `.not` flip, and the dual-formatter failure throw —
    /// and delegates only the per-matcher pass-loop to `body`.
    ///
    /// On pass, returns `frame.this()` (`thisValue`, not `undefined`).
    pub(crate) fn contain_matcher(
        &self,
        global: &JSGlobalObject,
        frame: &CallFrame,
        matcher_name: &'static str,
        expected_array: ExpectedArray,
        msgs: ContainMsgs,
        body: impl FnOnce(&JSGlobalObject, JSValue, JSValue) -> JsResult<ContainOutcome>,
    ) -> JsResult<JSValue> {
        let this = self.post_match_guard(global);
        let this_value = frame.this();

        let arguments = frame.arguments();
        if arguments.len() < 1 {
            return Err(global.throw_invalid_arguments(format_args!("{matcher_name}() takes 1 argument")));
        }

        this.increment_expect_call_counter();

        let expected = arguments[0];
        if matches!(expected_array, ExpectedArray::BeforeValue) && !expected.js_type().is_array() {
            return Err(global.throw_invalid_argument_type(matcher_name, "expected", "array"));
        }
        expected.ensure_still_alive();

        let value = this.get_value(global, this_value, matcher_name, "<green>expected<r>")?;
        if matches!(expected_array, ExpectedArray::AfterValue) && !expected.js_type().is_array() {
            return Err(global.throw_invalid_argument_type(matcher_name, "expected", "array"));
        }

        let not = this.flags.get().not();
        let outcome = body(global, value, expected)?;
        let mut pass = outcome.pass;
        if not {
            pass = !pass;
        }
        if pass {
            return Ok(this_value);
        }

        let received = outcome.received_override.unwrap_or(value);
        let mut f1 = make_formatter(global);
        let mut f2 = make_formatter(global);
        let signature = Self::get_signature(matcher_name, "<green>expected<r>", not);
        if not {
            throw!(
                this, global, signature,
                "\n\nExpected to not {}: <green>{}<r>\nReceived: <red>{}<r>\n",
                msgs.not_verb,
                expected.to_fmt(&mut f1),
                received.to_fmt(&mut f2),
            )
        } else {
            throw!(
                this, global, signature,
                "\n\nExpected to {}: <green>{}<r>\nReceived: <red>{}<r>\n",
                msgs.verb,
                expected.to_fmt(&mut f1),
                received.to_fmt(&mut f2),
            )
        }
    }
}

// `unary_predicate_matcher!` is defined in `test_runner/mod.rs` (top-level,
// outside `cfg_jsc!`) so it can be addressed as `crate::unary_predicate_matcher!`
// from each `expect/toBe*.rs` file — `#[macro_export]` from inside a
// macro-expanded module is not addressable by absolute path
// (`macro_expanded_macro_exports_accessed_by_absolute_paths`).

// ─── matcher dispatch ──────────────────────────────────────────────────────
// The generate-classes.ts Rust emitter calls every prototype matcher as
// `Expect::to_*(&mut *this, global, callframe)`. Roughly half the
// `expect/to*.rs` files already attach via `impl Expect { .. }`; the rest are
// free `pub fn to_*(this: &mut Expect, ..)` functions (those sibling
// crate-modules can't open `impl Expect` without seeing the struct
// definition first). Those modules are mounted under the `super::expect`
// façade (mod.rs `matchers!`), so we add inherent forwarders here — the real
// bodies stay in their per-matcher files, this is the layering bridge.
macro_rules! __forward_matcher {
    ( $( $method:ident => $module:ident :: $func:ident ),* $(,)? ) => {
        impl Expect {
            $(
                #[inline]
                pub(crate) fn $method(
                    &self,
                    global: &JSGlobalObject,
                    frame: &CallFrame,
                ) -> JsResult<JSValue> {
                    super::expect::$module::$func(self, global, frame)
                }
            )*
        }
    };
}
__forward_matcher! {
    to_be_array_of_size                      => to_be_array_of_size::to_be_array_of_size,
    to_be_empty                              => to_be_empty::to_be_empty,
    to_be_empty_object                       => to_be_empty_object::to_be_empty_object,
    to_be_instance_of                        => to_be_instance_of::to_be_instance_of,
    to_be_one_of                             => to_be_one_of::to_be_one_of,
    to_be_type_of                            => to_be_type_of::to_be_type_of,
    to_be_valid_date                         => to_be_valid_date::to_be_valid_date,
    to_contain_equal                         => to_contain_equal::to_contain_equal,
    to_end_with                              => simple_matchers::to_end_with,
    to_equal_ignoring_whitespace             => to_equal_ignoring_whitespace::to_equal_ignoring_whitespace,
    to_have_been_called                      => to_have_been_called::to_have_been_called,
    to_have_been_called_once                 => to_have_been_called_once::to_have_been_called_once,
    to_have_been_called_times                => to_have_been_called_times::to_have_been_called_times,
    to_have_been_called_with                 => to_have_been_called_with::to_have_been_called_with,
    to_have_been_last_called_with            => to_have_been_last_called_with::to_have_been_last_called_with,
    to_have_been_nth_called_with             => to_have_been_nth_called_with::to_have_been_nth_called_with,
    to_have_last_returned_with               => to_have_last_returned_with::to_have_last_returned_with,
    to_have_length                           => to_have_length::to_have_length,
    to_have_nth_returned_with                => to_have_nth_returned_with::to_have_nth_returned_with,
    to_have_property                         => to_have_property::to_have_property,
    to_have_returned_with                    => to_have_returned_with::to_have_returned_with,
    to_include                               => simple_matchers::to_include,
    to_match                                 => to_match::to_match,
    to_match_inline_snapshot                 => to_match_inline_snapshot::to_match_inline_snapshot,
    to_match_object                          => to_match_object::to_match_object,
    to_match_file_snapshot                   => to_match_file_snapshot::to_match_file_snapshot,
    to_match_snapshot                        => to_match_snapshot::to_match_snapshot,
    to_satisfy                               => to_satisfy::to_satisfy,
    to_start_with                            => simple_matchers::to_start_with,
    to_throw                                 => to_throw::to_throw,
    to_throw_error_matching_inline_snapshot  => to_throw_error_matching_inline_snapshot::to_throw_error_matching_inline_snapshot,
    to_throw_error_matching_snapshot         => to_throw_error_matching_snapshot::to_throw_error_matching_snapshot,
}

// Codegen'd `cache: true` accessors (`.classes.ts`) — Rust has no associated
// modules, so each lives as a sibling module instead of `Self::js::...`.
pub(crate) mod expect_string_matching_js {
    bun_jsc::codegen_cached_accessors!("ExpectStringMatching"; testValue);
}
pub(crate) mod expect_close_to_js {
    bun_jsc::codegen_cached_accessors!("ExpectCloseTo"; numberValue, digitsValue);
}
pub(crate) mod expect_object_containing_js {
    bun_jsc::codegen_cached_accessors!("ExpectObjectContaining"; objectValue);
}
pub(crate) mod expect_string_containing_js {
    bun_jsc::codegen_cached_accessors!("ExpectStringContaining"; stringValue);
}
pub(crate) mod expect_any_js {
    bun_jsc::codegen_cached_accessors!("ExpectAny"; constructorValue);
}
pub(crate) mod expect_array_containing_js {
    bun_jsc::codegen_cached_accessors!("ExpectArrayContaining"; arrayValue);
}
pub(crate) mod expect_custom_asymmetric_matcher_js {
    bun_jsc::codegen_cached_accessors!("ExpectCustomAsymmetricMatcher"; matcherFn, capturedArgs);
}
pub(crate) mod expect_matcher_utils_js {
    bun_jsc::codegen_cached_accessors!("ExpectMatcherUtils"; equalityTesters, equals, state);
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectAnything {
    pub(crate) flags: Cell<Flags>,
}

impl ExpectAnything {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn call(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let anything_js_value = ExpectAnything { flags: Cell::new(Flags::default()) }.to_js(global_this);
        anything_js_value.ensure_still_alive();

        global_this.bun_vm().auto_garbage_collect();

        Ok(anything_js_value)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectStringMatching {
    pub(crate) flags: Cell<Flags>,
}

impl ExpectStringMatching {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments();

        if args.is_empty() || (!args[0].is_string() && !args[0].is_reg_exp()) {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string or regular expression\n",
            ));
        }

        let test_value = args[0];

        let string_matching_js_value = ExpectStringMatching { flags: Cell::new(Flags::default()) }.to_js(global_this);
        expect_string_matching_js::test_value_set_cached(string_matching_js_value, global_this, test_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(string_matching_js_value)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectCloseTo {
    pub(crate) flags: Cell<Flags>,
}

impl ExpectCloseTo {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments();

        if args.is_empty() || !args[0].is_number() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>closeTo<d>(<r>number<d>, precision?)<r>\n\nExpected a number value",
            ));
        }
        let number_value = args[0];

        let mut precision_value: JSValue = if args.len() > 1 { args[1] } else { JSValue::UNDEFINED };
        if precision_value.is_undefined() {
            precision_value = JSValue::js_number_from_int32(2); // default value from jest
        }
        if !precision_value.is_number() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>closeTo<d>(number, <r>precision?<d>)<r>\n\nPrecision must be a number or undefined",
            ));
        }

        let instance_jsvalue = ExpectCloseTo { flags: Cell::new(Flags::default()) }.to_js(global_this);
        number_value.ensure_still_alive();
        precision_value.ensure_still_alive();
        expect_close_to_js::number_value_set_cached(instance_jsvalue, global_this, number_value);
        expect_close_to_js::digits_value_set_cached(instance_jsvalue, global_this, precision_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(instance_jsvalue)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectObjectContaining {
    pub(crate) flags: Cell<Flags>,
}

impl ExpectObjectContaining {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments();

        if args.is_empty() || !args[0].is_object() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>objectContaining<d>(<r>object<d>)<r>\n\nExpected an object\n",
            ));
        }

        let object_value = args[0];

        let instance_jsvalue = ExpectObjectContaining { flags: Cell::new(Flags::default()) }.to_js(global_this);
        expect_object_containing_js::object_value_set_cached(instance_jsvalue, global_this, object_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(instance_jsvalue)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectStringContaining {
    pub(crate) flags: Cell<Flags>,
}

impl ExpectStringContaining {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments();

        if args.is_empty() || !args[0].is_string() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string\n",
            ));
        }

        let string_value = args[0];

        let string_containing_js_value = ExpectStringContaining { flags: Cell::new(Flags::default()) }.to_js(global_this);
        expect_string_containing_js::string_value_set_cached(string_containing_js_value, global_this, string_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(string_containing_js_value)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectAny {
    pub(crate) flags: Cell<Flags>,
}

impl ExpectAny {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let arguments = call_frame.arguments();

        if arguments.is_empty() {
            return Err(global_this.throw2(
                "any() expects to be passed a constructor function. Please pass one or use anything() to match any object.",
                (),
            ));
        }

        let constructor = arguments[0];
        constructor.ensure_still_alive();
        if !constructor.is_constructor() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>any<d>(<r>constructor<d>)<r>\n\nExpected a constructor\n",
            ));
        }

        let asymmetric_matcher_constructor_type = AsymmetricMatcherConstructorType::from_js(global_this, constructor)?;

        let mut flags = Flags::default();
        flags.set_asymmetric_matcher_constructor_type(asymmetric_matcher_constructor_type);

        let any_js_value = ExpectAny { flags: Cell::new(flags) }.to_js(global_this);
        any_js_value.ensure_still_alive();
        expect_any_js::constructor_value_set_cached(any_js_value, global_this, constructor);
        any_js_value.ensure_still_alive();

        global_this.bun_vm().auto_garbage_collect();

        Ok(any_js_value)
    }
}

#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectArrayContaining {
    pub(crate) flags: Cell<Flags>,
}

impl ExpectArrayContaining {
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn call(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments();

        if args.is_empty() || !args[0].js_type().is_array() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>arrayContaining<d>(<r>array<d>)<r>\n\nExpected a array\n",
            ));
        }

        let array_value = args[0];

        let array_containing_js_value = ExpectArrayContaining { flags: Cell::new(Flags::default()) }.to_js(global_this);
        expect_array_containing_js::array_value_set_cached(array_containing_js_value, global_this, array_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(array_containing_js_value)
    }
}

/// An instantiated asymmetric custom matcher, returned from calls to `expect.toCustomMatch(...)`
///
/// Reference: `AsymmetricMatcher` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
/// (but only created for *custom* matchers, as built-ins have their own classes)
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`. The only
// field, `flags`, is set once at construction (`create()`) and never written
// thereafter, so it stays a bare `Flags` (no `Cell` needed). Both host-fns
// call into user JS (`execute_impl` → `execute_custom_matcher`, `custom_print`
// → `matcher_fn.call`) which can re-enter on the same `m_ctx`; holding a
// `noalias` `&mut Self` across that call is Stacked-Borrows UB even with no
// field writes. The codegen shim emits `&*__this` for `&self` receivers.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectCustomAsymmetricMatcher {
    pub(crate) flags: Flags,
}

impl ExpectCustomAsymmetricMatcher {
    /// Implements the static call of the custom matcher (`expect.myCustomMatcher(<args>)`),
    /// which creates an asymmetric matcher instance (`ExpectCustomAsymmetricMatcher`).
    /// This will not run the matcher, but just capture the args etc.
    pub(crate) fn create(global_this: &JSGlobalObject, call_frame: &CallFrame, matcher_fn: JSValue) -> JsResult<JSValue> {
        // try to retrieve the ExpectStatic instance (to get the flags)
        let flags = if let Some(expect_static) = <ExpectStatic as bun_jsc::JsClass>::from_js(call_frame.this()) {
            // SAFETY: from_js returns the live m_ctx payload for this JSValue.
            unsafe { (*expect_static).flags }
        } else {
            // if it's not an ExpectStatic instance, assume it was called from the Expect constructor, so use the default flags
            Flags::default()
        };

        // create the matcher instance (flags stored upfront)
        let instance_jsvalue = ExpectCustomAsymmetricMatcher { flags }.to_js(global_this);
        instance_jsvalue.ensure_still_alive();

        // store the user-provided matcher function into the instance
        expect_custom_asymmetric_matcher_js::matcher_fn_set_cached(instance_jsvalue, global_this, matcher_fn);

        // capture the args as a JS array saved in the instance, so the matcher can be executed later on with them
        let args = call_frame.arguments();
        let array = JSValue::create_array_from_slice(global_this, args)?;
        expect_custom_asymmetric_matcher_js::captured_args_set_cached(instance_jsvalue, global_this, array);
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
        let Some(matcher_fn) = expect_custom_asymmetric_matcher_js::matcher_fn_get_cached(this_value) else {
            return Err(global_this.throw2(
                "Internal consistency error: the ExpectCustomAsymmetricMatcher(matcherFn) was garbage collected but it should not have been!",
                (),
            ));
        };
        matcher_fn.ensure_still_alive();
        if !matcher_fn.js_type().is_function() {
            return Err(global_this.throw2(
                "Internal consistency error: the ExpectCustomMatcher(matcherFn) is not a function!",
                (),
            ));
        }

        // retrieve the matcher name
        let matcher_name = matcher_fn.get_name(global_this)?;

        // retrieve the asymmetric matcher args
        // if null, it means the function has not yet been called to capture the args, which is a misuse of the matcher
        let Some(captured_args) = expect_custom_asymmetric_matcher_js::captured_args_get_cached(this_value) else {
            return Err(global_this.throw(format_args!(
                "expect.{} misused, it needs to be instantiated by calling it with 0 or more arguments",
                matcher_name,
            )));
        };
        captured_args.ensure_still_alive();

        // prepare the args array as `[received, ...captured_args]`
        let args_count = captured_args.get_length(global_this)?;
        let mut matcher_args: Vec<JSValue> = Vec::with_capacity((args_count as usize).saturating_add(1));
        matcher_args.push(received);
        for i in 0..args_count {
            matcher_args.push(captured_args.get_index(global_this, i as u32)?);
        }

        Expect::execute_custom_matcher(global_this, &bun_core::String::EMPTY, &matcher_name, matcher_fn, &matcher_args, this.flags, None, true)
    }

    /// Function called by c++ function "matchAsymmetricMatcher" to execute the custom matcher against the provided leftValue
    ///
    /// # Safety
    /// `this` must point to a live `Self` and `global_this` must point to a live
    /// `JSGlobalObject` for the duration of the call.
    #[unsafe(no_mangle)]
    pub(crate) unsafe extern "C" fn ExpectCustomAsymmetricMatcher__execute(
        this: *mut Self,
        this_value: JSValue,
        global_this: *const JSGlobalObject,
        received: JSValue,
    ) -> bool {
        // SAFETY: called from C++ with valid pointers
        unsafe { Self::execute_impl(&*this, this_value, &*global_this, received) }.unwrap_or(false)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn asymmetric_match(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let received_value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        let pass = Pass::barrier();
        let _entered = pass.enter();
        let matched = Self::execute_impl(self, callframe.this(), global_this, received_value)?;
        Ok(JSValue::from(matched))
    }

    fn maybe_clear(global_this: &JSGlobalObject, err: JsError, dont_throw: bool) -> crate::Result<bool> {
        if dont_throw {
            global_this.clear_exception();
            return Ok(false);
        }
        match err {
            JsError::OutOfMemory => Err(crate::Error::Alloc(bun_alloc::AllocError)),
            _ => Err(crate::Error::Unexpected),
        }
    }

    /// Calls a custom implementation (if provided) to stringify this asymmetric matcher, and returns true if it was provided and it succeed
    pub(crate) fn custom_print(
        &self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
        writer: &mut (impl bun_io::Write + ?Sized),
        dont_throw: bool,
    ) -> crate::Result<bool> {
        let Some(matcher_fn) = expect_custom_asymmetric_matcher_js::matcher_fn_get_cached(this_value) else { return Ok(false) };
        let fn_value = match matcher_fn.get(global_this, "toAsymmetricMatcher") {
            Ok(v) => v,
            Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
        };
        if let Some(fn_value) = fn_value {
            if fn_value.js_type().is_function() {
                let Some(captured_args) = expect_custom_asymmetric_matcher_js::captured_args_get_cached(this_value) else { return Ok(false) };
                let args_len = match captured_args.get_length(global_this) {
                    Ok(n) => n,
                    Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                };
                let mut args: Vec<JSValue> = Vec::with_capacity(args_len as usize);
                let mut iter = match captured_args.array_iterator(global_this) {
                    Ok(it) => it,
                    Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                };
                loop {
                    match iter.next() {
                        Ok(Some(arg)) => args.push(arg),
                        Ok(None) => break,
                        Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                    }
                }

                let result = match matcher_fn.call(global_this, this_value, &args) {
                    Ok(r) => r,
                    Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                };
                let s = match result.to_bun_string(global_this) {
                    Ok(s) => s,
                    Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
                };
                write!(writer, "{}", s)?;
            }
        }
        Ok(false)
    }

}

/// Reference: `MatcherContext` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub(crate) struct ExpectMatcherContext {
    pub(crate) flags: Flags,
    /// `Expect::parent` of the `expect()` whose matcher is called.
    pub(crate) parent: Option<RefPtr<bun_test::RefData>>,
}

impl ExpectMatcherContext {
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_utils(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        ExpectMatcherUtils::singleton(global_this)
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_is_not(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(this.flags.not())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_promise(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match this.flags.promise() {
            Promise::Rejects => bun_core::String::static_("rejects").to_js(global_this),
            Promise::Resolves => bun_core::String::static_("resolves").to_js(global_this),
            _ => Ok(JSValue::js_empty_string(global_this)),
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_expand(_this: &Self, _global_this: &JSGlobalObject) -> JSValue {
        // TODO: this should return whether running tests in verbose mode or not (jest flag --expand), but bun currently doesn't have this switch
        JSValue::FALSE
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_equals(_this: &Self, global_this: &JSGlobalObject) -> JSValue {
        let utils = ExpectMatcherUtils::singleton(global_this);
        expect_matcher_utils_js::equals_get_cached(utils).unwrap_or_else(|| {
            let equals = JSFunction::create(global_this, "equals", equals_shim, 4, Default::default());
            expect_matcher_utils_js::equals_set_cached(utils, global_this, equals);
            equals
        })
    }

    fn equals(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments();
        if args.len() < 2 {
            return Err(global_this.throw2(
                "expect.extends matcher: this.util.equals expects at least 2 arguments",
                (),
            ));
        }
        let [a, b, custom_testers, strict_check] = callframe.arguments_as_array::<4>();
        let custom_testers = if custom_testers.is_undefined() {
            JSValue::ZERO
        } else if !custom_testers.js_type().is_array() {
            return Err(global_this.throw_invalid_argument_type_value("customTesters", "array", custom_testers));
        } else if custom_testers.get_length(global_this)? == 0 {
            JSValue::ZERO
        } else {
            custom_testers
        };
        let _testers = super::expect::add_equality_testers::EqualityTestersScope::enter(global_this, custom_testers)?;
        let pass = Pass::barrier();
        let _entered = pass.enter();
        Ok(JSValue::from(if strict_check.to_boolean() {
            a.jest_strict_deep_equals(b, global_this)?
        } else {
            a.jest_deep_equals(b, global_this)?
        }))
    }
}

/// A host function that ignores `this`: as in Jest, a matcher may destructure it or pass it on.
macro_rules! plain_host_fn {
    ($shim:ident, $function:path) => {
        bun_jsc::jsc_host_abi! {
            unsafe fn $shim(global: *mut JSGlobalObject, frame: *mut CallFrame) -> JSValue {
                // SAFETY: JSC guarantees both pointers are live for the call.
                let (global, frame) = unsafe { (&*global, &*frame) };
                bun_jsc::to_js_host_fn_result(global, $function(global, frame))
            }
        }
    };
}
plain_host_fn!(equals_shim, ExpectMatcherContext::equals);
plain_host_fn!(stringify_shim, ExpectMatcherUtils::stringify);
plain_host_fn!(print_expected_shim, ExpectMatcherUtils::print_expected);
plain_host_fn!(print_received_shim, ExpectMatcherUtils::print_received);
plain_host_fn!(expected_color_shim, ExpectMatcherUtils::expected_color);
plain_host_fn!(received_color_shim, ExpectMatcherUtils::received_color);
plain_host_fn!(matcher_hint_shim, ExpectMatcherUtils::matcher_hint);
plain_host_fn!(print_with_type_shim, ExpectMatcherUtils::print_with_type);
plain_host_fn!(diff_shim, ExpectMatcherUtils::diff);

const NO_VISUAL_DIFFERENCE: &[u8] = b"Compared values have no visual difference.";

/// The colors of jest-matcher-utils: `DIM_COLOR`, `EXPECTED_COLOR` and `RECEIVED_COLOR`.
#[derive(Clone, Copy)]
enum HintColor {
    Dim,
    Expected,
    Received,
}

impl HintColor {
    fn paint(self, out: &mut Vec<u8>, text: &[u8]) {
        if text.is_empty() {
            return;
        }
        if !Output::enable_ansi_colors_stderr() {
            out.extend_from_slice(text);
            return;
        }
        let open: &'static str = match self {
            HintColor::Dim => bun_core::pretty_fmt!("<d>", true),
            HintColor::Expected => bun_core::pretty_fmt!("<green>", true),
            HintColor::Received => bun_core::pretty_fmt!("<red>", true),
        };
        out.extend_from_slice(open.as_bytes());
        out.extend_from_slice(text);
        out.extend_from_slice(bun_core::pretty_fmt!("<r>", true).as_bytes());
    }
}

/// Reference: `MatcherUtils` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
///
/// The one cell of `expect` that each global roots, so it also holds what `expect` keeps per global.
#[bun_jsc::JsClass(no_construct, no_constructor)]
#[derive(Default)]
pub(crate) struct ExpectMatcherUtils {
    /// How many of the leading equality testers preload scripts registered. Those outlive the test file.
    pub(crate) preload_testers: Cell<u32>,
    /// `BunTestRoot::file_generation` of the test file that registered the other equality testers.
    pub(crate) testers_file: Cell<u32>,
    /// The same two for the snapshot serializers, of which those of preload scripts are the last.
    pub(crate) preload_serializers: Cell<u32>,
    pub(crate) serializers_file: Cell<u32>,
}

impl ExpectMatcherUtils {
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn ExpectMatcherUtils_createSigleton(global_this: &JSGlobalObject) -> JSValue {
        ExpectMatcherUtils::default().to_js(global_this).put_host_functions(
            global_this,
            &[
                ("stringify", stringify_shim, 1),
                ("printExpected", print_expected_shim, 1),
                ("printReceived", print_received_shim, 1),
                ("EXPECTED_COLOR", expected_color_shim, 1),
                ("RECEIVED_COLOR", received_color_shim, 1),
                ("matcherHint", matcher_hint_shim, 1),
                ("printWithType", print_with_type_shim, 3),
                ("diff", diff_shim, 2),
            ],
        )
    }

    pub(crate) fn singleton(global_this: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call with valid &JSGlobalObject
        unsafe { ExpectMatcherUtils__getSingleton(global_this) }
    }

    fn print_value(
        global_this: &JSGlobalObject,
        value: JSValue,
        color_or_null: Option<&'static str>,
    ) -> JsResult<JSValue> {
        let mut mutable_string = bun_core::MutableString::init_2048()?;

        if let Some(color) = color_or_null {
            if Output::enable_ansi_colors_stderr() {
                let _ = mutable_string.write_all(Output::pretty_fmt::<true>(color).as_ref());
            }
        }

        if value.is_error() {
            // As in Jest: a matcher's message is no place for the source frame and the stack.
            let _ = mutable_string.write_all(b"[");
            let _ = mutable_string.write_all(value.to_bun_string(global_this)?.to_utf8().slice());
            let _ = mutable_string.write_all(b"]");
        } else {
            let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
            formatter.format_value::<false>(value, &mut mutable_string)?;
        }

        if color_or_null.is_some() {
            if Output::enable_ansi_colors_stderr() {
                let _ = mutable_string.write_all(Output::pretty_fmt::<true>("<r>").as_ref());
            }
        }

        bun_string_jsc::create_utf8_for_js(global_this, mutable_string.slice())
    }

    fn stringify(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        Self::print_value(global_this, value, None)
    }

    fn print_expected(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        Self::print_value(global_this, value, Some("<green>"))
    }

    fn print_received(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let value = if arguments.is_empty() { JSValue::UNDEFINED } else { arguments[0] };
        Self::print_value(global_this, value, Some("<red>"))
    }

    /// As `chalk.green(...text)`: the arguments as strings, with a space between them.
    fn color_text(global_this: &JSGlobalObject, callframe: &CallFrame, color: HintColor) -> JsResult<JSValue> {
        let mut text: Vec<u8> = Vec::new();
        for (i, argument) in callframe.arguments().iter().enumerate() {
            if i > 0 {
                text.push(b' ');
            }
            text.extend_from_slice(argument.to_bun_string(global_this)?.to_utf8().slice());
        }
        let mut out: Vec<u8> = Vec::new();
        color.paint(&mut out, &text);
        bun_string_jsc::create_utf8_for_js(global_this, &out)
    }

    fn expected_color(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::color_text(global_this, callframe, HintColor::Expected)
    }

    fn received_color(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        Self::color_text(global_this, callframe, HintColor::Received)
    }

    /// `getType` of @jest/get-type: how failure messages name the type of a value.
    fn type_name(value: JSValue) -> &'static str {
        if value.is_undefined() {
            "undefined"
        } else if value.is_null() {
            "null"
        } else if value.is_array() {
            "array"
        } else if value.is_boolean() {
            "boolean"
        } else if value.is_callable() {
            "function"
        } else if value.is_number() {
            "number"
        } else if value.is_string_literal() {
            "string"
        } else if value.is_big_int() {
            "bigint"
        } else if value.is_symbol() {
            "symbol"
        } else {
            match value.js_type() {
                bun_jsc::JSType::RegExpObject => "regexp",
                bun_jsc::JSType::Map => "map",
                bun_jsc::JSType::Set => "set",
                bun_jsc::JSType::JSDate => "date",
                _ => "object",
            }
        }
    }

    /// `printWithType` of jest-matcher-utils.
    fn print_with_type(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let [name, value, print] = callframe.arguments_as_array::<3>();
        let name = name.to_bun_string(global_this)?;
        if !print.is_callable() {
            return Err(global_this.throw_type_error(format_args!("printWithType: the third argument (print) must be a function")));
        }
        let printed = print.call(global_this, JSValue::UNDEFINED, &[value])?.to_bun_string(global_this)?;
        let text = if value.is_undefined_or_null() {
            format!("{name} has value: {printed}")
        } else {
            format!("{name} has type:  {}\n{name} has value: {printed}", Self::type_name(value))
        };
        bun_string_jsc::create_utf8_for_js(global_this, text.as_bytes())
    }

    /// `diff` of jest-matcher-utils. `null` where a diff would say no more than the two values do.
    fn diff(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let [expected, received] = callframe.arguments_as_array::<2>();
        if (expected.is_number() && received.is_number())
            || (expected.is_big_int() && received.is_big_int())
            || (expected.is_boolean() && received.is_boolean())
        {
            return Ok(JSValue::NULL);
        }
        let mut out: Vec<u8> = Vec::new();
        if expected.is_same_value(received, global_this)? {
            HintColor::Dim.paint(&mut out, NO_VISUAL_DIFFERENCE);
            return bun_string_jsc::create_utf8_for_js(global_this, &out);
        }
        if Expect::is_asymmetric_matcher(expected) {
            return Ok(JSValue::NULL);
        }
        let (expected_type, received_type) = (Self::type_name(expected), Self::type_name(received));
        if expected_type != received_type {
            out.extend_from_slice(b"  Comparing two different types of values. Expected ");
            HintColor::Expected.paint(&mut out, expected_type.as_bytes());
            out.extend_from_slice(b" but received ");
            HintColor::Received.paint(&mut out, received_type.as_bytes());
            out.push(b'.');
            return bun_string_jsc::create_utf8_for_js(global_this, &out);
        }

        if expected_type != "string" {
            return Self::diff_text(global_this, &DiffFormatter::new(global_this, received, expected, false)?);
        }
        // Two strings are text to compare line by line, not values to quote.
        let (expected, received) = (expected.to_bun_string(global_this)?, received.to_bun_string(global_this)?);
        let (expected, received) = (expected.to_utf8(), received.to_utf8());
        Self::diff_text(global_this, &DiffFormatter::from_strings(received.slice(), expected.slice(), false))
    }

    fn diff_text(global_this: &JSGlobalObject, formatter: &DiffFormatter<'_>) -> JsResult<JSValue> {
        if formatter.received_string == formatter.expected_string {
            let mut out: Vec<u8> = Vec::new();
            HintColor::Dim.paint(&mut out, NO_VISUAL_DIFFERENCE);
            return bun_string_jsc::create_utf8_for_js(global_this, &out);
        }
        bun_string_jsc::create_utf8_for_js(global_this, format!("{formatter}").as_bytes())
    }

    /// `label` through the color function that `option_name` of `matcherHint` gave, if any.
    fn paint_label(
        global_this: &JSGlobalObject,
        out: &mut Vec<u8>,
        label: &bun_core::String,
        default_color: HintColor,
        option_name: &'static str,
        color: Option<JSValue>,
    ) -> JsResult<()> {
        let Some(color) = color else {
            default_color.paint(out, label.to_utf8().slice());
            return Ok(());
        };
        if !color.is_callable() {
            return Err(global_this.throw_type_error(format_args!("matcherHint: options.{option_name} must be a function")));
        }
        let painted = color.call(global_this, JSValue::UNDEFINED, &[label.to_js(global_this)?])?;
        out.extend_from_slice(painted.to_bun_string(global_this)?.to_utf8().slice());
        Ok(())
    }

    /// `matcherHint` of jest-matcher-utils: the labels are text, not values.
    fn matcher_hint(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        let argument = |i: usize| arguments.get(i).copied().filter(|value| !value.is_undefined());
        let label = |value: Option<JSValue>, default: &'static str| match value {
            Some(value) => value.to_bun_string(global_this),
            None => Ok(bun_core::String::static_(default)),
        };

        let Some(matcher_name) = argument(0).filter(|name| name.is_string()) else {
            return Err(global_this.throw2(
                "matcherHint: the first argument (matcher name) must be a string",
                (),
            ));
        };
        let matcher_name = matcher_name.to_bun_string(global_this)?;
        let received = label(argument(1), "received")?;
        let expected = label(argument(2), "expected")?;
        let options = argument(3).filter(|options| !options.is_null());
        if options.is_some_and(|options| !options.is_object()) {
            return Err(global_this.throw2(
                "matcherHint: options must be an object (or undefined)",
                (),
            ));
        }
        let option = |name: &'static str| match options {
            Some(options) => options.get(global_this, name),
            None => Ok(None),
        };

        let comment = label(option("comment")?, "")?;
        let expected_color = option("expectedColor")?;
        let is_direct_expect_call = option("isDirectExpectCall")?.is_some_and(JSValue::to_boolean);
        let is_not = option("isNot")?.is_some_and(JSValue::to_boolean);
        let promise = label(option("promise")?, "")?;
        let received_color = option("receivedColor")?;
        let second_argument = label(option("secondArgument")?.filter(|second| second.to_boolean()), "")?;
        let second_argument_color = option("secondArgumentColor")?;

        let mut hint: Vec<u8> = Vec::new();
        // Adjacent dim text is painted in one piece.
        let mut dim: Vec<u8> = b"expect".to_vec();
        let paint_dim = |hint: &mut Vec<u8>, dim: &mut Vec<u8>, last: &[u8]| {
            dim.extend_from_slice(last);
            HintColor::Dim.paint(hint, dim);
            dim.clear();
        };

        if !is_direct_expect_call && !received.is_empty() {
            paint_dim(&mut hint, &mut dim, b"(");
            Self::paint_label(global_this, &mut hint, &received, HintColor::Received, "receivedColor", received_color)?;
            dim.push(b')');
        }
        if !promise.is_empty() {
            paint_dim(&mut hint, &mut dim, b".");
            hint.extend_from_slice(promise.to_utf8().slice());
        }
        if is_not {
            paint_dim(&mut hint, &mut dim, b".");
            hint.extend_from_slice(b"not");
        }
        if matcher_name.index_of_ascii_char(b'.').is_some() {
            // The old format: the name brings its own periods, as in ".not.toBeFoo".
            dim.extend_from_slice(matcher_name.to_utf8().slice());
        } else {
            paint_dim(&mut hint, &mut dim, b".");
            hint.extend_from_slice(matcher_name.to_utf8().slice());
        }
        if expected.is_empty() {
            dim.extend_from_slice(b"()");
        } else {
            paint_dim(&mut hint, &mut dim, b"(");
            Self::paint_label(global_this, &mut hint, &expected, HintColor::Expected, "expectedColor", expected_color)?;
            if !second_argument.is_empty() {
                HintColor::Dim.paint(&mut hint, b", ");
                Self::paint_label(
                    global_this,
                    &mut hint,
                    &second_argument,
                    HintColor::Expected,
                    "secondArgumentColor",
                    second_argument_color,
                )?;
            }
            dim.push(b')');
        }
        if !comment.is_empty() {
            dim.extend_from_slice(b" // ");
            dim.extend_from_slice(comment.to_utf8().slice());
        }
        HintColor::Dim.paint(&mut hint, &dim);

        bun_string_jsc::create_utf8_for_js(global_this, &hint)
    }
}

#[bun_jsc::JsClass]
pub(crate) struct ExpectTypeOf {}

impl ExpectTypeOf {
    pub(crate) fn create(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // `JsClass::to_js` takes `self` by value; the codegen-side boxes it.
        let value = ExpectTypeOf {}.to_js(global_this);
        value.ensure_still_alive();
        Ok(value)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_one_argument_returns_void(&self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }
    #[bun_jsc::host_fn(method)]
    pub(crate) fn fn_one_argument_returns_expect_type_of(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Self::create(global_this)
    }
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_returns_expect_type_of(_this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Self::create(global_this)
    }

    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn constructor(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<*mut ExpectTypeOf> {
        Err(global_this.throw(format_args!("expectTypeOf() cannot be called with new")))
    }
    // extern shim emitted by `#[bun_jsc::JsClass]` codegen (TypeClass__construct/__call); bare `#[host_fn]` cannot target an associated fn without a receiver.
    pub(crate) fn call(global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Self::create(global_this)
    }
}

pub(crate) mod mock {
    use super::*;
    use bun_jsc::ComptimeStringMapExt as _;

    // C++: `JSC::EncodedJSValue JSMockFunction__get{Calls,Returns}(
    //         JSC::JSGlobalObject*, EncodedJSValue)` — `[[ZIG_EXPORT(zero_is_throw)]]`.
    // The leading `globalThis` parameter is load-bearing: the body opens a
    // `DECLARE_THROW_SCOPE(globalThis->vm())`, so omitting it shifts `value`
    // into the pointer slot and dereferences a garbage `JSGlobalObject*`
    // (UBSan: null `VM&` bind in JSGlobalObject.h).
    unsafe extern "C" {
        #[link_name = "JSMockFunction__getCalls"]
        fn JSMockFunction__getCalls_raw(global: *mut JSGlobalObject, value: JSValue) -> JSValue;
        #[link_name = "JSMockFunction__getReturns"]
        fn JSMockFunction__getReturns_raw(global: *mut JSGlobalObject, value: JSValue) -> JSValue;
    }

    /// `bun.cpp.JSMockFunction__getCalls` — returns the `mock.calls` array for a
    /// JSMockFunction, or `undefined` if `value` is not a mock. Safe wrapper
    /// over the C++ shim so matchers don't carry their own `extern` blocks.
    /// `zero_is_throw`: a `.zero` return means the throw scope is set.
    #[allow(non_snake_case)]
    #[track_caller]
    #[inline]
    fn JSMockFunction__getCalls(global: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
        // SAFETY: `global` is live; JSValue is repr(transparent) i64.
        bun_jsc::call_zero_is_throw(global, || unsafe {
            JSMockFunction__getCalls_raw(global.as_ptr(), value)
        })
    }

    /// `bun.cpp.JSMockFunction__getReturns` — see `JSMockFunction__getCalls`.
    #[allow(non_snake_case)]
    #[track_caller]
    #[inline]
    fn JSMockFunction__getReturns(global: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
        // SAFETY: `global` is live; JSValue is repr(transparent) i64.
        bun_jsc::call_zero_is_throw(global, || unsafe {
            JSMockFunction__getReturns_raw(global.as_ptr(), value)
        })
    }

    /// Which mock-backed array a `toHave*` matcher inspects, plus which of the two
    /// "received is not a mock" error styles it emits. The three `*CalledWith`
    /// matchers use the Jest-style `Matcher error:` form routed through
    /// [`Expect::throw`]; everything else uses the bare `global.throw(...)` form.
    #[derive(Clone, Copy)]
    pub(crate) enum MockKind {
        /// `mock.calls`; not-a-mock → `global.throw("Expected value must be a mock function: …")`.
        /// toHaveBeenCalled / toHaveBeenCalledOnce / toHaveBeenCalledTimes.
        Calls,
        /// `mock.calls`; not-a-mock → `this.throw(signature, "Matcher error: received value must be a mock function …")`.
        /// toHaveBeenCalledWith / toHaveBeenLastCalledWith / toHaveBeenNthCalledWith.
        CallsWithSig,
        /// `mock.results`; not-a-mock → `global.throw("Expected value must be a mock function: …")`.
        /// toHaveReturned* / toHave*ReturnedWith.
        Returns,
    }

    impl Expect {
        /// Shared prologue for every `expect(mockFn).toHave*` matcher: arms the
        /// `post_match` guard, resolves the captured value (handling `.resolves`/
        /// `.rejects`), bumps the assertion counter, fetches the requested
        /// mock-backed array, and emits the kind-appropriate "not a mock" error.
        ///
        /// Returns the [`PostMatchGuard`] (so `post_match` runs when the caller
        /// drops it), the `mock.calls` / `mock.results` JSArray, and the raw
        /// received value (some matchers print it again on later error paths).
        pub(crate) fn mock_prologue<'a>(
            &'a self,
            global: &'a JSGlobalObject,
            this_value: JSValue,
            matcher_name: &'static str,
            matcher_params: &'static str,
            kind: MockKind,
        ) -> JsResult<(PostMatchGuard<'a>, JSValue, JSValue)> {
            let (this, value, _) = self.matcher_prelude(global, this_value, matcher_name, matcher_params)?;
            let arr = match kind {
                MockKind::Calls | MockKind::CallsWithSig => JSMockFunction__getCalls(global, value)?,
                MockKind::Returns => JSMockFunction__getReturns(global, value)?,
            };
            if !arr.js_type().is_array() {
                let mut formatter = make_formatter(global);
                return Err(match kind {
                    MockKind::CallsWithSig => throw!(
                        this, global,
                        Self::get_signature(matcher_name, matcher_params, false),
                        "\n\nMatcher error: <red>received<r> value must be a mock function\nReceived: {}",
                        value.to_fmt(&mut formatter),
                    )
                    .unwrap_err(),
                    MockKind::Calls | MockKind::Returns => global.throw(format_args!(
                        "Expected value must be a mock function: {}",
                        value.to_fmt(&mut formatter),
                    )),
                });
            }
            Ok((this, arr, value))
        }
    }

    pub(crate) fn jest_mock_return_object_type(global_this: &JSGlobalObject, value: JSValue) -> JsResult<ReturnStatus> {
        // `mock.results` is a user-mutable JSArray, so `value` can be anything
        // (`fn.mock.results.push(undefined)`); `fast_get` requires an object.
        if value.is_object() {
            if let Some(type_string) = value.fast_get(global_this, bun_jsc::BuiltinName::Type)? {
                if type_string.is_string() {
                    if let Some(val) = RETURN_STATUS_MAP.from_js(global_this, type_string)? {
                        return Ok(val);
                    }
                }
            }
        }
        let mut formatter = ConsoleObject::Formatter::new(global_this).with_quote_strings(true);
        Err(global_this.throw(format_args!(
            "Expected value must be a mock function with returns: {}",
            value.to_fmt(&mut formatter),
        )))
    }

    fn jest_mock_return_object_value(global_this: &JSGlobalObject, value: JSValue) -> JsResult<JSValue> {
        Ok(value.get(global_this, "value")?.unwrap_or(JSValue::UNDEFINED))
    }

    // split lifetimes — `&'a mut Formatter<'a>` is the invariant-borrow trap
    // (forces the &mut to live as long as the Formatter's own param, which outlives the
    // local). `'g` tracks the JSGlobalObject borrow inside Formatter; `'a` is the short
    // &mut borrow held by this struct.
    pub(crate) struct AllCallsWithArgsFormatter<'a, 'g> {
        pub global_this: &'g JSGlobalObject,
        pub calls: JSValue,
        // reshaped for borrowck — Display::fmt takes &self but we need &mut Formatter
        pub formatter: core::cell::RefCell<&'a mut ConsoleObject::Formatter<'g>>,
    }

    impl fmt::Display for AllCallsWithArgsFormatter<'_, '_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            let mut formatter = self.formatter.borrow_mut();
            let mut printed_once = false;

            let calls_count = u32::try_from(
                self.calls
                    .get_length(self.global_this)
                    .map_err(js_error_to_write_error)?,
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
                    .map_err(js_error_to_write_error)?;
                write!(writer, "{}", call_args.to_fmt(&mut **formatter))?;
            }
            Ok(())
        }
    }

    #[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr, strum::EnumString)]
    pub(crate) enum ReturnStatus {
        #[strum(serialize = "throw")]
        Throw,
        #[strum(serialize = "return")]
        Return,
        #[strum(serialize = "incomplete")]
        Incomplete,
    }

    bun_core::comptime_string_map! {
        /// JS string extraction + lookup is provided by `ComptimeStringMapExt::from_js`
        /// (see `jest_mock_return_object_type`).
        pub(crate) static RETURN_STATUS_MAP: ReturnStatus = {
            b"throw" => ReturnStatus::Throw,
            b"return" => ReturnStatus::Return,
            b"incomplete" => ReturnStatus::Incomplete,
        };
    }

    // Formatter for when there are multiple returns or errors
    // split lifetimes — `&'f mut Formatter<'g>` instead of `&'a mut Formatter<'a>`.
    // The single-lifetime form makes the mut-borrow invariant in `'a` and forces the borrow to
    // last for the Formatter's whole lifetime, tripping dropck (E0597) at the call site.
    pub(crate) struct AllCallsFormatter<'g, 'f> {
        pub global_this: &'g JSGlobalObject,
        pub returns: JSValue,
        // reshaped for borrowck — Display::fmt takes &self but we need &mut Formatter
        pub formatter: core::cell::RefCell<&'f mut ConsoleObject::Formatter<'g>>,
    }

    impl fmt::Display for AllCallsFormatter<'_, '_> {
        fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
            let mut formatter = self.formatter.borrow_mut();
            let mut printed_once = false;

            let mut num_returns: i32 = 0;
            let mut num_calls: i32 = 0;

            let mut iter = self
                .returns
                .array_iterator(self.global_this)
                .map_err(js_error_to_write_error)?;
            loop {
                let next = iter.next().map_err(js_error_to_write_error)?;
                let Some(item) = next else { break };
                if printed_once { writer.write_str("\n")?; }
                printed_once = true;

                num_calls += 1;
                write!(writer, "           {:>2}: ", num_calls)?;

                let value = jest_mock_return_object_value(self.global_this, item)
                    .map_err(js_error_to_write_error)?;
                match jest_mock_return_object_type(self.global_this, item)
                    .map_err(js_error_to_write_error)?
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

    // split lifetimes — see AllCallsFormatter above for rationale (avoids the
    // `&'a mut T<'a>` invariance trap that locks the Formatter borrow for its entire life).
    pub(crate) struct SuccessfulReturnsFormatter<'g, 'f> {
        pub(crate) successful_returns: &'f Vec<JSValue>,
        // reshaped for borrowck — Display::fmt takes &self but we need &mut Formatter
        pub(crate) formatter: core::cell::RefCell<&'f mut ConsoleObject::Formatter<'g>>,
    }

    impl fmt::Display for SuccessfulReturnsFormatter<'_, '_> {
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

unsafe extern "C" {
    fn Bun__JSWrappingFunction__create(
        global_this: *const JSGlobalObject,
        symbol_name: &bun_core::String,
        // C++: `Bun::NativeFunctionPtr` — a bare `EncodedJSValue (*)(JSGlobalObject*, CallFrame*)`.
        // Rust's `JSHostFn` is already the pointer type, so no extra `*const`.
        function_pointer: bun_jsc::JSHostFn,
        wrapped_fn: JSValue,
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
        let mut input_iter = strings::split(input, b"\n");
        let mut output_iter = strings::split(res.trimmed, b"\n");
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
}
