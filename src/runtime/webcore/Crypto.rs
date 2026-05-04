use core::ffi::c_void;

use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsError, JsResult};
use bun_jsc::uuid::{UUID, UUID5, UUID7};
use bun_str::String as BunString;

use crate::node::Encoding;

// `.classes.ts`-backed type: the C++ JSCell wrapper stays generated C++.
// This struct is the `m_ctx` payload. `toJS`/`fromJS`/`fromJSDirect` are
// provided by the derive — do not hand-port the `pub const js = jsc.Codegen.JSCrypto`
// alias block.
#[derive(bun_jsc::JsClass)]
pub struct Crypto {
    garbage: i32,
}

impl Default for Crypto {
    fn default() -> Self {
        Self { garbage: 0 }
    }
}

// Zig: `comptime { _ = CryptoObject__create; }` — force-reference block, dropped.

fn throw_invalid_parameter(global: &JSGlobalObject) -> JsError {
    global
        .ERR(bun_jsc::ErrorCode::CRYPTO_SCRYPT_INVALID_PARAMETER, format_args!("Invalid scrypt parameters"))
        .throw()
}

// Zig: `comptime error_type: @Type(.enum_literal)` is compile-time checked to be `.RangeError`;
// no other variant is supported (`@compileError`). In Rust we drop the param and hard-code
// the RangeError path. `message` was `[:0]const u8` comptime + `fmt: anytype` → fold into
// `core::fmt::Arguments`.
fn throw_invalid_params(global: &JSGlobalObject, args: core::fmt::Arguments<'_>) -> JsError {
    // SAFETY: ERR_clear_error has no preconditions.
    unsafe { bun_boringssl_sys::ERR_clear_error() };
    global
        .ERR(bun_jsc::ErrorCode::CRYPTO_INVALID_SCRYPT_PARAMS, args)
        .throw()
}

impl Crypto {
    #[bun_jsc::host_fn(method)]
    pub fn timing_safe_equal(
        _this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        crate::node::crypto::timing_safe_equal(global, callframe)
    }

