use core::fmt;
use core::fmt::Write as _;
use std::io::Write as _;

use bun_core::EncodedSlice;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::{ArrayBuffer, CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult};
use bun_jsc::{JSPromise, JSPromiseStrong};

use crate::node::StringOrBuffer;

// The argon2/bcrypt API-surface shim lives at `crypto::pwhash` (this dir);
// the implementation is wired there, not here.
use super::pwhash;
use bun_sha_hmac::SHA512;

// ───────────────────────────────────────────────────────────────────────────
// PasswordObject
// ───────────────────────────────────────────────────────────────────────────

pub(crate) struct PasswordObject;

#[derive(Copy, Clone)]
#[repr(u8)]
pub enum Algorithm {
    Argon2i,
    Argon2d,
    Argon2id,
    Bcrypt,
}

#[derive(Copy, Clone)]
pub enum AlgorithmValue {
    Argon2i(Argon2Params),
    Argon2d(Argon2Params),
    Argon2id(Argon2Params),
    /// bcrypt only accepts "cost"
    Bcrypt(u8),
}

impl AlgorithmValue {
    pub(crate) const BCRYPT_DEFAULT: u8 = 10;

    pub(crate) const DEFAULT: AlgorithmValue = AlgorithmValue::Argon2id(Argon2Params::DEFAULT);

    fn from_js(global_object: &JSGlobalObject, value: JSValue) -> JsResult<AlgorithmValue> {
        if value.is_object() {
            if let Some(algorithm_value) = value.get_truthy(global_object, "algorithm")? {
                if !algorithm_value.is_string() {
                    return Err(global_object.throw_invalid_argument_type(
                        "hash",
                        "algorithm",
                        "string",
                    ));
                }

                let algorithm_string = algorithm_value.to_js_string_view(global_object)?;

                let Some(algo) = algorithm_from_string(&algorithm_string) else {
                    return Err(global_object.throw_invalid_argument_type(
                        "hash",
                        "algorithm",
                        UNKNOWN_PASSWORD_ALGORITHM_MESSAGE,
                    ));
                };

                match algo {
                    Algorithm::Bcrypt => {
                        let mut algorithm = AlgorithmValue::Bcrypt(AlgorithmValue::BCRYPT_DEFAULT);

                        if let Some(rounds_value) = value.get_truthy(global_object, "cost")? {
                            if !rounds_value.is_number() {
                                return Err(global_object
                                    .throw_invalid_argument_type("hash", "cost", "number"));
                            }

                            // Range-check as f64: ToInt32 would wrap e.g. 2^32 + 4 to 4.
                            let rounds = rounds_value.as_number();

                            if rounds.fract() != 0.0 || !(4.0..=31.0).contains(&rounds) {
                                return Err(global_object.throw_invalid_arguments(format_args!(
                                    "Rounds must be an integer between 4 and 31"
                                )));
                            }

                            algorithm = AlgorithmValue::Bcrypt(rounds as u8);
                        }

                        return Ok(algorithm);
                    }
                    Algorithm::Argon2id | Algorithm::Argon2d | Algorithm::Argon2i => {
                        let mut argon = Argon2Params::default();

                        if let Some(time_value) = value.get_truthy(global_object, "timeCost")? {
                            if !time_value.is_number() {
                                return Err(global_object
                                    .throw_invalid_argument_type("hash", "timeCost", "number"));
                            }

                            let time_cost = time_value.as_number();

                            if time_cost < 1.0 || time_cost.is_nan() {
                                return Err(global_object.throw_invalid_arguments(format_args!(
                                    "Time cost must be greater than 0"
                                )));
                            }

                            if time_cost.fract() != 0.0 || time_cost > f64::from(u32::MAX) {
                                return Err(global_object.throw_invalid_arguments(format_args!(
                                    "Time cost must be an integer between 1 and 4294967295"
                                )));
                            }

                            argon.time_cost = time_cost as u32;
                        }

                        if let Some(memory_value) = value.get_truthy(global_object, "memoryCost")? {
                            if !memory_value.is_number() {
                                return Err(global_object.throw_invalid_argument_type(
                                    "hash",
                                    "memoryCost",
                                    "number",
                                ));
                            }

                            let memory_cost = memory_value.as_number();

                            // argon2 requires `memoryCost >= 8 * parallelism`;
                            // Bun hard-codes `parallelism = 1` (see
                            // `Argon2Params::to_params`), so the floor is 8.
                            if memory_cost < 8.0 || memory_cost.is_nan() {
                                return Err(global_object.throw_invalid_arguments(format_args!(
                                    "Memory cost must be at least 8"
                                )));
                            }

                            if memory_cost.fract() != 0.0 || memory_cost > f64::from(u32::MAX) {
                                return Err(global_object.throw_invalid_arguments(format_args!(
                                    "Memory cost must be an integer between 8 and 4294967295"
                                )));
                            }

                            argon.memory_cost = memory_cost as u32;
                        }

                        return Ok(match algo {
                            Algorithm::Argon2id => AlgorithmValue::Argon2id(argon),
                            Algorithm::Argon2d => AlgorithmValue::Argon2d(argon),
                            Algorithm::Argon2i => AlgorithmValue::Argon2i(argon),
                            Algorithm::Bcrypt => unreachable!(),
                        });
                    }
                }
            } else {
                return Err(global_object.throw_invalid_argument_type(
                    "hash",
                    "options.algorithm",
                    "string",
                ));
            }
        } else if value.is_string() {
            let algorithm_string = value.to_js_string_view(global_object)?;

            let Some(algo) = algorithm_from_string(&algorithm_string) else {
                return Err(global_object.throw_invalid_argument_type(
                    "hash",
                    "algorithm",
                    UNKNOWN_PASSWORD_ALGORITHM_MESSAGE,
                ));
            };

            match algo {
                Algorithm::Bcrypt => {
                    return Ok(AlgorithmValue::Bcrypt(AlgorithmValue::BCRYPT_DEFAULT));
                }
                Algorithm::Argon2id => {
                    return Ok(AlgorithmValue::Argon2id(Argon2Params::default()));
                }
                Algorithm::Argon2d => {
                    return Ok(AlgorithmValue::Argon2d(Argon2Params::default()));
                }
                Algorithm::Argon2i => {
                    return Ok(AlgorithmValue::Argon2i(Argon2Params::default()));
                }
            }
        } else {
            return Err(global_object.throw_invalid_argument_type("hash", "algorithm", "string"));
        }
    }
}

