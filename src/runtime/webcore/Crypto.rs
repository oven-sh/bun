use bun_core::String as BunString;
use bun_jsc::uuid::{self, UUID, UUID5, UUID7};
use bun_jsc::{CallFrame, JSGlobalObject, JSUint8Array, JSValue, JsClass, JsResult, StringJsc};

use crate::node::Encoding;

// `.classes.ts`-backed type: the C++ JSCell wrapper stays generated C++.
// This struct is the `m_ctx` payload. `toJS`/`fromJS`/`fromJSDirect` are
// provided by the attribute macro — do not hand-port the `pub const js = jsc.Codegen.JSCrypto`
// alias block.
#[bun_jsc::JsClass]
#[derive(Default)]
pub struct Crypto {}

// Zig: `comptime { _ = CryptoObject__create; }` — force-reference block, dropped.

impl Crypto {
    #[bun_jsc::host_fn(method)]
    pub fn timing_safe_equal(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        crate::node::crypto::timing_safe_equal(global, callframe)
    }

    // DOMJIT fast path — non-standard signature (typed-array args unwrapped by codegen).
    // TODO(port): Zig return type is bare `JSValue` but the error branch returns
    // `ERR(..).throw()` (a `bun.JSError`). Mirroring as JsResult<JSValue> here; verify
    // DOMJIT shim expectations.
    pub fn timing_safe_equal_without_type_checks(
        &self,
        global: &JSGlobalObject,
        array_a: &JSUint8Array,
        array_b: &JSUint8Array,
    ) -> JSValue {
        // `JSUint8Array::slice()` takes `&mut self`; use ptr/len (`&self`) instead.
        let a_ptr = array_a.ptr();
        let b_ptr = array_b.ptr();
        let len = array_a.len();

        if array_b.len() != len {
            // TODO(port): see note above re: return type — DOMJIT shim expects bare JSValue
            // but the Zig error branch returns `bun.JSError`. Mirror by throwing then
            // returning the encoded error-builder JSValue.
            let _ = global
                .err(
                    bun_jsc::ErrorCode::CRYPTO_TIMING_SAFE_EQUAL_LENGTH,
                    format_args!("Input buffers must have the same byte length"),
                )
                .throw();
            return JSValue::ZERO;
        }

        // SAFETY: a_ptr/b_ptr are valid for `len` bytes (just obtained from JSUint8Array;
        // `JSUint8Array::slice()` needs `&mut self`, so reconstruct the slices here).
        // `ffi::slice` tolerates `(null, 0)` for detached/empty arrays.
        let (a, b) = unsafe {
            (
                bun_core::ffi::slice(a_ptr, len),
                bun_core::ffi::slice(b_ptr, len),
            )
        };
        JSValue::from(bun_boringssl_sys::constant_time_eq(a, b))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_random_values(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments();
        if arguments.is_empty() {
            return Err(global.throw_dom_exception(
                bun_jsc::DOMExceptionCode::TypeMismatchError,
                format_args!("The data argument must be an integer-type TypedArray"),
            ));
        }

        let Some(mut array_buffer) = arguments[0].as_array_buffer(global) else {
            return Err(global.throw_dom_exception(
                bun_jsc::DOMExceptionCode::TypeMismatchError,
                format_args!("The data argument must be an integer-type TypedArray"),
            ));
        };

        let slice = array_buffer.byte_slice_mut();

        random_data(global, slice);

        Ok(arguments[0])
    }

    // DOMJIT fast path.
    pub fn get_random_values_without_type_checks(
        &self,
        global: &JSGlobalObject,
        array: &JSUint8Array,
    ) -> JSValue {
        // Zig `array.slice()` yields `[]u8` (mutable). `JSUint8Array::slice()` takes
        // `&mut self`; use ptr()/len() (which take `&self`) to avoid the &mut requirement.
        // SAFETY: JSC guarantees `ptr()` is valid for `len()` writable bytes while the
        // typed-array cell is alive; `ffi::slice_mut` tolerates `(null, 0)` for detached.
        random_data(global, unsafe {
            bun_core::ffi::slice_mut(array.ptr(), array.len())
        });
        // Zig: @enumFromInt(@as(i64, @bitCast(@intFromPtr(array)))) — encode the cell
        // pointer back into a JSValue.
        JSValue::from_encoded(std::ptr::from_ref::<JSUint8Array>(array) as usize)
    }

    #[bun_jsc::host_fn(method)]
    pub fn random_uuid(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (mut str, bytes) = BunString::create_uninitialized_latin1(36);

        // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
        let uuid = global.bun_vm().as_mut().rare_data().next_uuid();

        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        str.transfer_to_js(global)
    }

    // DOMJIT fast path.
    pub fn random_uuid_without_type_checks(&self, global: &JSGlobalObject) -> JSValue {
        let (str, bytes) = BunString::create_uninitialized_latin1(36);
        // `defer str.deref()` — BunString's Drop handles the deref.

        // randomUUID must have been called already many times before this kicks
        // in so we can skip the rare_data pointer check.
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
        // NOTE(port): upstream lacks `rare_data_unchecked`; `rare_data()` lazy-inits anyway.
        let uuid = global.bun_vm().as_mut().rare_data().next_uuid();

        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        // DOMJIT fast path returns bare JSValue; OOM here is unrecoverable.
        str.to_js(global).unwrap_or(JSValue::ZERO)
    }

    // `#[JsClass]` emits `CryptoClass__construct` calling this.
    pub fn constructor(global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<*mut Crypto> {
        Err(global.throw_illegal_constructor("Crypto"))
    }
}

fn random_data(global: &JSGlobalObject, slice: &mut [u8]) {
    const ENTROPY_CACHE_FAST_PATH_MAX: usize = bun_jsc::RareData::EntropyCache::SIZE / 8;
    match slice.len() {
        0 => {}
        // 512 bytes or less we reuse from the same cache as UUID generation.
        1..=ENTROPY_CACHE_FAST_PATH_MAX => {
            // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
            let src = global
                .bun_vm()
                .as_mut()
                .rare_data()
                .entropy_slice(slice.len());
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
pub(crate) fn bun_random_uuid_v7(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments_undef::<2>();

    let mut encoding_value: JSValue = JSValue::UNDEFINED;

    let encoding: Encoding = 'brk: {
        if arguments.len > 0 {
            if !arguments.ptr[0].is_undefined() {
                if arguments.ptr[0].is_string() {
                    encoding_value = arguments.ptr[0];
                    break 'brk match Encoding::from_js(encoding_value, global)? {
                        Some(e) => e,
                        None => {
                            return Err(global
                                .err(
                                    bun_jsc::ErrorCode::UNKNOWN_ENCODING,
                                    format_args!(
                                        "Encoding must be one of base64, base64url, hex, or buffer"
                                    ),
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
        let timestamp_value: JSValue = if !encoding_value.is_undefined() && arguments.len > 1 {
            arguments.ptr[1]
        } else if arguments.len == 1 && encoding_value.is_undefined() {
            arguments.ptr[0]
        } else {
            JSValue::UNDEFINED
        };

        if !timestamp_value.is_undefined() {
            if timestamp_value.is_date() {
                let date = timestamp_value.get_unix_timestamp();
                break 'brk date.max(0.0) as u64;
            }
            break 'brk u64::try_from(global.validate_integer_range::<i64>(
                timestamp_value,
                0,
                bun_jsc::IntegerRange {
                    min: 0,
                    field_name: b"timestamp",
                    ..Default::default()
                },
            )?)
            .unwrap();
        }

        break 'brk u64::try_from(bun_core::time::milli_timestamp().max(0)).expect("int cast");
    };

    // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
    let entropy = global.bun_vm().as_mut().rare_data().entropy_slice(8);

    let uuid = UUID7::init(timestamp, <[u8; 8]>::try_from(&entropy[0..8]).unwrap());

    if encoding == Encoding::Hex {
        let (mut str, bytes) = BunString::create_uninitialized_latin1(36);
        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        return str.transfer_to_js(global);
    }

    encoding.encode_with_max_size(global, 32, &uuid.bytes)
}

// Zig: `comptime { @export(&jsc.toJSHostFn(Bun__randomUUIDv5_), .{ .name = "Bun__randomUUIDv5" }) }`
#[bun_jsc::host_fn(export = "Bun__randomUUIDv5")]
pub(crate) fn bun_random_uuid_v5(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments_undef::<3>();

    if arguments.len == 0 || arguments.ptr[0].is_undefined_or_null() {
        return Err(global
            .err(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"name\" argument must be specified"),
            )
            .throw());
    }

    if arguments.len < 2 || arguments.ptr[1].is_undefined_or_null() {
        return Err(global
            .err(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"namespace\" argument must be specified"),
            )
            .throw());
    }

    let encoding: Encoding = 'brk: {
        if arguments.len > 2 && !arguments.ptr[2].is_undefined() {
            if arguments.ptr[2].is_string() {
                break 'brk match Encoding::from_js(arguments.ptr[2], global)? {
                    Some(e) => e,
                    None => {
                        return Err(global
                            .err(
                                bun_jsc::ErrorCode::UNKNOWN_ENCODING,
                                format_args!(
                                    "Encoding must be one of base64, base64url, hex, or buffer"
                                ),
                            )
                            .throw());
                    }
                };
            }
        }

        break 'brk Encoding::Hex;
    };

    let name_value = arguments.ptr[0];
    let namespace_value = arguments.ptr[1];

    // `name` is a ZigString.Slice in Zig (borrow-or-own UTF-8). Port as bun_core::ZigStringSlice.
    let name: bun_core::ZigStringSlice = 'brk: {
        if name_value.is_string() {
            let name_str = bun_core::OwnedString::new(name_value.to_bun_string(global)?);
            let result = name_str.to_utf8();

            break 'brk result;
        } else if let Some(array_buffer) = name_value.as_array_buffer(global) {
            let bytes: &[u8] = array_buffer.byte_slice();
            break 'brk bun_core::ZigStringSlice::from_utf8_never_free(bytes);
        } else {
            return Err(global
                .err(
                    bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"name\" argument must be of type string or BufferSource"),
                )
                .throw());
        }
    };
    // `defer name.deinit()` — Utf8Slice's Drop handles cleanup.

    let namespace: [u8; 16] = 'brk: {
        if namespace_value.is_string() {
            let namespace_str = bun_core::OwnedString::new(namespace_value.to_bun_string(global)?);
            let namespace_slice = namespace_str.to_utf8();

            if namespace_slice.slice().len() != 36 {
                if let Some(namespace) = uuid::namespaces::get(namespace_slice.slice()) {
                    break 'brk *namespace;
                }

                return Err(global
                    .err(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Invalid UUID format for namespace"),
                    )
                    .throw());
            }

            let Ok(parsed_uuid) = UUID::parse(namespace_slice.slice()) else {
                return Err(global
                    .err(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Invalid UUID format for namespace"),
                    )
                    .throw());
            };
            break 'brk parsed_uuid.bytes;
        } else if let Some(array_buffer) = namespace_value.as_array_buffer(global) {
            let slice: &[u8] = array_buffer.byte_slice();
            if slice.len() != 16 {
                return Err(global
                    .err(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Namespace must be exactly 16 bytes"),
                    )
                    .throw());
            }
            break 'brk <[u8; 16]>::try_from(&slice[0..16]).unwrap();
        }

        return Err(global
            .err(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"namespace\" argument must be a string or buffer"),
            )
            .throw());
    };

    let uuid = UUID5::init(&namespace, name.slice());

    if encoding == Encoding::Hex {
        let (mut str, bytes) = BunString::create_uninitialized_latin1(36);
        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        return str.transfer_to_js(global);
    }

    encoding.encode_with_max_size(global, 32, &uuid.bytes)
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn CryptoObject__create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::mark_binding!();

    // PORTING.md: allocator.create(T) → Box::new. Box::new aborts on OOM, so the
    // Zig `catch return globalThis.throwOutOfMemoryValue()` arm is unreachable.
    // `JsClass::to_js` boxes `self` internally and transfers ownership to the JS wrapper.
    Crypto::default().to_js(global)
}

// ported from: src/runtime/webcore/Crypto.zig
