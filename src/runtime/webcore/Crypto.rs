use bun_core::String as BunString;
use bun_jsc::uuid::{self, UUID, UUID5, UUID7};
use bun_jsc::{
    CallFrame, JSGlobalObject, JSType, JSUint8Array, JSValue, JsClass, JsResult, Local, Scope,
    StringJsc,
};

use crate::node::Encoding;

// `.classes.ts`-backed type: the C++ JSCell wrapper stays generated C++.
// This struct is the `m_ctx` payload. `toJS`/`fromJS`/`fromJSDirect` are
// provided by the attribute macro — do not hand-port the `pub const js = jsc.Codegen.JSCrypto`
// alias block.
#[bun_jsc::JsClass]
#[derive(Default)]
pub struct Crypto {}

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
    // DOMJIT operations report failure by throwing on the VM and returning the empty
    // value (`JSValue::ZERO`); the generated wrapper returns the raw EncodedJSValue and
    // the JIT checks for a pending exception after the call.
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
            // Throw, then return the empty value — the DOMJIT wrapper surfaces the
            // pending exception (the C-ABI shim encodes it as zero).
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

        // https://w3c.github.io/webcrypto/#Crypto-method-getRandomValues accepts only
        // integer-typed views. This is an allow-list: DataView, ArrayBuffer and SharedArrayBuffer
        // all pass `as_array_buffer` above but must still raise TypeMismatchError.
        if !matches!(
            arguments[0].js_type(),
            JSType::Int8Array
                | JSType::Uint8Array
                | JSType::Uint8ClampedArray
                | JSType::Int16Array
                | JSType::Uint16Array
                | JSType::Int32Array
                | JSType::Uint32Array
                | JSType::BigInt64Array
                | JSType::BigUint64Array
        ) {
            return Err(global.throw_dom_exception(
                bun_jsc::DOMExceptionCode::TypeMismatchError,
                format_args!("The data argument must be an integer-type TypedArray"),
            ));
        }

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
        // `JSUint8Array::slice()` takes
        // `&mut self`; use ptr()/len() (which take `&self`) to avoid the &mut requirement.
        // SAFETY: JSC guarantees `ptr()` is valid for `len()` writable bytes while the
        // typed-array cell is alive; `ffi::slice_mut` tolerates `(null, 0)` for detached.
        random_data(global, unsafe {
            bun_core::ffi::slice_mut(array.ptr(), array.len())
        });
        // Encode the cell pointer back into a JSValue.
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
        let (mut str, bytes) = BunString::create_uninitialized_latin1(36);

        // randomUUID must have been called already many times before this kicks
        // in so we can skip the rare_data pointer check.
        // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
        // `rare_data()` lazy-inits, so no unchecked accessor is needed.
        let uuid = global.bun_vm().as_mut().rare_data().next_uuid();

        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        // DOMJIT fast path returns bare JSValue; OOM here is unrecoverable.
        str.transfer_to_js(global).unwrap_or(JSValue::ZERO)
    }

    // `#[JsClass]` emits `CryptoClass__construct` calling this.
    pub fn constructor(global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<*mut Crypto> {
        Err(global.throw_illegal_constructor())
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
            bun_boringssl_sys::rand_bytes(slice);
        }
    }
}

// The #[bun_jsc::host_fn] attribute macro emits the `extern "C"` shim with the
// correct calling convention and `#[unsafe(no_mangle)]` under the exported name.
#[bun_jsc::host_fn(scoped, export = "Bun__randomUUIDv7")]
pub(crate) fn bun_random_uuid_v7<'s>(
    scope: &mut Scope<'s>,
    callframe: &CallFrame,
) -> JsResult<Local<'s>> {
    let global = scope.unscoped_global();
    let arguments = callframe.scoped_arguments::<2>(scope);

    let mut encoding_value: Local<'s> = scope.undefined();

    let encoding: Encoding = 'brk: {
        if arguments.len > 0 {
            if !arguments.ptr[0].is_undefined() {
                if arguments.ptr[0].is_string() {
                    encoding_value = arguments.ptr[0];
                    break 'brk match Encoding::from_js(encoding_value.unscoped(), global)? {
                        Some(e) => e,
                        None => {
                            return Err(scope
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

    let (timestamp, timestamp_source): (u64, uuid::TimestampSource) = 'brk: {
        let timestamp_value: Local<'s> = if arguments.len > 1 {
            arguments.ptr[1]
        } else if arguments.len == 1 && encoding_value.is_undefined() {
            arguments.ptr[0]
        } else {
            scope.undefined()
        };

        if !timestamp_value.is_undefined() {
            // UUIDv7's unix_ts_ms field is 48 bits (RFC 9562 §5.7).
            const MAX_TIMESTAMP: i64 = (1i64 << 48) - 1;
            let range_opts = bun_jsc::RangeErrorOptions {
                min: 0,
                max: MAX_TIMESTAMP,
                field_name: b"timestamp",
                ..Default::default()
            };
            if timestamp_value.is_date() {
                let date = timestamp_value.get_unix_timestamp();
                if !date.is_finite() || date < 0.0 || date > MAX_TIMESTAMP as f64 {
                    return Err(scope.throw_range_error(date, range_opts));
                }
                break 'brk (date as u64, uuid::TimestampSource::Explicit);
            }
            if timestamp_value.is_number() && timestamp_value.as_number().is_nan() {
                return Err(scope.throw_range_error(f64::NAN, range_opts));
            }
            break 'brk (
                u64::try_from(global.validate_integer_range::<i64>(
                    timestamp_value.unscoped(),
                    0,
                    bun_jsc::IntegerRange {
                        min: 0,
                        max: i128::from(MAX_TIMESTAMP),
                        field_name: b"timestamp",
                        ..Default::default()
                    },
                )?)
                .unwrap(),
                uuid::TimestampSource::Explicit,
            );
        }

        break 'brk (
            u64::try_from(bun_core::time::milli_timestamp().max(0)).expect("int cast"),
            uuid::TimestampSource::Clock,
        );
    };

    // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
    let entropy = scope.bun_vm().as_mut().rare_data().entropy_slice(10);

    let uuid = UUID7::init(
        timestamp,
        <[u8; 10]>::try_from(&entropy[0..10]).unwrap(),
        timestamp_source,
    );

    if encoding == Encoding::Hex {
        let (mut str, bytes) = BunString::create_uninitialized_latin1(36);
        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        return str.transfer_to_js(global).map(|v| scope.local(v));
    }

    encoding
        .encode_with_max_size(global, 32, &uuid.bytes)
        .map(|v| scope.local(v))
}

