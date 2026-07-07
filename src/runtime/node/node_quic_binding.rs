//! The `node:quic` native binding object — Bun's equivalent of Node's
//! `internalBinding('quic')` (reference: node/src/quic/*, v26.3.0).
//!
//! The JS layer (`src/js/internal/quic/binding.ts`) loads this once per realm
//! via `$rust("node_quic_binding.rs", "createNodeQuicBinding")` and
//! immediately registers its callbacks through `setCallbacks()`. Constant
//! names and values mirror Node exactly; state byte offsets are derived from
//! the `#[repr(C)]` state structs that back the handles' `state` buffers so
//! they cannot drift. The endpoint/session/stream implementations live in
//! `src/runtime/node/quic/`.

use bun_jsc::{self as jsc, CallFrame, JSFunction, JSGlobalObject, JSValue, JsResult, StringJsc};

use super::quic::{callbacks, endpoint, session, stream};

/// The `on*` callback names required by `setCallbacks()`, without the `on`
/// prefix (Node: `QUIC_JS_CALLBACKS` in node/src/quic/bindingdata.h).
const QUIC_CALLBACK_NAMES: &[&str] = &[
    "EndpointClose",
    "SessionClose",
    "SessionEarlyDataRejected",
    "SessionGoaway",
    "SessionDatagram",
    "SessionDatagramStatus",
    "SessionHandshake",
    "SessionKeyLog",
    "SessionQlog",
    "SessionNew",
    "SessionNewToken",
    "SessionOrigin",
    "SessionPathValidation",
    "SessionTicket",
    "SessionVersionNegotiation",
    "StreamBlocked",
    "StreamClose",
    "StreamCreated",
    "StreamDrain",
    "StreamHeaders",
    "StreamReset",
    "StreamTrailers",
];

#[bun_jsc::host_fn]
fn set_callbacks(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    // Only the first call takes effect; subsequent calls are ignored
    // (node/src/quic/bindingdata.cc `BindingData::SetCallbacks`).
    if global
        .bun_vm()
        .as_mut()
        .rare_data()
        .node_quic_callbacks
        .get()
        .is_some()
    {
        return Ok(JSValue::UNDEFINED);
    }
    let callbacks_obj = frame.arguments_as_array::<1>()[0];
    if !callbacks_obj.is_object() {
        return Err(global
            .err(
                jsc::ErrorCode::INVALID_ARG_TYPE,
                format_args!("The \"callbacks\" argument must be of type object"),
            )
            .throw());
    }
    let mut name = String::with_capacity(32);
    for key in QUIC_CALLBACK_NAMES {
        name.clear();
        name.push_str("on");
        name.push_str(key);
        let value = callbacks_obj.get(global, name.as_str())?;
        if !value.is_some_and(JSValue::is_callable) {
            return Err(global
                .err(
                    jsc::ErrorCode::MISSING_ARGS,
                    format_args!("Missing Callback: on{key}"),
                )
                .throw());
        }
    }
    callbacks::set(global, callbacks_obj);
    Ok(JSValue::UNDEFINED)
}

fn put_num(obj: JSValue, global: &JSGlobalObject, key: &str, value: u64) {
    obj.put(global, key.as_bytes(), JSValue::js_number(value as f64));
}

fn put_str(obj: JSValue, global: &JSGlobalObject, key: &str, value: &'static [u8]) -> JsResult<()> {
    let value = bun_core::String::static_(value).to_js(global)?;
    obj.put(global, key.as_bytes(), value);
    Ok(())
}

macro_rules! put_state_offsets {
    ($obj:expr, $global:expr, $prefix:literal, $struct:ty, { $($NAME:literal => $field:ident),+ $(,)? }) => {
        $(
            put_num($obj, $global, concat!($prefix, $NAME), core::mem::offset_of!($struct, $field) as u64);
        )+
    };
}

macro_rules! put_state_offsets_with_size {
    ($obj:expr, $global:expr, $prefix:literal, $struct:ty, { $($NAME:literal => $field:ident : $ty:ty),+ $(,)? }) => {
        $(
            put_num($obj, $global, concat!($prefix, $NAME), core::mem::offset_of!($struct, $field) as u64);
            put_num($obj, $global, concat!($prefix, $NAME, "_SIZE"), core::mem::size_of::<$ty>() as u64);
        )+
    };
}

