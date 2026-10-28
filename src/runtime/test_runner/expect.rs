use crate::test_runner::jest::FileColumns as _;
use core::cell::Cell;
use core::fmt;

use bun_core::Output;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    JSGlobalObject, JSValue, JsError, JsResult,
    ConsoleObject, JSFunction, JSPropertyIterator,
};
use bun_jsc::{JsClass as _, StringJsc as _};
use bun_jsc::js_promise;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_core::strings;
use bun_ptr::RefPtr;

use super::bun_test::{self};
use super::diff_format::DiffFormatter;
use self::expect_deferred::{Asked, ExpectDeferred, MatcherCall, Pass, Question};
use super::execution::ExpectAssertions;
use super::jest::Jest;
use super::pretty_format::JestPrettyFormat;
use super::snapshot::{Format as SnapshotFormat, Outcome as SnapshotOutcome};
use super::expect::{JSValueTestExt, FormatterTestExt, make_formatter};
use crate::expect_throw as throw;
use crate::generated_bindgen::expect::{
    self as generated, js_ExpectAny, js_ExpectArrayContaining, js_ExpectCloseTo, js_ExpectCustomAsymmetricMatcher,
    js_ExpectMatcherUtils, js_ExpectObjectContaining, js_ExpectStringContaining,
    js_ExpectStringMatching,
};

use bun_jsc::js_error_to_write_error;

// Matcher submodules are declared in `super::expect` (mod.rs); this file
// provides only the `Expect` payload + helpers they extend.

#[path = "expect_deferred.rs"]
pub(crate) mod expect_deferred;




/// https://jestjs.io/docs/expect
// To support async tests, we need to track the test ID
// Every JS-exposed method takes `&self`; the only
// fields mutated post-construction (`flags`, via the `.not`/`.resolves`/`.rejects`
// chaining getters, and `matcher_ran`) are `Cell`-wrapped. `parent` and `custom_label` are
// read-only after `call()` constructs the wrapper.
pub(crate) struct Expect {
    pub(crate) flags: Cell<Flags>,
    /// A matcher has run since `.not` was last read, so the next `.not` is a new chain on a kept `expect()`, not `.not.not`.
    pub(crate) matcher_ran: Cell<bool>,
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
    /// `expect.poll()` can't be combined with `.resolves` / `.rejects`, so it reuses the spare promise bit pattern.
    #[inline]
    pub(crate) fn poll(self) -> bool {
        (self.0 & Self::PROMISE_MASK) == Self::PROMISE_MASK
    }
    #[inline]
    pub(crate) fn soft(self) -> bool {
        (self.0 & Self::SOFT_MASK) != 0
    }
    /// No `.resolves`, `.rejects`, `poll` or `soft`, so `call_matcher` can take its fast path.
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

    #[optimize(size)]
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

    #[optimize(size)]
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

    #[optimize(size)]
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

