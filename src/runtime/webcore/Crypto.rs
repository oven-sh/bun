use bun_core::String as BunString;
use bun_jsc::bindgen::{self, JsHeap, JsLocal, JsScope, StringOrJsBytes};
use bun_jsc::uuid::{self, UUID, UUID5, UUID7};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSType, JSValue, JsClass as _};

use crate::generated_bindgen::crypto::{EncodedUUID, UUIDEncodingOrTimestamp, UUIDTimestamp};
use crate::node::Encoding;

pub(crate) struct Crypto;

impl Crypto {
    pub(crate) fn get_random_values<'a>(
        &self,
        cx: &mut JsScope<'a>,
        array: JsLocal<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a>> {
        let global = cx.global();
        // https://w3c.github.io/webcrypto/#Crypto-method-getRandomValues accepts only
        // integer-typed views. This is an allow-list: DataView, ArrayBuffer and SharedArrayBuffer
        // all pass `as_array_buffer` but must still raise TypeMismatchError.
        let array_buffer = array.to_js().as_array_buffer(global).filter(|_| {
            matches!(
                array.to_js().js_type(),
                JSType::Int8Array
                    | JSType::Uint8Array
                    | JSType::Uint8ClampedArray
                    | JSType::Int16Array
                    | JSType::Uint16Array
                    | JSType::Int32Array
                    | JSType::Uint32Array
                    | JSType::BigInt64Array
                    | JSType::BigUint64Array
            )
        });
        let Some(mut array_buffer) = array_buffer else {
            return Err(global
                .throw_dom_exception(
                    bun_jsc::DOMExceptionCode::TypeMismatchError,
                    format_args!("The data argument must be an integer-type TypedArray"),
                )
                .into());
        };

        random_data(global, array_buffer.byte_slice_mut());

        Ok(array)
    }

    pub(crate) fn random_uuid(&self) -> BunString {
        let (str, bytes) = BunString::create_uninitialized_latin1(36);

        let uuid = VirtualMachine::get().as_mut().rare_data().next_uuid();

        uuid.print(
            (&mut bytes[0..36])
                .try_into()
                .expect("infallible: size matches"),
        );
        str
    }

    pub(crate) fn timing_safe_equal<'a>(
        &self,
        heap: &JsHeap<'a>,
        buf1: &'a [u8],
        buf2: &'a [u8],
    ) -> bindgen::Result<'a, bool> {
        timing_safe_equal(heap, buf1, buf2)
    }
}

pub(crate) fn timing_safe_equal<'a>(
    heap: &JsHeap<'a>,
    buf1: &[u8],
    buf2: &[u8],
) -> bindgen::Result<'a, bool> {
    if buf1.len() != buf2.len() {
        return Err(heap.error_with_code(
            bun_jsc::ErrorCode::CRYPTO_TIMING_SAFE_EQUAL_LENGTH,
            format_args!("Input buffers must have the same byte length"),
        ));
    }

    Ok(bun_boringssl::c::constant_time_eq(buf1, buf2))
}

