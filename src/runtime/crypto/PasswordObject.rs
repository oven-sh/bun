use core::fmt;
use core::fmt::Write as _;
use std::io::Write as _;

use bun_core::EncodedSlice;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope};
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_jsc::{JSPromise, JSPromiseStrong};

use crate::generated_bindgen::password_object::{
    PasswordCost, PasswordHashAlgorithm, PasswordHashOptions,
};

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
pub(crate) enum Algorithm {
    Argon2i,
    Argon2d,
    Argon2id,
    Bcrypt,
}

#[derive(Copy, Clone)]
pub(crate) enum AlgorithmValue {
    Argon2i(Argon2Params),
    Argon2d(Argon2Params),
    Argon2id(Argon2Params),
    /// bcrypt only accepts "cost"
    Bcrypt(u8),
}

impl AlgorithmValue {
    pub(crate) const BCRYPT_DEFAULT: u8 = 10;

    pub(crate) const DEFAULT: AlgorithmValue = AlgorithmValue::Argon2id(Argon2Params::DEFAULT);

    fn with_defaults(algorithm: Algorithm) -> AlgorithmValue {
        match algorithm {
            Algorithm::Bcrypt => AlgorithmValue::Bcrypt(AlgorithmValue::BCRYPT_DEFAULT),
            Algorithm::Argon2id => AlgorithmValue::Argon2id(Argon2Params::DEFAULT),
            Algorithm::Argon2d => AlgorithmValue::Argon2d(Argon2Params::DEFAULT),
            Algorithm::Argon2i => AlgorithmValue::Argon2i(Argon2Params::DEFAULT),
        }
    }

    fn from_argument<'a>(
        heap: &JsHeap<'a>,
        algorithm: PasswordHashAlgorithm<'a>,
    ) -> bindgen::Result<'a, AlgorithmValue> {
        match algorithm {
            PasswordHashAlgorithm::Missing => Ok(AlgorithmValue::DEFAULT),
            PasswordHashAlgorithm::Label(label) => {
                Algorithm::from_label(heap, "hash", &label.to_utf8()).map(Self::with_defaults)
            }
            PasswordHashAlgorithm::Options(options) => Self::from_options(heap, &options),
        }
    }

    fn from_options<'a>(
        heap: &JsHeap<'a>,
        options: &PasswordHashOptions<'a>,
    ) -> bindgen::Result<'a, AlgorithmValue> {
        let Some(label) = options.algorithm.filter(|label| !label.is_empty()) else {
            return Err(invalid_argument_type(
                heap,
                "hash",
                "options.algorithm",
                "string",
            ));
        };
        let invalid = |message: &str| heap.invalid_arguments(format_args!("{message}"));

        let algorithm = Algorithm::from_label(heap, "hash", label)?;
        if let Algorithm::Bcrypt = algorithm {
            let Some(rounds) = cost(heap, &options.cost, "cost")? else {
                return Ok(Self::with_defaults(algorithm));
            };
            if rounds.fract() != 0.0 || !(4.0..=31.0).contains(&rounds) {
                return Err(invalid("Rounds must be an integer between 4 and 31"));
            }
            return Ok(AlgorithmValue::Bcrypt(rounds as u8));
        }

        let mut argon = Argon2Params::DEFAULT;
        if let Some(time_cost) = cost(heap, &options.time_cost, "timeCost")? {
            if time_cost < 1.0 || time_cost.is_nan() {
                return Err(invalid("Time cost must be greater than 0"));
            }
            if time_cost.fract() != 0.0 || time_cost > f64::from(u32::MAX) {
                return Err(invalid(
                    "Time cost must be an integer between 1 and 4294967295",
                ));
            }
            argon.time_cost = time_cost as u32;
        }
        if let Some(memory_cost) = cost(heap, &options.memory_cost, "memoryCost")? {
            // argon2 requires `memoryCost >= 8 * parallelism`; Bun hard-codes `parallelism = 1` (see
            // `Argon2Params::to_params`), so the floor is 8.
            if memory_cost < 8.0 || memory_cost.is_nan() {
                return Err(invalid("Memory cost must be at least 8"));
            }
            if memory_cost.fract() != 0.0 || memory_cost > f64::from(u32::MAX) {
                return Err(invalid(
                    "Memory cost must be an integer between 8 and 4294967295",
                ));
            }
            argon.memory_cost = memory_cost as u32;
        }
        Ok(match algorithm {
            Algorithm::Argon2id => AlgorithmValue::Argon2id(argon),
            Algorithm::Argon2d => AlgorithmValue::Argon2d(argon),
            Algorithm::Argon2i => AlgorithmValue::Argon2i(argon),
            Algorithm::Bcrypt => unreachable!(),
        })
    }
}