/// `$rust("node_quic_binding.rs", "createNodeQuicBinding")`.
pub(crate) fn create_node_quic_binding(global: &JSGlobalObject) -> JsResult<JSValue> {
    let obj = JSValue::create_empty_object(global, 16);

    obj.put(
        global,
        b"Endpoint",
        crate::generated_classes::js_QuicEndpoint::get_constructor(global),
    );
    obj.put(
        global,
        b"setCallbacks",
        JSFunction::create(
            global,
            "setCallbacks",
            __jsc_host_set_callbacks,
            1,
            Default::default(),
        ),
    );

    // ── Endpoint constants (node/src/quic/endpoint.cc Endpoint::InitPerContext) ──
    for (i, name) in endpoint::ENDPOINT_STATS_FIELDS.iter().enumerate() {
        put_num(obj, global, &format!("IDX_STATS_ENDPOINT_{name}"), i as u64);
    }
    put_num(
        obj,
        global,
        "IDX_STATS_ENDPOINT_COUNT",
        endpoint::ENDPOINT_STATS_FIELDS.len() as u64,
    );
    put_state_offsets_with_size!(obj, global, "IDX_STATE_ENDPOINT_", endpoint::EndpointState, {
        "BOUND" => bound: u8,
        "RECEIVING" => receiving: u8,
        "LISTENING" => listening: u8,
        "CLOSING" => closing: u8,
        "BUSY" => busy: u8,
        "MAX_CONNECTIONS_PER_HOST" => max_connections_per_host: u16,
        "MAX_CONNECTIONS_TOTAL" => max_connections_total: u16,
        "PENDING_CALLBACKS" => pending_callbacks: u64,
    });
    put_num(obj, global, "DEFAULT_MAX_SOCKETADDRESS_LRU_SIZE", 1024);
    // 10 * NGTCP2_SECONDS / NGTCP2_SECONDS (node/src/quic/tokens.h).
    put_num(obj, global, "DEFAULT_RETRYTOKEN_EXPIRATION", 10);
    put_num(obj, global, "DEFAULT_REGULARTOKEN_EXPIRATION", 10);
    // kDefaultMaxPacketLength = NGTCP2_MAX_UDP_PAYLOAD_SIZE.
    put_num(obj, global, "DEFAULT_MAX_PACKET_LENGTH", 1200);
    put_num(
        obj,
        global,
        "CLOSECONTEXT_CLOSE",
        endpoint::CLOSECONTEXT_CLOSE as u64,
    );
    put_num(
        obj,
        global,
        "CLOSECONTEXT_BIND_FAILURE",
        endpoint::CLOSECONTEXT_BIND_FAILURE as u64,
    );
    put_num(
        obj,
        global,
        "CLOSECONTEXT_LISTEN_FAILURE",
        endpoint::CLOSECONTEXT_LISTEN_FAILURE as u64,
    );
    put_num(
        obj,
        global,
        "CLOSECONTEXT_RECEIVE_FAILURE",
        endpoint::CLOSECONTEXT_RECEIVE_FAILURE as u64,
    );
    put_num(
        obj,
        global,
        "CLOSECONTEXT_SEND_FAILURE",
        endpoint::CLOSECONTEXT_SEND_FAILURE as u64,
    );
    put_num(
        obj,
        global,
        "CLOSECONTEXT_START_FAILURE",
        endpoint::CLOSECONTEXT_START_FAILURE as u64,
    );

    // ── Session constants (node/src/quic/session.cc Session::InitPerContext) ──
    put_num(obj, global, "CC_ALGO_RENO", 0);
    put_num(obj, global, "CC_ALGO_CUBIC", 1);
    put_num(obj, global, "CC_ALGO_BBR", 2);
    put_str(obj, global, "CC_ALGO_RENO_STR", b"reno")?;
    put_str(obj, global, "CC_ALGO_CUBIC_STR", b"cubic")?;
    put_str(obj, global, "CC_ALGO_BBR_STR", b"bbr")?;
    // TransportParams::Initialize (node/src/quic/transportparams.h).
    put_num(obj, global, "DEFAULT_MAX_STREAM_DATA", 256 * 1024);
    put_num(obj, global, "DEFAULT_MAX_DATA", 1024 * 1024);
    put_num(obj, global, "DEFAULT_MAX_IDLE_TIMEOUT", 10);
    put_num(obj, global, "DEFAULT_MAX_STREAMS_BIDI", 100);
    put_num(obj, global, "DEFAULT_MAX_STREAMS_UNI", 3);
    put_num(obj, global, "DEFAULT_ACTIVE_CONNECTION_ID_LIMIT", 2);
    // PreferredAddress::Initialize (node/src/quic/preferredaddress.{h,cc}).
    put_num(obj, global, "PREFERRED_ADDRESS_IGNORE", 0);
    put_num(obj, global, "PREFERRED_ADDRESS_USE", 1);
    put_num(obj, global, "DEFAULT_PREFERRED_ADDRESS_POLICY", 0);
    put_num(obj, global, "STREAM_DIRECTION_BIDIRECTIONAL", 0);
    put_num(obj, global, "STREAM_DIRECTION_UNIDIRECTIONAL", 1);
    // node/src/node_http_common.h.
    put_num(obj, global, "DEFAULT_MAX_HEADER_LIST_PAIRS", 128);
    put_num(obj, global, "DEFAULT_MAX_HEADER_LENGTH", 8192);
    // NGTCP2_PROTO_VER_MAX/MIN == NGTCP2_PROTO_VER_V1.
    put_num(obj, global, "QUIC_PROTO_MAX", 1);
    put_num(obj, global, "QUIC_PROTO_MIN", 1);
    put_num(obj, global, "DEFAULT_HANDSHAKE_TIMEOUT", 10_000);
    put_str(
        obj,
        global,
        "DEFAULT_CIPHERS",
        b"TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_128_CCM_SHA256",
    )?;
    put_str(obj, global, "DEFAULT_GROUPS", b"X25519:P-256:P-384:P-521")?;
    for (i, name) in session::SESSION_STATS_FIELDS.iter().enumerate() {
        put_num(obj, global, &format!("IDX_STATS_SESSION_{name}"), i as u64);
    }
    put_num(
        obj,
        global,
        "IDX_STATS_SESSION_COUNT",
        session::SESSION_STATS_FIELDS.len() as u64,
    );
    put_state_offsets!(obj, global, "IDX_STATE_SESSION_", session::SessionState, {
        "LISTENER_FLAGS" => listener_flags,
        "CLOSING" => closing,
        "GRACEFUL_CLOSE" => graceful_close,
        "SILENT_CLOSE" => silent_close,
        "STATELESS_RESET" => stateless_reset,
        "HANDSHAKE_COMPLETED" => handshake_completed,
        "HANDSHAKE_CONFIRMED" => handshake_confirmed,
        "STREAM_OPEN_ALLOWED" => stream_open_allowed,
        "PRIORITY_SUPPORTED" => priority_supported,
        "HEADERS_SUPPORTED" => headers_supported,
        "WRAPPED" => wrapped,
        "APPLICATION_TYPE" => application_type,
        "NO_ERROR_CODE" => no_error_code,
        "INTERNAL_ERROR_CODE" => internal_error_code,
        "MAX_DATAGRAM_SIZE" => max_datagram_size,
        "LAST_DATAGRAM_ID" => last_datagram_id,
        "MAX_PENDING_DATAGRAMS" => max_pending_datagrams,
    });

    // ── Stream constants (node/src/quic/streams.cc Stream::InitPerContext) ──
    for (i, name) in stream::STREAM_STATS_FIELDS.iter().enumerate() {
        put_num(obj, global, &format!("IDX_STATS_STREAM_{name}"), i as u64);
    }
    put_num(
        obj,
        global,
        "IDX_STATS_STREAM_COUNT",
        stream::STREAM_STATS_FIELDS.len() as u64,
    );
    put_state_offsets!(obj, global, "IDX_STATE_STREAM_", stream::StreamState, {
        "ID" => id,
        "PENDING" => pending,
        "FIN_SENT" => fin_sent,
        "FIN_RECEIVED" => fin_received,
        "READ_ENDED" => read_ended,
        "WRITE_ENDED" => write_ended,
        "RESET" => reset,
        "RESET_CODE" => reset_code,
        "HAS_OUTBOUND" => has_outbound,
        "HAS_READER" => has_reader,
        "WANTS_BLOCK" => wants_block,
        "WANTS_HEADERS" => wants_headers,
        "WANTS_RESET" => wants_reset,
        "WANTS_TRAILERS" => wants_trailers,
        "RECEIVED_EARLY_DATA" => received_early_data,
        "WRITE_DESIRED_SIZE" => write_desired_size,
        "HIGH_WATER_MARK" => high_water_mark,
    });
    put_num(obj, global, "QUIC_STREAM_HEADERS_KIND_HINTS", 0);
    put_num(obj, global, "QUIC_STREAM_HEADERS_KIND_INITIAL", 1);
    put_num(obj, global, "QUIC_STREAM_HEADERS_KIND_TRAILING", 2);
    put_num(obj, global, "QUIC_STREAM_HEADERS_FLAGS_NONE", 0);
    put_num(obj, global, "QUIC_STREAM_HEADERS_FLAGS_TERMINAL", 1);

    Ok(obj)
}
