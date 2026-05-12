//! Node-compat error codes — generated from `src/jsc/bindings/ErrorCode.ts`.
//!
//! Mirrors `build/*/codegen/ErrorCode.zig` (`pub const Error = enum(u16)`) and
//! C++ `Bun::ErrorCode` in `ErrorCode+List.h`. Discriminants MUST stay
//! index-aligned with the C++ `errors[]` table so `Bun__createErrorWithCode`
//! picks the correct ctor / name / code triple.
//!
//! Regenerate by re-running the inline extractor against `ErrorCode.ts`; do
//! not hand-edit individual entries.

#![allow(non_upper_case_globals)]

use core::ffi::c_void;
use core::fmt::Arguments;

use crate::{JSGlobalObject, JSPromise, JSValue, JsError};

// ──────────────────────────────────────────────────────────────────────────
// `JSGlobalObject` is currently defined twice during the port: the legacy
// opaque stub at `crate::JSGlobalObject` (lib.rs) and the real port at
// `crate::js_global_object::JSGlobalObject`. Both are `#[repr(C)]` zero-sized
// opaque handles to the same C++ `JSC::JSGlobalObject`, so they are ABI-
// identical and a `&T → *mut c_void` reinterpret is sound. `ErrorCode::fmt`
// et al. are called from both sides; this trait erases the nominal split
// until the stub is removed and `js_global_object::JSGlobalObject` becomes
// the sole re-export.
// ──────────────────────────────────────────────────────────────────────────
pub trait GlobalObjectRef {
    /// Raw `JSC::JSGlobalObject*` for FFI.
    fn as_global_ptr(&self) -> *mut c_void;
    /// `globalThis.vm().throwError(globalThis, value)`.
    fn throw_js_value(&self, value: JSValue) -> JsError;
}

impl GlobalObjectRef for crate::JSGlobalObject {
    #[inline]
    fn as_global_ptr(&self) -> *mut c_void {
        std::ptr::from_ref::<Self>(self).cast_mut().cast::<c_void>()
    }
    #[inline]
    fn throw_js_value(&self, value: JSValue) -> JsError {
        self.throw_value(value)
    }
}

type ErrorCodeInt = u16;

/// `@import("ErrorCode").Error` — `enum(u16)` in Zig codegen, `Bun::ErrorCode`
/// in C++. Modelled as a newtype-over-`u16` so the same type can also carry
/// the legacy `anyerror`-derived sentinels (`PARSER_ERROR` / `JS_ERROR_OBJECT`)
/// from `src/jsc/ErrorCode.zig` without an exhaustive-match obligation.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct ErrorCode(pub ErrorCodeInt);