fn algorithm_from_string(s: &bun_core::String) -> Option<Algorithm> {
    if s.eq_ascii(b"argon2i") {
        Some(Algorithm::Argon2i)
    } else if s.eq_ascii(b"argon2d") {
        Some(Algorithm::Argon2d)
    } else if s.eq_ascii(b"argon2id") {
        Some(Algorithm::Argon2id)
    } else if s.eq_ascii(b"bcrypt") {
        Some(Algorithm::Bcrypt)
    } else {
        None
    }
}

#[derive(Copy, Clone)]
pub struct Argon2Params {
    // we don't support the other options right now, but can add them later if someone asks
    pub(crate) memory_cost: u32,
    pub(crate) time_cost: u32,
}

impl Argon2Params {
    const DEFAULT: Argon2Params = Argon2Params {
        memory_cost: pwhash::argon2::Params::INTERACTIVE_2ID_M,
        time_cost: pwhash::argon2::Params::INTERACTIVE_2ID_T,
    };

    fn to_params(self) -> pwhash::argon2::Params {
        pwhash::argon2::Params {
            t: self.time_cost,
            m: self.memory_cost,
            p: 1,
        }
    }
}

impl Default for Argon2Params {
    fn default() -> Self {
        Self::DEFAULT
    }
}

impl Algorithm {
    pub fn get(pw: &[u8]) -> Option<Algorithm> {
        if pw[0] != b'$' {
            return None;
        }

        // PHC format looks like $<algorithm>$<params>$<salt>$<hash><optional stuff>
        if pw[1..].starts_with(b"argon2d$") {
            return Some(Algorithm::Argon2d);
        }
        if pw[1..].starts_with(b"argon2i$") {
            return Some(Algorithm::Argon2i);
        }
        if pw[1..].starts_with(b"argon2id$") {
            return Some(Algorithm::Argon2id);
        }

        if pw[1..].starts_with(b"bcrypt") {
            return Some(Algorithm::Bcrypt);
        }

        // https://en.wikipedia.org/wiki/Crypt_(C)
        if pw[1..].starts_with(b"2") {
            return Some(Algorithm::Bcrypt);
        }

        None
    }
}

