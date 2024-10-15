export default {
  ERR_INVALID_HTTP_TOKEN: class ERR_INVALID_HTTP_TOKEN extends TypeError {
    constructor(message, token) {
      super(`${message} must be a valid HTTP token ["${token}"]`);
      this.code = "ERR_INVALID_HTTP_TOKEN";
    }
  },
  ERR_INVALID_ARG_VALUE: class ERR_INVALID_ARG_VALUE extends TypeError {
    constructor(field, value) {
      super(
        value !== undefined
          ? `The arguments ${field} is invalid. Received ${value}`
          : `The arguments ${field} is invalid.`,
      );
      this.code = "ERR_INVALID_ARG_VALUE";
    }
  },
  ERR_INVALID_ARG_TYPE: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_INVALID_ARG_TYPE", 3),
  ERR_OUT_OF_RANGE: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_OUT_OF_RANGE", 3),
  ERR_IPC_DISCONNECTED: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_IPC_DISCONNECTED", 0),
  ERR_SERVER_NOT_RUNNING: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_SERVER_NOT_RUNNING", 0),
  ERR_IPC_CHANNEL_CLOSED: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_IPC_CHANNEL_CLOSED", 0),
  ERR_SOCKET_BAD_TYPE: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_SOCKET_BAD_TYPE", 0),
  ERR_INVALID_PROTOCOL: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_INVALID_PROTOCOL", 0),
  ERR_BROTLI_INVALID_PARAM: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_BROTLI_INVALID_PARAM", 0),
  ERR_BUFFER_TOO_LARGE: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_BUFFER_TOO_LARGE", 0),
  ERR_ZLIB_INITIALIZATION_FAILED: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_ZLIB_INITIALIZATION_FAILED", 0),
  ERR_BUFFER_OUT_OF_BOUNDS: $newCppFunction("ErrorCode.cpp", "jsFunction_ERR_BUFFER_OUT_OF_BOUNDS", 0),
};