// ──────────────────────────────────────────────────────────────────────────
// Codegen'd from src/jsc/bindings/ErrorCode.ts
// ──────────────────────────────────────────────────────────────────────────
impl ErrorCode {
    /// `ABORT_ERR` (instanceof Error)
    pub const ABORT_ERR: ErrorCode = ErrorCode(0);
    /// `ERR_ACCESS_DENIED` (instanceof Error)
    pub const ACCESS_DENIED: ErrorCode = ErrorCode(1);
    /// `ERR_AMBIGUOUS_ARGUMENT` (instanceof TypeError)
    pub const AMBIGUOUS_ARGUMENT: ErrorCode = ErrorCode(2);
    /// `ERR_ARG_NOT_ITERABLE` (instanceof TypeError)
    pub const ARG_NOT_ITERABLE: ErrorCode = ErrorCode(3);
    /// `ERR_ASSERTION` (instanceof Error)
    pub const ASSERTION: ErrorCode = ErrorCode(4);
    /// `ERR_ASYNC_CALLBACK` (instanceof TypeError)
    pub const ASYNC_CALLBACK: ErrorCode = ErrorCode(5);
    /// `ERR_ASYNC_TYPE` (instanceof TypeError)
    pub const ASYNC_TYPE: ErrorCode = ErrorCode(6);
    /// `ERR_BODY_ALREADY_USED` (instanceof TypeError)
    pub const BODY_ALREADY_USED: ErrorCode = ErrorCode(7);
    /// `ERR_BORINGSSL` (instanceof Error)
    pub const BORINGSSL: ErrorCode = ErrorCode(8);
    /// `ERR_ZSTD` (instanceof Error)
    pub const ZSTD: ErrorCode = ErrorCode(9);
    /// `ERR_BROTLI_INVALID_PARAM` (instanceof RangeError)
    pub const BROTLI_INVALID_PARAM: ErrorCode = ErrorCode(10);
    /// `ERR_BUFFER_CONTEXT_NOT_AVAILABLE` (instanceof Error)
    pub const BUFFER_CONTEXT_NOT_AVAILABLE: ErrorCode = ErrorCode(11);
    /// `ERR_BUFFER_OUT_OF_BOUNDS` (instanceof RangeError)
    pub const BUFFER_OUT_OF_BOUNDS: ErrorCode = ErrorCode(12);
    /// `ERR_BUFFER_TOO_LARGE` (instanceof RangeError)
    pub const BUFFER_TOO_LARGE: ErrorCode = ErrorCode(13);
    /// `ERR_CHILD_PROCESS_IPC_REQUIRED` (instanceof Error)
    pub const CHILD_PROCESS_IPC_REQUIRED: ErrorCode = ErrorCode(14);
    /// `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` (instanceof RangeError)
    pub const CHILD_PROCESS_STDIO_MAXBUFFER: ErrorCode = ErrorCode(15);
    /// `ERR_CLOSED_MESSAGE_PORT` (instanceof Error)
    pub const CLOSED_MESSAGE_PORT: ErrorCode = ErrorCode(16);
    /// `ERR_CONSOLE_WRITABLE_STREAM` (instanceof TypeError)
    pub const CONSOLE_WRITABLE_STREAM: ErrorCode = ErrorCode(17);
    /// `ERR_CONSTRUCT_CALL_INVALID` (instanceof TypeError)
    pub const CONSTRUCT_CALL_INVALID: ErrorCode = ErrorCode(18);
    /// `ERR_CONSTRUCT_CALL_REQUIRED` (instanceof TypeError)
    pub const CONSTRUCT_CALL_REQUIRED: ErrorCode = ErrorCode(19);
    /// `ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED` (instanceof Error)
    pub const CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED: ErrorCode = ErrorCode(20);
    /// `ERR_CRYPTO_ECDH_INVALID_FORMAT` (instanceof TypeError)
    pub const CRYPTO_ECDH_INVALID_FORMAT: ErrorCode = ErrorCode(21);
    /// `ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY` (instanceof Error)
    pub const CRYPTO_ECDH_INVALID_PUBLIC_KEY: ErrorCode = ErrorCode(22);
    /// `ERR_CRYPTO_HASH_FINALIZED` (instanceof Error)
    pub const CRYPTO_HASH_FINALIZED: ErrorCode = ErrorCode(23);
    /// `ERR_CRYPTO_HASH_UPDATE_FAILED` (instanceof Error)
    pub const CRYPTO_HASH_UPDATE_FAILED: ErrorCode = ErrorCode(24);
    /// `ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS` (instanceof Error)
    pub const CRYPTO_INCOMPATIBLE_KEY_OPTIONS: ErrorCode = ErrorCode(25);
    /// `ERR_CRYPTO_INCOMPATIBLE_KEY` (instanceof Error)
    pub const CRYPTO_INCOMPATIBLE_KEY: ErrorCode = ErrorCode(26);
    /// `ERR_CRYPTO_INITIALIZATION_FAILED` (instanceof Error)
    pub const CRYPTO_INITIALIZATION_FAILED: ErrorCode = ErrorCode(27);
    /// `ERR_CRYPTO_INVALID_AUTH_TAG` (instanceof TypeError)
    pub const CRYPTO_INVALID_AUTH_TAG: ErrorCode = ErrorCode(28);
    /// `ERR_CRYPTO_INVALID_COUNTER` (instanceof TypeError)
    pub const CRYPTO_INVALID_COUNTER: ErrorCode = ErrorCode(29);
    /// `ERR_CRYPTO_INVALID_CURVE` (instanceof TypeError)
    pub const CRYPTO_INVALID_CURVE: ErrorCode = ErrorCode(30);
    /// `ERR_CRYPTO_INVALID_DIGEST` (instanceof TypeError)
    pub const CRYPTO_INVALID_DIGEST: ErrorCode = ErrorCode(31);
    /// `ERR_CRYPTO_INVALID_IV` (instanceof TypeError)
    pub const CRYPTO_INVALID_IV: ErrorCode = ErrorCode(32);
    /// `ERR_CRYPTO_INVALID_JWK` (instanceof TypeError)
    pub const CRYPTO_INVALID_JWK: ErrorCode = ErrorCode(33);
    /// `ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE` (instanceof TypeError)
    pub const CRYPTO_INVALID_KEY_OBJECT_TYPE: ErrorCode = ErrorCode(34);
    /// `ERR_CRYPTO_INVALID_KEYLEN` (instanceof RangeError)
    pub const CRYPTO_INVALID_KEYLEN: ErrorCode = ErrorCode(35);
    /// `ERR_CRYPTO_INVALID_KEYPAIR` (instanceof RangeError)
    pub const CRYPTO_INVALID_KEYPAIR: ErrorCode = ErrorCode(36);
    /// `ERR_CRYPTO_INVALID_KEYTYPE` (instanceof RangeError)
    pub const CRYPTO_INVALID_KEYTYPE: ErrorCode = ErrorCode(37);
    /// `ERR_CRYPTO_INVALID_MESSAGELEN` (instanceof RangeError)
    pub const CRYPTO_INVALID_MESSAGELEN: ErrorCode = ErrorCode(38);
    /// `ERR_CRYPTO_INVALID_SCRYPT_PARAMS` (instanceof RangeError)
    pub const CRYPTO_INVALID_SCRYPT_PARAMS: ErrorCode = ErrorCode(39);
    /// `ERR_CRYPTO_INVALID_STATE` (instanceof Error)
    pub const CRYPTO_INVALID_STATE: ErrorCode = ErrorCode(40);
    /// `ERR_CRYPTO_INVALID_TAG_LENGTH` (instanceof RangeError)
    pub const CRYPTO_INVALID_TAG_LENGTH: ErrorCode = ErrorCode(41);
    /// `ERR_CRYPTO_JOB_INIT_FAILED` (instanceof Error)
    pub const CRYPTO_JOB_INIT_FAILED: ErrorCode = ErrorCode(42);
    /// `ERR_CRYPTO_JWK_UNSUPPORTED_CURVE` (instanceof Error)
    pub const CRYPTO_JWK_UNSUPPORTED_CURVE: ErrorCode = ErrorCode(43);
    /// `ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE` (instanceof Error)
    pub const CRYPTO_JWK_UNSUPPORTED_KEY_TYPE: ErrorCode = ErrorCode(44);
    /// `ERR_CRYPTO_OPERATION_FAILED` (instanceof Error)
    pub const CRYPTO_OPERATION_FAILED: ErrorCode = ErrorCode(45);
    /// `ERR_CRYPTO_SCRYPT_INVALID_PARAMETER` (instanceof Error)
    pub const CRYPTO_SCRYPT_INVALID_PARAMETER: ErrorCode = ErrorCode(46);
    /// `ERR_CRYPTO_SIGN_KEY_REQUIRED` (instanceof Error)
    pub const CRYPTO_SIGN_KEY_REQUIRED: ErrorCode = ErrorCode(47);
    /// `ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH` (instanceof RangeError)
    pub const CRYPTO_TIMING_SAFE_EQUAL_LENGTH: ErrorCode = ErrorCode(48);
    /// `ERR_CRYPTO_UNKNOWN_CIPHER` (instanceof Error)
    pub const CRYPTO_UNKNOWN_CIPHER: ErrorCode = ErrorCode(49);
    /// `ERR_CRYPTO_UNKNOWN_DH_GROUP` (instanceof Error)
    pub const CRYPTO_UNKNOWN_DH_GROUP: ErrorCode = ErrorCode(50);
    /// `ERR_CRYPTO_UNSUPPORTED_OPERATION` (instanceof Error)
    pub const CRYPTO_UNSUPPORTED_OPERATION: ErrorCode = ErrorCode(51);
    /// `ERR_DIR_CLOSED` (instanceof Error)
    pub const DIR_CLOSED: ErrorCode = ErrorCode(52);
    /// `ERR_DLOPEN_DISABLED` (instanceof Error)
    pub const DLOPEN_DISABLED: ErrorCode = ErrorCode(53);
    /// `ERR_DLOPEN_FAILED` (instanceof Error)
    pub const DLOPEN_FAILED: ErrorCode = ErrorCode(54);
    /// `ERR_DNS_SET_SERVERS_FAILED` (instanceof Error)
    pub const DNS_SET_SERVERS_FAILED: ErrorCode = ErrorCode(55);
    /// `ERR_ENCODING_INVALID_ENCODED_DATA` (instanceof TypeError)
    pub const ENCODING_INVALID_ENCODED_DATA: ErrorCode = ErrorCode(56);
    /// `ERR_ENCODING_NOT_SUPPORTED` (instanceof RangeError)
    pub const ENCODING_NOT_SUPPORTED: ErrorCode = ErrorCode(57);
    /// `ERR_EVENT_RECURSION` (instanceof Error)
    pub const EVENT_RECURSION: ErrorCode = ErrorCode(58);
    /// `ERR_EXECUTION_ENVIRONMENT_NOT_AVAILABLE` (instanceof Error)
    pub const EXECUTION_ENVIRONMENT_NOT_AVAILABLE: ErrorCode = ErrorCode(59);
    /// `ERR_FEATURE_UNAVAILABLE_ON_PLATFORM` (instanceof TypeError)
    pub const FEATURE_UNAVAILABLE_ON_PLATFORM: ErrorCode = ErrorCode(60);
    /// `ERR_FORMDATA_PARSE_ERROR` (instanceof TypeError)
    pub const FORMDATA_PARSE_ERROR: ErrorCode = ErrorCode(61);
    /// `ERR_FS_CP_DIR_TO_NON_DIR` (instanceof Error)
    pub const FS_CP_DIR_TO_NON_DIR: ErrorCode = ErrorCode(62);
    /// `ERR_FS_CP_EINVAL` (instanceof Error)
    pub const FS_CP_EINVAL: ErrorCode = ErrorCode(63);
    /// `ERR_FS_CP_FIFO_PIPE` (instanceof Error)
    pub const FS_CP_FIFO_PIPE: ErrorCode = ErrorCode(64);
    /// `ERR_FS_CP_NON_DIR_TO_DIR` (instanceof Error)
    pub const FS_CP_NON_DIR_TO_DIR: ErrorCode = ErrorCode(65);
    /// `ERR_FS_CP_SOCKET` (instanceof Error)
    pub const FS_CP_SOCKET: ErrorCode = ErrorCode(66);
    /// `ERR_FS_CP_UNKNOWN` (instanceof Error)
    pub const FS_CP_UNKNOWN: ErrorCode = ErrorCode(67);
    /// `ERR_FS_EISDIR` (instanceof Error)
    pub const FS_EISDIR: ErrorCode = ErrorCode(68);
    /// `ERR_HTTP_BODY_NOT_ALLOWED` (instanceof Error)
    pub const HTTP_BODY_NOT_ALLOWED: ErrorCode = ErrorCode(69);
    /// `ERR_HTTP_HEADERS_SENT` (instanceof Error)
    pub const HTTP_HEADERS_SENT: ErrorCode = ErrorCode(70);
    /// `ERR_HTTP_CONTENT_LENGTH_MISMATCH` (instanceof Error)
    pub const HTTP_CONTENT_LENGTH_MISMATCH: ErrorCode = ErrorCode(71);
    /// `ERR_HTTP_INVALID_HEADER_VALUE` (instanceof TypeError)
    pub const HTTP_INVALID_HEADER_VALUE: ErrorCode = ErrorCode(72);
    /// `ERR_HTTP_INVALID_STATUS_CODE` (instanceof RangeError)
    pub const HTTP_INVALID_STATUS_CODE: ErrorCode = ErrorCode(73);
    /// `ERR_HTTP_TRAILER_INVALID` (instanceof Error)
    pub const HTTP_TRAILER_INVALID: ErrorCode = ErrorCode(74);
    /// `ERR_HTTP_SOCKET_ASSIGNED` (instanceof Error)
    pub const HTTP_SOCKET_ASSIGNED: ErrorCode = ErrorCode(75);
    /// `ERR_HTTP2_ALTSVC_INVALID_ORIGIN` (instanceof TypeError)
    pub const HTTP2_ALTSVC_INVALID_ORIGIN: ErrorCode = ErrorCode(76);
    /// `ERR_HTTP2_ALTSVC_LENGTH` (instanceof TypeError)
    pub const HTTP2_ALTSVC_LENGTH: ErrorCode = ErrorCode(77);
    /// `ERR_HTTP2_CONNECT_AUTHORITY` (instanceof Error)
    pub const HTTP2_CONNECT_AUTHORITY: ErrorCode = ErrorCode(78);
    /// `ERR_HTTP2_CONNECT_SCHEME` (instanceof Error)
    pub const HTTP2_CONNECT_SCHEME: ErrorCode = ErrorCode(79);
    /// `ERR_HTTP2_CONNECT_PATH` (instanceof Error)
    pub const HTTP2_CONNECT_PATH: ErrorCode = ErrorCode(80);
    /// `ERR_HTTP2_ERROR` (instanceof Error)
    pub const HTTP2_ERROR: ErrorCode = ErrorCode(81);
    /// `ERR_HTTP2_HEADER_SINGLE_VALUE` (instanceof TypeError)
    pub const HTTP2_HEADER_SINGLE_VALUE: ErrorCode = ErrorCode(82);
    /// `ERR_HTTP2_HEADERS_AFTER_RESPOND` (instanceof Error)
    pub const HTTP2_HEADERS_AFTER_RESPOND: ErrorCode = ErrorCode(83);
    /// `ERR_HTTP2_HEADERS_SENT` (instanceof Error)
    pub const HTTP2_HEADERS_SENT: ErrorCode = ErrorCode(84);
    /// `ERR_HTTP2_INFO_STATUS_NOT_ALLOWED` (instanceof RangeError)
    pub const HTTP2_INFO_STATUS_NOT_ALLOWED: ErrorCode = ErrorCode(85);
    /// `ERR_HTTP2_INVALID_HEADER_VALUE` (instanceof TypeError)
    pub const HTTP2_INVALID_HEADER_VALUE: ErrorCode = ErrorCode(86);
    /// `ERR_HTTP2_INVALID_INFO_STATUS` (instanceof RangeError)
    pub const HTTP2_INVALID_INFO_STATUS: ErrorCode = ErrorCode(87);
    /// `ERR_HTTP2_INVALID_ORIGIN` (instanceof TypeError)
    pub const HTTP2_INVALID_ORIGIN: ErrorCode = ErrorCode(88);
    /// `ERR_HTTP2_INVALID_PSEUDOHEADER` (instanceof TypeError)
    pub const HTTP2_INVALID_PSEUDOHEADER: ErrorCode = ErrorCode(89);
    /// `ERR_HTTP2_INVALID_SESSION` (instanceof Error)
    pub const HTTP2_INVALID_SESSION: ErrorCode = ErrorCode(90);
    /// `ERR_HTTP2_INVALID_STREAM` (instanceof Error)
    pub const HTTP2_INVALID_STREAM: ErrorCode = ErrorCode(91);
    /// `ERR_HTTP2_MAX_PENDING_SETTINGS_ACK` (instanceof Error)
    pub const HTTP2_MAX_PENDING_SETTINGS_ACK: ErrorCode = ErrorCode(92);
    /// `ERR_HTTP2_NO_SOCKET_MANIPULATION` (instanceof Error)
    pub const HTTP2_NO_SOCKET_MANIPULATION: ErrorCode = ErrorCode(93);
    /// `ERR_HTTP2_ORIGIN_LENGTH` (instanceof TypeError)
    pub const HTTP2_ORIGIN_LENGTH: ErrorCode = ErrorCode(94);
    /// `ERR_HTTP2_OUT_OF_STREAMS` (instanceof Error)
    pub const HTTP2_OUT_OF_STREAMS: ErrorCode = ErrorCode(95);
    /// `ERR_HTTP2_PAYLOAD_FORBIDDEN` (instanceof Error)
    pub const HTTP2_PAYLOAD_FORBIDDEN: ErrorCode = ErrorCode(96);
    /// `ERR_HTTP2_PING_CANCEL` (instanceof Error)
    pub const HTTP2_PING_CANCEL: ErrorCode = ErrorCode(97);
    /// `ERR_HTTP2_PING_LENGTH` (instanceof RangeError)
    pub const HTTP2_PING_LENGTH: ErrorCode = ErrorCode(98);
    /// `ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED` (instanceof TypeError)
    pub const HTTP2_PSEUDOHEADER_NOT_ALLOWED: ErrorCode = ErrorCode(99);
    /// `ERR_HTTP2_PUSH_DISABLED` (instanceof Error)
    pub const HTTP2_PUSH_DISABLED: ErrorCode = ErrorCode(100);
    /// `ERR_HTTP2_SEND_FILE_NOSEEK` (instanceof Error)
    pub const HTTP2_SEND_FILE_NOSEEK: ErrorCode = ErrorCode(101);
    /// `ERR_HTTP2_SEND_FILE` (instanceof Error)
    pub const HTTP2_SEND_FILE: ErrorCode = ErrorCode(102);
    /// `ERR_HTTP2_SESSION_ERROR` (instanceof Error)
    pub const HTTP2_SESSION_ERROR: ErrorCode = ErrorCode(103);
    /// `ERR_HTTP2_SOCKET_UNBOUND` (instanceof Error)
    pub const HTTP2_SOCKET_UNBOUND: ErrorCode = ErrorCode(104);
    /// `ERR_HTTP2_STATUS_101` (instanceof Error)
    pub const HTTP2_STATUS_101: ErrorCode = ErrorCode(105);
    /// `ERR_HTTP2_STATUS_INVALID` (instanceof RangeError)
    pub const HTTP2_STATUS_INVALID: ErrorCode = ErrorCode(106);
    /// `ERR_HTTP2_STREAM_ERROR` (instanceof Error)
    pub const HTTP2_STREAM_ERROR: ErrorCode = ErrorCode(107);
    /// `ERR_HTTP2_TRAILERS_ALREADY_SENT` (instanceof Error)
    pub const HTTP2_TRAILERS_ALREADY_SENT: ErrorCode = ErrorCode(108);
    /// `ERR_HTTP2_TRAILERS_NOT_READY` (instanceof Error)
    pub const HTTP2_TRAILERS_NOT_READY: ErrorCode = ErrorCode(109);
    /// `ERR_HTTP2_TOO_MANY_CUSTOM_SETTINGS` (instanceof Error)
    pub const HTTP2_TOO_MANY_CUSTOM_SETTINGS: ErrorCode = ErrorCode(110);
    /// `ERR_HTTP2_TOO_MANY_INVALID_FRAMES` (instanceof Error)
    pub const HTTP2_TOO_MANY_INVALID_FRAMES: ErrorCode = ErrorCode(111);
    /// `ERR_HTTP2_UNSUPPORTED_PROTOCOL` (instanceof Error)
    pub const HTTP2_UNSUPPORTED_PROTOCOL: ErrorCode = ErrorCode(112);
    /// `ERR_HTTP2_INVALID_SETTING_VALUE` (instanceof TypeError)
    pub const HTTP2_INVALID_SETTING_VALUE: ErrorCode = ErrorCode(113);
    /// `ERR_HTTP2_INVALID_SETTING_VALUE` (instanceof RangeError)
    pub const HTTP2_INVALID_SETTING_VALUE_RangeError: ErrorCode = ErrorCode(114);
    /// `ERR_ILLEGAL_CONSTRUCTOR` (instanceof TypeError)
    pub const ILLEGAL_CONSTRUCTOR: ErrorCode = ErrorCode(115);
    /// `ERR_INCOMPATIBLE_OPTION_PAIR` (instanceof TypeError)
    pub const INCOMPATIBLE_OPTION_PAIR: ErrorCode = ErrorCode(116);
    /// `ERR_INVALID_ADDRESS` (instanceof Error)
    pub const INVALID_ADDRESS: ErrorCode = ErrorCode(117);
    /// `ERR_INVALID_ADDRESS_FAMILY` (instanceof RangeError)
    pub const INVALID_ADDRESS_FAMILY: ErrorCode = ErrorCode(118);
    /// `ERR_INVALID_ARG_TYPE` (instanceof TypeError)
    pub const INVALID_ARG_TYPE: ErrorCode = ErrorCode(119);
    /// `ERR_INVALID_ARG_VALUE` (instanceof TypeError)
    pub const INVALID_ARG_VALUE: ErrorCode = ErrorCode(120);
    /// `ERR_INVALID_ASYNC_ID` (instanceof RangeError)
    pub const INVALID_ASYNC_ID: ErrorCode = ErrorCode(121);
    /// `ERR_INVALID_CHAR` (instanceof TypeError)
    pub const INVALID_CHAR: ErrorCode = ErrorCode(122);
    /// `ERR_INVALID_CURSOR_POS` (instanceof TypeError)
    pub const INVALID_CURSOR_POS: ErrorCode = ErrorCode(123);
    /// `ERR_INVALID_FD_TYPE` (instanceof TypeError)
    pub const INVALID_FD_TYPE: ErrorCode = ErrorCode(124);
    /// `ERR_INVALID_FILE_URL_HOST` (instanceof TypeError)
    pub const INVALID_FILE_URL_HOST: ErrorCode = ErrorCode(125);
    /// `ERR_INVALID_FILE_URL_PATH` (instanceof TypeError)
    pub const INVALID_FILE_URL_PATH: ErrorCode = ErrorCode(126);
    /// `ERR_INVALID_HANDLE_TYPE` (instanceof TypeError)
    pub const INVALID_HANDLE_TYPE: ErrorCode = ErrorCode(127);
    /// `ERR_INVALID_HTTP_TOKEN` (instanceof TypeError)
    pub const INVALID_HTTP_TOKEN: ErrorCode = ErrorCode(128);
    /// `ERR_INVALID_IP_ADDRESS` (instanceof TypeError)
    pub const INVALID_IP_ADDRESS: ErrorCode = ErrorCode(129);
    /// `ERR_INVALID_MIME_SYNTAX` (instanceof TypeError)
    pub const INVALID_MIME_SYNTAX: ErrorCode = ErrorCode(130);
    /// `ERR_INVALID_MODULE` (instanceof Error)
    pub const INVALID_MODULE: ErrorCode = ErrorCode(131);
    /// `ERR_INVALID_OBJECT_DEFINE_PROPERTY` (instanceof TypeError)
    pub const INVALID_OBJECT_DEFINE_PROPERTY: ErrorCode = ErrorCode(132);
    /// `ERR_INVALID_PACKAGE_CONFIG` (instanceof Error)
    pub const INVALID_PACKAGE_CONFIG: ErrorCode = ErrorCode(133);
    /// `ERR_INVALID_PROTOCOL` (instanceof TypeError)
    pub const INVALID_PROTOCOL: ErrorCode = ErrorCode(134);
    /// `ERR_INVALID_RETURN_VALUE` (instanceof TypeError)
    pub const INVALID_RETURN_VALUE: ErrorCode = ErrorCode(135);
    /// `ERR_INVALID_STATE` (instanceof Error)
    pub const INVALID_STATE: ErrorCode = ErrorCode(136);
    /// `ERR_INVALID_STATE` (instanceof TypeError)
    pub const INVALID_STATE_TypeError: ErrorCode = ErrorCode(137);
    /// `ERR_INVALID_STATE` (instanceof RangeError)
    pub const INVALID_STATE_RangeError: ErrorCode = ErrorCode(138);
    /// `ERR_INVALID_THIS` (instanceof TypeError)
    pub const INVALID_THIS: ErrorCode = ErrorCode(139);
    /// `ERR_INVALID_URI` (instanceof URIError)
    pub const INVALID_URI: ErrorCode = ErrorCode(140);
    /// `ERR_INVALID_URL_SCHEME` (instanceof TypeError)
    pub const INVALID_URL_SCHEME: ErrorCode = ErrorCode(141);
    /// `ERR_INVALID_URL` (instanceof TypeError)
    pub const INVALID_URL: ErrorCode = ErrorCode(142);
    /// `ERR_IP_BLOCKED` (instanceof Error)
    pub const IP_BLOCKED: ErrorCode = ErrorCode(143);
    /// `ERR_IPC_CHANNEL_CLOSED` (instanceof Error)
    pub const IPC_CHANNEL_CLOSED: ErrorCode = ErrorCode(144);
    /// `ERR_IPC_DISCONNECTED` (instanceof Error)
    pub const IPC_DISCONNECTED: ErrorCode = ErrorCode(145);
    /// `ERR_IPC_ONE_PIPE` (instanceof Error)
    pub const IPC_ONE_PIPE: ErrorCode = ErrorCode(146);
    /// `ERR_LOAD_SQLITE_EXTENSION` (instanceof Error)
    pub const LOAD_SQLITE_EXTENSION: ErrorCode = ErrorCode(147);
    /// `ERR_MEMORY_ALLOCATION_FAILED` (instanceof Error)
    pub const MEMORY_ALLOCATION_FAILED: ErrorCode = ErrorCode(148);
    /// `ERR_MESSAGE_TARGET_CONTEXT_UNAVAILABLE` (instanceof Error)
    pub const MESSAGE_TARGET_CONTEXT_UNAVAILABLE: ErrorCode = ErrorCode(149);
    /// `ERR_METHOD_NOT_IMPLEMENTED` (instanceof Error)
    pub const METHOD_NOT_IMPLEMENTED: ErrorCode = ErrorCode(150);
    /// `ERR_MISSING_ARGS` (instanceof TypeError)
    pub const MISSING_ARGS: ErrorCode = ErrorCode(151);
    /// `ERR_MISSING_PASSPHRASE` (instanceof TypeError)
    pub const MISSING_PASSPHRASE: ErrorCode = ErrorCode(152);
    /// `ERR_MISSING_PLATFORM_FOR_WORKER` (instanceof Error)
    pub const MISSING_PLATFORM_FOR_WORKER: ErrorCode = ErrorCode(153);
    /// `ERR_MODULE_NOT_FOUND` (instanceof Error)
    pub const ERR_MODULE_NOT_FOUND: ErrorCode = ErrorCode(154);
    /// `ERR_MULTIPLE_CALLBACK` (instanceof Error)
    pub const MULTIPLE_CALLBACK: ErrorCode = ErrorCode(155);
    /// `ERR_NON_CONTEXT_AWARE_DISABLED` (instanceof Error)
    pub const NON_CONTEXT_AWARE_DISABLED: ErrorCode = ErrorCode(156);
    /// `ERR_OUT_OF_RANGE` (instanceof RangeError)
    pub const OUT_OF_RANGE: ErrorCode = ErrorCode(157);
    /// `ERR_PARSE_ARGS_INVALID_OPTION_VALUE` (instanceof TypeError)
    pub const PARSE_ARGS_INVALID_OPTION_VALUE: ErrorCode = ErrorCode(158);
    /// `ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL` (instanceof TypeError)
    pub const PARSE_ARGS_UNEXPECTED_POSITIONAL: ErrorCode = ErrorCode(159);
    /// `ERR_PARSE_ARGS_UNKNOWN_OPTION` (instanceof TypeError)
    pub const PARSE_ARGS_UNKNOWN_OPTION: ErrorCode = ErrorCode(160);
    /// `ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2` (instanceof Error)
    pub const POSTGRES_AUTHENTICATION_FAILED_PBKDF2: ErrorCode = ErrorCode(161);
    /// `ERR_POSTGRES_CONNECTION_CLOSED` (instanceof Error)
    pub const POSTGRES_CONNECTION_CLOSED: ErrorCode = ErrorCode(162);
    /// `ERR_POSTGRES_CONNECTION_TIMEOUT` (instanceof Error)
    pub const POSTGRES_CONNECTION_TIMEOUT: ErrorCode = ErrorCode(163);
    /// `ERR_POSTGRES_EXPECTED_REQUEST` (instanceof Error)
    pub const POSTGRES_EXPECTED_REQUEST: ErrorCode = ErrorCode(164);
    /// `ERR_POSTGRES_EXPECTED_STATEMENT` (instanceof Error)
    pub const POSTGRES_EXPECTED_STATEMENT: ErrorCode = ErrorCode(165);
    /// `ERR_POSTGRES_IDLE_TIMEOUT` (instanceof Error)
    pub const POSTGRES_IDLE_TIMEOUT: ErrorCode = ErrorCode(166);
    /// `ERR_POSTGRES_INVALID_BACKEND_KEY_DATA` (instanceof TypeError)
    pub const POSTGRES_INVALID_BACKEND_KEY_DATA: ErrorCode = ErrorCode(167);
    /// `ERR_POSTGRES_INVALID_BINARY_DATA` (instanceof TypeError)
    pub const POSTGRES_INVALID_BINARY_DATA: ErrorCode = ErrorCode(168);
    /// `ERR_POSTGRES_INVALID_BYTE_SEQUENCE_FOR_ENCODING` (instanceof TypeError)
    pub const POSTGRES_INVALID_BYTE_SEQUENCE_FOR_ENCODING: ErrorCode = ErrorCode(169);
    /// `ERR_POSTGRES_INVALID_BYTE_SEQUENCE` (instanceof TypeError)
    pub const POSTGRES_INVALID_BYTE_SEQUENCE: ErrorCode = ErrorCode(170);
    /// `ERR_POSTGRES_INVALID_CHARACTER` (instanceof TypeError)
    pub const POSTGRES_INVALID_CHARACTER: ErrorCode = ErrorCode(171);
    /// `ERR_POSTGRES_INVALID_MESSAGE_LENGTH` (instanceof Error)
    pub const POSTGRES_INVALID_MESSAGE_LENGTH: ErrorCode = ErrorCode(172);
    /// `ERR_POSTGRES_INVALID_MESSAGE` (instanceof Error)
    pub const POSTGRES_INVALID_MESSAGE: ErrorCode = ErrorCode(173);
    /// `ERR_POSTGRES_INVALID_QUERY_BINDING` (instanceof Error)
    pub const POSTGRES_INVALID_QUERY_BINDING: ErrorCode = ErrorCode(174);
    /// `ERR_POSTGRES_INVALID_SERVER_KEY` (instanceof Error)
    pub const POSTGRES_INVALID_SERVER_KEY: ErrorCode = ErrorCode(175);
    /// `ERR_POSTGRES_INVALID_SERVER_SIGNATURE` (instanceof Error)
    pub const POSTGRES_INVALID_SERVER_SIGNATURE: ErrorCode = ErrorCode(176);
    /// `ERR_POSTGRES_INVALID_TRANSACTION_STATE` (instanceof Error)
    pub const POSTGRES_INVALID_TRANSACTION_STATE: ErrorCode = ErrorCode(177);
    /// `ERR_POSTGRES_LIFETIME_TIMEOUT` (instanceof Error)
    pub const POSTGRES_LIFETIME_TIMEOUT: ErrorCode = ErrorCode(178);
    /// `ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET` (instanceof Error)
    pub const POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET: ErrorCode = ErrorCode(179);
    /// `ERR_POSTGRES_NOT_TAGGED_CALL` (instanceof Error)
    pub const POSTGRES_NOT_TAGGED_CALL: ErrorCode = ErrorCode(180);
    /// `ERR_POSTGRES_NULLS_IN_ARRAY_NOT_SUPPORTED_YET` (instanceof Error)
    pub const POSTGRES_NULLS_IN_ARRAY_NOT_SUPPORTED_YET: ErrorCode = ErrorCode(181);
    /// `ERR_POSTGRES_OVERFLOW` (instanceof TypeError)
    pub const POSTGRES_OVERFLOW: ErrorCode = ErrorCode(182);
    /// `ERR_POSTGRES_QUERY_CANCELLED` (instanceof Error)
    pub const POSTGRES_QUERY_CANCELLED: ErrorCode = ErrorCode(183);
    /// `ERR_POSTGRES_SASL_SIGNATURE_INVALID_BASE64` (instanceof Error)
    pub const POSTGRES_SASL_SIGNATURE_INVALID_BASE64: ErrorCode = ErrorCode(184);
    /// `ERR_POSTGRES_SASL_SIGNATURE_MISMATCH` (instanceof Error)
    pub const POSTGRES_SASL_SIGNATURE_MISMATCH: ErrorCode = ErrorCode(185);
    /// `ERR_POSTGRES_SERVER_ERROR` (instanceof Error)
    pub const POSTGRES_SERVER_ERROR: ErrorCode = ErrorCode(186);
    /// `ERR_POSTGRES_SYNTAX_ERROR` (instanceof SyntaxError)
    pub const POSTGRES_SYNTAX_ERROR: ErrorCode = ErrorCode(187);
    /// `ERR_POSTGRES_TLS_NOT_AVAILABLE` (instanceof Error)
    pub const POSTGRES_TLS_NOT_AVAILABLE: ErrorCode = ErrorCode(188);
    /// `ERR_POSTGRES_TLS_UPGRADE_FAILED` (instanceof Error)
    pub const POSTGRES_TLS_UPGRADE_FAILED: ErrorCode = ErrorCode(189);
    /// `ERR_POSTGRES_UNEXPECTED_MESSAGE` (instanceof Error)
    pub const POSTGRES_UNEXPECTED_MESSAGE: ErrorCode = ErrorCode(190);
    /// `ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD` (instanceof Error)
    pub const POSTGRES_UNKNOWN_AUTHENTICATION_METHOD: ErrorCode = ErrorCode(191);
    /// `ERR_POSTGRES_UNKNOWN_FORMAT_CODE` (instanceof Error)
    pub const POSTGRES_UNKNOWN_FORMAT_CODE: ErrorCode = ErrorCode(192);
    /// `ERR_POSTGRES_UNSAFE_TRANSACTION` (instanceof Error)
    pub const POSTGRES_UNSAFE_TRANSACTION: ErrorCode = ErrorCode(193);
    /// `ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT` (instanceof TypeError)
    pub const POSTGRES_UNSUPPORTED_ARRAY_FORMAT: ErrorCode = ErrorCode(194);
    /// `ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD` (instanceof Error)
    pub const POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD: ErrorCode = ErrorCode(195);
    /// `ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT` (instanceof TypeError)
    pub const POSTGRES_UNSUPPORTED_BYTEA_FORMAT: ErrorCode = ErrorCode(196);
    /// `ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE` (instanceof TypeError)
    pub const POSTGRES_UNSUPPORTED_INTEGER_SIZE: ErrorCode = ErrorCode(197);
    /// `ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT` (instanceof TypeError)
    pub const POSTGRES_UNSUPPORTED_NUMERIC_FORMAT: ErrorCode = ErrorCode(198);
    /// `ERR_PROXY_INVALID_CONFIG` (instanceof Error)
    pub const PROXY_INVALID_CONFIG: ErrorCode = ErrorCode(199);
    /// `ERR_MYSQL_CONNECTION_CLOSED` (instanceof Error)
    pub const MYSQL_CONNECTION_CLOSED: ErrorCode = ErrorCode(200);
    /// `ERR_MYSQL_CONNECTION_TIMEOUT` (instanceof Error)
    pub const MYSQL_CONNECTION_TIMEOUT: ErrorCode = ErrorCode(201);
    /// `ERR_MYSQL_IDLE_TIMEOUT` (instanceof Error)
    pub const MYSQL_IDLE_TIMEOUT: ErrorCode = ErrorCode(202);
    /// `ERR_MYSQL_LIFETIME_TIMEOUT` (instanceof Error)
    pub const MYSQL_LIFETIME_TIMEOUT: ErrorCode = ErrorCode(203);
    /// `ERR_UNHANDLED_REJECTION` (instanceof Error)
    pub const UNHANDLED_REJECTION: ErrorCode = ErrorCode(204);
    /// `ERR_REQUIRE_ASYNC_MODULE` (instanceof Error)
    pub const REQUIRE_ASYNC_MODULE: ErrorCode = ErrorCode(205);
    /// `ERR_S3_INVALID_ENDPOINT` (instanceof Error)
    pub const S3_INVALID_ENDPOINT: ErrorCode = ErrorCode(206);
    /// `ERR_S3_INVALID_METHOD` (instanceof Error)
    pub const S3_INVALID_METHOD: ErrorCode = ErrorCode(207);
    /// `ERR_S3_INVALID_PATH` (instanceof Error)
    pub const S3_INVALID_PATH: ErrorCode = ErrorCode(208);
    /// `ERR_S3_INVALID_SESSION_TOKEN` (instanceof Error)
    pub const S3_INVALID_SESSION_TOKEN: ErrorCode = ErrorCode(209);
    /// `ERR_S3_INVALID_SIGNATURE` (instanceof Error)
    pub const S3_INVALID_SIGNATURE: ErrorCode = ErrorCode(210);
    /// `ERR_S3_MISSING_CREDENTIALS` (instanceof Error)
    pub const S3_MISSING_CREDENTIALS: ErrorCode = ErrorCode(211);
    /// `ERR_SCRIPT_EXECUTION_INTERRUPTED` (instanceof Error)
    pub const SCRIPT_EXECUTION_INTERRUPTED: ErrorCode = ErrorCode(212);
    /// `ERR_SCRIPT_EXECUTION_TIMEOUT` (instanceof Error)
    pub const SCRIPT_EXECUTION_TIMEOUT: ErrorCode = ErrorCode(213);
    /// `ERR_SERVER_ALREADY_LISTEN` (instanceof Error)
    pub const SERVER_ALREADY_LISTEN: ErrorCode = ErrorCode(214);
    /// `ERR_SERVER_NOT_RUNNING` (instanceof Error)
    pub const SERVER_NOT_RUNNING: ErrorCode = ErrorCode(215);
    /// `ERR_SOCKET_ALREADY_BOUND` (instanceof Error)
    pub const SOCKET_ALREADY_BOUND: ErrorCode = ErrorCode(216);
    /// `ERR_SOCKET_BAD_BUFFER_SIZE` (instanceof TypeError)
    pub const SOCKET_BAD_BUFFER_SIZE: ErrorCode = ErrorCode(217);
    /// `ERR_SOCKET_BAD_PORT` (instanceof RangeError)
    pub const SOCKET_BAD_PORT: ErrorCode = ErrorCode(218);
    /// `ERR_SOCKET_BAD_TYPE` (instanceof TypeError)
    pub const SOCKET_BAD_TYPE: ErrorCode = ErrorCode(219);
    /// `ERR_SOCKET_CLOSED_BEFORE_CONNECTION` (instanceof Error)
    pub const SOCKET_CLOSED_BEFORE_CONNECTION: ErrorCode = ErrorCode(220);
    /// `ERR_SOCKET_CLOSED` (instanceof Error)
    pub const SOCKET_CLOSED: ErrorCode = ErrorCode(221);
    /// `ERR_SOCKET_CONNECTION_TIMEOUT` (instanceof Error)
    pub const SOCKET_CONNECTION_TIMEOUT: ErrorCode = ErrorCode(222);
    /// `ERR_SOCKET_DGRAM_IS_CONNECTED` (instanceof Error)
    pub const SOCKET_DGRAM_IS_CONNECTED: ErrorCode = ErrorCode(223);
    /// `ERR_SOCKET_DGRAM_NOT_CONNECTED` (instanceof Error)
    pub const SOCKET_DGRAM_NOT_CONNECTED: ErrorCode = ErrorCode(224);
    /// `ERR_SOCKET_DGRAM_NOT_RUNNING` (instanceof Error)
    pub const SOCKET_DGRAM_NOT_RUNNING: ErrorCode = ErrorCode(225);
    /// `ERR_SSR_RESPONSE_EXPECTED` (instanceof Error)
    pub const SSR_RESPONSE_EXPECTED: ErrorCode = ErrorCode(226);
    /// `ERR_STREAM_ALREADY_FINISHED` (instanceof Error)
    pub const STREAM_ALREADY_FINISHED: ErrorCode = ErrorCode(227);
    /// `ERR_STREAM_CANNOT_PIPE` (instanceof Error)
    pub const STREAM_CANNOT_PIPE: ErrorCode = ErrorCode(228);
    /// `ERR_STREAM_DESTROYED` (instanceof Error)
    pub const STREAM_DESTROYED: ErrorCode = ErrorCode(229);
    /// `ERR_STREAM_NULL_VALUES` (instanceof TypeError)
    pub const STREAM_NULL_VALUES: ErrorCode = ErrorCode(230);
    /// `ERR_STREAM_PREMATURE_CLOSE` (instanceof Error)
    pub const STREAM_PREMATURE_CLOSE: ErrorCode = ErrorCode(231);
    /// `ERR_STREAM_PUSH_AFTER_EOF` (instanceof Error)
    pub const STREAM_PUSH_AFTER_EOF: ErrorCode = ErrorCode(232);
    /// `ERR_STREAM_RELEASE_LOCK` (instanceof Error)
    pub const STREAM_RELEASE_LOCK: ErrorCode = ErrorCode(233);
    /// `ERR_STREAM_UNABLE_TO_PIPE` (instanceof Error)
    pub const STREAM_UNABLE_TO_PIPE: ErrorCode = ErrorCode(234);
    /// `ERR_STREAM_UNSHIFT_AFTER_END_EVENT` (instanceof Error)
    pub const STREAM_UNSHIFT_AFTER_END_EVENT: ErrorCode = ErrorCode(235);
    /// `ERR_STREAM_WRAP` (instanceof Error)
    pub const STREAM_WRAP: ErrorCode = ErrorCode(236);
    /// `ERR_STREAM_WRITE_AFTER_END` (instanceof Error)
    pub const STREAM_WRITE_AFTER_END: ErrorCode = ErrorCode(237);
    /// `ERR_STRING_TOO_LONG` (instanceof Error)
    pub const STRING_TOO_LONG: ErrorCode = ErrorCode(238);
    /// `ERR_TLS_CERT_ALTNAME_FORMAT` (instanceof SyntaxError)
    pub const TLS_CERT_ALTNAME_FORMAT: ErrorCode = ErrorCode(239);
    /// `ERR_TLS_CERT_ALTNAME_INVALID` (instanceof Error)
    pub const TLS_CERT_ALTNAME_INVALID: ErrorCode = ErrorCode(240);
    /// `ERR_TLS_HANDSHAKE_TIMEOUT` (instanceof Error)
    pub const TLS_HANDSHAKE_TIMEOUT: ErrorCode = ErrorCode(241);
    /// `ERR_TLS_INVALID_PROTOCOL_METHOD` (instanceof TypeError)
    pub const TLS_INVALID_PROTOCOL_METHOD: ErrorCode = ErrorCode(242);
    /// `ERR_TLS_INVALID_PROTOCOL_VERSION` (instanceof TypeError)
    pub const TLS_INVALID_PROTOCOL_VERSION: ErrorCode = ErrorCode(243);
    /// `ERR_TLS_PROTOCOL_VERSION_CONFLICT` (instanceof TypeError)
    pub const TLS_PROTOCOL_VERSION_CONFLICT: ErrorCode = ErrorCode(244);
    /// `ERR_TLS_PSK_SET_IDENTITY_HINT_FAILED` (instanceof Error)
    pub const TLS_PSK_SET_IDENTITY_HINT_FAILED: ErrorCode = ErrorCode(245);
    /// `ERR_TLS_RENEGOTIATION_DISABLED` (instanceof Error)
    pub const TLS_RENEGOTIATION_DISABLED: ErrorCode = ErrorCode(246);
    /// `ERR_TLS_SNI_FROM_SERVER` (instanceof Error)
    pub const TLS_SNI_FROM_SERVER: ErrorCode = ErrorCode(247);
    /// `ERR_TLS_ALPN_CALLBACK_WITH_PROTOCOLS` (instanceof TypeError)
    pub const TLS_ALPN_CALLBACK_WITH_PROTOCOLS: ErrorCode = ErrorCode(248);
    /// `ERR_SSL_NO_CIPHER_MATCH` (instanceof Error)
    pub const SSL_NO_CIPHER_MATCH: ErrorCode = ErrorCode(249);
    /// `ERR_UNAVAILABLE_DURING_EXIT` (instanceof Error)
    pub const UNAVAILABLE_DURING_EXIT: ErrorCode = ErrorCode(250);
    /// `ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET` (instanceof Error)
    pub const UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET: ErrorCode = ErrorCode(251);
    /// `ERR_UNESCAPED_CHARACTERS` (instanceof TypeError)
    pub const UNESCAPED_CHARACTERS: ErrorCode = ErrorCode(252);
    /// `ERR_UNHANDLED_ERROR` (instanceof Error)
    pub const UNHANDLED_ERROR: ErrorCode = ErrorCode(253);
    /// `ERR_UNKNOWN_CREDENTIAL` (instanceof Error)
    pub const UNKNOWN_CREDENTIAL: ErrorCode = ErrorCode(254);
    /// `ERR_UNKNOWN_ENCODING` (instanceof TypeError)
    pub const UNKNOWN_ENCODING: ErrorCode = ErrorCode(255);
    /// `ERR_UNKNOWN_SIGNAL` (instanceof TypeError)
    pub const UNKNOWN_SIGNAL: ErrorCode = ErrorCode(256);
    /// `ERR_ZSTD_INVALID_PARAM` (instanceof RangeError)
    pub const ZSTD_INVALID_PARAM: ErrorCode = ErrorCode(257);
    /// `ERR_USE_AFTER_CLOSE` (instanceof Error)
    pub const USE_AFTER_CLOSE: ErrorCode = ErrorCode(258);
    /// `ERR_WASI_NOT_STARTED` (instanceof Error)
    pub const WASI_NOT_STARTED: ErrorCode = ErrorCode(259);
    /// `ERR_WEBASSEMBLY_RESPONSE` (instanceof TypeError)
    pub const WEBASSEMBLY_RESPONSE: ErrorCode = ErrorCode(260);
    /// `ERR_WORKER_INIT_FAILED` (instanceof Error)
    pub const WORKER_INIT_FAILED: ErrorCode = ErrorCode(261);
    /// `ERR_WORKER_NOT_RUNNING` (instanceof Error)
    pub const WORKER_NOT_RUNNING: ErrorCode = ErrorCode(262);
    /// `ERR_WORKER_UNSUPPORTED_OPERATION` (instanceof TypeError)
    pub const WORKER_UNSUPPORTED_OPERATION: ErrorCode = ErrorCode(263);
    /// `ERR_ZLIB_INITIALIZATION_FAILED` (instanceof Error)
    pub const ZLIB_INITIALIZATION_FAILED: ErrorCode = ErrorCode(264);
    /// `MODULE_NOT_FOUND` (instanceof Error)
    pub const MODULE_NOT_FOUND: ErrorCode = ErrorCode(265);
    /// `ERR_INTERNAL_ASSERTION` (instanceof Error)
    pub const INTERNAL_ASSERTION: ErrorCode = ErrorCode(266);
    /// `ERR_OSSL_EVP_INVALID_DIGEST` (instanceof Error)
    pub const OSSL_EVP_INVALID_DIGEST: ErrorCode = ErrorCode(267);
    /// `ERR_KEY_GENERATION_JOB_FAILED` (instanceof Error)
    pub const KEY_GENERATION_JOB_FAILED: ErrorCode = ErrorCode(268);
    /// `ERR_MISSING_OPTION` (instanceof TypeError)
    pub const MISSING_OPTION: ErrorCode = ErrorCode(269);
    /// `ERR_REDIS_AUTHENTICATION_FAILED` (instanceof Error)
    pub const REDIS_AUTHENTICATION_FAILED: ErrorCode = ErrorCode(270);
    /// `ERR_REDIS_CONNECTION_CLOSED` (instanceof Error)
    pub const REDIS_CONNECTION_CLOSED: ErrorCode = ErrorCode(271);
    /// `ERR_REDIS_CONNECTION_TIMEOUT` (instanceof Error)
    pub const REDIS_CONNECTION_TIMEOUT: ErrorCode = ErrorCode(272);
    /// `ERR_REDIS_IDLE_TIMEOUT` (instanceof Error)
    pub const REDIS_IDLE_TIMEOUT: ErrorCode = ErrorCode(273);
    /// `ERR_REDIS_INVALID_ARGUMENT` (instanceof Error)
    pub const REDIS_INVALID_ARGUMENT: ErrorCode = ErrorCode(274);
    /// `ERR_REDIS_INVALID_ARRAY` (instanceof Error)
    pub const REDIS_INVALID_ARRAY: ErrorCode = ErrorCode(275);
    /// `ERR_REDIS_INVALID_BULK_STRING` (instanceof Error)
    pub const REDIS_INVALID_BULK_STRING: ErrorCode = ErrorCode(276);
    /// `ERR_REDIS_INVALID_COMMAND` (instanceof Error)
    pub const REDIS_INVALID_COMMAND: ErrorCode = ErrorCode(277);
    /// `ERR_REDIS_INVALID_DATABASE` (instanceof Error)
    pub const REDIS_INVALID_DATABASE: ErrorCode = ErrorCode(278);
    /// `ERR_REDIS_INVALID_ERROR_STRING` (instanceof Error)
    pub const REDIS_INVALID_ERROR_STRING: ErrorCode = ErrorCode(279);
    /// `ERR_REDIS_INVALID_INTEGER` (instanceof Error)
    pub const REDIS_INVALID_INTEGER: ErrorCode = ErrorCode(280);
    /// `ERR_REDIS_INVALID_PASSWORD` (instanceof Error)
    pub const REDIS_INVALID_PASSWORD: ErrorCode = ErrorCode(281);
    /// `ERR_REDIS_INVALID_RESPONSE` (instanceof Error)
    pub const REDIS_INVALID_RESPONSE: ErrorCode = ErrorCode(282);
    /// `ERR_REDIS_INVALID_RESPONSE_TYPE` (instanceof Error)
    pub const REDIS_INVALID_RESPONSE_TYPE: ErrorCode = ErrorCode(283);
    /// `ERR_REDIS_INVALID_SIMPLE_STRING` (instanceof Error)
    pub const REDIS_INVALID_SIMPLE_STRING: ErrorCode = ErrorCode(284);
    /// `ERR_REDIS_INVALID_STATE` (instanceof Error)
    pub const REDIS_INVALID_STATE: ErrorCode = ErrorCode(285);
    /// `ERR_REDIS_INVALID_USERNAME` (instanceof Error)
    pub const REDIS_INVALID_USERNAME: ErrorCode = ErrorCode(286);
    /// `ERR_REDIS_TLS_NOT_AVAILABLE` (instanceof Error)
    pub const REDIS_TLS_NOT_AVAILABLE: ErrorCode = ErrorCode(287);
    /// `ERR_REDIS_TLS_UPGRADE_FAILED` (instanceof Error)
    pub const REDIS_TLS_UPGRADE_FAILED: ErrorCode = ErrorCode(288);
    /// `HPE_UNEXPECTED_CONTENT_LENGTH` (instanceof Error)
    pub const HPE_UNEXPECTED_CONTENT_LENGTH: ErrorCode = ErrorCode(289);
    /// `HPE_INVALID_TRANSFER_ENCODING` (instanceof Error)
    pub const HPE_INVALID_TRANSFER_ENCODING: ErrorCode = ErrorCode(290);
    /// `HPE_INVALID_EOF_STATE` (instanceof Error)
    pub const HPE_INVALID_EOF_STATE: ErrorCode = ErrorCode(291);
    /// `HPE_INVALID_METHOD` (instanceof Error)
    pub const HPE_INVALID_METHOD: ErrorCode = ErrorCode(292);
    /// `HPE_INTERNAL` (instanceof Error)
    pub const HPE_INTERNAL: ErrorCode = ErrorCode(293);
    /// `ERR_VM_MODULE_STATUS` (instanceof Error)
    pub const VM_MODULE_STATUS: ErrorCode = ErrorCode(294);
    /// `ERR_VM_MODULE_ALREADY_LINKED` (instanceof Error)
    pub const VM_MODULE_ALREADY_LINKED: ErrorCode = ErrorCode(295);
    /// `ERR_VM_MODULE_CANNOT_CREATE_CACHED_DATA` (instanceof Error)
    pub const VM_MODULE_CANNOT_CREATE_CACHED_DATA: ErrorCode = ErrorCode(296);
    /// `ERR_VM_MODULE_NOT_MODULE` (instanceof Error)
    pub const VM_MODULE_NOT_MODULE: ErrorCode = ErrorCode(297);
    /// `ERR_VM_MODULE_DIFFERENT_CONTEXT` (instanceof Error)
    pub const VM_MODULE_DIFFERENT_CONTEXT: ErrorCode = ErrorCode(298);
    /// `ERR_VM_MODULE_LINK_FAILURE` (instanceof Error)
    pub const VM_MODULE_LINK_FAILURE: ErrorCode = ErrorCode(299);
    /// `ERR_VM_MODULE_CACHED_DATA_REJECTED` (instanceof Error)
    pub const VM_MODULE_CACHED_DATA_REJECTED: ErrorCode = ErrorCode(300);
    /// `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING` (instanceof TypeError)
    pub const VM_DYNAMIC_IMPORT_CALLBACK_MISSING: ErrorCode = ErrorCode(301);
    /// `HPE_INVALID_HEADER_TOKEN` (instanceof Error)
    pub const HPE_INVALID_HEADER_TOKEN: ErrorCode = ErrorCode(302);
    /// `HPE_HEADER_OVERFLOW` (instanceof Error)
    pub const HPE_HEADER_OVERFLOW: ErrorCode = ErrorCode(303);
    /// `ERR_SECRETS_NOT_AVAILABLE` (instanceof Error)
    pub const SECRETS_NOT_AVAILABLE: ErrorCode = ErrorCode(304);
    /// `ERR_SECRETS_NOT_FOUND` (instanceof Error)
    pub const SECRETS_NOT_FOUND: ErrorCode = ErrorCode(305);
    /// `ERR_SECRETS_ACCESS_DENIED` (instanceof Error)
    pub const SECRETS_ACCESS_DENIED: ErrorCode = ErrorCode(306);
    /// `ERR_SECRETS_PLATFORM_ERROR` (instanceof Error)
    pub const SECRETS_PLATFORM_ERROR: ErrorCode = ErrorCode(307);
    /// `ERR_SECRETS_USER_CANCELED` (instanceof Error)
    pub const SECRETS_USER_CANCELED: ErrorCode = ErrorCode(308);
    /// `ERR_SECRETS_INTERACTION_NOT_ALLOWED` (instanceof Error)
    pub const SECRETS_INTERACTION_NOT_ALLOWED: ErrorCode = ErrorCode(309);
    /// `ERR_SECRETS_AUTH_FAILED` (instanceof Error)
    pub const SECRETS_AUTH_FAILED: ErrorCode = ErrorCode(310);
    /// `ERR_SECRETS_INTERACTION_REQUIRED` (instanceof Error)
    pub const SECRETS_INTERACTION_REQUIRED: ErrorCode = ErrorCode(311);