/// `crate::Error` (NonZeroU16 tag). The pwhash shim
/// must `impl From<pwhash::Error> for crate::Error`.
pub(crate) type HashError = crate::Error;

impl PasswordObject {
    // This is purposely simple because nobody asked to make it more complicated
    pub(crate) fn hash(password: &[u8], algorithm: AlgorithmValue) -> Result<Box<[u8]>, HashError> {
        match algorithm {
            AlgorithmValue::Argon2i(argon)
            | AlgorithmValue::Argon2d(argon)
            | AlgorithmValue::Argon2id(argon) => {
                let mut outbuf = [0u8; 4096];
                let hash_options = pwhash::argon2::HashOptions {
                    params: argon.to_params(),
                    // allocator dropped — global mimalloc
                    mode: match algorithm {
                        AlgorithmValue::Argon2i(_) => pwhash::argon2::Mode::Argon2i,
                        AlgorithmValue::Argon2d(_) => pwhash::argon2::Mode::Argon2d,
                        AlgorithmValue::Argon2id(_) => pwhash::argon2::Mode::Argon2id,
                        _ => unreachable!(),
                    },
                    encoding: pwhash::Encoding::Phc,
                };
                // warning: argon2's code may spin up threads if paralellism is set to > 0
                // we don't expose this option
                // but since it parses from phc format, it's possible that it will be set
                // eventually we should do something that about that.
                let out_bytes = pwhash::argon2::str_hash(password, hash_options, &mut outbuf)?;
                Ok(Box::<[u8]>::from(out_bytes))
            }
            AlgorithmValue::Bcrypt(cost) => {
                let mut outbuf = [0u8; 4096];
                // bcrypt silently truncates passwords longer than 72 bytes
                // we use SHA512 to hash the password if it's longer than 72 bytes
                // The digest gets its own 64-byte buffer
                // (SHA512::final wants `&mut [u8; DIGEST]`).
                let mut digest = [0u8; SHA512::DIGEST];
                let mut password_to_use = password;
                let outbuf_slice: &mut [u8];
                if password.len() > 72 {
                    let mut sha_512 = SHA512::init();
                    sha_512.update(password);
                    sha_512.r#final(&mut digest);
                    password_to_use = &digest;
                    outbuf_slice = &mut outbuf[SHA512::DIGEST..];
                } else {
                    outbuf_slice = &mut outbuf[..];
                }

                let hash_options = pwhash::bcrypt::HashOptions {
                    params: pwhash::bcrypt::Params {
                        rounds_log: cost,
                        silently_truncate_password: true,
                    },
                    // allocator dropped
                    encoding: pwhash::Encoding::Crypt,
                };
                let out_bytes =
                    pwhash::bcrypt::str_hash(password_to_use, hash_options, outbuf_slice)?;
                Ok(Box::<[u8]>::from(out_bytes))
            }
        }
    }

    pub(crate) fn verify(
        password: &[u8],
        previous_hash: &[u8],
        algorithm: Option<Algorithm>,
    ) -> Result<bool, HashError> {
        if previous_hash.is_empty() {
            return Ok(false);
        }

        let algo = match algorithm.or_else(|| Algorithm::get(previous_hash)) {
            Some(a) => a,
            None => return Err(crate::Error::UnsupportedAlgorithm),
        };

        Self::verify_with_algorithm(password, previous_hash, algo)
    }