    pub(crate) fn get_not<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        let is_new_chain = self.matcher_ran.replace(false);
        // Vitest's `.not` only turns negation on, so its `.not.not` is still negated.
        let not = !self.flags.get().not() || is_new_chain || self.is_vitest();
        self.update_flags(|f| f.set_not(not));
        this_value
    }

    pub(crate) fn get_resolves<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        if self.flags.get().poll() {
            return Err(heap.error(format_args!("expect.poll() does not support .resolves")));
        }
        match self.flags.get().promise() {
            Promise::Resolves | Promise::None => self.update_flags(|f| f.set_promise(Promise::Resolves)),
            Promise::Rejects => {
                return Err(heap.error(format_args!("Cannot chain .resolves() after .rejects()")));
            }
        }
        Ok(this_value)
    }

    pub(crate) fn get_rejects<'a>(
        &self,
        this_value: JsWrapper<'a, Self>,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        if self.flags.get().poll() {
            return Err(heap.error(format_args!("expect.poll() does not support .rejects")));
        }
        match self.flags.get().promise() {
            Promise::None | Promise::Rejects => self.update_flags(|f| f.set_promise(Promise::Rejects)),
            Promise::Resolves => {
                return Err(heap.error(format_args!("Cannot chain .rejects() after .resolves()")));
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

    /// The promise `call_matcher_on_promise` stored in `resultValue`. `None` if the received value wasn't a promise.
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

    /// A promise that settles the way `await value` would, or `None` if `value` isn't thenable.
    #[optimize(size)]
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
        // A thenable's `then` only runs in a microtask, so `adopted` is already fulfilled only if `value` isn't thenable.
        Ok((adopted.status() != js_promise::Status::Fulfilled).then_some(bun_jsc::AnyPromise::Normal(adopted)))
    }

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
    /// If either flag is set, returns the result of `promise` (the already settled promise for `value`), or an error if the expectation failed (in which case if silent is false, also throws a js exception)
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
        let flags: Flags = if let Some(instance) = instance_value.as_class_ref::<ExpectCustomAsymmetricMatcher>() {
            instance.flags
        } else if let Some(instance) = instance_value.as_class_ref::<ExpectAny>() {
            // SAFETY: any_constructor_type is a valid out-ptr provided by C++ caller
            unsafe { *any_constructor_type = instance.flags.asymmetric_matcher_constructor_type() as u8 };
            instance.flags
        } else if let Some(instance) = instance_value.as_class_ref::<ExpectAnything>() {
            instance.flags
        } else if let Some(instance) = instance_value.as_class_ref::<ExpectStringMatching>() {
            instance.flags
        } else if let Some(instance) = instance_value.as_class_ref::<ExpectCloseTo>() {
            instance.flags
        } else if let Some(instance) = instance_value.as_class_ref::<ExpectObjectContaining>() {
            instance.flags
        } else if let Some(instance) = instance_value.as_class_ref::<ExpectStringContaining>() {
            instance.flags
        } else if let Some(instance) = instance_value.as_class_ref::<ExpectArrayContaining>() {
            instance.flags
        } else {
            Flags::default()
        };

        // SAFETY: out_flags is a valid out-ptr provided by C++ caller
        unsafe { *out_flags = flags.encode() };

        // (note that matcher_name/matcher_args are not used because silent=true)
        // SAFETY: value is a valid in/out-ptr provided by C++ caller
        let v = unsafe { *value };
        let promise = match flags.promise() {
            Promise::None => None,
            _ => match Pass::settled(global_this, Question { asked: Asked::Promise, who: JSValue::UNDEFINED, what: v }, &mut || {
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

    pub(crate) fn is_in_vitest_test(&self, buntest: &mut bun_test::BunTest) -> bool {
        let Some(parent) = self.parent.as_ref() else { return false };
        let test = parent.phase.sequence(buntest).and_then(|sequence| sequence.test_entry);
        let entry = test.or_else(|| parent.phase.entry(buntest).map(core::ptr::NonNull::from));
        // SAFETY: `buntest` owns the entries of its sequences.
        entry.is_some_and(|entry| unsafe { entry.as_ref() }.calling.is_vitest())
    }

    /// Whether to side with Vitest where it and Jest disagree: the running test was registered through `"vitest"`.
    pub(crate) fn is_vitest(&self) -> bool {
        self.bun_test().is_some_and(|buntest| self.is_in_vitest_test(buntest.get()))
    }

    pub(crate) fn call(cx: &mut JsScope<'_>, value: JsLocal<'_>, message: JsLocal<'_>) -> JsResult<JSValue> {
        Self::call_in(cx.global(), value.to_js(), message.to_js(), None)
    }

    /// `state` is the test this `expect()` belongs to (a test context's bound `expect`). `None` means the running test.
    pub(crate) fn call_in(
        global_this: &JSGlobalObject,
        value: JSValue,
        message: JSValue,
        state: Option<bun_test::RefDataValue>,
    ) -> JsResult<JSValue> {

        let mut custom_label = bun_core::String::EMPTY;
        if message.is_string() || message.implements_to_string(global_this)? {
            custom_label = message.to_bun_string(global_this)?;
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
            matcher_ran: Cell::new(false),
            custom_label,
            parent: active_execution_entry_ref,
        };
        let expect_js_value = expect.to_js(global_this);
        super::expect::js::captured_value_set_cached(expect_js_value, global_this, value);
        global_this.bun_vm().auto_garbage_collect();
        Ok(expect_js_value)
    }

    #[optimize(size)]
    fn call_with_flags(
        global_this: &JSGlobalObject,
        value: JSValue,
        message: JSValue,
        state: Option<bun_test::RefDataValue>,
        flags: u8,
    ) -> JsResult<JSValue> {
        let expect_js_value = Self::call_in(global_this, value, message, state)?;
        if let Some(expect) = expect_js_value.as_class_ref::<Expect>() {
            expect.update_flags(|f| f.0 |= flags);
        }
        Ok(expect_js_value)
    }

    pub(crate) fn soft(cx: &mut JsScope<'_>, value: JsLocal<'_>, message: JsLocal<'_>) -> JsResult<JSValue> {
        Self::soft_in(cx.global(), value.to_js(), message.to_js(), None)
    }

    pub(crate) fn soft_in(
        global_this: &JSGlobalObject,
        value: JSValue,
        message: JSValue,
        state: Option<bun_test::RefDataValue>,
    ) -> JsResult<JSValue> {
        Self::call_with_flags(global_this, value, message, state, Flags::SOFT_MASK)
    }

    pub(crate) fn poll(cx: &mut JsScope<'_>, r#fn: JsLocal<'_>, options: JsLocal<'_>) -> JsResult<JSValue> {
        Self::poll_in(cx.global(), r#fn.to_js(), options.to_js(), None)
    }

    pub(crate) fn poll_in(
        global_this: &JSGlobalObject,
        function: JSValue,
        options: JSValue,
        state: Option<bun_test::RefDataValue>,
    ) -> JsResult<JSValue> {
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
            JSValue::js_number_from_int32(super::vi_wait::interval_ms(global_this, interval)? as i32),
            JSValue::js_number_from_int32(super::vi_wait::delay_ms(global_this, timeout, 1000)? as i32),
        ];
        let expect_js_value = Self::call_with_flags(
            global_this,
            function,
            message.unwrap_or(JSValue::UNDEFINED),
            state,
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
        // If printing a value threw (a getter, a Proxy trap), propagate that error like Jest does.
        if rendered.is_err() && global_this.has_exception() {
            return Err(JsError::Thrown);
        }
        Err(global_this.throw(format_args!("{message}")))
    }

    pub(crate) fn constructor<'a>(heap: &JsHeap<'a>) -> bindgen::Result<'a, Self> {
        Err(heap.error(format_args!("expect() cannot be called with new")))
    }

    #[optimize(size)]
    pub(crate) fn pass(&self, cx: &mut JsScope<'_>, message: JsLocal<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        let this = self.post_match_guard(global_this);

        let value = message.to_js();

        let message: bun_core::String = if !value.is_undefined() {
            if !value.is_string() {
                return Err(global_this.throw_invalid_argument_type("pass", "message", "string"));
            }

            value.to_bun_string(global_this)?
        } else {
            bun_core::String::static_("passes by .pass() assertion")
        };

        this.increment_expect_call_counter();

        if !this.flags.get().not() { return Ok(JSValue::UNDEFINED); }

        let signature = Self::get_signature("pass", "", true);
        throw!(this, global_this, signature, "\n\n{}\n", message)
    }

    #[optimize(size)]
    pub(crate) fn fail(&self, cx: &mut JsScope<'_>, message: JsLocal<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        let this = self.post_match_guard(global_this);

        let value = message.to_js();

        let message: bun_core::String = if !value.is_undefined() {
            if !value.is_string() {
                return Err(global_this.throw_invalid_argument_type("fail", "message", "string"));
            }

            value.to_bun_string(global_this)?
        } else {
            bun_core::String::static_("fails by .fail() assertion")
        };

        this.increment_expect_call_counter();

        if this.flags.get().not() { return Ok(JSValue::UNDEFINED); }

        let signature = Self::get_signature("fail", "", true);
        throw!(this, global_this, signature, "\n\n{}\n", message)
    }
}

#[derive(Copy, Clone)]
pub(crate) enum Received {
    Value(JSValue),
    Thrown(JSValue),
}

unsafe extern "C" {
    safe fn Bun__holdRejectedPromises(global: &JSGlobalObject) -> usize;
    safe fn Bun__releaseRejectedPromises(global: &JSGlobalObject, mark: usize);
}

/// `toThrow()` takes a rejection that nothing handles during the call for what the function threw. What was rejected
/// before the call isn't the function's, and can still get its handler, so it waits here until the call is over.
struct EarlierRejections<'a> {
    global: &'a JSGlobalObject,
    mark: usize,
}

impl<'a> EarlierRejections<'a> {
    fn hold(global: &'a JSGlobalObject) -> Self {
        Self { global, mark: Bun__holdRejectedPromises(global) }
    }
}

impl Drop for EarlierRejections<'_> {
    fn drop(&mut self) {
        Bun__releaseRejectedPromises(self.global, self.mark);
    }
}

pub(crate) struct TrimResult<'a> {
    pub(crate) trimmed: &'a [u8],
    pub(crate) start_indent: Option<&'a [u8]>,
    pub(crate) end_indent: Option<&'a [u8]>,
}

impl Expect {
    #[optimize(size)]
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

        let mut reported = FirstReport { value: JSValue::ZERO, is_calling: true, outer: vm.unhandled_rejection_scope() };
        let question = Question { asked: Asked::Call, who: JSValue::UNDEFINED, what: value };
        let return_value_from_function = Pass::once(global_this, question, &mut || {
            let _earlier = EarlierRejections::hold(vm.global());

            reported.outer = vm.unhandled_rejection_scope();
            vm.on_unhandled_rejection_ctx = Some((&raw mut reported).cast());
            vm.on_unhandled_rejection = FirstReport::take;
            let returned = match value.call(global_this, JSValue::UNDEFINED, &[]) {
                Ok(v) => v,
                Err(err) => global_this.take_exception(err),
            };

            reported.is_calling = false;
            let _ = vm.global().handle_rejected_promises();
            reported.outer.apply(vm);
            Ok(returned)
        })?;
        let return_value = Pass::once(global_this, question, &mut || {
            Ok(if reported.value.is_empty() { return_value_from_function } else { reported.value })
        })?;