    /// == C++ `NODE_ERROR_COUNT`.
    pub const COUNT: u16 = 312;
}

// ──────────────────────────────────────────────────────────────────────────
// `ERR_`-prefixed aliases — some callers spell the full Node code string,
// some use the Zig-style stripped name. Both resolve to the same discriminant.
// ──────────────────────────────────────────────────────────────────────────
impl ErrorCode {
    pub const ERR_ACCESS_DENIED: ErrorCode = ErrorCode::ACCESS_DENIED;
    pub const ERR_AMBIGUOUS_ARGUMENT: ErrorCode = ErrorCode::AMBIGUOUS_ARGUMENT;
    pub const ERR_ARG_NOT_ITERABLE: ErrorCode = ErrorCode::ARG_NOT_ITERABLE;
    pub const ERR_ASSERTION: ErrorCode = ErrorCode::ASSERTION;
    pub const ERR_ASYNC_CALLBACK: ErrorCode = ErrorCode::ASYNC_CALLBACK;
    pub const ERR_ASYNC_TYPE: ErrorCode = ErrorCode::ASYNC_TYPE;
    pub const ERR_BODY_ALREADY_USED: ErrorCode = ErrorCode::BODY_ALREADY_USED;
    pub const ERR_BORINGSSL: ErrorCode = ErrorCode::BORINGSSL;
    pub const ERR_ZSTD: ErrorCode = ErrorCode::ZSTD;
    pub const ERR_BROTLI_INVALID_PARAM: ErrorCode = ErrorCode::BROTLI_INVALID_PARAM;
    pub const ERR_BUFFER_CONTEXT_NOT_AVAILABLE: ErrorCode = ErrorCode::BUFFER_CONTEXT_NOT_AVAILABLE;
    pub const ERR_BUFFER_OUT_OF_BOUNDS: ErrorCode = ErrorCode::BUFFER_OUT_OF_BOUNDS;
    pub const ERR_BUFFER_TOO_LARGE: ErrorCode = ErrorCode::BUFFER_TOO_LARGE;
    pub const ERR_CHILD_PROCESS_IPC_REQUIRED: ErrorCode = ErrorCode::CHILD_PROCESS_IPC_REQUIRED;
    pub const ERR_CHILD_PROCESS_STDIO_MAXBUFFER: ErrorCode =
        ErrorCode::CHILD_PROCESS_STDIO_MAXBUFFER;
    pub const ERR_CLOSED_MESSAGE_PORT: ErrorCode = ErrorCode::CLOSED_MESSAGE_PORT;
    pub const ERR_CONSOLE_WRITABLE_STREAM: ErrorCode = ErrorCode::CONSOLE_WRITABLE_STREAM;
    pub const ERR_CONSTRUCT_CALL_INVALID: ErrorCode = ErrorCode::CONSTRUCT_CALL_INVALID;
    pub const ERR_CONSTRUCT_CALL_REQUIRED: ErrorCode = ErrorCode::CONSTRUCT_CALL_REQUIRED;
    pub const ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED: ErrorCode =
        ErrorCode::CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED;
    pub const ERR_CRYPTO_ECDH_INVALID_FORMAT: ErrorCode = ErrorCode::CRYPTO_ECDH_INVALID_FORMAT;
    pub const ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY: ErrorCode =
        ErrorCode::CRYPTO_ECDH_INVALID_PUBLIC_KEY;
    pub const ERR_CRYPTO_HASH_FINALIZED: ErrorCode = ErrorCode::CRYPTO_HASH_FINALIZED;
    pub const ERR_CRYPTO_HASH_UPDATE_FAILED: ErrorCode = ErrorCode::CRYPTO_HASH_UPDATE_FAILED;
    pub const ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS: ErrorCode =
        ErrorCode::CRYPTO_INCOMPATIBLE_KEY_OPTIONS;
    pub const ERR_CRYPTO_INCOMPATIBLE_KEY: ErrorCode = ErrorCode::CRYPTO_INCOMPATIBLE_KEY;
    pub const ERR_CRYPTO_INITIALIZATION_FAILED: ErrorCode = ErrorCode::CRYPTO_INITIALIZATION_FAILED;
    pub const ERR_CRYPTO_INVALID_AUTH_TAG: ErrorCode = ErrorCode::CRYPTO_INVALID_AUTH_TAG;
    pub const ERR_CRYPTO_INVALID_COUNTER: ErrorCode = ErrorCode::CRYPTO_INVALID_COUNTER;
    pub const ERR_CRYPTO_INVALID_CURVE: ErrorCode = ErrorCode::CRYPTO_INVALID_CURVE;
    pub const ERR_CRYPTO_INVALID_DIGEST: ErrorCode = ErrorCode::CRYPTO_INVALID_DIGEST;
    pub const ERR_CRYPTO_INVALID_IV: ErrorCode = ErrorCode::CRYPTO_INVALID_IV;
    pub const ERR_CRYPTO_INVALID_JWK: ErrorCode = ErrorCode::CRYPTO_INVALID_JWK;
    pub const ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE: ErrorCode =
        ErrorCode::CRYPTO_INVALID_KEY_OBJECT_TYPE;
    pub const ERR_CRYPTO_INVALID_KEYLEN: ErrorCode = ErrorCode::CRYPTO_INVALID_KEYLEN;
    pub const ERR_CRYPTO_INVALID_KEYPAIR: ErrorCode = ErrorCode::CRYPTO_INVALID_KEYPAIR;
    pub const ERR_CRYPTO_INVALID_KEYTYPE: ErrorCode = ErrorCode::CRYPTO_INVALID_KEYTYPE;
    pub const ERR_CRYPTO_INVALID_MESSAGELEN: ErrorCode = ErrorCode::CRYPTO_INVALID_MESSAGELEN;
    pub const ERR_CRYPTO_INVALID_SCRYPT_PARAMS: ErrorCode = ErrorCode::CRYPTO_INVALID_SCRYPT_PARAMS;
    pub const ERR_CRYPTO_INVALID_STATE: ErrorCode = ErrorCode::CRYPTO_INVALID_STATE;
    pub const ERR_CRYPTO_INVALID_TAG_LENGTH: ErrorCode = ErrorCode::CRYPTO_INVALID_TAG_LENGTH;
    pub const ERR_CRYPTO_JOB_INIT_FAILED: ErrorCode = ErrorCode::CRYPTO_JOB_INIT_FAILED;
    pub const ERR_CRYPTO_JWK_UNSUPPORTED_CURVE: ErrorCode = ErrorCode::CRYPTO_JWK_UNSUPPORTED_CURVE;
    pub const ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE: ErrorCode =
        ErrorCode::CRYPTO_JWK_UNSUPPORTED_KEY_TYPE;
    pub const ERR_CRYPTO_OPERATION_FAILED: ErrorCode = ErrorCode::CRYPTO_OPERATION_FAILED;
    pub const ERR_CRYPTO_SCRYPT_INVALID_PARAMETER: ErrorCode =
        ErrorCode::CRYPTO_SCRYPT_INVALID_PARAMETER;
    pub const ERR_CRYPTO_SIGN_KEY_REQUIRED: ErrorCode = ErrorCode::CRYPTO_SIGN_KEY_REQUIRED;
    pub const ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH: ErrorCode =
        ErrorCode::CRYPTO_TIMING_SAFE_EQUAL_LENGTH;
    pub const ERR_CRYPTO_UNKNOWN_CIPHER: ErrorCode = ErrorCode::CRYPTO_UNKNOWN_CIPHER;
    pub const ERR_CRYPTO_UNKNOWN_DH_GROUP: ErrorCode = ErrorCode::CRYPTO_UNKNOWN_DH_GROUP;
    pub const ERR_CRYPTO_UNSUPPORTED_OPERATION: ErrorCode = ErrorCode::CRYPTO_UNSUPPORTED_OPERATION;
    pub const ERR_DIR_CLOSED: ErrorCode = ErrorCode::DIR_CLOSED;
    pub const ERR_DLOPEN_DISABLED: ErrorCode = ErrorCode::DLOPEN_DISABLED;
    pub const ERR_DLOPEN_FAILED: ErrorCode = ErrorCode::DLOPEN_FAILED;
    pub const ERR_DNS_SET_SERVERS_FAILED: ErrorCode = ErrorCode::DNS_SET_SERVERS_FAILED;
    pub const ERR_ENCODING_INVALID_ENCODED_DATA: ErrorCode =
        ErrorCode::ENCODING_INVALID_ENCODED_DATA;
    pub const ERR_ENCODING_NOT_SUPPORTED: ErrorCode = ErrorCode::ENCODING_NOT_SUPPORTED;
    pub const ERR_EVENT_RECURSION: ErrorCode = ErrorCode::EVENT_RECURSION;
    pub const ERR_EXECUTION_ENVIRONMENT_NOT_AVAILABLE: ErrorCode =
        ErrorCode::EXECUTION_ENVIRONMENT_NOT_AVAILABLE;
    pub const ERR_FEATURE_UNAVAILABLE_ON_PLATFORM: ErrorCode =
        ErrorCode::FEATURE_UNAVAILABLE_ON_PLATFORM;
    pub const ERR_FORMDATA_PARSE_ERROR: ErrorCode = ErrorCode::FORMDATA_PARSE_ERROR;
    pub const ERR_FS_CP_DIR_TO_NON_DIR: ErrorCode = ErrorCode::FS_CP_DIR_TO_NON_DIR;
    pub const ERR_FS_CP_EINVAL: ErrorCode = ErrorCode::FS_CP_EINVAL;
    pub const ERR_FS_CP_FIFO_PIPE: ErrorCode = ErrorCode::FS_CP_FIFO_PIPE;
    pub const ERR_FS_CP_NON_DIR_TO_DIR: ErrorCode = ErrorCode::FS_CP_NON_DIR_TO_DIR;
    pub const ERR_FS_CP_SOCKET: ErrorCode = ErrorCode::FS_CP_SOCKET;
    pub const ERR_FS_CP_UNKNOWN: ErrorCode = ErrorCode::FS_CP_UNKNOWN;
    pub const ERR_FS_EISDIR: ErrorCode = ErrorCode::FS_EISDIR;
    pub const ERR_HTTP_BODY_NOT_ALLOWED: ErrorCode = ErrorCode::HTTP_BODY_NOT_ALLOWED;
    pub const ERR_HTTP_HEADERS_SENT: ErrorCode = ErrorCode::HTTP_HEADERS_SENT;
    pub const ERR_HTTP_CONTENT_LENGTH_MISMATCH: ErrorCode = ErrorCode::HTTP_CONTENT_LENGTH_MISMATCH;
    pub const ERR_HTTP_INVALID_HEADER_VALUE: ErrorCode = ErrorCode::HTTP_INVALID_HEADER_VALUE;
    pub const ERR_HTTP_INVALID_STATUS_CODE: ErrorCode = ErrorCode::HTTP_INVALID_STATUS_CODE;
    pub const ERR_HTTP_TRAILER_INVALID: ErrorCode = ErrorCode::HTTP_TRAILER_INVALID;
    pub const ERR_HTTP_SOCKET_ASSIGNED: ErrorCode = ErrorCode::HTTP_SOCKET_ASSIGNED;
    pub const ERR_HTTP2_ALTSVC_INVALID_ORIGIN: ErrorCode = ErrorCode::HTTP2_ALTSVC_INVALID_ORIGIN;
    pub const ERR_HTTP2_ALTSVC_LENGTH: ErrorCode = ErrorCode::HTTP2_ALTSVC_LENGTH;
    pub const ERR_HTTP2_CONNECT_AUTHORITY: ErrorCode = ErrorCode::HTTP2_CONNECT_AUTHORITY;
    pub const ERR_HTTP2_CONNECT_SCHEME: ErrorCode = ErrorCode::HTTP2_CONNECT_SCHEME;
    pub const ERR_HTTP2_CONNECT_PATH: ErrorCode = ErrorCode::HTTP2_CONNECT_PATH;
    pub const ERR_HTTP2_ERROR: ErrorCode = ErrorCode::HTTP2_ERROR;
    pub const ERR_HTTP2_HEADER_SINGLE_VALUE: ErrorCode = ErrorCode::HTTP2_HEADER_SINGLE_VALUE;
    pub const ERR_HTTP2_HEADERS_AFTER_RESPOND: ErrorCode = ErrorCode::HTTP2_HEADERS_AFTER_RESPOND;
    pub const ERR_HTTP2_HEADERS_SENT: ErrorCode = ErrorCode::HTTP2_HEADERS_SENT;
    pub const ERR_HTTP2_INFO_STATUS_NOT_ALLOWED: ErrorCode =
        ErrorCode::HTTP2_INFO_STATUS_NOT_ALLOWED;
    pub const ERR_HTTP2_INVALID_HEADER_VALUE: ErrorCode = ErrorCode::HTTP2_INVALID_HEADER_VALUE;
    pub const ERR_HTTP2_INVALID_INFO_STATUS: ErrorCode = ErrorCode::HTTP2_INVALID_INFO_STATUS;
    pub const ERR_HTTP2_INVALID_ORIGIN: ErrorCode = ErrorCode::HTTP2_INVALID_ORIGIN;
    pub const ERR_HTTP2_INVALID_PSEUDOHEADER: ErrorCode = ErrorCode::HTTP2_INVALID_PSEUDOHEADER;
    pub const ERR_HTTP2_INVALID_SESSION: ErrorCode = ErrorCode::HTTP2_INVALID_SESSION;
    pub const ERR_HTTP2_INVALID_STREAM: ErrorCode = ErrorCode::HTTP2_INVALID_STREAM;
    pub const ERR_HTTP2_MAX_PENDING_SETTINGS_ACK: ErrorCode =
        ErrorCode::HTTP2_MAX_PENDING_SETTINGS_ACK;
    pub const ERR_HTTP2_NO_SOCKET_MANIPULATION: ErrorCode = ErrorCode::HTTP2_NO_SOCKET_MANIPULATION;
    pub const ERR_HTTP2_ORIGIN_LENGTH: ErrorCode = ErrorCode::HTTP2_ORIGIN_LENGTH;
    pub const ERR_HTTP2_OUT_OF_STREAMS: ErrorCode = ErrorCode::HTTP2_OUT_OF_STREAMS;
    pub const ERR_HTTP2_PAYLOAD_FORBIDDEN: ErrorCode = ErrorCode::HTTP2_PAYLOAD_FORBIDDEN;
    pub const ERR_HTTP2_PING_CANCEL: ErrorCode = ErrorCode::HTTP2_PING_CANCEL;
    pub const ERR_HTTP2_PING_LENGTH: ErrorCode = ErrorCode::HTTP2_PING_LENGTH;
    pub const ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED: ErrorCode =
        ErrorCode::HTTP2_PSEUDOHEADER_NOT_ALLOWED;
    pub const ERR_HTTP2_PUSH_DISABLED: ErrorCode = ErrorCode::HTTP2_PUSH_DISABLED;
    pub const ERR_HTTP2_SEND_FILE_NOSEEK: ErrorCode = ErrorCode::HTTP2_SEND_FILE_NOSEEK;
    pub const ERR_HTTP2_SEND_FILE: ErrorCode = ErrorCode::HTTP2_SEND_FILE;
    pub const ERR_HTTP2_SESSION_ERROR: ErrorCode = ErrorCode::HTTP2_SESSION_ERROR;
    pub const ERR_HTTP2_SOCKET_UNBOUND: ErrorCode = ErrorCode::HTTP2_SOCKET_UNBOUND;
    pub const ERR_HTTP2_STATUS_101: ErrorCode = ErrorCode::HTTP2_STATUS_101;
    pub const ERR_HTTP2_STATUS_INVALID: ErrorCode = ErrorCode::HTTP2_STATUS_INVALID;
    pub const ERR_HTTP2_STREAM_ERROR: ErrorCode = ErrorCode::HTTP2_STREAM_ERROR;
    pub const ERR_HTTP2_TRAILERS_ALREADY_SENT: ErrorCode = ErrorCode::HTTP2_TRAILERS_ALREADY_SENT;
    pub const ERR_HTTP2_TRAILERS_NOT_READY: ErrorCode = ErrorCode::HTTP2_TRAILERS_NOT_READY;
    pub const ERR_HTTP2_TOO_MANY_CUSTOM_SETTINGS: ErrorCode =
        ErrorCode::HTTP2_TOO_MANY_CUSTOM_SETTINGS;
    pub const ERR_HTTP2_TOO_MANY_INVALID_FRAMES: ErrorCode =
        ErrorCode::HTTP2_TOO_MANY_INVALID_FRAMES;
    pub const ERR_HTTP2_UNSUPPORTED_PROTOCOL: ErrorCode = ErrorCode::HTTP2_UNSUPPORTED_PROTOCOL;
    pub const ERR_HTTP2_INVALID_SETTING_VALUE: ErrorCode = ErrorCode::HTTP2_INVALID_SETTING_VALUE;
    pub const ERR_ILLEGAL_CONSTRUCTOR: ErrorCode = ErrorCode::ILLEGAL_CONSTRUCTOR;
    pub const ERR_INCOMPATIBLE_OPTION_PAIR: ErrorCode = ErrorCode::INCOMPATIBLE_OPTION_PAIR;
    pub const ERR_INVALID_ADDRESS: ErrorCode = ErrorCode::INVALID_ADDRESS;
    pub const ERR_INVALID_ADDRESS_FAMILY: ErrorCode = ErrorCode::INVALID_ADDRESS_FAMILY;
    pub const ERR_INVALID_ARG_TYPE: ErrorCode = ErrorCode::INVALID_ARG_TYPE;
    pub const ERR_INVALID_ARG_VALUE: ErrorCode = ErrorCode::INVALID_ARG_VALUE;
    pub const ERR_INVALID_ASYNC_ID: ErrorCode = ErrorCode::INVALID_ASYNC_ID;
    pub const ERR_INVALID_CHAR: ErrorCode = ErrorCode::INVALID_CHAR;
    pub const ERR_INVALID_CURSOR_POS: ErrorCode = ErrorCode::INVALID_CURSOR_POS;
    pub const ERR_INVALID_FD_TYPE: ErrorCode = ErrorCode::INVALID_FD_TYPE;
    pub const ERR_INVALID_FILE_URL_HOST: ErrorCode = ErrorCode::INVALID_FILE_URL_HOST;
    pub const ERR_INVALID_FILE_URL_PATH: ErrorCode = ErrorCode::INVALID_FILE_URL_PATH;
    pub const ERR_INVALID_HANDLE_TYPE: ErrorCode = ErrorCode::INVALID_HANDLE_TYPE;
    pub const ERR_INVALID_HTTP_TOKEN: ErrorCode = ErrorCode::INVALID_HTTP_TOKEN;
    pub const ERR_INVALID_IP_ADDRESS: ErrorCode = ErrorCode::INVALID_IP_ADDRESS;
    pub const ERR_INVALID_MIME_SYNTAX: ErrorCode = ErrorCode::INVALID_MIME_SYNTAX;
    pub const ERR_INVALID_MODULE: ErrorCode = ErrorCode::INVALID_MODULE;
    pub const ERR_INVALID_OBJECT_DEFINE_PROPERTY: ErrorCode =
        ErrorCode::INVALID_OBJECT_DEFINE_PROPERTY;
    pub const ERR_INVALID_PACKAGE_CONFIG: ErrorCode = ErrorCode::INVALID_PACKAGE_CONFIG;
    pub const ERR_INVALID_PROTOCOL: ErrorCode = ErrorCode::INVALID_PROTOCOL;
    pub const ERR_INVALID_RETURN_VALUE: ErrorCode = ErrorCode::INVALID_RETURN_VALUE;
    pub const ERR_INVALID_STATE: ErrorCode = ErrorCode::INVALID_STATE;
    pub const ERR_INVALID_THIS: ErrorCode = ErrorCode::INVALID_THIS;
    pub const ERR_INVALID_URI: ErrorCode = ErrorCode::INVALID_URI;
    pub const ERR_INVALID_URL_SCHEME: ErrorCode = ErrorCode::INVALID_URL_SCHEME;
    pub const ERR_INVALID_URL: ErrorCode = ErrorCode::INVALID_URL;
    pub const ERR_IP_BLOCKED: ErrorCode = ErrorCode::IP_BLOCKED;
    pub const ERR_IPC_CHANNEL_CLOSED: ErrorCode = ErrorCode::IPC_CHANNEL_CLOSED;
    pub const ERR_IPC_DISCONNECTED: ErrorCode = ErrorCode::IPC_DISCONNECTED;
    pub const ERR_IPC_ONE_PIPE: ErrorCode = ErrorCode::IPC_ONE_PIPE;
    pub const ERR_LOAD_SQLITE_EXTENSION: ErrorCode = ErrorCode::LOAD_SQLITE_EXTENSION;
    pub const ERR_MEMORY_ALLOCATION_FAILED: ErrorCode = ErrorCode::MEMORY_ALLOCATION_FAILED;
    pub const ERR_MESSAGE_TARGET_CONTEXT_UNAVAILABLE: ErrorCode =
        ErrorCode::MESSAGE_TARGET_CONTEXT_UNAVAILABLE;
    pub const ERR_METHOD_NOT_IMPLEMENTED: ErrorCode = ErrorCode::METHOD_NOT_IMPLEMENTED;
    pub const ERR_MISSING_ARGS: ErrorCode = ErrorCode::MISSING_ARGS;
    pub const ERR_MISSING_PASSPHRASE: ErrorCode = ErrorCode::MISSING_PASSPHRASE;
    pub const ERR_MISSING_PLATFORM_FOR_WORKER: ErrorCode = ErrorCode::MISSING_PLATFORM_FOR_WORKER;
    pub const ERR_MULTIPLE_CALLBACK: ErrorCode = ErrorCode::MULTIPLE_CALLBACK;
    pub const ERR_NON_CONTEXT_AWARE_DISABLED: ErrorCode = ErrorCode::NON_CONTEXT_AWARE_DISABLED;
    pub const ERR_OUT_OF_RANGE: ErrorCode = ErrorCode::OUT_OF_RANGE;
    pub const ERR_PARSE_ARGS_INVALID_OPTION_VALUE: ErrorCode =
        ErrorCode::PARSE_ARGS_INVALID_OPTION_VALUE;
    pub const ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL: ErrorCode =
        ErrorCode::PARSE_ARGS_UNEXPECTED_POSITIONAL;
    pub const ERR_PARSE_ARGS_UNKNOWN_OPTION: ErrorCode = ErrorCode::PARSE_ARGS_UNKNOWN_OPTION;
    pub const ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2: ErrorCode =
        ErrorCode::POSTGRES_AUTHENTICATION_FAILED_PBKDF2;
    pub const ERR_POSTGRES_CONNECTION_CLOSED: ErrorCode = ErrorCode::POSTGRES_CONNECTION_CLOSED;
    pub const ERR_POSTGRES_CONNECTION_TIMEOUT: ErrorCode = ErrorCode::POSTGRES_CONNECTION_TIMEOUT;
    pub const ERR_POSTGRES_EXPECTED_REQUEST: ErrorCode = ErrorCode::POSTGRES_EXPECTED_REQUEST;
    pub const ERR_POSTGRES_EXPECTED_STATEMENT: ErrorCode = ErrorCode::POSTGRES_EXPECTED_STATEMENT;
    pub const ERR_POSTGRES_IDLE_TIMEOUT: ErrorCode = ErrorCode::POSTGRES_IDLE_TIMEOUT;
    pub const ERR_POSTGRES_INVALID_BACKEND_KEY_DATA: ErrorCode =
        ErrorCode::POSTGRES_INVALID_BACKEND_KEY_DATA;
    pub const ERR_POSTGRES_INVALID_BINARY_DATA: ErrorCode = ErrorCode::POSTGRES_INVALID_BINARY_DATA;
    pub const ERR_POSTGRES_INVALID_BYTE_SEQUENCE_FOR_ENCODING: ErrorCode =
        ErrorCode::POSTGRES_INVALID_BYTE_SEQUENCE_FOR_ENCODING;
    pub const ERR_POSTGRES_INVALID_BYTE_SEQUENCE: ErrorCode =
        ErrorCode::POSTGRES_INVALID_BYTE_SEQUENCE;
    pub const ERR_POSTGRES_INVALID_CHARACTER: ErrorCode = ErrorCode::POSTGRES_INVALID_CHARACTER;
    pub const ERR_POSTGRES_INVALID_MESSAGE_LENGTH: ErrorCode =
        ErrorCode::POSTGRES_INVALID_MESSAGE_LENGTH;
    pub const ERR_POSTGRES_INVALID_MESSAGE: ErrorCode = ErrorCode::POSTGRES_INVALID_MESSAGE;
    pub const ERR_POSTGRES_INVALID_QUERY_BINDING: ErrorCode =
        ErrorCode::POSTGRES_INVALID_QUERY_BINDING;
    pub const ERR_POSTGRES_INVALID_SERVER_KEY: ErrorCode = ErrorCode::POSTGRES_INVALID_SERVER_KEY;
    pub const ERR_POSTGRES_INVALID_SERVER_SIGNATURE: ErrorCode =
        ErrorCode::POSTGRES_INVALID_SERVER_SIGNATURE;
    pub const ERR_POSTGRES_INVALID_TRANSACTION_STATE: ErrorCode =
        ErrorCode::POSTGRES_INVALID_TRANSACTION_STATE;
    pub const ERR_POSTGRES_LIFETIME_TIMEOUT: ErrorCode = ErrorCode::POSTGRES_LIFETIME_TIMEOUT;
    pub const ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET: ErrorCode =
        ErrorCode::POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET;
    pub const ERR_POSTGRES_NOT_TAGGED_CALL: ErrorCode = ErrorCode::POSTGRES_NOT_TAGGED_CALL;
    pub const ERR_POSTGRES_NULLS_IN_ARRAY_NOT_SUPPORTED_YET: ErrorCode =
        ErrorCode::POSTGRES_NULLS_IN_ARRAY_NOT_SUPPORTED_YET;
    pub const ERR_POSTGRES_OVERFLOW: ErrorCode = ErrorCode::POSTGRES_OVERFLOW;
    pub const ERR_POSTGRES_QUERY_CANCELLED: ErrorCode = ErrorCode::POSTGRES_QUERY_CANCELLED;
    pub const ERR_POSTGRES_SASL_SIGNATURE_INVALID_BASE64: ErrorCode =
        ErrorCode::POSTGRES_SASL_SIGNATURE_INVALID_BASE64;
    pub const ERR_POSTGRES_SASL_SIGNATURE_MISMATCH: ErrorCode =
        ErrorCode::POSTGRES_SASL_SIGNATURE_MISMATCH;
    pub const ERR_POSTGRES_SERVER_ERROR: ErrorCode = ErrorCode::POSTGRES_SERVER_ERROR;
    pub const ERR_POSTGRES_SYNTAX_ERROR: ErrorCode = ErrorCode::POSTGRES_SYNTAX_ERROR;
    pub const ERR_POSTGRES_TLS_NOT_AVAILABLE: ErrorCode = ErrorCode::POSTGRES_TLS_NOT_AVAILABLE;
    pub const ERR_POSTGRES_TLS_UPGRADE_FAILED: ErrorCode = ErrorCode::POSTGRES_TLS_UPGRADE_FAILED;
    pub const ERR_POSTGRES_UNEXPECTED_MESSAGE: ErrorCode = ErrorCode::POSTGRES_UNEXPECTED_MESSAGE;
    pub const ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD: ErrorCode =
        ErrorCode::POSTGRES_UNKNOWN_AUTHENTICATION_METHOD;
    pub const ERR_POSTGRES_UNKNOWN_FORMAT_CODE: ErrorCode = ErrorCode::POSTGRES_UNKNOWN_FORMAT_CODE;
    pub const ERR_POSTGRES_UNSAFE_TRANSACTION: ErrorCode = ErrorCode::POSTGRES_UNSAFE_TRANSACTION;
    pub const ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT: ErrorCode =
        ErrorCode::POSTGRES_UNSUPPORTED_ARRAY_FORMAT;
    pub const ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD: ErrorCode =
        ErrorCode::POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD;
    pub const ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT: ErrorCode =
        ErrorCode::POSTGRES_UNSUPPORTED_BYTEA_FORMAT;
    pub const ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE: ErrorCode =
        ErrorCode::POSTGRES_UNSUPPORTED_INTEGER_SIZE;
    pub const ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT: ErrorCode =
        ErrorCode::POSTGRES_UNSUPPORTED_NUMERIC_FORMAT;
    pub const ERR_PROXY_INVALID_CONFIG: ErrorCode = ErrorCode::PROXY_INVALID_CONFIG;
    pub const ERR_MYSQL_CONNECTION_CLOSED: ErrorCode = ErrorCode::MYSQL_CONNECTION_CLOSED;
    pub const ERR_MYSQL_CONNECTION_TIMEOUT: ErrorCode = ErrorCode::MYSQL_CONNECTION_TIMEOUT;
    pub const ERR_MYSQL_IDLE_TIMEOUT: ErrorCode = ErrorCode::MYSQL_IDLE_TIMEOUT;
    pub const ERR_MYSQL_LIFETIME_TIMEOUT: ErrorCode = ErrorCode::MYSQL_LIFETIME_TIMEOUT;
    pub const ERR_UNHANDLED_REJECTION: ErrorCode = ErrorCode::UNHANDLED_REJECTION;
    pub const ERR_REQUIRE_ASYNC_MODULE: ErrorCode = ErrorCode::REQUIRE_ASYNC_MODULE;
    pub const ERR_S3_INVALID_ENDPOINT: ErrorCode = ErrorCode::S3_INVALID_ENDPOINT;
    pub const ERR_S3_INVALID_METHOD: ErrorCode = ErrorCode::S3_INVALID_METHOD;
    pub const ERR_S3_INVALID_PATH: ErrorCode = ErrorCode::S3_INVALID_PATH;
    pub const ERR_S3_INVALID_SESSION_TOKEN: ErrorCode = ErrorCode::S3_INVALID_SESSION_TOKEN;
    pub const ERR_S3_INVALID_SIGNATURE: ErrorCode = ErrorCode::S3_INVALID_SIGNATURE;
    pub const ERR_S3_MISSING_CREDENTIALS: ErrorCode = ErrorCode::S3_MISSING_CREDENTIALS;
    pub const ERR_SCRIPT_EXECUTION_INTERRUPTED: ErrorCode = ErrorCode::SCRIPT_EXECUTION_INTERRUPTED;
    pub const ERR_SCRIPT_EXECUTION_TIMEOUT: ErrorCode = ErrorCode::SCRIPT_EXECUTION_TIMEOUT;
    pub const ERR_SERVER_ALREADY_LISTEN: ErrorCode = ErrorCode::SERVER_ALREADY_LISTEN;
    pub const ERR_SERVER_NOT_RUNNING: ErrorCode = ErrorCode::SERVER_NOT_RUNNING;
    pub const ERR_SOCKET_ALREADY_BOUND: ErrorCode = ErrorCode::SOCKET_ALREADY_BOUND;
    pub const ERR_SOCKET_BAD_BUFFER_SIZE: ErrorCode = ErrorCode::SOCKET_BAD_BUFFER_SIZE;
    pub const ERR_SOCKET_BAD_PORT: ErrorCode = ErrorCode::SOCKET_BAD_PORT;
    pub const ERR_SOCKET_BAD_TYPE: ErrorCode = ErrorCode::SOCKET_BAD_TYPE;
    pub const ERR_SOCKET_CLOSED_BEFORE_CONNECTION: ErrorCode =
        ErrorCode::SOCKET_CLOSED_BEFORE_CONNECTION;
    pub const ERR_SOCKET_CLOSED: ErrorCode = ErrorCode::SOCKET_CLOSED;
    pub const ERR_SOCKET_CONNECTION_TIMEOUT: ErrorCode = ErrorCode::SOCKET_CONNECTION_TIMEOUT;
    pub const ERR_SOCKET_DGRAM_IS_CONNECTED: ErrorCode = ErrorCode::SOCKET_DGRAM_IS_CONNECTED;
    pub const ERR_SOCKET_DGRAM_NOT_CONNECTED: ErrorCode = ErrorCode::SOCKET_DGRAM_NOT_CONNECTED;
    pub const ERR_SOCKET_DGRAM_NOT_RUNNING: ErrorCode = ErrorCode::SOCKET_DGRAM_NOT_RUNNING;
    pub const ERR_SSR_RESPONSE_EXPECTED: ErrorCode = ErrorCode::SSR_RESPONSE_EXPECTED;
    pub const ERR_STREAM_ALREADY_FINISHED: ErrorCode = ErrorCode::STREAM_ALREADY_FINISHED;
    pub const ERR_STREAM_CANNOT_PIPE: ErrorCode = ErrorCode::STREAM_CANNOT_PIPE;
    pub const ERR_STREAM_DESTROYED: ErrorCode = ErrorCode::STREAM_DESTROYED;
    pub const ERR_STREAM_NULL_VALUES: ErrorCode = ErrorCode::STREAM_NULL_VALUES;
    pub const ERR_STREAM_PREMATURE_CLOSE: ErrorCode = ErrorCode::STREAM_PREMATURE_CLOSE;
    pub const ERR_STREAM_PUSH_AFTER_EOF: ErrorCode = ErrorCode::STREAM_PUSH_AFTER_EOF;
    pub const ERR_STREAM_RELEASE_LOCK: ErrorCode = ErrorCode::STREAM_RELEASE_LOCK;
    pub const ERR_STREAM_UNABLE_TO_PIPE: ErrorCode = ErrorCode::STREAM_UNABLE_TO_PIPE;
    pub const ERR_STREAM_UNSHIFT_AFTER_END_EVENT: ErrorCode =
        ErrorCode::STREAM_UNSHIFT_AFTER_END_EVENT;
    pub const ERR_STREAM_WRAP: ErrorCode = ErrorCode::STREAM_WRAP;
    pub const ERR_STREAM_WRITE_AFTER_END: ErrorCode = ErrorCode::STREAM_WRITE_AFTER_END;
    pub const ERR_STRING_TOO_LONG: ErrorCode = ErrorCode::STRING_TOO_LONG;
    pub const ERR_TLS_CERT_ALTNAME_FORMAT: ErrorCode = ErrorCode::TLS_CERT_ALTNAME_FORMAT;
    pub const ERR_TLS_CERT_ALTNAME_INVALID: ErrorCode = ErrorCode::TLS_CERT_ALTNAME_INVALID;
    pub const ERR_TLS_HANDSHAKE_TIMEOUT: ErrorCode = ErrorCode::TLS_HANDSHAKE_TIMEOUT;
    pub const ERR_TLS_INVALID_PROTOCOL_METHOD: ErrorCode = ErrorCode::TLS_INVALID_PROTOCOL_METHOD;
    pub const ERR_TLS_INVALID_PROTOCOL_VERSION: ErrorCode = ErrorCode::TLS_INVALID_PROTOCOL_VERSION;
    pub const ERR_TLS_PROTOCOL_VERSION_CONFLICT: ErrorCode =
        ErrorCode::TLS_PROTOCOL_VERSION_CONFLICT;
    pub const ERR_TLS_PSK_SET_IDENTITY_HINT_FAILED: ErrorCode =
        ErrorCode::TLS_PSK_SET_IDENTITY_HINT_FAILED;
    pub const ERR_TLS_RENEGOTIATION_DISABLED: ErrorCode = ErrorCode::TLS_RENEGOTIATION_DISABLED;
    pub const ERR_TLS_SNI_FROM_SERVER: ErrorCode = ErrorCode::TLS_SNI_FROM_SERVER;
    pub const ERR_TLS_ALPN_CALLBACK_WITH_PROTOCOLS: ErrorCode =
        ErrorCode::TLS_ALPN_CALLBACK_WITH_PROTOCOLS;
    pub const ERR_SSL_NO_CIPHER_MATCH: ErrorCode = ErrorCode::SSL_NO_CIPHER_MATCH;
    pub const ERR_UNAVAILABLE_DURING_EXIT: ErrorCode = ErrorCode::UNAVAILABLE_DURING_EXIT;
    pub const ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET: ErrorCode =
        ErrorCode::UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET;
    pub const ERR_UNESCAPED_CHARACTERS: ErrorCode = ErrorCode::UNESCAPED_CHARACTERS;
    pub const ERR_UNHANDLED_ERROR: ErrorCode = ErrorCode::UNHANDLED_ERROR;
    pub const ERR_UNKNOWN_CREDENTIAL: ErrorCode = ErrorCode::UNKNOWN_CREDENTIAL;
    pub const ERR_UNKNOWN_ENCODING: ErrorCode = ErrorCode::UNKNOWN_ENCODING;
    pub const ERR_UNKNOWN_SIGNAL: ErrorCode = ErrorCode::UNKNOWN_SIGNAL;
    pub const ERR_ZSTD_INVALID_PARAM: ErrorCode = ErrorCode::ZSTD_INVALID_PARAM;
    pub const ERR_USE_AFTER_CLOSE: ErrorCode = ErrorCode::USE_AFTER_CLOSE;
    pub const ERR_WASI_NOT_STARTED: ErrorCode = ErrorCode::WASI_NOT_STARTED;
    pub const ERR_WEBASSEMBLY_RESPONSE: ErrorCode = ErrorCode::WEBASSEMBLY_RESPONSE;
    pub const ERR_WORKER_INIT_FAILED: ErrorCode = ErrorCode::WORKER_INIT_FAILED;
    pub const ERR_WORKER_NOT_RUNNING: ErrorCode = ErrorCode::WORKER_NOT_RUNNING;
    pub const ERR_WORKER_UNSUPPORTED_OPERATION: ErrorCode = ErrorCode::WORKER_UNSUPPORTED_OPERATION;
    pub const ERR_ZLIB_INITIALIZATION_FAILED: ErrorCode = ErrorCode::ZLIB_INITIALIZATION_FAILED;
    pub const ERR_INTERNAL_ASSERTION: ErrorCode = ErrorCode::INTERNAL_ASSERTION;
    pub const ERR_OSSL_EVP_INVALID_DIGEST: ErrorCode = ErrorCode::OSSL_EVP_INVALID_DIGEST;
    pub const ERR_KEY_GENERATION_JOB_FAILED: ErrorCode = ErrorCode::KEY_GENERATION_JOB_FAILED;
    pub const ERR_MISSING_OPTION: ErrorCode = ErrorCode::MISSING_OPTION;
    pub const ERR_REDIS_AUTHENTICATION_FAILED: ErrorCode = ErrorCode::REDIS_AUTHENTICATION_FAILED;
    pub const ERR_REDIS_CONNECTION_CLOSED: ErrorCode = ErrorCode::REDIS_CONNECTION_CLOSED;
    pub const ERR_REDIS_CONNECTION_TIMEOUT: ErrorCode = ErrorCode::REDIS_CONNECTION_TIMEOUT;
    pub const ERR_REDIS_IDLE_TIMEOUT: ErrorCode = ErrorCode::REDIS_IDLE_TIMEOUT;
    pub const ERR_REDIS_INVALID_ARGUMENT: ErrorCode = ErrorCode::REDIS_INVALID_ARGUMENT;
    pub const ERR_REDIS_INVALID_ARRAY: ErrorCode = ErrorCode::REDIS_INVALID_ARRAY;
    pub const ERR_REDIS_INVALID_BULK_STRING: ErrorCode = ErrorCode::REDIS_INVALID_BULK_STRING;
    pub const ERR_REDIS_INVALID_COMMAND: ErrorCode = ErrorCode::REDIS_INVALID_COMMAND;
    pub const ERR_REDIS_INVALID_DATABASE: ErrorCode = ErrorCode::REDIS_INVALID_DATABASE;
    pub const ERR_REDIS_INVALID_ERROR_STRING: ErrorCode = ErrorCode::REDIS_INVALID_ERROR_STRING;
    pub const ERR_REDIS_INVALID_INTEGER: ErrorCode = ErrorCode::REDIS_INVALID_INTEGER;
    pub const ERR_REDIS_INVALID_PASSWORD: ErrorCode = ErrorCode::REDIS_INVALID_PASSWORD;
    pub const ERR_REDIS_INVALID_RESPONSE: ErrorCode = ErrorCode::REDIS_INVALID_RESPONSE;
    pub const ERR_REDIS_INVALID_RESPONSE_TYPE: ErrorCode = ErrorCode::REDIS_INVALID_RESPONSE_TYPE;
    pub const ERR_REDIS_INVALID_SIMPLE_STRING: ErrorCode = ErrorCode::REDIS_INVALID_SIMPLE_STRING;
    pub const ERR_REDIS_INVALID_STATE: ErrorCode = ErrorCode::REDIS_INVALID_STATE;
    pub const ERR_REDIS_INVALID_USERNAME: ErrorCode = ErrorCode::REDIS_INVALID_USERNAME;
    pub const ERR_REDIS_TLS_NOT_AVAILABLE: ErrorCode = ErrorCode::REDIS_TLS_NOT_AVAILABLE;
    pub const ERR_REDIS_TLS_UPGRADE_FAILED: ErrorCode = ErrorCode::REDIS_TLS_UPGRADE_FAILED;
    pub const ERR_VM_MODULE_STATUS: ErrorCode = ErrorCode::VM_MODULE_STATUS;
    pub const ERR_VM_MODULE_ALREADY_LINKED: ErrorCode = ErrorCode::VM_MODULE_ALREADY_LINKED;
    pub const ERR_VM_MODULE_CANNOT_CREATE_CACHED_DATA: ErrorCode =
        ErrorCode::VM_MODULE_CANNOT_CREATE_CACHED_DATA;
    pub const ERR_VM_MODULE_NOT_MODULE: ErrorCode = ErrorCode::VM_MODULE_NOT_MODULE;
    pub const ERR_VM_MODULE_DIFFERENT_CONTEXT: ErrorCode = ErrorCode::VM_MODULE_DIFFERENT_CONTEXT;
    pub const ERR_VM_MODULE_LINK_FAILURE: ErrorCode = ErrorCode::VM_MODULE_LINK_FAILURE;
    pub const ERR_VM_MODULE_CACHED_DATA_REJECTED: ErrorCode =
        ErrorCode::VM_MODULE_CACHED_DATA_REJECTED;
    pub const ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING: ErrorCode =
        ErrorCode::VM_DYNAMIC_IMPORT_CALLBACK_MISSING;
    pub const ERR_SECRETS_NOT_AVAILABLE: ErrorCode = ErrorCode::SECRETS_NOT_AVAILABLE;
    pub const ERR_SECRETS_NOT_FOUND: ErrorCode = ErrorCode::SECRETS_NOT_FOUND;
    pub const ERR_SECRETS_ACCESS_DENIED: ErrorCode = ErrorCode::SECRETS_ACCESS_DENIED;
    pub const ERR_SECRETS_PLATFORM_ERROR: ErrorCode = ErrorCode::SECRETS_PLATFORM_ERROR;
    pub const ERR_SECRETS_USER_CANCELED: ErrorCode = ErrorCode::SECRETS_USER_CANCELED;
    pub const ERR_SECRETS_INTERACTION_NOT_ALLOWED: ErrorCode =
        ErrorCode::SECRETS_INTERACTION_NOT_ALLOWED;
    pub const ERR_SECRETS_AUTH_FAILED: ErrorCode = ErrorCode::SECRETS_AUTH_FAILED;
    pub const ERR_SECRETS_INTERACTION_REQUIRED: ErrorCode = ErrorCode::SECRETS_INTERACTION_REQUIRED;