    pub(crate) fn verify_with_algorithm(
        password: &[u8],
        previous_hash: &[u8],
        algorithm: Algorithm,
    ) -> Result<bool, HashError> {
        match algorithm {
            Algorithm::Argon2id | Algorithm::Argon2d | Algorithm::Argon2i => {
                match pwhash::argon2::str_verify(previous_hash, password, Default::default()) {
                    Ok(()) => Ok(true),
                    Err(crate::Error::PasswordVerificationFailed) => Ok(false),
                    Err(err) => Err(err),
                }
            }
            Algorithm::Bcrypt => {
                let mut password_to_use = password;
                let mut outbuf = [0u8; SHA512::DIGEST];

                // bcrypt silently truncates passwords longer than 72 bytes
                // we use SHA512 to hash the password if it's longer than 72 bytes
                if password.len() > 72 {
                    let mut sha_512 = SHA512::init();
                    sha_512.update(password);
                    sha_512.r#final(&mut outbuf);
                    password_to_use = &outbuf;
                }
                match pwhash::bcrypt::str_verify(
                    previous_hash,
                    password_to_use,
                    pwhash::bcrypt::VerifyOptions {
                        silently_truncate_password: true,
                    },
                ) {
                    Ok(()) => Ok(true),
                    Err(crate::Error::PasswordVerificationFailed) => Ok(false),
                    Err(err) => Err(err),
                }
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// JSPasswordObject
// ───────────────────────────────────────────────────────────────────────────

pub(crate) struct JSPasswordObject;

struct PascalToUpperUnderscoreCaseFormatter<'a> {
    input: &'a [u8],
}

impl fmt::Display for PascalToUpperUnderscoreCaseFormatter<'_> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        for &c in self.input {
            if c.is_ascii_uppercase() {
                writer.write_str("_")?;
                writer.write_char(c as char)?;
            } else if c.is_ascii_lowercase() {
                writer.write_char(c.to_ascii_uppercase() as char)?;
            } else {
                writer.write_char(c as char)?;
            }
        }
        Ok(())
    }
}

#[unsafe(no_mangle)]
extern "C" fn JSPasswordObject__create(global_object: &JSGlobalObject) -> JSValue {
    let object = JSValue::create_empty_object(global_object, 4);
    // `#[bun_jsc::host_fn]` emits an `extern "C"` shim named
    // `__jsc_host_<fn>`; pass that (not the safe Rust fn) to JSFunction.
    object.put(
        global_object,
        b"hash",
        JSFunction::create(
            global_object,
            "hash",
            __jsc_host_js_password_object_hash,
            2,
            Default::default(),
        ),
    );
    object.put(
        global_object,
        b"hashSync",
        JSFunction::create(
            global_object,
            "hashSync",
            __jsc_host_js_password_object_hash_sync,
            2,
            Default::default(),
        ),
    );
    object.put(
        global_object,
        b"verify",
        JSFunction::create(
            global_object,
            "verify",
            __jsc_host_js_password_object_verify,
            2,
            Default::default(),
        ),
    );
    object.put(
        global_object,
        b"verifySync",
        JSFunction::create(
            global_object,
            "verifySync",
            __jsc_host_js_password_object_verify_sync,
            2,
            Default::default(),
        ),
    );
    object
}

// ─── PasswordOp: generic hash/verify off-thread job ───────────────────────
//
// Hash and verify jobs differ only in (a) extra input fields, (b) success
// payload type + JS conversion, (c) the verb in the error message. Collapse
// both into one `PasswordJob<Op>` / `PasswordResult<Op>` parameterised on a
// `PasswordOp` carrying exactly those three axes.

pub(crate) trait PasswordOp: Send + 'static {
    /// Success payload (`Box<[u8]>` for hash, `bool` for verify).
    type Value: Send;
    /// "hashing" | "verification" — slotted into the JS Error message.
    const ERR_VERB: &'static str;
    /// Off-thread compute. `self` borrows the op so its inputs stay owned by
    /// the job and are `free_sensitive`d in the job's / op's `Drop`.
    fn compute(&self, password: &[u8]) -> Result<Self::Value, HashError>;
    /// Convert the success payload to a `JSValue` on the JS thread.
    fn to_js(value: Self::Value, g: &JSGlobalObject) -> JSValue;
}