#[bun_jsc::host_fn(scoped, export = "Bun__randomUUIDv5")]
pub(crate) fn bun_random_uuid_v5<'s>(
    scope: &mut Scope<'s>,
    callframe: &CallFrame,
) -> JsResult<Local<'s>> {
    let global = scope.unscoped_global();
    let arguments = callframe.scoped_arguments::<3>(scope);

    if arguments.len == 0 || arguments.ptr[0].is_undefined_or_null() {
        return Err(scope
            .err(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"name\" argument must be specified"),
            )
            .throw());
    }

    if arguments.len < 2 || arguments.ptr[1].is_undefined_or_null() {
        return Err(scope
            .err(
                bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"namespace\" argument must be specified"),
            )
            .throw());
    }

    let encoding: Encoding = 'brk: {
        if arguments.len > 2 && !arguments.ptr[2].is_undefined() {
            if arguments.ptr[2].is_string() {
                break 'brk match Encoding::from_js(arguments.ptr[2].unscoped(), global)? {
                    Some(e) => e,
                    None => {
                        return Err(scope
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

    // `bun_core::ZigStringSlice` is a borrow-or-own UTF-8 slice.
    let name: bun_core::ZigStringSlice = 'brk: {
        if name_value.is_string() {
            let name_str = bun_core::OwnedString::new(name_value.to_bun_string(scope)?);
            let result = name_str.to_utf8();

            break 'brk result;
        } else if let Some(array_buffer) = name_value.unscoped().as_array_buffer(global) {
            let bytes: &[u8] = array_buffer.byte_slice();
            break 'brk bun_core::ZigStringSlice::from_utf8_never_free(bytes);
        } else {
            return Err(scope
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
            let namespace_str = bun_core::OwnedString::new(namespace_value.to_bun_string(scope)?);
            let namespace_slice = namespace_str.to_utf8();

            if namespace_slice.slice().len() != 36 {
                if let Some(namespace) = uuid::namespaces::get(namespace_slice.slice()) {
                    break 'brk *namespace;
                }

                return Err(scope
                    .err(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Invalid UUID format for namespace"),
                    )
                    .throw());
            }

            let Ok(parsed_uuid) = UUID::parse(namespace_slice.slice()) else {
                return Err(scope
                    .err(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Invalid UUID format for namespace"),
                    )
                    .throw());
            };
            break 'brk parsed_uuid.bytes;
        } else if let Some(array_buffer) = namespace_value.unscoped().as_array_buffer(global) {
            let slice: &[u8] = array_buffer.byte_slice();
            if slice.len() != 16 {
                return Err(scope
                    .err(
                        bun_jsc::ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Namespace must be exactly 16 bytes"),
                    )
                    .throw());
            }
            break 'brk <[u8; 16]>::try_from(&slice[0..16]).unwrap();
        }

        return Err(scope
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
        return str.transfer_to_js(global).map(|v| scope.local(v));
    }

    encoding
        .encode_with_max_size(global, 32, &uuid.bytes)
        .map(|v| scope.local(v))
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn CryptoObject__create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::mark_binding!();

    // Box::new aborts on OOM, so an out-of-memory throw arm is unreachable.
    // `JsClass::to_js` boxes `self` internally and transfers ownership to the JS wrapper.
    Crypto::default().to_js(global)
}