fn invalid_argument_type<'a>(
    heap: &JsHeap<'a>,
    function: &str,
    field: &str,
    typename: &str,
) -> bindgen::Error<'a> {
    heap.invalid_arguments(format_args!(
        "Expected {field} to be a {typename} for '{function}'."
    ))
}

/// `None` for `undefined`, `null` and `""`.
fn cost<'a>(
    heap: &JsHeap<'a>,
    value: &PasswordCost,
    name: &str,
) -> bindgen::Result<'a, Option<f64>> {
    match value {
        PasswordCost::Missing => Ok(None),
        PasswordCost::Text(text) if text.is_empty() => Ok(None),
        PasswordCost::Number(number) => Ok(Some(*number)),
        _ => Err(invalid_argument_type(heap, "hash", name, "number")),
    }
}

impl Algorithm {
    fn from_label<'a>(
        heap: &JsHeap<'a>,
        function: &str,
        label: &[u8],
    ) -> bindgen::Result<'a, Algorithm> {
        match label {
            b"argon2i" => Ok(Algorithm::Argon2i),
            b"argon2d" => Ok(Algorithm::Argon2d),
            b"argon2id" => Ok(Algorithm::Argon2id),
            b"bcrypt" => Ok(Algorithm::Bcrypt),
            _ => Err(invalid_argument_type(
                heap,
                function,
                "algorithm",
                UNKNOWN_PASSWORD_ALGORITHM_MESSAGE,
            )),
        }
    }
}

#[derive(Copy, Clone)]
pub(crate) struct Argon2Params {
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

impl Algorithm {
    pub(crate) fn get(pw: &[u8]) -> Option<Algorithm> {
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
// Bun.password
// ───────────────────────────────────────────────────────────────────────────

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

// ─── PasswordOp: generic hash/verify off-thread job ───────────────────────
//
// Hash and verify jobs differ only in (a) extra input fields, (b) success
// payload type + JS conversion, (c) the verb in the error message. Collapse
// both into one `PasswordJob<Op>` / `PasswordResult<Op>` parameterised on a
// `PasswordOp` carrying exactly those three axes.

/// A copy of a password or a hash, zeroed before it is freed.
struct Sensitive(Box<[u8]>);

impl From<Vec<u8>> for Sensitive {
    fn from(bytes: Vec<u8>) -> Self {
        Self(bytes.into_boxed_slice())
    }
}

impl core::ops::Deref for Sensitive {
    type Target = [u8];
    fn deref(&self) -> &[u8] {
        &self.0
    }
}

impl Drop for Sensitive {
    fn drop(&mut self) {
        bun_alloc::free_sensitive(core::mem::take(&mut self.0));
    }
}

pub(crate) trait PasswordOp: Send + 'static {
    /// Success payload (`Box<[u8]>` for hash, `bool` for verify).
    type Value: Send;
    /// "hashing" | "verification" — slotted into the JS Error message.
    const ERR_VERB: &'static str;
    /// Off-thread compute. `self` borrows the op so its inputs stay owned by
    /// the job.
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
    prev_hash: Sensitive,
    algorithm: Option<Algorithm>,
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

fn password_error<'a>(heap: &JsHeap<'a>, err: &HashError, verb: &str) -> bindgen::Error<'a> {
    // SAFETY: it makes an `Error` and a string, and defines `code`.
    let global = unsafe { heap.global() };
    bindgen::Error::from_value(JsLocal::new(
        heap,
        password_error_instance(err, verb, global),
    ))
}

/// `Bun.password.hash/verify` off the JS thread: the op and the password are
/// owned copies; the promise is the JS side.
struct PasswordJob<Op: PasswordOp> {
    op: Op,
    password: Sensitive,
    value: Option<Result<Op::Value, HashError>>,
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

/// Boxes a `PasswordJob<Op>`, refs the loop, and schedules it.
fn schedule<Op: PasswordOp>(cx: &bun_jsc::JsThread<'_>, password: Sensitive, op: Op) -> JSValue {
    debug_assert!(!password.is_empty()); // caller must check

    let promise = JSPromiseStrong::init(cx.global());
    let promise_value = promise.value();
    bun_jsc::Job::<PasswordJob<Op>>::schedule(
        cx,
        PasswordJob {
            op,
            password,
            value: None,
        },
        promise,
    );
    promise_value
}

const EMPTY_PASSWORD: &str = "password must not be empty";

pub(crate) fn hash<'a>(
    cx: &mut JsScope<'a>,
    password: Vec<u8>,
    algorithm: PasswordHashAlgorithm<'a>,
) -> bindgen::Result<'a, JSValue> {
    let password = Sensitive::from(password);
    let algorithm = AlgorithmValue::from_argument(&cx.heap, algorithm)?;
    if password.is_empty() {
        return Err(cx.heap.invalid_arguments(format_args!("{EMPTY_PASSWORD}")));
    }