        if let Some(promise) = return_value.as_any_promise() {
            return match promise.unwrap(global_this.vm(), js_promise::UnwrapMode::MarkHandled) {
                js_promise::Unwrapped::Fulfilled(_) => Ok((None, return_value_from_function)),
                // since we know for sure it rejected, we should always return the error
                js_promise::Unwrapped::Rejected(rejected) => {
                    Ok((Some(rejected.to_error().unwrap_or(rejected)), return_value_from_function))
                }
                // A Promise subclass can start its work in `then()`, as a `Bun.sql` query does.
                js_promise::Unwrapped::Pending => {
                    let awaited = Self::promise_to_await(global_this, return_value)?.unwrap_or(promise);
                    Err(Pass::wait_for(global_this, awaited))
                }
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

    /// Mirrors `_toThrowErrorMatchingSnapshot` in jest-snapshot.
    #[cold]
    #[optimize(size)]
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
        // Jest follows a `cause` cycle until the string overflows. Stop at the first repeat instead.
        let mut seen = [thrown; MAX_CAUSES + 1];
        let mut count = 1;
        while !seen[..count].contains(&cause) && count <= MAX_CAUSES {
            let line = if cause.is_any_error() {
                cause.get(global_this, "message")?.unwrap_or(JSValue::UNDEFINED)
            } else if cause.is_string() {
                cause
            } else {
                break;
            };
            text.extend_from_slice(b"\nCause: ");
            text.extend_from_slice(&line.to_bun_string(global_this)?.to_owned_slice());
            seen[count] = cause;
            count += 1;
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

    #[optimize(size)]
    pub(crate) fn inline_snapshot(
        &self,
        global_this: &JSGlobalObject,
        this_value: JSValue,
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

        // An inline snapshot has no file header naming its format, so go by the module the test was registered through.
        let is_vitest = this.is_vitest();
        let format = if is_vitest { SnapshotFormat::Vitest } else { SnapshotFormat::Bun };
        let mut pretty_value: Vec<u8> = Vec::new();
        let value = Self::value_to_snapshot(global_this, received, format)?;
        let (shown, same_as_older_bun) =
            this.match_and_fmt_snapshot(global_this, value, property_matchers, &mut pretty_value, fn_name, format)?;
        if this.bun_test().is_some() {
            match runner.snapshots.format_of(this).and_then(|format| runner.snapshots.add_count(this, format, b"")) {
                Ok(_) => {}
                Err(crate::Error::NoTest | crate::Error::SnapshotInConcurrentGroup | crate::Error::TestNotActive) => {}
                // Inline snapshots don't need the snapshot file, so leave these errors to a matcher that does.
                Err(crate::Error::FailedToOpenSnapshotFile | crate::Error::ParseError) => {}
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
                // Jest and Vitest print a plain value identically, so trying one covers both.
                match (received, is_vitest) {
                    (Received::Value(_), true) => &[],
                    (Received::Value(_), false) | (Received::Thrown(_), true) => &[SnapshotFormat::Jest],
                    (Received::Thrown(_), false) => &[SnapshotFormat::Jest, SnapshotFormat::Vitest],
                },
                !same_as_older_bun || property_matchers.is_some(),
                global_this,
                received,
                shown,
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
            if bun_core::ci_info::is_ci() {
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
            let srcloc = ExpectDeferred::call_site(global_this, this_value)
                .unwrap_or_else(|| global_this.get_caller_src_loc());
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

    #[cold]
    #[optimize(size)]
    fn was_written_by_another(
        formats: &[SnapshotFormat],
        or_older_bun: bool,
        global_this: &JSGlobalObject,
        received: Received,
        with_matchers: JSValue,
        property_matchers: Option<JSValue>,
        saved: &[u8],
    ) -> JsResult<bool> {
        for format in or_older_bun.then_some(None).into_iter().chain(formats.iter().copied().map(Some)) {
            let is_it = (|| {
                let value = Self::value_to_snapshot(global_this, received, format.unwrap_or(SnapshotFormat::Bun))?;
                let Some(format) = format else {
                    // Older Bun wrote the matchers into the object in place, which didn't stick for getters or frozen objects.
                    return Ok((property_matchers.is_some() && JestPrettyFormat::did_older_bun_print(global_this, with_matchers, saved)?)
                        || JestPrettyFormat::did_older_bun_print(global_this, value, saved)?);
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

    /// Returns `value` with `property_matchers` substituted in, and `print_snapshot`'s result.
    #[optimize(size)]
    pub(crate) fn match_and_fmt_snapshot(
        &self,
        global_this: &JSGlobalObject,
        value: JSValue,
        property_matchers: Option<JSValue>,
        pretty_value: &mut Vec<u8>,
        fn_name: &'static str,
        format: SnapshotFormat,
    ) -> JsResult<(JSValue, bool)> {
        let mut shown = value;
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
            shown = with_matchers;
        }

        let printed = if format.is_pretty_format() { value } else { shown };
        let same_as_older_bun = JestPrettyFormat::print_snapshot(global_this, printed, property_matchers, pretty_value, format)?;
        Ok((shown, same_as_older_bun))
    }

    #[optimize(size)]
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
                if runner.snapshots.may_hold_entries_of_bun()
                    && Self::was_written_by_another(
                        &[],
                        !same_as_older_bun || property_matchers.is_some(),
                        global_this,
                        received,
                        shown,
                        property_matchers,
                        &saved,
                    )?
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
    #[optimize(size)]
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

    pub(crate) fn get_static_not<'a>(heap: &JsHeap<'a>) -> JsWrapper<'a, ExpectStatic> {
        let mut flags = Flags::default();
        flags.set_not(true);
        ExpectStatic { flags }.into_js(heap)
    }

    pub(crate) fn get_static_resolves_to<'a>(heap: &JsHeap<'a>) -> JsWrapper<'a, ExpectStatic> {
        let mut flags = Flags::default();
        flags.set_promise(Promise::Resolves);
        ExpectStatic { flags }.into_js(heap)
    }

    pub(crate) fn get_static_rejects_to<'a>(heap: &JsHeap<'a>) -> JsWrapper<'a, ExpectStatic> {
        let mut flags = Flags::default();
        flags.set_promise(Promise::Rejects);
        ExpectStatic { flags }.into_js(heap)
    }

    pub(crate) fn any(cx: &mut JsScope<'_>, constructor: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectAny::create(cx.global(), Flags::default(), constructor.to_js())
    }

    pub(crate) fn anything(cx: &mut JsScope<'_>) -> JSValue {
        ExpectAnything::create(cx.global(), Flags::default())
    }

    pub(crate) fn close_to(cx: &mut JsScope<'_>, number: JsLocal<'_>, precision: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectCloseTo::create(cx.global(), Flags::default(), number.to_js(), precision.to_js())
    }

    pub(crate) fn object_containing(cx: &mut JsScope<'_>, object: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectObjectContaining::create(cx.global(), Flags::default(), object.to_js())
    }

    pub(crate) fn string_containing(cx: &mut JsScope<'_>, string: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectStringContaining::create(cx.global(), Flags::default(), string.to_js())
    }

    pub(crate) fn string_matching(cx: &mut JsScope<'_>, test: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectStringMatching::create(cx.global(), Flags::default(), test.to_js())
    }

    pub(crate) fn array_containing(cx: &mut JsScope<'_>, array: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectArrayContaining::create(cx.global(), Flags::default(), array.to_js())
    }

    /// `expect.toSatisfy(predicate, message?)`. As in Vitest, it's what `expect.extend({ toSatisfy })` would add.
    pub(crate) fn static_to_satisfy(cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        Self::to_satisfy_matcher(cx.global(), Flags::default(), JsLocal::to_js_slice(args))
    }

    #[optimize(size)]
    fn to_satisfy_matcher(global_this: &JSGlobalObject, flags: Flags, args: &[JSValue]) -> JsResult<JSValue> {
        if !args.first().is_some_and(|predicate| predicate.is_callable()) {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>toSatisfy<d>(<r>predicate<d>, message?)<r>\n\nExpected a function\n",
            ));
        }
        let utils = ExpectMatcherUtils::singleton(global_this);
        let matcher_fn =
            js_ExpectMatcherUtils::to_satisfy_get_cached(utils).unwrap_or_else(|| {
                let matcher_fn = JSFunction::create(
                    global_this,
                    "toSatisfy",
                    generated::Bun__Expect__toSatisfyAsCustomMatcher,
                    2,
                    Default::default(),
                );
                js_ExpectMatcherUtils::to_satisfy_set_cached(utils, global_this, matcher_fn);
                matcher_fn
            });
        ExpectCustomAsymmetricMatcher::create_with(global_this, flags, args, matcher_fn)
    }

    pub(crate) fn to_satisfy_as_custom_matcher(
        cx: &mut JsScope<'_>,
        received: JsLocal<'_>,
        predicate: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let pass = predicate
            .to_js()
            .call(global_this, JSValue::UNDEFINED, &[received.to_js()])?
            .to_boolean();
        let result = JSValue::create_empty_object(global_this, 1);
        result.put(global_this, b"pass", JSValue::from(pass));
        Ok(result)
    }

    /// Implements `expect.extend({ ... })`
    pub(crate) fn extend(cx: &mut JsScope<'_>, matchers: JsLocal<'_>) -> JsResult<()> {
        let global_this = cx.global();

        let Some(matchers_to_register) = matchers.to_js().get_object() else {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>extend<d>(<r>matchers<d>)<r>\n\nExpected an object containing matchers\n",
            ));
        };

        // SAFETY: FFI call with valid &JSGlobalObject
        let expect_proto = unsafe { Expect__getPrototype(global_this) };
        let expect_constructor = super::expect::js::get_constructor(global_this);
        // SAFETY: FFI call with valid &JSGlobalObject
        let expect_static_proto = unsafe { ExpectStatic__getPrototype(global_this) };

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
                    // `import * as matchers` from a CommonJS package adds these two keys.
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

                // SAFETY: FFI call with valid global, &bun_core::String, host-fn ptr, and JSValue.
                // C++ takes the function pointer **by value** (`NativeFunctionPtr`), not a
                // pointer-to-function-pointer — `JSHostFn` already is the
                // function-pointer type, so pass it directly.
                let wrapper_fn = unsafe {
                    Bun__JSWrappingFunction__create(
                        global_this,
                        &matcher_name,
                        generated::Bun__Expect__applyCustomMatcher,
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

        Ok(())
    }

    #[cold]
    #[optimize(size)]
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

    /// Runs `call(&[received, ...rest])` with the args visible to the GC, since a `Vec` alone wouldn't root them.
    #[inline]
    fn with_matcher_args<R>(
        received: JSValue,
        rest_len: usize,
        mut rest: impl FnMut(usize) -> JsResult<JSValue>,
        call: impl FnOnce(&[JSValue]) -> JsResult<R>,
    ) -> JsResult<R> {
        const ON_STACK: usize = 8;
        if rest_len < ON_STACK {
            let mut args = [JSValue::UNDEFINED; ON_STACK];
            args[0] = received;
            for (index, arg) in args[1..=rest_len].iter_mut().enumerate() {
                *arg = rest(index)?;
            }
            return call(&args[..=rest_len]);
        }
        bun_jsc::MarkedArgumentBuffer::new(|roots| {
            let mut args = Vec::with_capacity(rest_len.saturating_add(1));
            roots.append(received);
            args.push(received);
            for index in 0..rest_len {
                let arg = rest(index)?;
                roots.append(arg);
                args.push(arg);
            }
            call(&args)
        })
    }

    /// Execute the custom matcher for the given args (the left value + the args passed to the matcher call).
    /// This function is called both for symmetric and asymmetric matching.
    /// If silent=false, throws an exception in JS if the matcher result didn't result in a pass (or if the matcher result is invalid).
    #[optimize(size)]
    pub(crate) fn execute_custom_matcher(
        global_this: &JSGlobalObject,
        custom_label: &bun_core::String,
        matcher_name: &bun_core::String,
        matcher_fn: JSValue,
        who: JSValue,
        args: &[JSValue],
        flags: Flags,
        parent: Option<&RefPtr<bun_test::RefData>>,
        silent: bool,
    ) -> JsResult<bool> {
        // call the custom matcher implementation
        let what = args.first().copied().unwrap_or(JSValue::UNDEFINED);
        let mut result = Pass::once_inline(global_this, Question { asked: Asked::Matcher, who, what }, || {
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
                    bun_test::print_error(VirtualMachine::get().as_mut(), global_this, result, None);
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

        // Like Jest and Vitest, don't prepend a signature. Matchers add their own with `this.utils.matcherHint()`.
        Err(if custom_label.is_empty() {
            global_this.throw(format_args!("{message_text}"))
        } else {
            global_this.throw(format_args!("{custom_label}\n\n{message_text}"))
        })
    }

    /// Function that is run for either `expect.myMatcher()` call or `expect().myMatcher` call,
    /// and we can known which case it is based on if the `this` value is an instance of Expect
    pub(crate) fn apply_custom_matcher(
        cx: &mut JsScope<'_>,
        this_value: JsLocal<'_>,
        callee: JsLocal<'_>,
        args: &[JsLocal<'_>],
    ) -> JsResult<JSValue> {
        // SAFETY: bun_vm() returns the live VM pointer for this global.
        let _gc = cx.global().bun_vm().as_mut().auto_gc_on_drop();
        let call = MatcherCall { this: this_value.to_js(), callee: callee.to_js(), arguments: JsLocal::to_js_slice(args) };

        // try to retrieve the Expect instance
        let Some(expect) = call.this.as_class_ref::<Expect>() else {
            // if no Expect instance, assume it is a static call (`expect.myMatcher()`), so create an ExpectCustomAsymmetricMatcher instance
            let global_this = cx.global();
            let matcher_fn = Self::custom_matcher_fn(global_this, call.callee)?;
            return ExpectCustomAsymmetricMatcher::create(global_this, call.this, call.arguments, matcher_fn);
        };

        // if we got an Expect instance, then it's a non-static call (`expect().myMatcher`),
        // so now execute the symmetric matching
        expect.run_matcher(cx, &call, |cx| expect.custom_matcher(cx.global(), &call))
    }

    fn custom_matcher_fn(global_this: &JSGlobalObject, func: JSValue) -> JsResult<JSValue> {
        let matcher_fn: JSValue = get_custom_matcher_fn(func, global_this).unwrap_or(JSValue::UNDEFINED);
        if !matcher_fn.js_type().is_function() {
            return Err(global_this.throw2(
                "Internal consistency error: failed to retrieve the matcher function for a custom matcher!",
                (),
            ));
        }
        Ok(matcher_fn)
    }

    fn custom_matcher(&self, global_this: &JSGlobalObject, call: &MatcherCall<'_>) -> JsResult<JSValue> {
        let expect = self;
        let this_value: JSValue = call.this;
        let matcher_fn = Self::custom_matcher_fn(global_this, call.callee)?;

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

        let args = call.arguments;
        Self::with_matcher_args(value, args.len(), |index| Ok(args[index]), |matcher_args| {
            Self::execute_custom_matcher(global_this, &expect.custom_label, &matcher_name, matcher_fn, matcher_fn, matcher_args, expect.flags.get(), expect.parent.as_ref(), false)
        })?;

        Ok(this_value)
    }

    pub(crate) fn add_snapshot_serializer(cx: &mut JsScope<'_>, serializer: JsLocal<'_>) -> JsResult<()> {
        JestPrettyFormat::add_snapshot_serializer(cx.global(), serializer.to_js())
    }

    #[optimize(size)]
    pub(crate) fn has_assertions(cx: &mut JsScope<'_>) -> JsResult<()> {
        Self::has_assertions_in(cx.global(), None)
    }

    #[optimize(size)]
    pub(crate) fn has_assertions_in(global_this: &JSGlobalObject, state: Option<bun_test::RefDataValue>) -> JsResult<()> {
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

        Ok(())
    }

    #[optimize(size)]
    pub(crate) fn assertions(cx: &mut JsScope<'_>, expected: JsLocal<'_>) -> JsResult<()> {
        Self::assertions_in(cx.global(), expected.to_js(), None)
    }

    pub(crate) fn assertions_in(
        global_this: &JSGlobalObject,
        expected: JSValue,
        state: Option<bun_test::RefDataValue>,
    ) -> JsResult<()> {
        // SAFETY: bun_vm() returns the live VM pointer for this global.
        let _gc = global_this.bun_vm().as_mut().auto_gc_on_drop();

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

        Ok(())
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

    pub(crate) fn unreachable(cx: &mut JsScope<'_>, message: JsLocal<'_>) -> JsResult<()> {
        let global_this = cx.global();
        let arg = message.to_js();

        if arg.is_undefined_or_null() {
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
pub(crate) struct ExpectStatic {
    pub(crate) flags: Flags,
}

impl ExpectStatic {
    pub(crate) fn get_not<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, Self> {
        let mut flags = self.flags;
        flags.set_not(!self.flags.not());
        ExpectStatic { flags }.into_js(heap)
    }

    pub(crate) fn get_resolves_to<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        let mut flags = self.flags;
        if flags.promise() != Promise::None {
            return Err(Self::async_chaining_error(heap, flags, "resolvesTo"));
        }
        flags.set_promise(Promise::Resolves);
        Ok(ExpectStatic { flags }.into_js(heap))
    }

    pub(crate) fn get_rejects_to<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JsWrapper<'a, Self>> {
        let mut flags = self.flags;
        if flags.promise() != Promise::None {
            return Err(Self::async_chaining_error(heap, flags, "rejectsTo"));
        }
        flags.set_promise(Promise::Rejects);
        Ok(ExpectStatic { flags }.into_js(heap))
    }

    #[cold]
    fn async_chaining_error<'a>(heap: &JsHeap<'a>, flags: Flags, name: &str) -> bindgen::Error<'a> {
        let str = match flags.promise() {
            Promise::Resolves => "resolvesTo",
            Promise::Rejects => "rejectsTo",
            _ => unreachable!(),
        };
        heap.error(format_args!("expect.{name}: already called expect.{str} on this chain"))
    }

    pub(crate) fn anything(&self, cx: &mut JsScope<'_>) -> JSValue {
        ExpectAnything::create(cx.global(), self.flags)
    }

    pub(crate) fn any(&self, cx: &mut JsScope<'_>, constructor: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectAny::create(cx.global(), self.flags, constructor.to_js())
    }

    pub(crate) fn array_containing(&self, cx: &mut JsScope<'_>, array: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectArrayContaining::create(cx.global(), self.flags, array.to_js())
    }

    pub(crate) fn close_to(&self, cx: &mut JsScope<'_>, number: JsLocal<'_>, precision: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectCloseTo::create(cx.global(), self.flags, number.to_js(), precision.to_js())
    }

    pub(crate) fn object_containing(&self, cx: &mut JsScope<'_>, object: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectObjectContaining::create(cx.global(), self.flags, object.to_js())
    }

    pub(crate) fn string_containing(&self, cx: &mut JsScope<'_>, string: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectStringContaining::create(cx.global(), self.flags, string.to_js())
    }

    pub(crate) fn string_matching(&self, cx: &mut JsScope<'_>, test: JsLocal<'_>) -> JsResult<JSValue> {
        ExpectStringMatching::create(cx.global(), self.flags, test.to_js())
    }

    pub(crate) fn to_satisfy(&self, cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        Expect::to_satisfy_matcher(cx.global(), self.flags, JsLocal::to_js_slice(args))
    }
}

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
        this_value: JSValue,
        matcher_name: &'static str,
        pred: impl FnOnce(JSValue) -> bool,
    ) -> JsResult<JSValue> {
        let (this, value, not) = self.matcher_prelude(global, this_value, matcher_name, "")?;
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
    /// guard, expected-is-string check, `get_value`,
    /// `increment_expect_call_counter`, UTF-8 slice + predicate, `not`-xor, dual
    /// formatter, `get_signature`, `throw`.
    ///
    /// Normalizes an inherited inconsistency where `toInclude` passed `""`
    /// to `get_value`'s `matcher_params` while the other two passed
    /// `"<green>expected<r>"` — all three now use the latter (matches the
    /// signature already used in their failure messages).
    #[optimize(size)]
    pub(crate) fn run_string_affix_matcher(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        expected: JSValue,
        matcher_name: &'static str,
        verb: &'static str,
        pred: fn(&[u8], &[u8]) -> bool,
    ) -> JsResult<JSValue> {
        let this = self.post_match_guard(global);

        if !expected.is_string() {
            return Err(global.throw(format_args!(
                "{matcher_name}() requires the first argument to be a string"
            )));
        }

        let value = this.get_value(global, this_value, matcher_name, "<green>expected<r>")?;
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
// same boilerplate (post_match defer, expect-counter,
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
    /// `post_match` guard, counter bump, `get_value`,
    /// optional `expected.is_array()` validation (positioned per
    /// [`ExpectedArray`]), `.not` flip, and the dual-formatter failure throw —
    /// and delegates only the per-matcher pass-loop to `body`.
    ///
    /// On pass, returns `this_value`, not `undefined`.
    pub(crate) fn contain_matcher(
        &self,
        global: &JSGlobalObject,
        this_value: JSValue,
        expected: JSValue,
        matcher_name: &'static str,
        expected_array: ExpectedArray,
        msgs: ContainMsgs,
        body: impl FnOnce(&JSGlobalObject, JSValue, JSValue) -> JsResult<ContainOutcome>,
    ) -> JsResult<JSValue> {
        let this = self.post_match_guard(global);

        this.increment_expect_call_counter();

        if matches!(expected_array, ExpectedArray::BeforeValue) && !expected.js_type().is_array() {
            return Err(global.throw_invalid_argument_type(matcher_name, "expected", "array"));
        }

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

pub(crate) struct ExpectAnything {
    pub(crate) flags: Flags,
}

impl ExpectAnything {
    fn create(global_this: &JSGlobalObject, flags: Flags) -> JSValue {
        let anything_js_value = ExpectAnything { flags }.to_js(global_this);
        anything_js_value.ensure_still_alive();

        global_this.bun_vm().auto_garbage_collect();

        anything_js_value
    }
}

pub(crate) struct ExpectStringMatching {
    pub(crate) flags: Flags,
}

impl ExpectStringMatching {
    fn create(global_this: &JSGlobalObject, flags: Flags, test_value: JSValue) -> JsResult<JSValue> {
        if !test_value.is_string() && !test_value.is_reg_exp() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>stringMatching<d>(<r>string<d>)<r>\n\nExpected a string or regular expression\n",
            ));
        }

        // Like in Jest and Vitest, a string is the source of a regular expression.
        let pattern = if test_value.is_reg_exp() {
            test_value
        } else {
            bun_jsc::call_zero_is_throw(global_this, || {
                ExpectStringMatching__compile(global_this, test_value)
            })?
        };

        let string_matching_js_value = ExpectStringMatching { flags }.to_js(global_this);
        js_ExpectStringMatching::test_value_set_cached(string_matching_js_value, global_this, test_value);
        js_ExpectStringMatching::pattern_set_cached(string_matching_js_value, global_this, pattern);

        global_this.bun_vm().auto_garbage_collect();
        Ok(string_matching_js_value)
    }
}

pub(crate) struct ExpectCloseTo {
    pub(crate) flags: Flags,
}

impl ExpectCloseTo {
    fn create(
        global_this: &JSGlobalObject,
        flags: Flags,
        number_value: JSValue,
        mut precision_value: JSValue,
    ) -> JsResult<JSValue> {
        if !number_value.is_number() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>closeTo<d>(<r>number<d>, precision?)<r>\n\nExpected a number value",
            ));
        }

        if precision_value.is_undefined() {
            precision_value = JSValue::js_number_from_int32(2); // default value from jest
        }
        if !precision_value.is_number() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>closeTo<d>(number, <r>precision?<d>)<r>\n\nPrecision must be a number or undefined",
            ));
        }

