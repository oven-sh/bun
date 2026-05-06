use core::fmt;
use core::fmt::Write as _;
use core::mem::offset_of;
use std::io::Write as _;

use bun_aio::KeepAlive;
use bun_jsc::{
    self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsError, JsResult, WorkPoolTask,
};
use bun_string::ZigString;
// `bun_jsc::{AnyTask, ConcurrentTask, EventLoop}` are *modules* (re-exported from
// `bun_event_loop`); pull the concrete types out by name.
use bun_jsc::event_loop::EventLoop;
// JSC-side ZigString carries `to_js` (the `bun_string::ZigString` repr-twin
// lives in `bun_jsc::zig_string`); used for ASCII→JS conversions only.
use bun_jsc::zig_string::ZigString as JscZigString;
use bun_jsc::AnyTask::{AnyTask, JsResult as AnyTaskJsResult};
use bun_jsc::ConcurrentTask::ConcurrentTask;
use bun_jsc::{JSPromise, JSPromiseStrong};
use bun_threading::thread_pool::Task as ThreadPoolTask;
use bun_threading::work_pool::WorkPool;

use crate::node::StringOrBuffer;

// std.crypto.pwhash — Zig stdlib argon2/bcrypt. API-surface shim lives at
// `crypto::pwhash` (this dir); vendor impl (Rust `argon2`/`bcrypt` crates or
// Zig-stdlib staticlib) is wired there, not here.
use super::pwhash;
use bun_sha_hmac::SHA512;

// ───────────────────────────────────────────────────────────────────────────
// PasswordObject
// ───────────────────────────────────────────────────────────────────────────

pub struct PasswordObject;

impl PasswordObject {
    // pub const pwhash = std.crypto.pwhash;  — re-export dropped; see `use` above.
}

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
#[repr(u8)]
pub enum Algorithm {
    #[strum(serialize = "argon2i")]
    Argon2i,
    #[strum(serialize = "argon2d")]
    Argon2d,
    #[strum(serialize = "argon2id")]
    Argon2id,
    #[strum(serialize = "bcrypt")]
    Bcrypt,
}

/// Zig: `Algorithm.Value = union(Algorithm)`
#[derive(Copy, Clone)]
pub enum AlgorithmValue {
    Argon2i(Argon2Params),
    Argon2d(Argon2Params),
    Argon2id(Argon2Params),
    /// bcrypt only accepts "cost"
    Bcrypt(u8), // Zig: u6
}

impl AlgorithmValue {
    pub const BCRYPT_DEFAULT: u8 = 10; // Zig name has typo `bcrpyt_default`; preserved as const

    pub const DEFAULT: AlgorithmValue = AlgorithmValue::Argon2id(Argon2Params::DEFAULT);

    pub fn from_js(global_object: &JSGlobalObject, value: JSValue) -> JsResult<AlgorithmValue> {
        if value.is_object() {
            if let Some(algorithm_value) = value.get_truthy(global_object, "algorithm")? {
                if !algorithm_value.is_string() {
                    return Err(global_object.throw_invalid_argument_type(
                        "hash",
                        "algorithm",
                        "string",
                    ));
                }

                let algorithm_string = algorithm_value.get_zig_string(global_object)?;

                // Zig: ComptimeStringMap.getWithEql(ZigString, ZigString.eqlComptime) —
                // ZigString may be UTF-16; compare each label via `eql_comptime`.
                let Some(algo) = algorithm_from_zig_string(&algorithm_string) else {
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

                            let rounds = rounds_value.coerce_to_i32(global_object)?;

                            if rounds < 4 || rounds > 31 {
                                return Err(global_object.throw_invalid_arguments(
                                    format_args!("Rounds must be between 4 and 31"),
                                ));
                            }

                            algorithm =
                                AlgorithmValue::Bcrypt(u8::try_from(rounds).unwrap() & 0x3F);
                            // Zig: @as(u6, @intCast(rounds))
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

                            let time_cost = time_value.coerce_to_i32(global_object)?;

                            if time_cost < 1 {
                                return Err(global_object.throw_invalid_arguments(format_args!(
                                    "Time cost must be greater than 0"
                                )));
                            }

                            argon.time_cost = u32::try_from(time_cost).unwrap();
                        }

                        if let Some(memory_value) =
                            value.get_truthy(global_object, "memoryCost")?
                        {
                            if !memory_value.is_number() {
                                return Err(global_object.throw_invalid_argument_type(
                                    "hash",
                                    "memoryCost",
                                    "number",
                                ));
                            }

                            let memory_cost = memory_value.coerce_to_i32(global_object)?;

                            if memory_cost < 1 {
                                return Err(global_object.throw_invalid_arguments(format_args!(
                                    "Memory cost must be greater than 0"
                                )));
                            }

                            argon.memory_cost = u32::try_from(memory_cost).unwrap();
                        }

                        // Zig: @unionInit(Algorithm.Value, @tagName(tag), argon)
                        return Ok(match algo {
                            Algorithm::Argon2id => AlgorithmValue::Argon2id(argon),
                            Algorithm::Argon2d => AlgorithmValue::Argon2d(argon),
                            Algorithm::Argon2i => AlgorithmValue::Argon2i(argon),
                            Algorithm::Bcrypt => unreachable!(),
                        });
                    }
                }
                #[allow(unreachable_code)]
                {
                    unreachable!()
                }
            } else {
                return Err(global_object.throw_invalid_argument_type(
                    "hash",
                    "options.algorithm",
                    "string",
                ));
            }
        } else if value.is_string() {
            let algorithm_string = value.get_zig_string(global_object)?;

            let Some(algo) = algorithm_from_zig_string(&algorithm_string) else {
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
        #[allow(unreachable_code)]
        {
            unreachable!()
        }
    }
}