    // DOMJIT fast path — non-standard signature (typed-array args unwrapped by codegen).
    // TODO(port): Zig return type is bare `JSValue` but the error branch returns
    // `ERR(..).throw()` (a `bun.JSError`). Mirroring as JsResult<JSValue> here; verify
    // DOMJIT shim expectations in Phase B.
    pub fn timing_safe_equal_without_type_checks(
        _this: &mut Self,
        global: &JSGlobalObject,
        array_a: &JSUint8Array,
        array_b: &JSUint8Array,
    ) -> JSValue {
        let a = array_a.slice();
        let b = array_b.slice();

        let len = a.len();
        if b.len() != len {
            // TODO(port): see note above re: return type
            return global
                .ERR(
                    bun_jsc::ErrorCode::CRYPTO_TIMING_SAFE_EQUAL_LENGTH,
                    format_args!("Input buffers must have the same byte length"),
                )
                .throw();
        }

        // SAFETY: a and b are valid for `len` bytes (just obtained from JSUint8Array::slice).
        JSValue::from(unsafe { bun_boringssl_sys::CRYPTO_memcmp(a.as_ptr().cast::<c_void>(), b.as_ptr().cast::<c_void>(), len) } == 0)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_random_values(
        _this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.is_empty() {
            return global.throw_dom_exception(
                bun_jsc::DomExceptionCode::TypeMismatchError,
                format_args!("The data argument must be an integer-type TypedArray"),
            );
        }

        let Some(mut array_buffer) = arguments[0].as_array_buffer(global) else {
            return global.throw_dom_exception(
                bun_jsc::DomExceptionCode::TypeMismatchError,
                format_args!("The data argument must be an integer-type TypedArray"),
            );
        };

        let slice = array_buffer.byte_slice();

        random_data(global, slice.as_mut_ptr(), slice.len());

        Ok(arguments[0])
    }

    // DOMJIT fast path.
    pub fn get_random_values_without_type_checks(
        _this: &mut Self,
        global: &JSGlobalObject,
        array: &JSUint8Array,
    ) -> JSValue {
        // Zig `array.slice()` yields `[]u8` (mutable). Do not cast a *const to *mut.
        // TODO(port): JSUint8Array mutable slice accessor name (slice_mut) — confirm in Phase B.
        let slice = array.slice_mut();
        random_data(global, slice.as_mut_ptr(), slice.len());
        // Zig: @enumFromInt(@as(i64, @bitCast(@intFromPtr(array))))
        // SAFETY: JSValue is #[repr(transparent)] i64; this encodes the cell pointer
        // back into a JSValue exactly as the Zig does.
        unsafe { core::mem::transmute::<i64, JSValue>((array as *const JSUint8Array as usize as i64)) }
    }

    #[bun_jsc::host_fn(method)]
    pub fn random_uuid(
        _this: &mut Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (mut str, bytes) = BunString::create_uninitialized_latin1(36);

        let uuid = global.bun_vm().rare_data().next_uuid();

        uuid.print(&mut bytes[0..36]);
        Ok(str.transfer_to_js(global))
    }

    // DOMJIT fast path.
    pub fn random_uuid_without_type_checks(
        _this: &mut Self,
        global: &JSGlobalObject,
    ) -> JSValue {
        let (str, bytes) = BunString::create_uninitialized_latin1(36);
        // `defer str.deref()` — BunString's Drop handles the deref.

        // randomUUID must have been called already many times before this kicks
        // in so we can skip the rare_data pointer check.
        let uuid = global.bun_vm().rare_data_unchecked().next_uuid();

        uuid.print(&mut bytes[0..36]);
        str.to_js(global)
    }

    #[bun_jsc::host_fn(constructor)]
    pub fn constructor(global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<*mut Crypto> {
        Err(bun_jsc::Error::ILLEGAL_CONSTRUCTOR.throw(global, format_args!("Crypto is not constructable")))
    }
}

fn random_data(global: &JSGlobalObject, ptr: *mut u8, len: usize) {
    // SAFETY: caller guarantees `ptr` is valid for `len` writable bytes.
    let slice = unsafe { core::slice::from_raw_parts_mut(ptr, len) };

    match slice.len() {
        0 => {}
        // 512 bytes or less we reuse from the same cache as UUID generation.
        1..=const { bun_jsc::RareData::EntropyCache::SIZE / 8 } => {
            let src = global.bun_vm().rare_data().entropy_slice(slice.len());
            slice[..src.len()].copy_from_slice(src);
        }
        _ => {
            bun_core::csprng(slice);
        }
    }
}

// Zig: `comptime { @export(&jsc.toJSHostFn(Bun__randomUUIDv7_), .{ .name = "Bun__randomUUIDv7" }) }`
// The #[bun_jsc::host_fn] attribute macro emits the `extern "C"` shim with the
// correct calling convention and `#[unsafe(no_mangle)]` under the exported name.
#[bun_jsc::host_fn(export = "Bun__randomUUIDv7")]
pub fn bun_random_uuid_v7(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_undef::<2>();

    let mut encoding_value: JSValue = JSValue::UNDEFINED;

    let encoding: Encoding = 'brk: {
        if arguments.len() > 0 {
            if !arguments[0].is_undefined() {
                if arguments[0].is_string() {
                    encoding_value = arguments[0];
                    break 'brk match Encoding::from_js(encoding_value, global)? {
                        Some(e) => e,
                        None => {
                            return Err(global
                                .ERR(
                                    bun_jsc::ErrorCode::UNKNOWN_ENCODING,
                                    format_args!("Encoding must be one of base64, base64url, hex, or buffer"),
                                )
                                .throw());
                        }
                    };
                }
            }
        }

        break 'brk Encoding::Hex;
    };

    let timestamp: u64 = 'brk: {
        let timestamp_value: JSValue = if !encoding_value.is_undefined() && arguments.len() > 1 {
            arguments[1]
        } else if arguments.len() == 1 && encoding_value.is_undefined() {
            arguments[0]
        } else {
            JSValue::UNDEFINED
        };

        if !timestamp_value.is_undefined() {
            if timestamp_value.is_date() {
                let date = timestamp_value.get_unix_timestamp();
                break 'brk date.max(0.0) as u64;
            }
            break 'brk u64::try_from(
                global.validate_integer_range::<i64>(timestamp_value, 0, bun_jsc::IntegerRange { min: 0, field_name: "timestamp" })?,
            )
            .unwrap();
        }

        // TODO(port): std.time.milliTimestamp() — confirm bun_core::time API
        break 'brk u64::try_from(bun_core::time::milli_timestamp().max(0)).unwrap();
    };

    let entropy = global.bun_vm().rare_data().entropy_slice(8);

    let uuid = UUID7::init(timestamp, &<[u8; 8]>::try_from(&entropy[0..8]).unwrap());

    if encoding == Encoding::Hex {
        let (mut str, bytes) = BunString::create_uninitialized_latin1(36);
        uuid.print(&mut bytes[0..36]);
        return Ok(str.transfer_to_js(global));
    }

    encoding.encode_with_max_size(global, 32, &uuid.bytes)
}