        let instance_jsvalue = ExpectCloseTo { flags }.to_js(global_this);
        js_ExpectCloseTo::number_value_set_cached(instance_jsvalue, global_this, number_value);
        js_ExpectCloseTo::digits_value_set_cached(instance_jsvalue, global_this, precision_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(instance_jsvalue)
    }
}

pub(crate) struct ExpectObjectContaining {
    pub(crate) flags: Flags,
}

impl ExpectObjectContaining {
    fn create(global_this: &JSGlobalObject, flags: Flags, object_value: JSValue) -> JsResult<JSValue> {
        if !object_value.is_object() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>objectContaining<d>(<r>object<d>)<r>\n\nExpected an object\n",
            ));
        }

        let instance_jsvalue = ExpectObjectContaining { flags }.to_js(global_this);
        js_ExpectObjectContaining::object_value_set_cached(instance_jsvalue, global_this, object_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(instance_jsvalue)
    }
}

pub(crate) struct ExpectStringContaining {
    pub(crate) flags: Flags,
}

impl ExpectStringContaining {
    fn create(global_this: &JSGlobalObject, flags: Flags, string_value: JSValue) -> JsResult<JSValue> {
        if !string_value.is_string() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>stringContaining<d>(<r>string<d>)<r>\n\nExpected a string\n",
            ));
        }

        let string_containing_js_value = ExpectStringContaining { flags }.to_js(global_this);
        js_ExpectStringContaining::string_value_set_cached(string_containing_js_value, global_this, string_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(string_containing_js_value)
    }
}