pub(crate) struct HashOp {
    algorithm: AlgorithmValue,
}
impl PasswordOp for HashOp {
    type Value = Box<[u8]>;
    const ERR_VERB: &'static str = "hashing";
    fn compute(&self, password: &[u8]) -> Result<Box<[u8]>, HashError> {
        PasswordObject::hash(password, self.algorithm)
    }
    fn to_js(value: Box<[u8]>, g: &JSGlobalObject) -> JSValue {
        // PHC / bcrypt output is ASCII.
        EncodedSlice::latin1(&value).to_js(g)
        // `value` drops here.
    }
}

pub(crate) struct VerifyOp {
    prev_hash: Box<[u8]>,
    algorithm: Option<Algorithm>,
}
impl Drop for VerifyOp {
    fn drop(&mut self) {
        // bun.freeSensitive — volatile-zero then free; the job's Drop handles
        // `password`, this handles the op-specific `prev_hash`.
        bun_alloc::free_sensitive(core::mem::take(&mut self.prev_hash));
    }
}
impl PasswordOp for VerifyOp {
    type Value = bool;
    const ERR_VERB: &'static str = "verification";
    fn compute(&self, password: &[u8]) -> Result<bool, HashError> {
        PasswordObject::verify(password, &self.prev_hash, self.algorithm)
    }
    fn to_js(value: bool, _g: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(value)
    }
}

/// Build the JS `Error` instance for a failed hash/verify, with `code` set
/// to `PASSWORD_<SCREAMING_SNAKE_ERROR_NAME>`.
fn password_error_instance(err: &HashError, verb: &str, g: &JSGlobalObject) -> JSValue {
    let mut error_code: Vec<u8> = Vec::new();
    write!(
        &mut error_code,
        "PASSWORD{}",
        PascalToUpperUnderscoreCaseFormatter {
            input: err.name().as_bytes()
        }
    )
    .expect("unreachable"); // bun.handleOom
    let instance = g.create_error_instance(format_args!(
        "Password {verb} failed with error \"{}\"",
        err.name()
    ));
    instance.put(g, b"code", EncodedSlice::latin1(&error_code).to_js(g));
    instance
}

/// `Bun.password.hash/verify` off the JS thread: the op and the password are
/// owned copies (zeroed on drop); the promise is the JS side.
struct PasswordJob<Op: PasswordOp> {
    op: Op,
    password: Box<[u8]>,
    value: Option<Result<Op::Value, HashError>>,
}

impl<Op: PasswordOp> Drop for PasswordJob<Op> {
    fn drop(&mut self) {
        // bun.freeSensitive — volatile-zero the buffer then free; take the Box so
        // the field's own Drop sees an empty slice afterwards. Any op-owned
        // sensitive buffers (`prev_hash`) are freed by the op's own `Drop`.
        bun_alloc::free_sensitive(core::mem::take(&mut self.password));
    }
}

impl<Op: PasswordOp> bun_jsc::JobContext for PasswordJob<Op> {
    type OffThread = Self;
    type Js = JSPromiseStrong;
    fn run(this: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        this.value = Some(this.op.compute(&this.password));
        Some(done)
    }
    fn then(
        mut this: Self,
        mut promise: JSPromiseStrong,
        cx: &bun_jsc::JsThread<'_>,
    ) -> JsResult<()> {
        let global = cx.global();
        match this.value.take().expect("computed") {
            Err(err) => {
                let error_instance = password_error_instance(&err, Op::ERR_VERB, global);
                promise.reject_with_async_stack(global, Ok(error_instance))?;
            }
            Ok(v) => {
                let js = Op::to_js(v, global);
                promise.resolve(global, js)?;
            }
        }
        Ok(())
    }
}

// ─── hash / verify entry points ───────────────────────────────────────────