    // NOTE: `ERR_SYSTEM_ERROR` / `ERR_CHILD_CLOSED_BEFORE_REPLY` intentionally
    // do NOT live here. They belong to the unrelated Zig enum
    // `jsc.Node.ErrorCode` (src/runtime/node/nodejs_error_code.zig →
    // `bun_runtime::node::nodejs_error_code::ErrorCode`), not to the
    // ErrorCode.ts-derived table this type mirrors. Adding them here with
    // out-of-range discriminants (≥ Self::COUNT) is a memory-safety bug: the
    // C++ side does `errors[static_cast<size_t>(code)]` against a fixed
    // `errors[COUNT]` array with no bounds check (ErrorCode.cpp /
    // ErrorCode+Data.h), so any such value reaching `ErrorCode::fmt()` →
    // `Bun__createErrorWithCode` reads past the array and past
    // `ErrorCodeCache::internalField`. Callers needing those tags must use
    // `bun_runtime::node::nodejs_error_code::ErrorCode` directly.
}

/// `error.code` string table — index-aligned with the consts above and with
/// C++ `errors[].code` in `ErrorCode+Data.h`.
static CODE_STR: [&str; ErrorCode::COUNT as usize] = [
    "ABORT_ERR",
    "ERR_ACCESS_DENIED",
    "ERR_AMBIGUOUS_ARGUMENT",
    "ERR_ARG_NOT_ITERABLE",
    "ERR_ASSERTION",
    "ERR_ASYNC_CALLBACK",
    "ERR_ASYNC_TYPE",
    "ERR_BODY_ALREADY_USED",
    "ERR_BORINGSSL",
    "ERR_ZSTD",
    "ERR_BROTLI_INVALID_PARAM",
    "ERR_BUFFER_CONTEXT_NOT_AVAILABLE",
    "ERR_BUFFER_OUT_OF_BOUNDS",
    "ERR_BUFFER_TOO_LARGE",
    "ERR_CHILD_PROCESS_IPC_REQUIRED",
    "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
    "ERR_CLOSED_MESSAGE_PORT",
    "ERR_CONSOLE_WRITABLE_STREAM",
    "ERR_CONSTRUCT_CALL_INVALID",
    "ERR_CONSTRUCT_CALL_REQUIRED",
    "ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED",
    "ERR_CRYPTO_ECDH_INVALID_FORMAT",
    "ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY",
    "ERR_CRYPTO_HASH_FINALIZED",
    "ERR_CRYPTO_HASH_UPDATE_FAILED",
    "ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS",
    "ERR_CRYPTO_INCOMPATIBLE_KEY",
    "ERR_CRYPTO_INITIALIZATION_FAILED",
    "ERR_CRYPTO_INVALID_AUTH_TAG",
    "ERR_CRYPTO_INVALID_COUNTER",
    "ERR_CRYPTO_INVALID_CURVE",
    "ERR_CRYPTO_INVALID_DIGEST",
    "ERR_CRYPTO_INVALID_IV",
    "ERR_CRYPTO_INVALID_JWK",
    "ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE",
    "ERR_CRYPTO_INVALID_KEYLEN",
    "ERR_CRYPTO_INVALID_KEYPAIR",
    "ERR_CRYPTO_INVALID_KEYTYPE",
    "ERR_CRYPTO_INVALID_MESSAGELEN",
    "ERR_CRYPTO_INVALID_SCRYPT_PARAMS",
    "ERR_CRYPTO_INVALID_STATE",
    "ERR_CRYPTO_INVALID_TAG_LENGTH",
    "ERR_CRYPTO_JOB_INIT_FAILED",
    "ERR_CRYPTO_JWK_UNSUPPORTED_CURVE",
    "ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE",
    "ERR_CRYPTO_OPERATION_FAILED",
    "ERR_CRYPTO_SCRYPT_INVALID_PARAMETER",
    "ERR_CRYPTO_SIGN_KEY_REQUIRED",
    "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH",
    "ERR_CRYPTO_UNKNOWN_CIPHER",
    "ERR_CRYPTO_UNKNOWN_DH_GROUP",
    "ERR_CRYPTO_UNSUPPORTED_OPERATION",
    "ERR_DIR_CLOSED",
    "ERR_DLOPEN_DISABLED",
    "ERR_DLOPEN_FAILED",
    "ERR_DNS_SET_SERVERS_FAILED",
    "ERR_ENCODING_INVALID_ENCODED_DATA",
    "ERR_ENCODING_NOT_SUPPORTED",
    "ERR_EVENT_RECURSION",
    "ERR_EXECUTION_ENVIRONMENT_NOT_AVAILABLE",
    "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM",
    "ERR_FORMDATA_PARSE_ERROR",
    "ERR_FS_CP_DIR_TO_NON_DIR",
    "ERR_FS_CP_EINVAL",
    "ERR_FS_CP_FIFO_PIPE",
    "ERR_FS_CP_NON_DIR_TO_DIR",
    "ERR_FS_CP_SOCKET",
    "ERR_FS_CP_UNKNOWN",
    "ERR_FS_EISDIR",
    "ERR_HTTP_BODY_NOT_ALLOWED",
    "ERR_HTTP_HEADERS_SENT",
    "ERR_HTTP_CONTENT_LENGTH_MISMATCH",
    "ERR_HTTP_INVALID_HEADER_VALUE",
    "ERR_HTTP_INVALID_STATUS_CODE",
    "ERR_HTTP_TRAILER_INVALID",
    "ERR_HTTP_SOCKET_ASSIGNED",
    "ERR_HTTP2_ALTSVC_INVALID_ORIGIN",
    "ERR_HTTP2_ALTSVC_LENGTH",
    "ERR_HTTP2_CONNECT_AUTHORITY",
    "ERR_HTTP2_CONNECT_SCHEME",
    "ERR_HTTP2_CONNECT_PATH",
    "ERR_HTTP2_ERROR",
    "ERR_HTTP2_HEADER_SINGLE_VALUE",
    "ERR_HTTP2_HEADERS_AFTER_RESPOND",
    "ERR_HTTP2_HEADERS_SENT",
    "ERR_HTTP2_INFO_STATUS_NOT_ALLOWED",
    "ERR_HTTP2_INVALID_HEADER_VALUE",
    "ERR_HTTP2_INVALID_INFO_STATUS",
    "ERR_HTTP2_INVALID_ORIGIN",
    "ERR_HTTP2_INVALID_PSEUDOHEADER",
    "ERR_HTTP2_INVALID_SESSION",
    "ERR_HTTP2_INVALID_STREAM",
    "ERR_HTTP2_MAX_PENDING_SETTINGS_ACK",
    "ERR_HTTP2_NO_SOCKET_MANIPULATION",
    "ERR_HTTP2_ORIGIN_LENGTH",
    "ERR_HTTP2_OUT_OF_STREAMS",
    "ERR_HTTP2_PAYLOAD_FORBIDDEN",
    "ERR_HTTP2_PING_CANCEL",
    "ERR_HTTP2_PING_LENGTH",
    "ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED",
    "ERR_HTTP2_PUSH_DISABLED",
    "ERR_HTTP2_SEND_FILE_NOSEEK",
    "ERR_HTTP2_SEND_FILE",
    "ERR_HTTP2_SESSION_ERROR",
    "ERR_HTTP2_SOCKET_UNBOUND",
    "ERR_HTTP2_STATUS_101",
    "ERR_HTTP2_STATUS_INVALID",
    "ERR_HTTP2_STREAM_ERROR",
    "ERR_HTTP2_TRAILERS_ALREADY_SENT",
    "ERR_HTTP2_TRAILERS_NOT_READY",
    "ERR_HTTP2_TOO_MANY_CUSTOM_SETTINGS",
    "ERR_HTTP2_TOO_MANY_INVALID_FRAMES",
    "ERR_HTTP2_UNSUPPORTED_PROTOCOL",
    "ERR_HTTP2_INVALID_SETTING_VALUE",
    "ERR_HTTP2_INVALID_SETTING_VALUE",
    "ERR_ILLEGAL_CONSTRUCTOR",
    "ERR_INCOMPATIBLE_OPTION_PAIR",
    "ERR_INVALID_ADDRESS",
    "ERR_INVALID_ADDRESS_FAMILY",
    "ERR_INVALID_ARG_TYPE",
    "ERR_INVALID_ARG_VALUE",
    "ERR_INVALID_ASYNC_ID",
    "ERR_INVALID_CHAR",
    "ERR_INVALID_CURSOR_POS",
    "ERR_INVALID_FD_TYPE",
    "ERR_INVALID_FILE_URL_HOST",
    "ERR_INVALID_FILE_URL_PATH",
    "ERR_INVALID_HANDLE_TYPE",
    "ERR_INVALID_HTTP_TOKEN",
    "ERR_INVALID_IP_ADDRESS",
    "ERR_INVALID_MIME_SYNTAX",
    "ERR_INVALID_MODULE",
    "ERR_INVALID_OBJECT_DEFINE_PROPERTY",
    "ERR_INVALID_PACKAGE_CONFIG",
    "ERR_INVALID_PROTOCOL",
    "ERR_INVALID_RETURN_VALUE",
    "ERR_INVALID_STATE",
    "ERR_INVALID_STATE",
    "ERR_INVALID_STATE",
    "ERR_INVALID_THIS",
    "ERR_INVALID_URI",
    "ERR_INVALID_URL_SCHEME",
    "ERR_INVALID_URL",
    "ERR_IP_BLOCKED",
    "ERR_IPC_CHANNEL_CLOSED",
    "ERR_IPC_DISCONNECTED",
    "ERR_IPC_ONE_PIPE",
    "ERR_LOAD_SQLITE_EXTENSION",
    "ERR_MEMORY_ALLOCATION_FAILED",
    "ERR_MESSAGE_TARGET_CONTEXT_UNAVAILABLE",
    "ERR_METHOD_NOT_IMPLEMENTED",
    "ERR_MISSING_ARGS",
    "ERR_MISSING_PASSPHRASE",
    "ERR_MISSING_PLATFORM_FOR_WORKER",
    "ERR_MODULE_NOT_FOUND",
    "ERR_MULTIPLE_CALLBACK",
    "ERR_NON_CONTEXT_AWARE_DISABLED",
    "ERR_OUT_OF_RANGE",
    "ERR_PARSE_ARGS_INVALID_OPTION_VALUE",
    "ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL",
    "ERR_PARSE_ARGS_UNKNOWN_OPTION",
    "ERR_POSTGRES_AUTHENTICATION_FAILED_PBKDF2",
    "ERR_POSTGRES_CONNECTION_CLOSED",
    "ERR_POSTGRES_CONNECTION_TIMEOUT",
    "ERR_POSTGRES_EXPECTED_REQUEST",
    "ERR_POSTGRES_EXPECTED_STATEMENT",
    "ERR_POSTGRES_IDLE_TIMEOUT",
    "ERR_POSTGRES_INVALID_BACKEND_KEY_DATA",
    "ERR_POSTGRES_INVALID_BINARY_DATA",
    "ERR_POSTGRES_INVALID_BYTE_SEQUENCE_FOR_ENCODING",
    "ERR_POSTGRES_INVALID_BYTE_SEQUENCE",
    "ERR_POSTGRES_INVALID_CHARACTER",
    "ERR_POSTGRES_INVALID_MESSAGE_LENGTH",
    "ERR_POSTGRES_INVALID_MESSAGE",
    "ERR_POSTGRES_INVALID_QUERY_BINDING",
    "ERR_POSTGRES_INVALID_SERVER_KEY",
    "ERR_POSTGRES_INVALID_SERVER_SIGNATURE",
    "ERR_POSTGRES_INVALID_TRANSACTION_STATE",
    "ERR_POSTGRES_LIFETIME_TIMEOUT",
    "ERR_POSTGRES_MULTIDIMENSIONAL_ARRAY_NOT_SUPPORTED_YET",
    "ERR_POSTGRES_NOT_TAGGED_CALL",
    "ERR_POSTGRES_NULLS_IN_ARRAY_NOT_SUPPORTED_YET",
    "ERR_POSTGRES_OVERFLOW",
    "ERR_POSTGRES_QUERY_CANCELLED",
    "ERR_POSTGRES_SASL_SIGNATURE_INVALID_BASE64",
    "ERR_POSTGRES_SASL_SIGNATURE_MISMATCH",
    "ERR_POSTGRES_SERVER_ERROR",
    "ERR_POSTGRES_SYNTAX_ERROR",
    "ERR_POSTGRES_TLS_NOT_AVAILABLE",
    "ERR_POSTGRES_TLS_UPGRADE_FAILED",
    "ERR_POSTGRES_UNEXPECTED_MESSAGE",
    "ERR_POSTGRES_UNKNOWN_AUTHENTICATION_METHOD",
    "ERR_POSTGRES_UNKNOWN_FORMAT_CODE",
    "ERR_POSTGRES_UNSAFE_TRANSACTION",
    "ERR_POSTGRES_UNSUPPORTED_ARRAY_FORMAT",
    "ERR_POSTGRES_UNSUPPORTED_AUTHENTICATION_METHOD",
    "ERR_POSTGRES_UNSUPPORTED_BYTEA_FORMAT",
    "ERR_POSTGRES_UNSUPPORTED_INTEGER_SIZE",
    "ERR_POSTGRES_UNSUPPORTED_NUMERIC_FORMAT",
    "ERR_PROXY_INVALID_CONFIG",
    "ERR_MYSQL_CONNECTION_CLOSED",
    "ERR_MYSQL_CONNECTION_TIMEOUT",
    "ERR_MYSQL_IDLE_TIMEOUT",
    "ERR_MYSQL_LIFETIME_TIMEOUT",
    "ERR_UNHANDLED_REJECTION",
    "ERR_REQUIRE_ASYNC_MODULE",
    "ERR_S3_INVALID_ENDPOINT",
    "ERR_S3_INVALID_METHOD",
    "ERR_S3_INVALID_PATH",
    "ERR_S3_INVALID_SESSION_TOKEN",
    "ERR_S3_INVALID_SIGNATURE",
    "ERR_S3_MISSING_CREDENTIALS",
    "ERR_SCRIPT_EXECUTION_INTERRUPTED",
    "ERR_SCRIPT_EXECUTION_TIMEOUT",
    "ERR_SERVER_ALREADY_LISTEN",
    "ERR_SERVER_NOT_RUNNING",
    "ERR_SOCKET_ALREADY_BOUND",
    "ERR_SOCKET_BAD_BUFFER_SIZE",
    "ERR_SOCKET_BAD_PORT",
    "ERR_SOCKET_BAD_TYPE",
    "ERR_SOCKET_CLOSED_BEFORE_CONNECTION",
    "ERR_SOCKET_CLOSED",
    "ERR_SOCKET_CONNECTION_TIMEOUT",
    "ERR_SOCKET_DGRAM_IS_CONNECTED",
    "ERR_SOCKET_DGRAM_NOT_CONNECTED",
    "ERR_SOCKET_DGRAM_NOT_RUNNING",
    "ERR_SSR_RESPONSE_EXPECTED",
    "ERR_STREAM_ALREADY_FINISHED",
    "ERR_STREAM_CANNOT_PIPE",
    "ERR_STREAM_DESTROYED",
    "ERR_STREAM_NULL_VALUES",
    "ERR_STREAM_PREMATURE_CLOSE",
    "ERR_STREAM_PUSH_AFTER_EOF",
    "ERR_STREAM_RELEASE_LOCK",
    "ERR_STREAM_UNABLE_TO_PIPE",
    "ERR_STREAM_UNSHIFT_AFTER_END_EVENT",
    "ERR_STREAM_WRAP",
    "ERR_STREAM_WRITE_AFTER_END",
    "ERR_STRING_TOO_LONG",
    "ERR_TLS_CERT_ALTNAME_FORMAT",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "ERR_TLS_HANDSHAKE_TIMEOUT",
    "ERR_TLS_INVALID_PROTOCOL_METHOD",
    "ERR_TLS_INVALID_PROTOCOL_VERSION",
    "ERR_TLS_PROTOCOL_VERSION_CONFLICT",
    "ERR_TLS_PSK_SET_IDENTITY_HINT_FAILED",
    "ERR_TLS_RENEGOTIATION_DISABLED",
    "ERR_TLS_SNI_FROM_SERVER",
    "ERR_TLS_ALPN_CALLBACK_WITH_PROTOCOLS",
    "ERR_SSL_NO_CIPHER_MATCH",
    "ERR_UNAVAILABLE_DURING_EXIT",
    "ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET",
    "ERR_UNESCAPED_CHARACTERS",
    "ERR_UNHANDLED_ERROR",
    "ERR_UNKNOWN_CREDENTIAL",
    "ERR_UNKNOWN_ENCODING",
    "ERR_UNKNOWN_SIGNAL",
    "ERR_ZSTD_INVALID_PARAM",
    "ERR_USE_AFTER_CLOSE",
    "ERR_WASI_NOT_STARTED",
    "ERR_WEBASSEMBLY_RESPONSE",
    "ERR_WORKER_INIT_FAILED",
    "ERR_WORKER_NOT_RUNNING",
    "ERR_WORKER_UNSUPPORTED_OPERATION",
    "ERR_ZLIB_INITIALIZATION_FAILED",
    "MODULE_NOT_FOUND",
    "ERR_INTERNAL_ASSERTION",
    "ERR_OSSL_EVP_INVALID_DIGEST",
    "ERR_KEY_GENERATION_JOB_FAILED",
    "ERR_MISSING_OPTION",
    "ERR_REDIS_AUTHENTICATION_FAILED",
    "ERR_REDIS_CONNECTION_CLOSED",
    "ERR_REDIS_CONNECTION_TIMEOUT",
    "ERR_REDIS_IDLE_TIMEOUT",
    "ERR_REDIS_INVALID_ARGUMENT",
    "ERR_REDIS_INVALID_ARRAY",
    "ERR_REDIS_INVALID_BULK_STRING",
    "ERR_REDIS_INVALID_COMMAND",
    "ERR_REDIS_INVALID_DATABASE",
    "ERR_REDIS_INVALID_ERROR_STRING",
    "ERR_REDIS_INVALID_INTEGER",
    "ERR_REDIS_INVALID_PASSWORD",
    "ERR_REDIS_INVALID_RESPONSE",
    "ERR_REDIS_INVALID_RESPONSE_TYPE",
    "ERR_REDIS_INVALID_SIMPLE_STRING",
    "ERR_REDIS_INVALID_STATE",
    "ERR_REDIS_INVALID_USERNAME",
    "ERR_REDIS_TLS_NOT_AVAILABLE",
    "ERR_REDIS_TLS_UPGRADE_FAILED",
    "HPE_UNEXPECTED_CONTENT_LENGTH",
    "HPE_INVALID_TRANSFER_ENCODING",
    "HPE_INVALID_EOF_STATE",
    "HPE_INVALID_METHOD",
    "HPE_INTERNAL",
    "ERR_VM_MODULE_STATUS",
    "ERR_VM_MODULE_ALREADY_LINKED",
    "ERR_VM_MODULE_CANNOT_CREATE_CACHED_DATA",
    "ERR_VM_MODULE_NOT_MODULE",
    "ERR_VM_MODULE_DIFFERENT_CONTEXT",
    "ERR_VM_MODULE_LINK_FAILURE",
    "ERR_VM_MODULE_CACHED_DATA_REJECTED",
    "ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING",
    "HPE_INVALID_HEADER_TOKEN",
    "HPE_HEADER_OVERFLOW",
    "ERR_SECRETS_NOT_AVAILABLE",
    "ERR_SECRETS_NOT_FOUND",
    "ERR_SECRETS_ACCESS_DENIED",
    "ERR_SECRETS_PLATFORM_ERROR",
    "ERR_SECRETS_USER_CANCELED",
    "ERR_SECRETS_INTERACTION_NOT_ALLOWED",
    "ERR_SECRETS_AUTH_FAILED",
    "ERR_SECRETS_INTERACTION_REQUIRED",
];