/// Zig: `Algorithm.label.getWithEql(input, ZigString.eqlComptime)`.
/// `bun_string::ZigString` may be UTF-16 so a direct `phf` byte lookup is
/// unsound; compare each (4-entry) label via the encoding-aware `eql_comptime`.
fn algorithm_from_zig_string(s: &ZigString) -> Option<Algorithm> {
    if s.eql_comptime(b"argon2i") {
        Some(Algorithm::Argon2i)
    } else if s.eql_comptime(b"argon2d") {
        Some(Algorithm::Argon2d)
    } else if s.eql_comptime(b"argon2id") {
        Some(Algorithm::Argon2id)
    } else if s.eql_comptime(b"bcrypt") {
        Some(Algorithm::Bcrypt)
    } else {
        None
    }
}

/// JS-thread `EventLoopCtx` for `KeepAlive::ref_/unref`. Zig passed the
/// `*VirtualMachine` directly (anytype dispatch); the Rust split routes through
/// the aio hook registered by `crate::init()`.
#[inline]
fn vm_ctx() -> bun_aio::EventLoopCtx {
    bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js)
}

#[derive(Copy, Clone)]
pub struct Argon2Params {
    // we don't support the other options right now, but can add them later if someone asks
    pub memory_cost: u32,
    pub time_cost: u32,
}

impl Argon2Params {
    // TODO(port): pwhash.argon2.Params.interactive_2id.{m,t} — hard-code Zig stdlib's
    // values here once the pwhash shim is settled.
    pub const DEFAULT: Argon2Params = Argon2Params {
        memory_cost: pwhash::argon2::Params::INTERACTIVE_2ID_M,
        time_cost: pwhash::argon2::Params::INTERACTIVE_2ID_T,
    };

    pub fn to_params(self) -> pwhash::argon2::Params {
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
    pub const ARGON2: Algorithm = Algorithm::Argon2id;

    pub const LABEL: phf::Map<&'static [u8], Algorithm> = phf::phf_map! {
        b"argon2i" => Algorithm::Argon2i,
        b"argon2d" => Algorithm::Argon2d,
        b"argon2id" => Algorithm::Argon2id,
        b"bcrypt" => Algorithm::Bcrypt,
    };