impl JSPasswordObject {
    /// Shared body of `hash`/`verify`: sync path computes inline and either
    /// throws or returns the converted value; async path boxes a
    /// `PasswordJob<Op>`, refs the loop, and schedules it.
    fn run<Op: PasswordOp, const SYNC: bool>(
        global_object: &JSGlobalObject,
        password: Box<[u8]>,
        op: Op,
    ) -> JsResult<JSValue> {
        debug_assert!(!password.is_empty()); // caller must check

        if SYNC {
            return match op.compute(&password) {
                Err(err) => {
                    let error_instance = password_error_instance(&err, Op::ERR_VERB, global_object);
                    Err(global_object.throw_value(error_instance))
                }
                Ok(v) => Ok(Op::to_js(v, global_object)),
            };
        }

        let promise = JSPromiseStrong::init(global_object);
        let promise_value = promise.value();
        bun_jsc::Job::<PasswordJob<Op>>::schedule(
            &global_object.js_thread(),
            PasswordJob {
                op,
                password,
                value: None,
            },
            promise,
        );
        Ok(promise_value)
    }

    pub(crate) fn hash<const SYNC: bool>(
        global_object: &JSGlobalObject,
        password: Box<[u8]>,
        algorithm: AlgorithmValue,
    ) -> JsResult<JSValue> {
        Self::run::<HashOp, SYNC>(global_object, password, HashOp { algorithm })
    }

    pub(crate) fn verify<const SYNC: bool>(
        global_object: &JSGlobalObject,
        password: Box<[u8]>,
        prev_hash: Box<[u8]>,
        algorithm: Option<Algorithm>,
    ) -> JsResult<JSValue> {
        Self::run::<VerifyOp, SYNC>(
            global_object,
            password,
            VerifyOp {
                prev_hash,
                algorithm,
            },
        )
    }
}

// ─── host functions ───────────────────────────────────────────────────────

// Once we have bindings generator, this should be replaced with a generated function
#[bun_jsc::host_fn]
fn js_password_object_hash(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments();

    if arguments.len() < 1 {
        return Err(global_object.throw_not_enough_arguments("hash", 1, 0));
    }

    let mut algorithm = AlgorithmValue::DEFAULT;

    if arguments.len() > 1 && !arguments[1].is_empty_or_undefined_or_null() {
        algorithm = AlgorithmValue::from_js(global_object, arguments[1])?;
    }

    let Some(string_or_buffer) = StringOrBuffer::from_js(global_object, arguments[0])? else {
        return Err(global_object.throw_invalid_argument_type(
            "hash",
            "password",
            "string or TypedArray",
        ));
    };

    if string_or_buffer.slice().is_empty() {
        return Err(
            global_object.throw_invalid_arguments(format_args!("password must not be empty"))
        );
    }

    JSPasswordObject::hash::<false>(
        global_object,
        Box::<[u8]>::from(string_or_buffer.slice()),
        algorithm,
    )
}

// Once we have bindings generator, this should be replaced with a generated function
#[bun_jsc::host_fn]
fn js_password_object_hash_sync(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments();

    if arguments.len() < 1 {
        return Err(global_object.throw_not_enough_arguments("hash", 1, 0));
    }

    let mut algorithm = AlgorithmValue::DEFAULT;

    if arguments.len() > 1 && !arguments[1].is_empty_or_undefined_or_null() {
        algorithm = AlgorithmValue::from_js(global_object, arguments[1])?;
    }

    let Some(string_or_buffer) = StringOrBuffer::from_js(global_object, arguments[0])? else {
        return Err(global_object.throw_invalid_argument_type(
            "hash",
            "password",
            "string or TypedArray",
        ));
    };

    if string_or_buffer.slice().is_empty() {
        return Err(
            global_object.throw_invalid_arguments(format_args!("password must not be empty"))
        );
    }

    // The sync path only needs `&[u8]`; copy into a Box to share the async
    // signature.
    JSPasswordObject::hash::<true>(
        global_object,
        Box::<[u8]>::from(string_or_buffer.slice()),
        algorithm,
    )
}

// ─── verify host functions ────────────────────────────────────────────────