// ──────────────────────────────────────────────────────────────────────────
// Legacy anyerror-wrapper sentinels (src/jsc/ErrorCode.zig).
// ──────────────────────────────────────────────────────────────────────────
impl ErrorCode {
    // TODO(b2-blocked): bun_core::Error::as_u16 — bun_core::Error is currently the
    // wide errno-carrying struct, not the NonZeroU16 anyerror code. Use errno as a
    // stand-in until the interning table lands.
    pub const PARSER_ERROR: ErrorCodeInt = 0xFFFE;
    pub const JS_ERROR_OBJECT: ErrorCodeInt = 0xFFFD;

    #[inline]
    pub fn from(code: bun_core::Error) -> ErrorCode {
        // Zig: @as(ErrorCode, @enumFromInt(@intFromError(code)))
        ErrorCode(code.as_u16() as ErrorCodeInt)
    }

    #[inline]
    pub fn to_error(self) -> bun_core::Error {
        // Zig: @errorFromInt(@intFromEnum(self))
        bun_core::Error::from_errno(self.0 as i32)
    }
}

impl ErrorCode {
    #[inline]
    pub const fn raw(self) -> u16 {
        self.0
    }

    /// Node `error.code` string (e.g. `"ERR_INVALID_ARG_TYPE"`).
    #[inline]
    pub fn code_str(self) -> &'static str {
        CODE_STR
            .get(self.0 as usize)
            .copied()
            .unwrap_or("ERR_UNKNOWN")
    }

    /// `Error.fmt(this, globalThis, fmt, args)` (codegen ErrorCode.zig) —
    /// formats `args` into a `bun.String`, hands it to
    /// `Bun__createErrorWithCode`, and returns the constructed Error JSValue.
    /// The C++ side picks the ctor / `.name` / `.code` from `errors[self.0]`.
    pub fn fmt<G: GlobalObjectRef + ?Sized>(self, global: &G, args: Arguments<'_>) -> JSValue {
        let mut message = bun_core::String::create_format(args);
        // `G` is one of the two `#[repr(C)]` opaque ZST `JSGlobalObject`
        // handles (see `GlobalObjectRef` doc); `opaque_ref` is the safe
        // ZST-handle deref proof (panics on null). C++ clones the impl into a
        // JSString; Zig wrapper does `defer message.deref()`, mirrored below.
        let global = JSGlobalObject::opaque_ref(global.as_global_ptr().cast::<JSGlobalObject>());
        let v = Bun__createErrorWithCode(global, self, &mut message);
        message.deref();
        v
    }

    /// `Error.throw(this, globalThis, fmt, args)` — `.fmt` then
    /// `globalThis.throwValue`.
    #[inline]
    pub fn throw<G: GlobalObjectRef + ?Sized>(self, global: &G, args: Arguments<'_>) -> JsError {
        global.throw_js_value(self.fmt(global, args))
    }
}

