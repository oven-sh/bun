use bun_core::String as BunString;
use bun_jsc::uuid::{self, UUID, UUID5, UUID7};
use bun_jsc::{CallFrame, JSGlobalObject, JSType, JSValue, JsClass, JsResult, StringJsc};

use crate::node::Encoding;

// UUIDv7 and ULID both encode a 48-bit Unix timestamp in milliseconds.
const MAX_48_BIT_TIMESTAMP: i64 = (1i64 << 48) - 1;

fn timestamp_range_options() -> bun_jsc::RangeErrorOptions<'static> {
    bun_jsc::RangeErrorOptions {
        min: 0,
        max: MAX_48_BIT_TIMESTAMP,
        field_name: b"timestamp",
        ..Default::default()
    }
}

fn parse_48_bit_timestamp(global: &JSGlobalObject, value: JSValue) -> JsResult<u64> {
    if value.is_date() {
        let timestamp = value.get_unix_timestamp();
        if !timestamp.is_finite() || timestamp < 0.0 || timestamp > MAX_48_BIT_TIMESTAMP as f64 {
            return Err(global.throw_range_error(timestamp, timestamp_range_options()));
        }
        return Ok(timestamp as u64);
    }

    if value.is_number() && value.as_number().is_nan() {
        return Err(global.throw_range_error(f64::NAN, timestamp_range_options()));
    }

    Ok(u64::try_from(global.validate_integer_range::<i64>(
        value,
        0,
        bun_jsc::IntegerRange {
            min: 0,
            max: i128::from(MAX_48_BIT_TIMESTAMP),
            field_name: b"timestamp",
            ..Default::default()
        },
    )?)
    .unwrap())
}

// `.classes.ts`-backed type: the C++ JSCell wrapper stays generated C++.
// This struct is the `m_ctx` payload. `toJS`/`fromJS`/`fromJSDirect` are
// provided by the attribute macro — do not hand-port the `pub const js = jsc.Codegen.JSCrypto`
// alias block.
#[bun_jsc::JsClass]
#[derive(Default)]
pub struct Crypto {}

impl Crypto {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn timing_safe_equal(
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

    #[bun_jsc::host_fn(method)]
    pub(crate) fn get_random_values(
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

    #[bun_jsc::host_fn(method)]
    pub(crate) fn random_uuid(
        &self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (str, bytes) = BunString::create_uninitialized_latin1(36);

        // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
        let uuid = global.bun_vm().as_mut().rare_data().next_uuid();

        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        str.into_js(global)
    }

    // DOMJIT fast path.

    // `#[JsClass]` emits `CryptoClass__construct` calling this.
    pub(crate) fn constructor(
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<*mut Crypto> {
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
#[bun_jsc::host_fn(export = "Bun__randomUUIDv7")]
fn bun_random_uuid_v7(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
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

    let (timestamp, timestamp_source): (u64, uuid::TimestampSource) = 'brk: {
        let timestamp_value: JSValue = if arguments.len > 1 {
            arguments.ptr[1]
        } else if arguments.len == 1 && encoding_value.is_undefined() {
            arguments.ptr[0]
        } else {
            JSValue::UNDEFINED
        };

        if !timestamp_value.is_undefined() {
            break 'brk (
                parse_48_bit_timestamp(global, timestamp_value)?,
                uuid::TimestampSource::Explicit,
            );
        }

        break 'brk (
            u64::try_from(bun_core::time::milli_timestamp().max(0)).expect("int cast"),
            uuid::TimestampSource::Clock,
        );
    };

    // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
    let entropy = global.bun_vm().as_mut().rare_data().entropy_slice(10);

    let uuid = UUID7::init(
        timestamp,
        <[u8; 10]>::try_from(&entropy[0..10]).unwrap(),
        timestamp_source,
    );

    if encoding == Encoding::Hex {
        let (str, bytes) = BunString::create_uninitialized_latin1(36);
        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        return str.into_js(global);
    }

    encoding.encode_with_max_size(global, 32, &uuid.bytes)
}

#[bun_jsc::host_fn(export = "Bun__randomULID")]
fn bun_random_ulid(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let timestamp_value = callframe.argument(0);
    let timestamp = if timestamp_value.is_undefined() {
        let timestamp = bun_core::time::milli_timestamp().max(0);
        if timestamp > MAX_48_BIT_TIMESTAMP {
            return Err(global.throw_range_error(timestamp, timestamp_range_options()));
        }
        timestamp as u64
    } else {
        parse_48_bit_timestamp(global, timestamp_value)?
    };

    let (str, bytes) = BunString::create_uninitialized_latin1(uuid::ULID_STRING_LENGTH);
    if str.is_dead() {
        return str.into_js(global);
    }

    // SAFETY: `bun_vm()` never returns null for a Bun-owned global.
    let entropy = global.bun_vm().as_mut().rare_data().entropy_slice(10);
    let randomness: &[u8; 10] = (&*entropy).try_into().expect("infallible: size matches");
    uuid::print_ulid(
        timestamp,
        randomness,
        (&mut bytes[..uuid::ULID_STRING_LENGTH])
            .try_into()
            .expect("infallible: size matches"),
    );

    str.into_js(global)
}

#[bun_jsc::host_fn(export = "Bun__randomUUIDv5")]
fn bun_random_uuid_v5(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
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

    let name_buffer;
    let name: bun_core::Utf8Bytes = 'brk: {
        if name_value.is_string() {
            break 'brk name_value.to_utf8(global)?;
        } else if let Some(array_buffer) = name_value.as_array_buffer(global) {
            name_buffer = array_buffer;
            break 'brk bun_core::Utf8Bytes::Borrowed(name_buffer.byte_slice());
        } else {
            return Err(global
                .err(
                    bun_jsc::ErrorCode::INVALID_ARG_TYPE,
                    format_args!("The \"name\" argument must be of type string or BufferSource"),
                )
                .throw());
        }
    };

    let namespace: [u8; 16] = 'brk: {
        if namespace_value.is_string() {
            let namespace_str = namespace_value.to_bun_string(global)?;
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
        let (str, bytes) = BunString::create_uninitialized_latin1(36);
        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        return str.into_js(global);
    }

    encoding.encode_with_max_size(global, 32, &uuid.bytes)
}

#[unsafe(no_mangle)]
extern "C" fn CryptoObject__create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::mark_binding!();

    // Box::new aborts on OOM, so an out-of-memory throw arm is unreachable.
    // `JsClass::to_js` boxes `self` internally and transfers ownership to the JS wrapper.
    Crypto::default().to_js(global)
}