// Once we have bindings generator, this should be replaced with a generated function
#[bun_jsc::host_fn]
fn js_password_object_verify(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments();

    if arguments.len() < 2 {
        return Err(global_object.throw_not_enough_arguments("verify", 2, 0));
    }

    let mut algorithm: Option<Algorithm> = None;

    if arguments.len() > 2 && !arguments[2].is_empty_or_undefined_or_null() {
        if !arguments[2].is_string() {
            return Err(global_object.throw_invalid_argument_type("verify", "algorithm", "string"));
        }

        let algorithm_string = arguments[2].to_js_string_view(global_object)?;

        let Some(a) = algorithm_from_string(&algorithm_string) else {
            return Err(global_object.throw_invalid_argument_type(
                "verify",
                "algorithm",
                UNKNOWN_PASSWORD_ALGORITHM_MESSAGE,
            ));
        };
        algorithm = Some(a);
    }

    let Some(password) = StringOrBuffer::from_js(global_object, arguments[0])? else {
        return Err(global_object.throw_invalid_argument_type(
            "verify",
            "password",
            "string or TypedArray",
        ));
    };

    let Some(hash_) = StringOrBuffer::from_js(global_object, arguments[1])? else {
        drop(password);
        return Err(global_object.throw_invalid_argument_type(
            "verify",
            "hash",
            "string or TypedArray",
        ));
    };

    if hash_.slice().is_empty() {
        return Ok(JSPromise::resolved_promise_value(
            global_object,
            JSValue::FALSE,
        ));
    }

    if password.slice().is_empty() {
        return Ok(JSPromise::resolved_promise_value(
            global_object,
            JSValue::FALSE,
        ));
    }

    JSPasswordObject::verify::<false>(
        global_object,
        Box::<[u8]>::from(password.slice()),
        Box::<[u8]>::from(hash_.slice()),
        algorithm,
    )
}

// Once we have bindings generator, this should be replaced with a generated function
#[bun_jsc::host_fn]
fn js_password_object_verify_sync(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments();

    if arguments.len() < 2 {
        return Err(global_object.throw_not_enough_arguments("verify", 2, 0));
    }

    let mut algorithm: Option<Algorithm> = None;

    if arguments.len() > 2 && !arguments[2].is_empty_or_undefined_or_null() {
        if !arguments[2].is_string() {
            return Err(global_object.throw_invalid_argument_type("verify", "algorithm", "string"));
        }

        let algorithm_string = arguments[2].to_js_string_view(global_object)?;

        let Some(a) = algorithm_from_string(&algorithm_string) else {
            return Err(global_object.throw_invalid_argument_type(
                "verify",
                "algorithm",
                UNKNOWN_PASSWORD_ALGORITHM_MESSAGE,
            ));
        };
        algorithm = Some(a);
    }

    let Some(mut password) = StringOrBuffer::from_js(global_object, arguments[0])? else {
        return Err(global_object.throw_invalid_argument_type(
            "verify",
            "password",
            "string or TypedArray",
        ));
    };

    let Some(hash_) = StringOrBuffer::from_js(global_object, arguments[1])? else {
        drop(password);
        return Err(global_object.throw_invalid_argument_type(
            "verify",
            "hash",
            "string or TypedArray",
        ));
    };

    if let StringOrBuffer::Buffer(buffer) = &mut password {
        buffer.buffer = ArrayBuffer::from_typed_array(global_object, buffer.buffer.value);
    }

    if hash_.slice().is_empty() {
        return Ok(JSValue::FALSE);
    }

    if password.slice().is_empty() {
        return Ok(JSValue::FALSE);
    }

    // The sync path only needs `&[u8]`; copy into Boxes to share the async
    // signature.
    JSPasswordObject::verify::<true>(
        global_object,
        Box::<[u8]>::from(password.slice()),
        Box::<[u8]>::from(hash_.slice()),
        algorithm,
    )
}

const UNKNOWN_PASSWORD_ALGORITHM_MESSAGE: &str = "unknown algorithm, expected one of: \"bcrypt\", \"argon2id\", \"argon2d\", \"argon2i\" (default is \"argon2id\")";