pub(crate) struct ExpectAny {
    pub(crate) flags: Flags,
}

impl ExpectAny {
    fn create(global_this: &JSGlobalObject, mut flags: Flags, constructor: JSValue) -> JsResult<JSValue> {
        if constructor.is_undefined() {
            return Err(global_this.throw2(
                "any() expects to be passed a constructor function. Please pass one or use anything() to match any object.",
                (),
            ));
        }

        if !constructor.is_constructor() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>any<d>(<r>constructor<d>)<r>\n\nExpected a constructor\n",
            ));
        }

        let asymmetric_matcher_constructor_type = AsymmetricMatcherConstructorType::from_js(global_this, constructor)?;

        flags.set_asymmetric_matcher_constructor_type(asymmetric_matcher_constructor_type);

        let any_js_value = ExpectAny { flags }.to_js(global_this);
        any_js_value.ensure_still_alive();
        js_ExpectAny::constructor_value_set_cached(any_js_value, global_this, constructor);
        any_js_value.ensure_still_alive();

        global_this.bun_vm().auto_garbage_collect();

        Ok(any_js_value)
    }
}

pub(crate) struct ExpectArrayContaining {
    pub(crate) flags: Flags,
}

impl ExpectArrayContaining {
    fn create(global_this: &JSGlobalObject, flags: Flags, array_value: JSValue) -> JsResult<JSValue> {
        if !array_value.js_type().is_array() {
            return Err(crate::throw_pretty_static!(
                global_this,
                "<d>expect.<r>arrayContaining<d>(<r>array<d>)<r>\n\nExpected a array\n",
            ));
        }

        let array_containing_js_value = ExpectArrayContaining { flags }.to_js(global_this);
        js_ExpectArrayContaining::array_value_set_cached(array_containing_js_value, global_this, array_value);

        global_this.bun_vm().auto_garbage_collect();
        Ok(array_containing_js_value)
    }
}

