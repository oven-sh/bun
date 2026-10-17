use bun_core::String as BunString;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, StringOrJsBytes};
use bun_jsc::uuid::{self, UUID, UUID5, UUID7};
use bun_jsc::{CallFrame, JSGlobalObject, JSType, JSValue, JsClass, JsResult, StringJsc};

use crate::generated_bindgen::crypto::UUIDEncoding;
use crate::node::Encoding;

// `.classes.ts`-backed type: the C++ JSCell wrapper stays generated C++.
// This struct is the `m_ctx` payload. `toJS`/`fromJS`/`fromJSDirect` are
// provided by the attribute macro — do not hand-port the `pub const js = jsc.Codegen.JSCrypto`
// alias block.
#[bun_jsc::JsClass]
#[derive(Default)]
pub(crate) struct Crypto {}

impl Crypto {
    #[bun_jsc::host_fn(method)]
    pub(crate) fn timing_safe_equal(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        crate::node::crypto::timing_safe_equal(global, callframe)
    }

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
                    return Err(global.throw_range_error(date, range_opts));
                }
                break 'brk (date as u64, uuid::TimestampSource::Explicit);
            }
            if timestamp_value.is_number() && timestamp_value.as_number().is_nan() {
                return Err(global.throw_range_error(f64::NAN, range_opts));
            }
            break 'brk (
                u64::try_from(global.validate_integer_range::<i64>(
                    timestamp_value,
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

pub(crate) fn random_uuid_v5<'a>(
    heap: &JsHeap<'a>,
    name: &[u8],
    namespace: StringOrJsBytes<'a>,
    encoding: UUIDEncoding<'a>,
) -> bindgen::Result<'a, JsLocal<'a>> {
    let encoding = match encoding {
        UUIDEncoding::Label(label) => Encoding::from(label).ok_or_else(|| {
            heap.error_with_code(
                bun_jsc::ErrorCode::UNKNOWN_ENCODING,
                format_args!("Encoding must be one of base64, base64url, hex, or buffer"),
            )
        })?,
        UUIDEncoding::Ignored(_) => Encoding::Hex,
    };
    let invalid_value = |message: &str| {
        heap.error_with_code(
            bun_jsc::ErrorCode::INVALID_ARG_VALUE,
            format_args!("{message}"),
        )
    };

    let namespace: [u8; 16] = match namespace {
        StringOrJsBytes::String(text) => {
            let text = text.to_utf8();
            if text.len() == 36 {
                UUID::parse(&text)
                    .map_err(|_| invalid_value("Invalid UUID format for namespace"))?
                    .bytes
            } else {
                *uuid::namespaces::get(&text)
                    .ok_or_else(|| invalid_value("Invalid UUID format for namespace"))?
            }
        }
        StringOrJsBytes::Bytes(bytes) => bytes
            .get(heap)
            .try_into()
            .map_err(|_| invalid_value("Namespace must be exactly 16 bytes"))?,
    };

    let uuid = UUID5::init(&namespace, name);

    match encoding {
        Encoding::Hex => {
            let (str, bytes) = BunString::create_uninitialized_latin1(36);
            uuid.print(
                (&mut bytes[0..36])
                    .try_into()
                    .expect("infallible: size matches"),
            );
            bindgen::to_js::string(heap, str)
        }
        Encoding::Buffer => Ok(heap
            .create_buffer_from_box(Box::from(uuid.bytes))?
            .as_value()),
        encoding => bindgen::to_js::string(
            heap,
            crate::webcore::encoding::to_bun_string(&uuid.bytes, encoding),
        ),
    }
}

#[unsafe(no_mangle)]
extern "C" fn CryptoObject__create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::mark_binding!();

    // Box::new aborts on OOM, so an out-of-memory throw arm is unreachable.
    // `JsClass::to_js` boxes `self` internally and transfers ownership to the JS wrapper.
    Crypto::default().to_js(global)
}