impl From<ErrorCode> for &'static str {
    #[inline]
    fn from(c: ErrorCode) -> &'static str {
        c.code_str()
    }
}

impl core::fmt::Display for ErrorCode {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.write_str(self.code_str())
    }
}

// safe fn: `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle (`&` is
// ABI-identical to non-null `*mut`); `bun_core::String` is `#[repr(C)]` and
// the C++ side reads it in-place (clones the impl into a JSString); `ErrorCode`
// is a by-value `#[repr(u16)]` POD.
unsafe extern "C" {
    safe fn Bun__createErrorWithCode(
        global: &JSGlobalObject,
        code: ErrorCode,
        message: &mut bun_core::String,
    ) -> JSValue;
}

/// Runtime equivalent of Zig's comptime `ErrorBuilder(code, fmt, Args)`.
/// Returned from `JSGlobalObject::err(code, args)` so callers can choose
/// `.throw()` / `.to_js()` / `.reject()` at the use site.
pub struct ErrorBuilder<'a, G: GlobalObjectRef + ?Sized = JSGlobalObject> {
    pub global: &'a G,
    pub code: ErrorCode,
    pub args: Arguments<'a>,
}

impl<'a, G: GlobalObjectRef + ?Sized> ErrorBuilder<'a, G> {
    #[inline]
    pub fn new(global: &'a G, code: ErrorCode, args: Arguments<'a>) -> Self {
        Self { global, code, args }
    }