fn random_data(global: &JSGlobalObject, slice: &mut [u8]) {
    const ENTROPY_CACHE_FAST_PATH_MAX: usize = bun_jsc::RareData::EntropyCache::SIZE / 8;
    match slice.len() {
        0 => {}
        // 512 bytes or less we reuse from the same cache as UUID generation.
        1..=ENTROPY_CACHE_FAST_PATH_MAX => {
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

fn encoding_from_label<'a>(heap: &JsHeap<'a>, label: &[u8]) -> bindgen::Result<'a, Encoding> {
    Encoding::from(label).ok_or_else(|| {
        heap.error_with_code(
            bun_jsc::ErrorCode::UNKNOWN_ENCODING,
            format_args!("Encoding must be one of base64, base64url, hex, or buffer"),
        )
    })
}

pub(crate) fn random_uuid_v7<'a>(
    heap: &JsHeap<'a>,
    encoding: UUIDEncodingOrTimestamp<'a>,
    timestamp: Option<UUIDTimestamp>,
) -> bindgen::Result<'a, EncodedUUID<'a>> {
    let (encoding, alone) = match encoding {
        UUIDEncodingOrTimestamp::Label(label) => (
            encoding_from_label(heap, label)?,
            Some(UUIDTimestamp::Clock),
        ),
        UUIDEncodingOrTimestamp::Clock => (Encoding::Hex, Some(UUIDTimestamp::Clock)),
        UUIDEncodingOrTimestamp::Time(time) => (Encoding::Hex, Some(UUIDTimestamp::Time(time))),
        UUIDEncodingOrTimestamp::Ignored(_) => (Encoding::Hex, None),
    };
    let Some(timestamp) = timestamp.or(alone) else {
        return Err(heap.invalid_arguments(format_args!("timestamp must be a number or Date")));
    };

    let (timestamp, timestamp_source): (u64, uuid::TimestampSource) = match timestamp {
        UUIDTimestamp::Time(time) => {
            // UUIDv7's unix_ts_ms field is 48 bits (RFC 9562 §5.7).
            const MAX_TIMESTAMP: i64 = (1i64 << 48) - 1;
            if !(0.0..=MAX_TIMESTAMP as f64).contains(&time) {
                return Err(heap.error_with_code(
                    bun_jsc::ErrorCode::OUT_OF_RANGE,
                    format_args!(
                        "{}",
                        bun_core::fmt::out_of_range(
                            time,
                            bun_jsc::RangeErrorOptions {
                                min: 0,
                                max: MAX_TIMESTAMP,
                                field_name: b"timestamp",
                                ..Default::default()
                            },
                        )
                    ),
                ));
            }
            if time.floor() != time {
                return Err(heap.invalid_arguments(format_args!(
                    "The \"timestamp\" property must be of type integer. Received number"
                )));
            }
            (time as u64, uuid::TimestampSource::Explicit)
        }
        UUIDTimestamp::Clock => (
            u64::try_from(bun_core::time::milli_timestamp().max(0)).expect("int cast"),
            uuid::TimestampSource::Clock,
        ),
    };

    let entropy = VirtualMachine::get().as_mut().rare_data().entropy_slice(10);

    let uuid = UUID7::init(
        timestamp,
        <[u8; 10]>::try_from(&entropy[0..10]).unwrap(),
        timestamp_source,
    );

    match encoding {
        Encoding::Hex => {
            let (str, bytes) = BunString::create_uninitialized_latin1(36);
            uuid.print(
                (&mut bytes[0..36])
                    .try_into()
                    .expect("infallible: size matches"),
            );
            Ok(EncodedUUID::Text(str))
        }
        Encoding::Buffer => Ok(EncodedUUID::Bytes(heap.create_buffer(&uuid.bytes)?)),
        encoding => Ok(EncodedUUID::Text(crate::webcore::encoding::to_bun_string(
            &uuid.bytes,
            encoding,
        ))),
    }
}

pub(crate) fn random_uuid_v5<'a>(
    heap: &JsHeap<'a>,
    name: &[u8],
    namespace: StringOrJsBytes<'a>,
    encoding: Option<&[u8]>,
) -> bindgen::Result<'a, EncodedUUID<'a>> {
    let encoding = match encoding {
        Some(label) => encoding_from_label(heap, label)?,
        None => Encoding::Hex,
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
            Ok(EncodedUUID::Text(str))
        }
        Encoding::Buffer => Ok(EncodedUUID::Bytes(
            heap.create_buffer_from_box(Box::from(uuid.bytes))?,
        )),
        encoding => Ok(EncodedUUID::Text(crate::webcore::encoding::to_bun_string(
            &uuid.bytes,
            encoding,
        ))),
    }
}

#[unsafe(no_mangle)]
extern "C" fn CryptoObject__create(global: &JSGlobalObject) -> JSValue {
    bun_jsc::mark_binding!();

    Crypto.to_js(global)
}