/// An instantiated asymmetric custom matcher, returned from calls to `expect.toCustomMatch(...)`
///
/// Reference: `AsymmetricMatcher` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
/// (but only created for *custom* matchers, as built-ins have their own classes)
// Every JS-exposed method takes `&self`. The only
// field, `flags`, is set once at construction (`create()`) and never written
// thereafter, so it stays a bare `Flags` (no `Cell` needed). Both members
// call into user JS (`execute_impl` → `execute_custom_matcher`, `custom_print`
// → `matcher_fn.call`) which can re-enter on the same payload; holding a
// `noalias` `&mut Self` across that call is Stacked-Borrows UB even with no
// field writes.
pub(crate) struct ExpectCustomAsymmetricMatcher {
    pub(crate) flags: Flags,
}

impl ExpectCustomAsymmetricMatcher {
    /// Implements the static call of the custom matcher (`expect.myCustomMatcher(<args>)`),
    /// which creates an asymmetric matcher instance (`ExpectCustomAsymmetricMatcher`).
    /// This will not run the matcher, but just capture the args etc.
    pub(crate) fn create(
        global_this: &JSGlobalObject,
        this_value: JSValue,
        args: &[JSValue],
        matcher_fn: JSValue,
    ) -> JsResult<JSValue> {
        // try to retrieve the ExpectStatic instance (to get the flags)
        let flags = if let Some(expect_static) = this_value.as_class_ref::<ExpectStatic>() {
            expect_static.flags
        } else {
            // if it's not an ExpectStatic instance, assume it was called from the Expect constructor, so use the default flags
            Flags::default()
        };
        Self::create_with(global_this, flags, args, matcher_fn)
    }

