type ErrorCodeMapping = Array<
  [
    /** error.code  */
    string,
    /** Constructor **/
    typeof TypeError | typeof RangeError | typeof Error | typeof SyntaxError,
    /** error.name  */
    string,
  ]
>;

export default [
  ["ABORT_ERR", Error, "AbortError"],
  ["ERR_CRYPTO_INVALID_DIGEST", TypeError, "TypeError"],
  ["ERR_ENCODING_INVALID_ENCODED_DATA", TypeError, "TypeError"],
  ["ERR_HTTP2_INVALID_HEADER_VALUE", TypeError, "TypeError"],
  ["ERR_HTTP2_INVALID_PSEUDOHEADER", TypeError, "TypeError"],
  ["ERR_HTTP2_INVALID_SINGLE_VALUE_HEADER", TypeError, "TypeError"],
  ["ERR_INVALID_ARG_TYPE", TypeError, "TypeError"],
  ["ERR_INVALID_ARG_VALUE", TypeError, "TypeError"],
  ["ERR_INVALID_PROTOCOL", TypeError, "TypeError"],
  ["ERR_INVALID_THIS", TypeError, "TypeError"],
  ["ERR_IPC_CHANNEL_CLOSED", Error, "Error"],
  ["ERR_IPC_DISCONNECTED", Error, "Error"],
  ["ERR_MISSING_ARGS", TypeError, "TypeError"],
  ["ERR_OUT_OF_RANGE", RangeError, "RangeError"],
  ["ERR_PARSE_ARGS_INVALID_OPTION_VALUE", TypeError, "TypeError"],
  ["ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL", TypeError, "TypeError"],
  ["ERR_PARSE_ARGS_UNKNOWN_OPTION", TypeError, "TypeError"],
  ["ERR_SERVER_NOT_RUNNING", Error, "Error"],
  ["ERR_SOCKET_BAD_TYPE", TypeError, "TypeError"],
  ["ERR_STREAM_ALREADY_FINISHED", TypeError, "TypeError"],
  ["ERR_STREAM_CANNOT_PIPE", TypeError, "TypeError"],
  ["ERR_STREAM_DESTROYED", TypeError, "TypeError"],
  ["ERR_STREAM_NULL_VALUES", TypeError, "TypeError"],
  ["ERR_STREAM_WRITE_AFTER_END", TypeError, "TypeError"],
  ["ERR_ZLIB_INITIALIZATION_FAILED", Error, "Error"],
  ["ERR_STRING_TOO_LONG", Error, "Error"],
  ["ERR_CRYPTO_SCRYPT_INVALID_PARAMETER", Error, "Error"],
  ["ERR_CRYPTO_INVALID_SCRYPT_PARAMS", RangeError, "RangeError"],
  ["MODULE_NOT_FOUND", Error, "Error"],
  ["ERR_ILLEGAL_CONSTRUCTOR", TypeError, "TypeError"],
  ["ERR_INVALID_URL", TypeError, "TypeError"],
  ["ERR_BUFFER_TOO_LARGE", RangeError, "RangeError"],

  // Bun-specific
  ["ERR_FORMDATA_PARSE_ERROR", TypeError, "TypeError"],
  ["ERR_BODY_ALREADY_USED", Error, "Error"],
  ["ERR_STREAM_WRAP", Error, "Error"],
] as ErrorCodeMapping;