    /// Throw this error as a JS exception.
    #[inline]
    pub fn throw(self) -> JsError {
        self.code.throw(self.global, self.args)
    }

    /// Turn this into a JSValue (the constructed Error object).
    #[inline]
    pub fn to_js(self) -> JSValue {
        self.code.fmt(self.global, self.args)
    }

    /// Turn this into a `JSPromise` that is already rejected with the error.
    #[inline]
    pub fn reject(self) -> JSValue {
        let v = self.code.fmt(self.global, self.args);
        // `G` is one of the two `#[repr(C)]` opaque ZST `JSGlobalObject`
        // handles (see `GlobalObjectRef` doc); both name the same C++ object,
        // so reinterpreting the pointer for `JSPromise::rejected_promise`
        // (which is still typed against the lib.rs stub) is sound. `opaque_ref`
        // is the safe ZST-handle deref (panics on null).
        let global: &JSGlobalObject =
            JSGlobalObject::opaque_ref(self.global.as_global_ptr().cast::<JSGlobalObject>());
        JSPromise::rejected_promise(global, v).to_js()
    }
}

// Zig: comptime { @export(&ErrorCode.ParserError, .{ .name = "Zig_ErrorCodeParserError" }); ... }
//
// Gated off: in Zig these are `@intFromEnum(ErrorCode.from(error.ParserError))`
// — i.e. derived from the anyerror integer so that the value C++ compares
// against (`extern "C" ZigErrorCode Zig_ErrorCodeParserError;`,
// headers-handwritten.h) is exactly what `from()` produces. The Rust `from()`
// above currently maps via `code.errno`, which never yields the hard-coded
// 0xFFFE/0xFFFD placeholders, so exporting them would make C++ parser-error
// detection silently never match. Until `bun_core::Error` gains the
// NonZeroU16 anyerror interning (`err!("ParserError").as_u16()`) and these
// constants can be derived from the same source as `from()`, keep the Zig-side
// `@export` authoritative and do not let C++ link against bogus Rust statics.

#[unsafe(no_mangle)]
pub static Zig_ErrorCodeParserError: ErrorCodeInt = ErrorCode::PARSER_ERROR;

#[unsafe(no_mangle)]
pub static Zig_ErrorCodeJSErrorObject: ErrorCodeInt = ErrorCode::JS_ERROR_OBJECT;

// ported from: src/jsc/bindings/ErrorCode.ts