    fn create_with(global_this: &JSGlobalObject, flags: Flags, args: &[JSValue], matcher_fn: JSValue) -> JsResult<JSValue> {
        // create the matcher instance (flags stored upfront)
        let instance_jsvalue = ExpectCustomAsymmetricMatcher { flags }.to_js(global_this);
        instance_jsvalue.ensure_still_alive();

        // store the user-provided matcher function into the instance
        js_ExpectCustomAsymmetricMatcher::matcher_fn_set_cached(instance_jsvalue, global_this, matcher_fn);

        // capture the args as a JS array saved in the instance, so the matcher can be executed later on with them
        let array = JSValue::create_array_from_slice(global_this, args)?;
        js_ExpectCustomAsymmetricMatcher::captured_args_set_cached(instance_jsvalue, global_this, array);
        array.ensure_still_alive();

        // return the same instance, now fully initialized including the captured args (previously it was incomplete)
        Ok(instance_jsvalue)
    }

    fn execute_impl(
        &self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
        received: JSValue,
    ) -> JsResult<bool> {
        // retrieve the user-provided matcher implementation function (the function passed to expect.extend({ ... }))
        let Some(matcher_fn) = js_ExpectCustomAsymmetricMatcher::matcher_fn_get_cached(this_value) else {
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
        let Some(captured_args) = js_ExpectCustomAsymmetricMatcher::captured_args_get_cached(this_value) else {
            return Err(global_this.throw(format_args!(
                "expect.{} misused, it needs to be instantiated by calling it with 0 or more arguments",
                matcher_name,
            )));
        };
        captured_args.ensure_still_alive();

        // prepare the args array as `[received, ...captured_args]`
        let args_count = captured_args.get_length(global_this)? as usize;
        Expect::with_matcher_args(received, args_count, |index| captured_args.get_index(global_this, index as u32), |matcher_args| {
            Expect::execute_custom_matcher(global_this, &bun_core::String::EMPTY, &matcher_name, matcher_fn, this_value, matcher_args, self.flags, None, true)
        })
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
        unsafe { (*this).execute_impl(this_value, &*global_this, received) }.unwrap_or(false)
    }

    pub(crate) fn asymmetric_match(
        &self,
        this_value: JsWrapper<'_, Self>,
        cx: &mut JsScope<'_>,
        received: JsLocal<'_>,
    ) -> JsResult<bool> {
        let pass = Pass::barrier();
        let _entered = pass.enter();
        self.execute_impl(this_value.to_js(), cx.global(), received.to_js())
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
    #[optimize(size)]
    pub(crate) fn custom_print(
        &self,
        this_value: JSValue,
        global_this: &JSGlobalObject,
        writer: &mut (impl bun_io::Write + ?Sized),
        dont_throw: bool,
    ) -> crate::Result<bool> {
        let Some(matcher_fn) = js_ExpectCustomAsymmetricMatcher::matcher_fn_get_cached(this_value) else { return Ok(false) };
        // `expect.toSatisfy()` prints like in Vitest everywhere: `toSatisfy<[Function isOdd], "is odd">`.
        let utils = ExpectMatcherUtils::singleton(global_this);
        if js_ExpectMatcherUtils::to_satisfy_get_cached(utils) == Some(matcher_fn) {
            let mut printed: Vec<u8> = Vec::new();
            if let Err(e) = JestPrettyFormat::print_snapshot(
                global_this,
                this_value,
                None,
                &mut printed,
                SnapshotFormat::Vitest,
            ) {
                return Self::maybe_clear(global_this, e, dont_throw);
            }
            writer.write_all(&printed)?;
            return Ok(true);
        }
        let fn_value = match matcher_fn.get(global_this, "toAsymmetricMatcher") {
            Ok(v) => v,
            Err(e) => return Self::maybe_clear(global_this, e, dont_throw),
        };
        if let Some(fn_value) = fn_value {
            if fn_value.js_type().is_function() {
                let Some(captured_args) = js_ExpectCustomAsymmetricMatcher::captured_args_get_cached(this_value) else { return Ok(false) };
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
pub(crate) struct ExpectMatcherContext {
    pub(crate) flags: Flags,
    pub(crate) parent: Option<RefPtr<bun_test::RefData>>,
}

impl ExpectMatcherContext {
    pub(crate) fn get_utils(&self, cx: &mut JsScope<'_>) -> JSValue {
        ExpectMatcherUtils::singleton(cx.global())
    }

    pub(crate) fn get_is_not(&self) -> bool {
        self.flags.not()
    }

    pub(crate) fn get_promise(&self) -> bun_core::String {
        match self.flags.promise() {
            Promise::Rejects => bun_core::String::static_("rejects"),
            Promise::Resolves => bun_core::String::static_("resolves"),
            _ => bun_core::String::EMPTY,
        }
    }

    pub(crate) fn get_expand(&self) -> bool {
        // TODO: this should return whether running tests in verbose mode or not (jest flag --expand), but bun currently doesn't have this switch
        false
    }

    pub(crate) fn get_equals(&self, cx: &mut JsScope<'_>) -> JSValue {
        let global_this = cx.global();
        let utils = ExpectMatcherUtils::singleton(global_this);
        js_ExpectMatcherUtils::equals_get_cached(utils).unwrap_or_else(|| {
            let equals = JSFunction::create(global_this, "equals", generated::Bun__ExpectMatcherContext__equals, 4, Default::default());
            js_ExpectMatcherUtils::equals_set_cached(utils, global_this, equals);
            equals
        })
    }

    pub(crate) fn equals(
        cx: &mut JsScope<'_>,
        a: JsLocal<'_>,
        b: JsLocal<'_>,
        custom_testers: JsLocal<'_>,
        strict_check: bool,
    ) -> JsResult<bool> {
        let global_this = cx.global();
        let (a, b, custom_testers) = (a.to_js(), b.to_js(), custom_testers.to_js());
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
        if strict_check {
            a.jest_strict_deep_equals(b, global_this)
        } else {
            a.jest_deep_equals(b, global_this)
        }
    }
}

const NO_VISUAL_DIFFERENCE: &[u8] = b"Compared values have no visual difference.";

#[derive(Clone, Copy)]
enum HintColor {
    Dim,
    Expected,
    Received,
}

impl HintColor {
    #[optimize(size)]
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

/// Catches errors that `toThrow()`'s function reports instead of throwing, e.g. from a native emitter's listener.
/// The first one counts as thrown and the rest go to the outer handler.
struct FirstReport {
    value: JSValue,
    /// False while draining the rejections the call left behind, which are dropped.
    is_calling: bool,
    outer: bun_jsc::virtual_machine::UnhandledRejectionScope,
}

impl FirstReport {
    fn take(vm: &mut VirtualMachine, global: &JSGlobalObject, value: JSValue) {
        let Some(this) = vm.on_unhandled_rejection_ctx else { return };
        // SAFETY: `get_value_as_to_throw` points the ctx at its local only while this is the handler.
        let this = unsafe { &mut *this.cast::<FirstReport>() };
        if !this.is_calling {
            return;
        }
        if this.value.is_empty() {
            this.value = value;
            return;
        }
        let inner = vm.unhandled_rejection_scope();
        this.outer.apply(vm);
        (vm.on_unhandled_rejection)(vm, global, value);
        inner.apply(vm);
    }
}

/// Reference: `MatcherUtils` in https://github.com/jestjs/jest/blob/main/packages/expect/src/types.ts
///
/// It's the only `expect` cell that each global roots, so `expect`'s per-global state lives here too.
#[derive(Default)]
pub(crate) struct ExpectMatcherUtils {
    /// Per equality tester, whether the test file's own code registered it. Those don't carry over to the next file.
    /// Testers from preloads and imported modules stay, because those modules are only evaluated once.
    pub(crate) testers_of_file: bun_jsc::JsCell<Vec<bool>>,
    /// `BunTestRoot::file_generation` of that test file.
    pub(crate) testers_file: Cell<u32>,
    pub(crate) serializers_of_file: bun_jsc::JsCell<Vec<bool>>,
    pub(crate) serializers_file: Cell<u32>,
}

impl ExpectMatcherUtils {
    #[unsafe(no_mangle)]
    pub(crate) extern "C" fn ExpectMatcherUtils_createSigleton(global_this: &JSGlobalObject) -> JSValue {
        let utils = ExpectMatcherUtils::default().to_js(global_this);
        let functions: [(&str, bun_jsc::JSHostFn, u32); 8] = [
            ("stringify", generated::Bun__ExpectMatcherUtils__stringify, 1),
            ("printExpected", generated::Bun__ExpectMatcherUtils__printExpected, 1),
            ("printReceived", generated::Bun__ExpectMatcherUtils__printReceived, 1),
            ("EXPECTED_COLOR", generated::Bun__ExpectMatcherUtils__expectedColor, 1),
            ("RECEIVED_COLOR", generated::Bun__ExpectMatcherUtils__receivedColor, 1),
            ("matcherHint", generated::Bun__ExpectMatcherUtils__matcherHint, 1),
            ("printWithType", generated::Bun__ExpectMatcherUtils__printWithType, 3),
            ("diff", generated::Bun__ExpectMatcherUtils__diff, 2),
        ];
        for (name, function, length) in functions {
            let function = JSFunction::create(global_this, name, function, length, Default::default());
            utils.put(global_this, name.as_bytes(), function);
        }
        utils
    }

    pub(crate) fn singleton(global_this: &JSGlobalObject) -> JSValue {
        // SAFETY: FFI call with valid &JSGlobalObject
        unsafe { ExpectMatcherUtils__getSingleton(global_this) }
    }

    #[optimize(size)]
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
            // Like Jest, print `[Error: message]` without the source frame and stack.
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

    #[optimize(size)]
    pub(crate) fn stringify(cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<JSValue> {
        Self::print_value(cx.global(), value.to_js(), None)
    }

    #[optimize(size)]
    pub(crate) fn print_expected(cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<JSValue> {
        Self::print_value(cx.global(), value.to_js(), Some("<green>"))
    }

    #[optimize(size)]
    pub(crate) fn print_received(cx: &mut JsScope<'_>, value: JsLocal<'_>) -> JsResult<JSValue> {
        Self::print_value(cx.global(), value.to_js(), Some("<red>"))
    }

    #[optimize(size)]
    fn color_text(global_this: &JSGlobalObject, texts: &[JsLocal<'_>], color: HintColor) -> JsResult<JSValue> {
        let mut text: Vec<u8> = Vec::new();
        for (i, argument) in texts.iter().enumerate() {
            if i > 0 {
                text.push(b' ');
            }
            text.extend_from_slice(argument.to_js().to_bun_string(global_this)?.to_utf8().slice());
        }
        let mut out: Vec<u8> = Vec::new();
        color.paint(&mut out, &text);
        bun_string_jsc::create_utf8_for_js(global_this, &out)
    }

    pub(crate) fn expected_color(cx: &mut JsScope<'_>, texts: &[JsLocal<'_>]) -> JsResult<JSValue> {
        Self::color_text(cx.global(), texts, HintColor::Expected)
    }

    pub(crate) fn received_color(cx: &mut JsScope<'_>, texts: &[JsLocal<'_>]) -> JsResult<JSValue> {
        Self::color_text(cx.global(), texts, HintColor::Received)
    }

    /// Mirrors `getType` in @jest/get-type.
    #[optimize(size)]
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

    #[optimize(size)]
    pub(crate) fn print_with_type(
        cx: &mut JsScope<'_>,
        name: JsLocal<'_>,
        value: JsLocal<'_>,
        print: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global_this = cx.global();
        let (value, print) = (value.to_js(), print.to_js());
        let name = name.to_js().to_bun_string(global_this)?;
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

    /// Like `diff` in jest-matcher-utils, returns `null` when a diff would add nothing to printing the two values.
    #[optimize(size)]
    pub(crate) fn diff(cx: &mut JsScope<'_>, expected: JsLocal<'_>, received: JsLocal<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        let (expected, received) = (expected.to_js(), received.to_js());
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
        let (expected, received) = (expected.to_bun_string(global_this)?, received.to_bun_string(global_this)?);
        let (expected, received) = (expected.to_utf8(), received.to_utf8());
        Self::diff_text(global_this, &DiffFormatter::from_strings(received.slice(), expected.slice(), false))
    }

    #[optimize(size)]
    fn diff_text(global_this: &JSGlobalObject, formatter: &DiffFormatter<'_>) -> JsResult<JSValue> {
        if formatter.received_string == formatter.expected_string {
            let mut out: Vec<u8> = Vec::new();
            HintColor::Dim.paint(&mut out, NO_VISUAL_DIFFERENCE);
            return bun_string_jsc::create_utf8_for_js(global_this, &out);
        }
        bun_string_jsc::create_utf8_for_js(global_this, format!("{formatter}").as_bytes())
    }

    #[optimize(size)]
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

    #[optimize(size)]
    pub(crate) fn matcher_hint(cx: &mut JsScope<'_>, arguments: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let global_this = cx.global();
        let arguments = JsLocal::to_js_slice(arguments);
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
        // Like Jest, buffer adjacent dim text and paint it as one span.
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
            // Jest's old format, where the name includes its own dots, e.g. ".not.toBeFoo".
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

pub(crate) struct ExpectTypeOf {}

impl ExpectTypeOf {
    pub(crate) fn type_assertion(&self) {}

    pub(crate) fn type_step<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, Self> {
        ExpectTypeOf {}.into_js(heap)
    }

    pub(crate) fn get_type_property<'a>(&self, heap: &JsHeap<'a>) -> JsWrapper<'a, Self> {
        ExpectTypeOf {}.into_js(heap)
    }

    pub(crate) fn constructor<'a>(heap: &JsHeap<'a>) -> bindgen::Result<'a, Self> {
        Err(heap.error(format_args!("expectTypeOf() cannot be called with new")))
    }

    pub(crate) fn call<'a>(heap: &JsHeap<'a>) -> JsWrapper<'a, Self> {
        ExpectTypeOf {}.into_js(heap)
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
        // C++: `Bun::NativeFunctionPtr`. Rust's `JSHostFn` is already the pointer type, so no extra `*const`.
        function_pointer: bun_jsc::JSHostFn,
        wrapped_fn: JSValue,
    ) -> JSValue;
    fn Bun__JSWrappingFunction__getWrappedFunction(this: JSValue, global_this: *const JSGlobalObject) -> JSValue;

    fn ExpectMatcherUtils__getSingleton(global_this: *const JSGlobalObject) -> JSValue;

    safe fn ExpectStringMatching__compile(global: &JSGlobalObject, source: JSValue) -> JSValue;

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