// Zig: `comptime { @export(&jsc.toJSHostFn(Bun__randomUUIDv5_), .{ .name = "Bun__randomUUIDv5" }) }`
#[bun_jsc::host_fn(export = "Bun__randomUUIDv5")]
pub fn bun_random_uuid_v5(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_undef::<3>();

    if arguments.is_empty() || arguments[0].is_undefined_or_null() {
        return Err(global
            .ERR(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"name\" argument must be specified"),
            )
            .throw());
    }

    if arguments.len() < 2 || arguments[1].is_undefined_or_null() {
        return Err(global
            .ERR(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"namespace\" argument must be specified"),
            )
            .throw());
    }

    let encoding: Encoding = 'brk: {
        if arguments.len() > 2 && !arguments[2].is_undefined() {
            if arguments[2].is_string() {
                break 'brk match Encoding::from_js(arguments[2], global)? {
                    Some(e) => e,
                    None => {
                        return Err(global
                            .ERR(
                                bun_jsc::ErrorCode::UNKNOWN_ENCODING,
                                format_args!("Encoding must be one of base64, base64url, hex, or buffer"),
                            )
                            .throw());
                    }
                };
            }
        }

        break 'brk Encoding::Hex;
    };

    let name_value = arguments[0];
    let namespace_value = arguments[1];

    // `name` is a ZigString.Slice in Zig (borrow-or-own UTF-8). Port as bun_str::Utf8Slice.
    let name: bun_str::Utf8Slice<'_> = 'brk: {
        if name_value.is_string() {
            let name_str = name_value.to_bun_string(global)?;
            // `defer name_str.deref()` — BunString's Drop handles the deref.
            let result = name_str.to_utf8();

            break 'brk result;
        } else if let Some(array_buffer) = name_value.as_array_buffer(global) {
            break 'brk bun_str::Utf8Slice::from_utf8_never_free(array_buffer.byte_slice());
        } else {
            return Err(global
                .ERR(
                    bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"name\" argument must be of type string or BufferSource"),
                )
                .throw());
        }
    };
    // `defer name.deinit()` — Utf8Slice's Drop handles cleanup.

    let namespace: [u8; 16] = 'brk: {
        if namespace_value.is_string() {
            let namespace_str = namespace_value.to_bun_string(global)?;
            // `defer namespace_str.deref()` — Drop handles it.
            let namespace_slice = namespace_str.to_utf8();
            // `defer namespace_slice.deinit()` — Drop handles it.

            if namespace_slice.as_bytes().len() != 36 {
                if let Some(namespace) = UUID5::namespaces().get(namespace_slice.as_bytes()) {
                    break 'brk *namespace;
                }

                return Err(global
                    .ERR(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Invalid UUID format for namespace"),
                    )
                    .throw());
            }

            let Ok(parsed_uuid) = UUID::parse(namespace_slice.as_bytes()) else {
                return Err(global
                    .ERR(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Invalid UUID format for namespace"),
                    )
                    .throw());
            };
            break 'brk parsed_uuid.bytes;
        } else if let Some(array_buffer) = namespace_value.as_array_buffer(global) {
            let slice = array_buffer.byte_slice();
            if slice.len() != 16 {
                return Err(global
                    .ERR(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Namespace must be exactly 16 bytes"),
                    )
                    .throw());
            }
            break 'brk <[u8; 16]>::try_from(&slice[0..16]).unwrap();
        }

        return Err(global
            .ERR(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"namespace\" argument must be a string or buffer"),
            )
            .throw());
    };

    let uuid = UUID5::init(&namespace, name.as_bytes());

    if encoding == Encoding::Hex {
        let (mut str, bytes) = BunString::create_uninitialized_latin1(36);
        uuid.print(&mut bytes[0..36]);
        return Ok(str.transfer_to_js(global));
    }

    encoding.encode_with_max_size(global, 32, &uuid.bytes)
}

#[unsafe(no_mangle)]
pub extern "C" fn CryptoObject__create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::mark_binding!();

    // PORTING.md: allocator.create(T) → Box::new. Box::new aborts on OOM, so the
    // Zig `catch return globalThis.throwOutOfMemoryValue()` arm is unreachable.
    // TODO(port): throwOutOfMemoryValue path unreachable, Box::new aborts.
    let ptr = Box::into_raw(Box::new(Crypto::default()));

    // SAFETY: `ptr` is a freshly-boxed Crypto; ownership transfers to the JS wrapper.
    unsafe { Crypto::to_js(ptr, global) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/Crypto.zig (288 lines)
//   confidence: medium
//   todos:      5
//   notes:      DOMJIT fast-path return types need verification; ERR()/throw_dom_exception/validate_integer_range API shapes guessed; Utf8Slice borrow vs name_str drop ordering may need ManuallyDrop in Phase B.
// ──────────────────────────────────────────────────────────────────────────
