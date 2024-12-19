// used by generate-node-errors.ts
type ErrorCodeMapping = Array<
  [
    /** error.code  */
    string,
    /** Constructor **/
    typeof TypeError | typeof RangeError | typeof Error | typeof SyntaxError,
    /** error.name. Defaults to `Constructor.name` (that is, mapping[1].name  */
    string,
  ]
>;

export default [
  ["ABORT_ERR", Error, "AbortError"],
  ["ERR_CRYPTO_INVALID_DIGEST", TypeError],
  ["ERR_ENCODING_INVALID_ENCODED_DATA", TypeError],
  ["ERR_INVALID_ARG_TYPE", TypeError],
  ["ERR_INVALID_ARG_VALUE", TypeError],
  ["ERR_INVALID_PROTOCOL", TypeError],
  ["ERR_INVALID_THIS", TypeError],
  ["ERR_IPC_CHANNEL_CLOSED", Error],
  ["ERR_IPC_DISCONNECTED", Error],
  ["ERR_MISSING_ARGS", TypeError],
  ["ERR_OUT_OF_RANGE", RangeError],
  ["ERR_PARSE_ARGS_INVALID_OPTION_VALUE", TypeError],
  ["ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL", TypeError],
  ["ERR_PARSE_ARGS_UNKNOWN_OPTION", TypeError],
  ["ERR_SERVER_NOT_RUNNING", Error],
  ["ERR_SOCKET_BAD_TYPE", TypeError],
  ["ERR_STREAM_ALREADY_FINISHED", TypeError],
  ["ERR_STREAM_CANNOT_PIPE", TypeError],
  ["ERR_STREAM_DESTROYED", TypeError],
  ["ERR_STREAM_NULL_VALUES", TypeError],
  ["ERR_STREAM_WRITE_AFTER_END", TypeError],
  ["ERR_ZLIB_INITIALIZATION_FAILED", Error],
  ["ERR_STRING_TOO_LONG", Error],
  ["ERR_CRYPTO_SCRYPT_INVALID_PARAMETER", Error],
  ["ERR_CRYPTO_INVALID_SCRYPT_PARAMS", RangeError],
  ["MODULE_NOT_FOUND", Error],
  ["ERR_ILLEGAL_CONSTRUCTOR", TypeError],
  ["ERR_INVALID_URL", TypeError],
  ["ERR_BUFFER_TOO_LARGE", RangeError],
  ["ERR_BROTLI_INVALID_PARAM", RangeError],
  ["ERR_UNKNOWN_ENCODING", TypeError],
  ["ERR_INVALID_STATE", Error],
  ["ERR_BUFFER_OUT_OF_BOUNDS", RangeError],
  ["ERR_UNKNOWN_SIGNAL", TypeError],
  ["ERR_SOCKET_BAD_PORT", RangeError],
  ["ERR_STREAM_RELEASE_LOCK", Error, "AbortError"],
  ["ERR_INCOMPATIBLE_OPTION_PAIR", TypeError, "TypeError"],
  ["ERR_INVALID_URI", URIError, "URIError"],
  ["ERR_SCRIPT_EXECUTION_TIMEOUT", Error, "Error"],
  ["ERR_SCRIPT_EXECUTION_INTERRUPTED", Error, "Error"],

  // Bun-specific
  ["ERR_FORMDATA_PARSE_ERROR", TypeError],
  ["ERR_BODY_ALREADY_USED", Error],
  ["ERR_STREAM_WRAP", Error],
  ["ERR_BORINGSSL", Error],

  // Console
  ["ERR_CONSOLE_WRITABLE_STREAM", TypeError, "TypeError"],

  // NET
  ["ERR_SOCKET_CLOSED_BEFORE_CONNECTION", Error],
  ["ERR_SOCKET_CLOSED", Error],

  // HTTP2
  ["ERR_INVALID_HTTP_TOKEN", TypeError],
  ["ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED", TypeError],
  ["ERR_HTTP2_SEND_FILE", Error],
  ["ERR_HTTP2_SEND_FILE_NOSEEK", Error],
  ["ERR_HTTP2_HEADERS_SENT", Error, "ERR_HTTP2_HEADERS_SENT"],
  ["ERR_HTTP2_INFO_STATUS_NOT_ALLOWED", RangeError],
  ["ERR_HTTP2_STATUS_INVALID", RangeError],
  ["ERR_HTTP2_INVALID_PSEUDOHEADER", TypeError],
  ["ERR_HTTP2_INVALID_HEADER_VALUE", TypeError],
  ["ERR_HTTP2_PING_CANCEL", Error],
  ["ERR_HTTP2_STREAM_ERROR", Error],
  ["ERR_HTTP2_INVALID_SINGLE_VALUE_HEADER", TypeError],
  ["ERR_HTTP2_SESSION_ERROR", Error],
  ["ERR_HTTP2_INVALID_SESSION", Error],
  ["ERR_HTTP2_INVALID_HEADERS", Error],
  ["ERR_HTTP2_PING_LENGTH", RangeError],
  ["ERR_HTTP2_INVALID_STREAM", Error],
  ["ERR_HTTP2_TRAILERS_ALREADY_SENT", Error],
  ["ERR_HTTP2_TRAILERS_NOT_READY", Error],
  ["ERR_HTTP2_PAYLOAD_FORBIDDEN", Error],
  ["ERR_HTTP2_NO_SOCKET_MANIPULATION", Error],
  ["ERR_HTTP2_SOCKET_UNBOUND", Error],
  ["ERR_HTTP2_ERROR", Error],
  ["ERR_HTTP2_OUT_OF_STREAMS", Error],

  // AsyncHooks
  ["ERR_ASYNC_TYPE", TypeError],
  ["ERR_INVALID_ASYNC_ID", RangeError],
  ["ERR_ASYNC_CALLBACK", TypeError],
] as ErrorCodeMapping;