    Ok(schedule(&cx.js_thread(), password, HashOp { algorithm }))
}

pub(crate) fn hash_sync<'a>(
    heap: &JsHeap<'a>,
    password: &[u8],
    algorithm: PasswordHashAlgorithm<'a>,
) -> bindgen::Result<'a, Box<[u8]>> {
    let algorithm = AlgorithmValue::from_argument(heap, algorithm)?;
    if password.is_empty() {
        return Err(heap.invalid_arguments(format_args!("{EMPTY_PASSWORD}")));
    }
    PasswordObject::hash(password, algorithm)
        .map_err(|err| password_error(heap, &err, HashOp::ERR_VERB))
}

fn verify_algorithm<'a>(
    heap: &JsHeap<'a>,
    label: Option<&[u8]>,
) -> bindgen::Result<'a, Option<Algorithm>> {
    label
        .map(|label| Algorithm::from_label(heap, "verify", label))
        .transpose()
}

pub(crate) fn verify<'a>(
    cx: &mut JsScope<'a>,
    password: Vec<u8>,
    prev_hash: Vec<u8>,
    algorithm: Option<&'a [u8]>,
) -> bindgen::Result<'a, JSValue> {
    let password = Sensitive::from(password);
    let prev_hash = Sensitive::from(prev_hash);
    let algorithm = verify_algorithm(&cx.heap, algorithm)?;
    if prev_hash.is_empty() || password.is_empty() {
        return Ok(JSPromise::resolved_promise_value(
            cx.global(),
            JSValue::FALSE,
        ));
    }

    Ok(schedule(
        &cx.js_thread(),
        password,
        VerifyOp {
            prev_hash,
            algorithm,
        },
    ))
}

pub(crate) fn verify_sync<'a>(
    heap: &JsHeap<'a>,
    password: &[u8],
    hash: &[u8],
    algorithm: Option<&'a [u8]>,
) -> bindgen::Result<'a, bool> {
    let algorithm = verify_algorithm(heap, algorithm)?;
    if hash.is_empty() || password.is_empty() {
        return Ok(false);
    }
    PasswordObject::verify(password, hash, algorithm)
        .map_err(|err| password_error(heap, &err, VerifyOp::ERR_VERB))
}

const UNKNOWN_PASSWORD_ALGORITHM_MESSAGE: &str = "unknown algorithm, expected one of: \"bcrypt\", \"argon2id\", \"argon2d\", \"argon2i\" (default is \"argon2id\")";