    pub const DEFAULT: Algorithm = Algorithm::ARGON2;

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

/// Zig: `pub const HashError = pwhash.Error || error{UnsupportedAlgorithm};`
/// Phase A: collapse into bun_core::Error (NonZeroU16 tag). The pwhash shim
/// must `impl From<pwhash::Error> for bun_core::Error`.
pub type HashError = bun_core::Error;

impl PasswordObject {
    // This is purposely simple because nobody asked to make it more complicated
    pub fn hash(password: &[u8], algorithm: AlgorithmValue) -> Result<Box<[u8]>, HashError> {
        match algorithm {
            AlgorithmValue::Argon2i(argon)
            | AlgorithmValue::Argon2d(argon)
            | AlgorithmValue::Argon2id(argon) => {
                let mut outbuf = [0u8; 4096];
                let hash_options = pwhash::argon2::HashOptions {
                    params: argon.to_params(),
                    // allocator: dropped — global mimalloc
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
                // PORT NOTE: reshaped for borrowck — Zig aliased `outbuf` for both the
                // SHA digest and the remaining output slice; here the digest gets its own
                // 64-byte buffer (SHA512::final wants `&mut [u8; DIGEST]`).
                let mut digest = [0u8; SHA512::DIGEST];
                let mut password_to_use = password;
                let outbuf_slice: &mut [u8];
                if password.len() > 72 {
                    let mut sha_512 = SHA512::init();
                    sha_512.update(password);
                    sha_512.r#final(&mut digest);
                    // sha_512 dropped here (Zig: defer sha_512.deinit())
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
                    // allocator: dropped
                    encoding: pwhash::Encoding::Crypt,
                };
                let out_bytes =
                    pwhash::bcrypt::str_hash(password_to_use, hash_options, outbuf_slice)?;
                Ok(Box::<[u8]>::from(out_bytes))
            }
        }
    }

    pub fn verify(
        password: &[u8],
        previous_hash: &[u8],
        algorithm: Option<Algorithm>,
    ) -> Result<bool, HashError> {
        if previous_hash.is_empty() {
            return Ok(false);
        }

        let algo = match algorithm.or_else(|| Algorithm::get(previous_hash)) {
            Some(a) => a,
            None => return Err(bun_core::err!("UnsupportedAlgorithm")),
        };

        Self::verify_with_algorithm(password, previous_hash, algo)
    }

    pub fn verify_with_algorithm(
        password: &[u8],
        previous_hash: &[u8],
        algorithm: Algorithm,
    ) -> Result<bool, HashError> {
        match algorithm {
            Algorithm::Argon2id | Algorithm::Argon2d | Algorithm::Argon2i => {
                match pwhash::argon2::str_verify(previous_hash, password, Default::default()) {
                    Ok(()) => Ok(true),
                    Err(err) => {
                        if err == bun_core::err!("PasswordVerificationFailed") {
                            return Ok(false);
                        }
                        Err(err)
                    }
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
                    Err(err) => {
                        if err == bun_core::err!("PasswordVerificationFailed") {
                            return Ok(false);
                        }
                        Err(err)
                    }
                }
            }
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// JSPasswordObject
// ───────────────────────────────────────────────────────────────────────────

pub struct JSPasswordObject;

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
pub extern "C" fn JSPasswordObject__create(global_object: &JSGlobalObject) -> JSValue {
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

// ─── HashJob ──────────────────────────────────────────────────────────────

struct HashJob {
    algorithm: AlgorithmValue,
    password: Box<[u8]>,
    promise: JSPromiseStrong,
    event_loop: &'static EventLoop,
    global: *const JSGlobalObject,
    r#ref: KeepAlive,
    task: WorkPoolTask,
}

impl Drop for HashJob {
    fn drop(&mut self) {
        // promise: Drop on JSPromiseStrong handles deinit.
        // bun.freeSensitive — volatile-zero the buffer then free; take the Box so the
        // field's own Drop sees an empty slice afterwards.
        bun_alloc::free_sensitive(core::mem::take(&mut self.password));
    }
}

impl HashJob {
    pub fn new(init: HashJob) -> *mut HashJob {
        Box::into_raw(Box::new(init))
    }

    pub fn get_value(password: &[u8], algorithm: AlgorithmValue) -> HashResultValue {
        match PasswordObject::hash(password, algorithm) {
            Ok(value) => HashResultValue::Hash(value),
            Err(err) => HashResultValue::Err(err),
        }
    }

    pub fn run(task: *mut ThreadPoolTask) {
        // SAFETY: task points to HashJob.task; recover parent via offset_of.
        let this: *mut HashJob = unsafe {
            (task as *mut u8)
                .sub(offset_of!(HashJob, task))
                .cast::<HashJob>()
        };
        // SAFETY: `this` was produced by Box::into_raw in `HashJob::new` and is uniquely
        // owned by this thread-pool callback; no other alias exists until we drop it below.
        let this_ref = unsafe { &mut *this };

        let result = HashResult::new(HashResult {
            value: HashJob::get_value(&this_ref.password, this_ref.algorithm),
            task: AnyTask::default(), // overwritten below
            promise: core::mem::take(&mut this_ref.promise),
            global: this_ref.global,
            r#ref: core::mem::take(&mut this_ref.r#ref),
        });
        // this.promise = .empty — handled by mem::take above

        // SAFETY: `result` was just returned from Box::into_raw in `HashResult::new`;
        // not yet shared (enqueue happens after this write).
        unsafe {
            // Zig: `AnyTask.New(HashResult, run_from_js).init(result)` — construct directly
            // since Rust `New<T>` cannot carry a comptime callback param.
            (*result).task = AnyTask {
                ctx: Some(core::ptr::NonNull::new_unchecked(result).cast()),
                callback: HashResult::run_from_js_erased,
            };
        }
        // this.ref = .{} — handled by mem::take above
        this_ref.event_loop.enqueue_task_concurrent(
            // SAFETY: `result` is a valid Box::into_raw allocation; ownership transfers to
            // the event loop here. `task` is an intrusive field at a stable address.
            ConcurrentTask::create_from(unsafe { core::ptr::addr_of_mut!((*result).task) }),
        );
        // SAFETY: `this` came from Box::into_raw in `HashJob::new`; `this_ref` is no longer
        // used after this point. Drop runs secure_zero on the password.
        unsafe { drop(Box::from_raw(this)) };
    }
}

struct HashResult {
    value: HashResultValue,
    r#ref: KeepAlive,

    task: AnyTask,
    promise: JSPromiseStrong,
    global: *const JSGlobalObject,
}

impl HashResult {
    pub fn new(init: HashResult) -> *mut HashResult {
        Box::into_raw(Box::new(init))
    }

    /// Type-erased shim matching `AnyTask.callback`'s ABI; recovers `*mut Self`
    /// and forwards to `run_from_js`.
    fn run_from_js_erased(p: *mut core::ffi::c_void) -> AnyTaskJsResult<()> {
        Self::run_from_js(p.cast::<HashResult>()).map_err(|_| core::ptr::null_mut())
    }

    // TODO(port): bun.JSTerminated!void — confirm error type name in bun_jsc.
    pub fn run_from_js(this: *mut HashResult) -> Result<(), jsc::JsTerminated> {
        // SAFETY: `this` was produced by Box::into_raw and is uniquely owned here.
        let this_ref = unsafe { &mut *this };
        let promise = core::mem::take(&mut this_ref.promise);
        // defer promise.deinit() — Drop on JSPromiseStrong at scope exit.
        // SAFETY: global was stored from a live &JSGlobalObject; VM outlives the task.
        let global = unsafe { &*this_ref.global };
        this_ref.r#ref.unref(global.bun_vm());
        match core::mem::replace(&mut this_ref.value, HashResultValue::Err(Error::default())) {
            // TODO(port): the Zig leaves `value` in place and reads `this.value` again
            // for `toErrorInstance`; here we move it out once. Behaviour identical.
            HashResultValue::Err(err) => {
                let error_instance =
                    HashResultValue::Err(err).to_error_instance(global);
                // SAFETY: `this` came from Box::into_raw in `HashResult::new`; the event
                // loop hands sole ownership to this callback. `this_ref` is not used again.
                unsafe { drop(Box::from_raw(this)) };
                promise.reject_with_async_stack(global, error_instance)?;
            }
            HashResultValue::Hash(value) => {
                let js_string = ZigString::init(&value).to_js(global);
                drop(value); // Zig: defer bun.default_allocator.free(value)
                // SAFETY: `this` came from Box::into_raw in `HashResult::new`; the event
                // loop hands sole ownership to this callback. `this_ref` is not used again.
                unsafe { drop(Box::from_raw(this)) };
                promise.resolve(global, js_string)?;
            }
        }
        Ok(())
    }
}

enum HashResultValue {
    Err(HashError),
    Hash(Box<[u8]>),
}

impl HashResultValue {
    pub fn to_error_instance(&self, global_object: &JSGlobalObject) -> JSValue {
        let HashResultValue::Err(err) = self else {
            unreachable!()
        };
        let mut error_code: Vec<u8> = Vec::new();
        write!(
            &mut error_code,
            "PASSWORD{}",
            PascalToUpperUnderscoreCaseFormatter {
                input: err.name().as_bytes()
            }
        )
        .expect("unreachable"); // bun.handleOom
        let instance = global_object.create_error_instance(format_args!(
            "Password hashing failed with error \"{}\"",
            err.name()
        ));
        instance.put(
            global_object,
            ZigString::static_("code"),
            ZigString::init(&error_code).to_js(global_object),
        );
        instance
    }
}

// ─── hash / verify entry points ───────────────────────────────────────────

impl JSPasswordObject {
    pub fn hash<const SYNC: bool>(
        global_object: &JSGlobalObject,
        password: Box<[u8]>,
        algorithm: AlgorithmValue,
    ) -> JsResult<JSValue> {
        debug_assert!(!password.is_empty()); // caller must check

        if SYNC {
            let value = HashJob::get_value(&password, algorithm);
            match value {
                HashResultValue::Err(_) => {
                    let error_instance = value.to_error_instance(global_object);
                    return global_object.throw_value(error_instance);
                }
                HashResultValue::Hash(h) => {
                    let js = ZigString::init(&h).to_js(global_object);
                    return Ok(js);
                }
            }
            #[allow(unreachable_code)]
            {
                unreachable!()
            }
        }

        let promise = JSPromiseStrong::init(global_object);
        let promise_value = promise.value();

        let job = HashJob::new(HashJob {
            algorithm,
            password,
            promise,
            event_loop: global_object.bun_vm().event_loop(),
            global: global_object as *const _,
            r#ref: KeepAlive::default(),
            task: WorkPoolTask {
                callback: HashJob::run,
            },
        });
        // SAFETY: `job` was just returned from Box::into_raw in `HashJob::new`; not yet
        // shared with the work pool.
        unsafe { (*job).r#ref.r#ref(global_object.bun_vm()) };
        // SAFETY: `job` is a valid Box::into_raw allocation; ownership transfers to the
        // work pool here. `task` is an intrusive field at a stable address.
        WorkPool::schedule(unsafe { &mut (*job).task });

        Ok(promise_value)
    }

    pub fn verify<const SYNC: bool>(
        global_object: &JSGlobalObject,
        password: Box<[u8]>,
        prev_hash: Box<[u8]>,
        algorithm: Option<Algorithm>,
    ) -> JsResult<JSValue> {
        debug_assert!(!password.is_empty()); // caller must check

        if SYNC {
            let value = VerifyJob::get_value(&password, &prev_hash, algorithm);
            match value {
                VerifyResultValue::Err(_) => {
                    let error_instance = value.to_error_instance(global_object);
                    return global_object.throw_value(error_instance);
                }
                VerifyResultValue::Pass(pass) => {
                    return Ok(JSValue::from(pass));
                }
            }
            #[allow(unreachable_code)]
            {
                unreachable!()
            }
        }

        let promise = JSPromiseStrong::init(global_object);
        let promise_value = promise.value();

        let job = VerifyJob::new(VerifyJob {
            algorithm,
            password,
            prev_hash,
            promise,
            event_loop: global_object.bun_vm().event_loop(),
            global: global_object as *const _,
            r#ref: KeepAlive::default(),
            task: WorkPoolTask {
                callback: VerifyJob::run,
            },
        });
        // SAFETY: `job` was just returned from Box::into_raw in `VerifyJob::new`; not yet
        // shared with the work pool.
        unsafe { (*job).r#ref.r#ref(global_object.bun_vm()) };
        // SAFETY: `job` is a valid Box::into_raw allocation; ownership transfers to the
        // work pool here. `task` is an intrusive field at a stable address.
        WorkPool::schedule(unsafe { &mut (*job).task });

        Ok(promise_value)
    }
}

// ─── host functions ───────────────────────────────────────────────────────

// Once we have bindings generator, this should be replaced with a generated function
#[bun_jsc::host_fn]
pub fn js_password_object_hash(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old(2);
    let arguments = &arguments_.ptr[..arguments_.len];

    if arguments.len() < 1 {
        return global_object.throw_not_enough_arguments("hash", 1, 0);
    }

    let mut algorithm = AlgorithmValue::DEFAULT;

    if arguments.len() > 1 && !arguments[1].is_empty_or_undefined_or_null() {
        algorithm = AlgorithmValue::from_js(global_object, arguments[1])?;
    }

    // TODO: this most likely should error like `hashSync` instead of stringifying.
    //
    // fromJS(...) orelse {
    //   return globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
    // }
    let password_to_hash =
        StringOrBuffer::from_js_to_owned_slice(global_object, arguments[0])?;
    // errdefer bun.default_allocator.free(password_to_hash) — Box<[u8]> drops on `?`.

    if password_to_hash.is_empty() {
        return global_object.throw_invalid_arguments(format_args!("password must not be empty"));
    }

    JSPasswordObject::hash::<false>(global_object, password_to_hash, algorithm)
}

// Once we have bindings generator, this should be replaced with a generated function
#[bun_jsc::host_fn]
pub fn js_password_object_hash_sync(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old(2);
    let arguments = &arguments_.ptr[..arguments_.len];

    if arguments.len() < 1 {
        return global_object.throw_not_enough_arguments("hash", 1, 0);
    }

    let mut algorithm = AlgorithmValue::DEFAULT;

    if arguments.len() > 1 && !arguments[1].is_empty_or_undefined_or_null() {
        algorithm = AlgorithmValue::from_js(global_object, arguments[1])?;
    }

    let Some(string_or_buffer) = StringOrBuffer::from_js(global_object, arguments[0])? else {
        return global_object.throw_invalid_argument_type(
            "hash",
            "password",
            "string or TypedArray",
        );
    };
    // defer string_or_buffer.deinit() — Drop at scope exit.

    if string_or_buffer.slice().is_empty() {
        return global_object.throw_invalid_arguments(format_args!("password must not be empty"));
    }

    // PORT NOTE: sync path borrows the slice; pass as Box for unified signature.
    // TODO(port): hash<true> only needs &[u8]; consider splitting sync/async to
    // avoid the copy. Zig passed the borrowed slice directly.
    JSPasswordObject::hash::<true>(
        global_object,
        Box::<[u8]>::from(string_or_buffer.slice()),
        algorithm,
    )
}

// ─── VerifyJob ────────────────────────────────────────────────────────────

struct VerifyJob {
    algorithm: Option<Algorithm>,
    password: Box<[u8]>,
    prev_hash: Box<[u8]>,
    promise: JSPromiseStrong,
    event_loop: &'static EventLoop,
    global: *const JSGlobalObject,
    r#ref: KeepAlive,
    task: WorkPoolTask,
}

impl Drop for VerifyJob {
    fn drop(&mut self) {
        // promise: Drop on JSPromiseStrong handles deinit.
        // bun.freeSensitive — volatile-zero the buffers then free; take the Boxes so the
        // fields' own Drop sees empty slices afterwards.
        bun_alloc::free_sensitive(core::mem::take(&mut self.password));
        bun_alloc::free_sensitive(core::mem::take(&mut self.prev_hash));
    }
}

impl VerifyJob {
    pub fn new(init: VerifyJob) -> *mut VerifyJob {
        Box::into_raw(Box::new(init))
    }

    pub fn get_value(
        password: &[u8],
        prev_hash: &[u8],
        algorithm: Option<Algorithm>,
    ) -> VerifyResultValue {
        match PasswordObject::verify(password, prev_hash, algorithm) {
            Ok(pass) => VerifyResultValue::Pass(pass),
            Err(err) => VerifyResultValue::Err(err),
        }
    }

    pub fn run(task: *mut ThreadPoolTask) {
        // SAFETY: task points to VerifyJob.task; recover parent via offset_of.
        let this: *mut VerifyJob = unsafe {
            (task as *mut u8)
                .sub(offset_of!(VerifyJob, task))
                .cast::<VerifyJob>()
        };
        // SAFETY: `this` was produced by Box::into_raw in `VerifyJob::new` and is uniquely
        // owned by this thread-pool callback; no other alias exists until we drop it below.
        let this_ref = unsafe { &mut *this };

        let result = VerifyResult::new(VerifyResult {
            value: VerifyJob::get_value(&this_ref.password, &this_ref.prev_hash, this_ref.algorithm),
            task: AnyTask::default(),
            promise: core::mem::take(&mut this_ref.promise),
            global: this_ref.global,
            r#ref: core::mem::take(&mut this_ref.r#ref),
        });

        // SAFETY: `result` was just returned from Box::into_raw in `VerifyResult::new`;
        // not yet shared (enqueue happens after this write).
        unsafe {
            // Zig: `AnyTask.New(VerifyResult, run_from_js).init(result)` — construct directly
            // since Rust `New<T>` cannot carry a comptime callback param.
            (*result).task = AnyTask {
                ctx: Some(core::ptr::NonNull::new_unchecked(result).cast()),
                callback: VerifyResult::run_from_js_erased,
            };
        }
        this_ref.event_loop.enqueue_task_concurrent(
            // SAFETY: `result` is a valid Box::into_raw allocation; ownership transfers to
            // the event loop here. `task` is an intrusive field at a stable address.
            ConcurrentTask::create_from(unsafe { core::ptr::addr_of_mut!((*result).task) }),
        );
        // SAFETY: `this` came from Box::into_raw in `VerifyJob::new`; `this_ref` is no
        // longer used after this point. Drop runs secure_zero on password/prev_hash.
        unsafe { drop(Box::from_raw(this)) };
    }
}

struct VerifyResult {
    value: VerifyResultValue,
    r#ref: KeepAlive,

    task: AnyTask,
    promise: JSPromiseStrong,
    global: *const JSGlobalObject,
}

impl VerifyResult {
    pub fn new(init: VerifyResult) -> *mut VerifyResult {
        Box::into_raw(Box::new(init))
    }

    /// Type-erased shim matching `AnyTask.callback`'s ABI; recovers `*mut Self`
    /// and forwards to `run_from_js`.
    fn run_from_js_erased(p: *mut core::ffi::c_void) -> AnyTaskJsResult<()> {
        Self::run_from_js(p.cast::<VerifyResult>()).map_err(|_| core::ptr::null_mut())
    }

    pub fn run_from_js(this: *mut VerifyResult) -> Result<(), jsc::JsTerminated> {
        // SAFETY: `this` was produced by Box::into_raw in `VerifyResult::new` and is
        // uniquely owned here (event loop hands sole ownership to this callback).
        let this_ref = unsafe { &mut *this };
        let promise = core::mem::take(&mut this_ref.promise);
        // SAFETY: global stored from a live &JSGlobalObject; VM outlives task.
        let global = unsafe { &*this_ref.global };
        this_ref.r#ref.unref(global.bun_vm());
        match this_ref.value {
            VerifyResultValue::Err(_) => {
                let error_instance = this_ref.value.to_error_instance(global);
                // SAFETY: `this` came from Box::into_raw in `VerifyResult::new`;
                // `this_ref` is not used again after this point.
                unsafe { drop(Box::from_raw(this)) };
                promise.reject_with_async_stack(global, error_instance)?;
            }
            VerifyResultValue::Pass(pass) => {
                // SAFETY: `this` came from Box::into_raw in `VerifyResult::new`;
                // `this_ref` is not used again after this point.
                unsafe { drop(Box::from_raw(this)) };
                promise.resolve(global, JSValue::from(pass))?;
            }
        }
        Ok(())
    }
}

enum VerifyResultValue {
    Err(HashError),
    Pass(bool),
}

impl VerifyResultValue {
    pub fn to_error_instance(&self, global_object: &JSGlobalObject) -> JSValue {
        let VerifyResultValue::Err(err) = self else {
            unreachable!()
        };
        let mut error_code: Vec<u8> = Vec::new();
        write!(
            &mut error_code,
            "PASSWORD{}",
            PascalToUpperUnderscoreCaseFormatter {
                input: err.name().as_bytes()
            }
        )
        .expect("unreachable");
        let instance = global_object.create_error_instance(format_args!(
            "Password verification failed with error \"{}\"",
            err.name()
        ));
        instance.put(
            global_object,
            ZigString::static_("code"),
            ZigString::init(&error_code).to_js(global_object),
        );
        instance
    }
}

// ─── verify host functions ────────────────────────────────────────────────

// Once we have bindings generator, this should be replaced with a generated function
#[bun_jsc::host_fn]
pub fn js_password_object_verify(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old(3);
    let arguments = &arguments_.ptr[..arguments_.len];

    if arguments.len() < 2 {
        return global_object.throw_not_enough_arguments("verify", 2, 0);
    }

    let mut algorithm: Option<Algorithm> = None;

    if arguments.len() > 2 && !arguments[2].is_empty_or_undefined_or_null() {
        if !arguments[2].is_string() {
            return global_object.throw_invalid_argument_type("verify", "algorithm", "string");
        }

        let algorithm_string = arguments[2].get_zig_string(global_object)?;

        algorithm = match Algorithm::LABEL.get(algorithm_string.as_bytes()).copied() {
            Some(a) => Some(a),
            None => {
                if !global_object.has_exception() {
                    return global_object.throw_invalid_argument_type(
                        "verify",
                        "algorithm",
                        UNKNOWN_PASSWORD_ALGORITHM_MESSAGE,
                    );
                }
                return Err(JsError::Thrown);
            }
        };
    }

    // TODO: this most likely should error like `verifySync` instead of stringifying.
    //
    // fromJS(...) orelse {
    //   return globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
    // }
    let owned_password = StringOrBuffer::from_js_to_owned_slice(global_object, arguments[0])?;

    // TODO: this most likely should error like `verifySync` instead of stringifying.
    //
    // fromJS(...) orelse {
    //   return globalObject.throwInvalidArgumentType("hash", "password", "string or TypedArray");
    // }
    let owned_hash = match StringOrBuffer::from_js_to_owned_slice(global_object, arguments[1]) {
        Ok(h) => h,
        Err(err) => {
            drop(owned_password);
            return Err(err);
        }
    };

    if owned_hash.is_empty() {
        drop(owned_password);
        return Ok(JSPromise::resolved_promise_value(global_object, JSValue::FALSE));
    }

    if owned_password.is_empty() {
        drop(owned_hash);
        return Ok(JSPromise::resolved_promise_value(global_object, JSValue::FALSE));
    }

    JSPasswordObject::verify::<false>(global_object, owned_password, owned_hash, algorithm)
}

// Once we have bindings generator, this should be replaced with a generated function
#[bun_jsc::host_fn]
pub fn js_password_object_verify_sync(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments_ = callframe.arguments_old(3);
    let arguments = &arguments_.ptr[..arguments_.len];

    if arguments.len() < 2 {
        return global_object.throw_not_enough_arguments("verify", 2, 0);
    }

    let mut algorithm: Option<Algorithm> = None;

    if arguments.len() > 2 && !arguments[2].is_empty_or_undefined_or_null() {
        if !arguments[2].is_string() {
            return global_object.throw_invalid_argument_type("verify", "algorithm", "string");
        }

        let algorithm_string = arguments[2].get_zig_string(global_object)?;

        algorithm = match Algorithm::LABEL.get(algorithm_string.as_bytes()).copied() {
            Some(a) => Some(a),
            None => {
                if !global_object.has_exception() {
                    return global_object.throw_invalid_argument_type(
                        "verify",
                        "algorithm",
                        UNKNOWN_PASSWORD_ALGORITHM_MESSAGE,
                    );
                }
                return Ok(JSValue::ZERO);
            }
        };
    }

    let Some(password) = StringOrBuffer::from_js(global_object, arguments[0])? else {
        return global_object.throw_invalid_argument_type(
            "verify",
            "password",
            "string or TypedArray",
        );
    };

    let Some(hash_) = StringOrBuffer::from_js(global_object, arguments[1])? else {
        drop(password);
        return global_object.throw_invalid_argument_type("verify", "hash", "string or TypedArray");
    };

    // defer password.deinit() / hash_.deinit() — Drop at scope exit.

    if hash_.slice().is_empty() {
        return Ok(JSValue::FALSE);
    }

    if password.slice().is_empty() {
        return Ok(JSValue::FALSE);
    }

    // TODO(port): sync path only needs &[u8]; copying into Box here to share
    // signature with async. Zig passed borrowed slices.
    JSPasswordObject::verify::<true>(
        global_object,
        Box::<[u8]>::from(password.slice()),
        Box::<[u8]>::from(hash_.slice()),
        algorithm,
    )
}

const UNKNOWN_PASSWORD_ALGORITHM_MESSAGE: &str =
    "unknown algorithm, expected one of: \"bcrypt\", \"argon2id\", \"argon2d\", \"argon2i\" (default is \"argon2id\")";

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/crypto/PasswordObject.zig (759 lines)
//   confidence: medium
//   todos:      11
//   notes:      std.crypto.pwhash has no Rust mapping — needs bun_crypto::pwhash shim; sync hash/verify copy slice into Box (Zig borrowed); freeSensitive→secure_zero placeholder; ZigString→phf lookup may need UTF-16 handling.
// ──────────────────────────────────────────────────────────────────────────
