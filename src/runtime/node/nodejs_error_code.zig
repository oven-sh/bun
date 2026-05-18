/// https://nodejs.org/api/errors.html#nodejs-error-codes
pub const Code = enum {
    /// Used when an operation has been aborted (typically using an AbortController).
    /// APIs not using AbortSignals typically do not raise an error with this code.
    /// This code does not use the regular ERR_* convention Node.js errors use in order to be compatible with the web platform's AbortError.
    /// Added in: v15.0.0
    ABORT_ERR,

    /// A function argument is being used in a way that suggests that the function signature may be misunderstood. This is thrown by the assert module when the message parameter in assert.throws(block, message) matches the error message thrown by block because that usage suggests that the user believes message is the expected message rather than the message the AssertionError will display if block does not throw.
    ERR_AMBIGUOUS_ARGUMENT,

    /// An iterable argument (i.e. a value that works with for...of loops) was required, but not provided to a Node.js API.
    ERR_ARG_NOT_ITERABLE,

    /// A special type of error that can be triggered whenever Node.js detects an exceptional logic violation that should never occur. These are raised typically by the assert module.
    ERR_ASSERTION,

    /// An attempt was made to register something that is not a function as an AsyncHooks callback.
    ERR_ASYNC_CALLBACK,

    /// The type of an asynchronous resource was invalid. Users are also able to define their own types if using the public embedder API.
    ERR_ASYNC_TYPE,

    /// Data passed to a Brotli stream was not successfully compressed.
    ERR_BROTLI_COMPRESSION_FAILED,

    /// An invalid parameter key was passed during construction of a Brotli stream.
    ERR_BROTLI_INVALID_PARAM,

    /// When encountering this error, a possible alternative to creating a Buffer instance is to create a normal Uint8Array, which only differs in the prototype of the resulting object. Uint8Arrays are generally accepted in all Node.js core APIs where Buffers are; they are available in all Contexts.
    /// An attempt was made to create a Node.js Buffer instance from addon or embedder code, while in a JS engine Context that is not associated with a Node.js instance. The data passed to the Buffer method will have been released by the time the method returns.
    ERR_BUFFER_CONTEXT_NOT_AVAILABLE,

    /// An operation outside the bounds of a Buffer was attempted.
    ERR_BUFFER_OUT_OF_BOUNDS,

    /// An attempt has been made to create a Buffer larger than the maximum allowed size.
    ERR_BUFFER_TOO_LARGE,

    /// Node.js was unable to watch for the SIGINT signal.
    ERR_CANNOT_WATCH_SIGINT,

    /// A child process was closed before the parent received a reply.
    ERR_CHILD_CLOSED_BEFORE_REPLY,

    /// Used when a child process is being forked without specifying an IPC channel.
    ERR_CHILD_PROCESS_IPC_REQUIRED,

    /// Used when the main process is trying to read data from the child process's STDERR/STDOUT, and the data's length is longer than the maxBuffer option.
    ERR_CHILD_PROCESS_STDIO_MAXBUFFER,

    /// There was an attempt to use a MessagePort instance in a closed state, usually after .close() has been called.
    ERR_CLOSED_MESSAGE_PORT,

    /// Console was instantiated without stdout stream, or Console has a non-writable stdout or stderr stream.
    ERR_CONSOLE_WRITABLE_STREAM,

    /// A class constructor was called that is not callable.
    ERR_CONSTRUCT_CALL_INVALID,

    /// A constructor for a class was called without new.
    ERR_CONSTRUCT_CALL_REQUIRED,

    /// The vm context passed into the API is not yet initialized. This could happen when an error occurs (and is caught) during the creation of the context, for example, when the allocation fails or the maximum call stack size is reached when the context is created.
    ERR_CONTEXT_NOT_INITIALIZED,

    /// A client certificate engine was requested that is not supported by the version of OpenSSL being used.
    ERR_CRYPTO_CUSTOM_ENGINE_NOT_SUPPORTED,

    /// An invalid value for the format argument was passed to the crypto.ECDH() class getPublicKey() method.
    ERR_CRYPTO_ECDH_INVALID_FORMAT,

    /// An invalid value for the key argument has been passed to the crypto.ECDH() class computeSecret() method. It means that the public key lies outside of the elliptic curve.
    ERR_CRYPTO_ECDH_INVALID_PUBLIC_KEY,

    /// An invalid crypto engine identifier was passed to require('crypto').setEngine().
    ERR_CRYPTO_ENGINE_UNKNOWN,

    /// The --force-fips command-line argument was used but there was an attempt to enable or disable FIPS mode in the crypto module.
    ERR_CRYPTO_FIPS_FORCED,

    /// An attempt was made to enable or disable FIPS mode, but FIPS mode was not available.
    ERR_CRYPTO_FIPS_UNAVAILABLE,

    /// hash.digest() was called multiple times. The hash.digest() method must be called no more than one time per instance of a Hash object.
    ERR_CRYPTO_HASH_FINALIZED,

    /// hash.update() failed for any reason. This should rarely, if ever, happen.
    ERR_CRYPTO_HASH_UPDATE_FAILED,

    /// The given crypto keys are incompatible with the attempted operation.
    ERR_CRYPTO_INCOMPATIBLE_KEY,

    /// The selected public or private key encoding is incompatible with other options.
    ERR_CRYPTO_INCOMPATIBLE_KEY_OPTIONS,

    /// Added in: v15.0.0
    /// Initialization of the crypto subsystem failed.
    ERR_CRYPTO_INITIALIZATION_FAILED,

    /// Added in: v15.0.0
    /// An invalid authentication tag was provided.
    ERR_CRYPTO_INVALID_AUTH_TAG,

    /// Added in: v15.0.0
    /// An invalid counter was provided for a counter-mode cipher.
    ERR_CRYPTO_INVALID_COUNTER,

    /// An invalid elliptic-curve was provided.
    /// Added in: v15.0.0
    ERR_CRYPTO_INVALID_CURVE,

    /// An invalid crypto digest algorithm was specified.
    ERR_CRYPTO_INVALID_DIGEST,

    /// Added in: v15.0.0
    /// An invalid initialization vector was provided.
    ERR_CRYPTO_INVALID_IV,

    /// Added in: v15.0.0
    /// An invalid JSON Web Key was provided.
    ERR_CRYPTO_INVALID_JWK,

    /// The given crypto key object's type is invalid for the attempted operation.
    ERR_CRYPTO_INVALID_KEY_OBJECT_TYPE,

    /// Added in: v15.0.0
    /// An invalid key length was provided.
    ERR_CRYPTO_INVALID_KEYLEN,

    /// An invalid key pair was provided.
    /// Added in: v15.0.0
    ERR_CRYPTO_INVALID_KEYPAIR,

    /// An invalid key type was provided.
    /// Added in: v15.0.0
    ERR_CRYPTO_INVALID_KEYTYPE,

    /// Added in: v15.0.0
    /// An invalid message length was provided.
    ERR_CRYPTO_INVALID_MESSAGELEN,

    /// Invalid scrypt algorithm parameters were provided.
    /// Added in: v15.0.0
    ERR_CRYPTO_INVALID_SCRYPT_PARAMS,

    /// A crypto method was used on an object that was in an invalid state. For instance, calling cipher.getAuthTag() before calling cipher.final().
    ERR_CRYPTO_INVALID_STATE,

    /// Added in: v15.0.0
    /// An invalid authentication tag length was provided.
    ERR_CRYPTO_INVALID_TAG_LENGTH,

    /// Added in: v15.0.0
    //// Initialization of an asynchronous crypto operation failed.
    ERR_CRYPTO_JOB_INIT_FAILED,

    /// Key's Elliptic Curve is not registered for use in the JSON Web Key Elliptic Curve Registry.
    ERR_CRYPTO_JWK_UNSUPPORTED_CURVE,

    /// Key's Asymmetric Key Type is not registered for use in the JSON Web Key Types Registry.
    ERR_CRYPTO_JWK_UNSUPPORTED_KEY_TYPE,

    /// A crypto operation failed for an otherwise unspecified reason.
    /// Added in: v15.0.0
    ERR_CRYPTO_OPERATION_FAILED,

    /// The PBKDF2 algorithm failed for unspecified reasons. OpenSSL does not provide more details and therefore neither does Node.js.
    ERR_CRYPTO_PBKDF2_ERROR,

    /// One or more crypto.scrypt() or crypto.scryptSync() parameters are outside their legal range.
    ERR_CRYPTO_SCRYPT_INVALID_PARAMETER,

    /// Node.js was compiled without scrypt support. Not possible with the official release binaries but can happen with custom builds, including distro builds.
    ERR_CRYPTO_SCRYPT_NOT_SUPPORTED,

    /// A signing key was not provided to the sign.sign() method.
    ERR_CRYPTO_SIGN_KEY_REQUIRED,

    /// crypto.timingSafeEqual() was called with Buffer, TypedArray, or DataView arguments of different lengths.
    ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH,

    /// An unknown cipher was specified.
    ERR_CRYPTO_UNKNOWN_CIPHER,

    /// An unknown Diffie-Hellman group name was given. See crypto.getDiffieHellman() for a list of valid group names.
    ERR_CRYPTO_UNKNOWN_DH_GROUP,

    /// Added in: v15.0.0, v14.18.0
    /// An attempt to invoke an unsupported crypto operation was made.
    ERR_CRYPTO_UNSUPPORTED_OPERATION,

    /// An error occurred with the debugger.
    /// Added in: v16.4.0, v14.17.4
    ERR_DEBUGGER_ERROR,

    /// Added in: v16.4.0, v14.17.4
    /// The debugger timed out waiting for the required host/port to be free.
    ERR_DEBUGGER_STARTUP_ERROR,

    /// Added in: v16.10.0
    /// Loading native addons has been disabled using --no-addons.
    ERR_DLOPEN_DISABLED,

    /// Added in: v15.0.0
    /// A call to process.dlopen() failed.
    ERR_DLOPEN_FAILED,

    /// The fs.Dir was previously closed.
    ERR_DIR_CLOSED,

    /// A synchronous read or close call was attempted on an fs.Dir which has ongoing asynchronous operations.
    /// Added in: v14.3.0
    ERR_DIR_CONCURRENT_OPERATION,

    /// c-ares failed to set the DNS server.
    ERR_DNS_SET_SERVERS_FAILED,

    /// The domain module was not usable since it could not establish the required error handling hooks, because process.setUncaughtExceptionCaptureCallback() had been called at an earlier point in time.
    ERR_DOMAIN_CALLBACK_NOT_AVAILABLE,

    /// process.setUncaughtExceptionCaptureCallback() could not be called because the domain module has been loaded at an earlier point in time.
    /// The stack trace is extended to include the point in time at which the domain module had been loaded.
    ERR_DOMAIN_CANNOT_SET_UNCAUGHT_EXCEPTION_CAPTURE,

    /// Data provided to TextDecoder() API was invalid according to the encoding provided.
    ERR_ENCODING_INVALID_ENCODED_DATA,

    /// Encoding provided to TextDecoder() API was not one of the WHATWG Supported Encodings.
    ERR_ENCODING_NOT_SUPPORTED,

    /// --print cannot be used with ESM input.
    ERR_EVAL_ESM_CANNOT_PRINT,

    /// Thrown when an attempt is made to recursively dispatch an event on EventTarget.
    ERR_EVENT_RECURSION,

    /// The JS execution context is not associated with a Node.js environment. This may occur when Node.js is used as an embedded library and some hooks for the JS engine are not set up properly.
    ERR_EXECUTION_ENVIRONMENT_NOT_AVAILABLE,

    /// A Promise that was callbackified via util.callbackify() was rejected with a falsy value.
    ERR_FALSY_VALUE_REJECTION,

    /// Added in: v14.0.0
    /// Used when a feature that is not available to the current platform which is running Node.js is used.
    ERR_FEATURE_UNAVAILABLE_ON_PLATFORM,

    /// An attempt was made to copy a directory to a non-directory (file, symlink, etc.) using fs.cp().
    ERR_FS_CP_DIR_TO_NON_DIR,

    /// An attempt was made to copy over a file that already existed with fs.cp(), with the force and errorOnExist set to true.
    ERR_FS_CP_EEXIST,

    /// When using fs.cp(), src or dest pointed to an invalid path.
    ERR_FS_CP_EINVAL,

    /// An attempt was made to copy a named pipe with fs.cp().
    ERR_FS_CP_FIFO_PIPE,

    /// An attempt was made to copy a non-directory (file, symlink, etc.) to a directory using fs.cp().
    ERR_FS_CP_NON_DIR_TO_DIR,

    /// An attempt was made to copy to a socket with fs.cp().
    ERR_FS_CP_SOCKET,

    /// When using fs.cp(), a symlink in dest pointed to a subdirectory of src.
    ERR_FS_CP_SYMLINK_TO_SUBDIRECTORY,

    /// An attempt was made to copy to an unknown file type with fs.cp().
    ERR_FS_CP_UNKNOWN,

    /// Path is a directory.
    ERR_FS_EISDIR,

    /// An attempt has been made to read a file whose size is larger than the maximum allowed size for a Buffer.
    ERR_FS_FILE_TOO_LARGE,

    /// An invalid symlink type was passed to the fs.symlink() or fs.symlinkSync() methods.
    ERR_FS_INVALID_SYMLINK_TYPE,

    /// An attempt was made to add more headers after the headers had already been sent.
    ERR_HTTP_HEADERS_SENT,

    /// An invalid HTTP header value was specified.
    ERR_HTTP_INVALID_HEADER_VALUE,

    /// Status code was outside the regular status code range (100-999).
    ERR_HTTP_INVALID_STATUS_CODE,

    /// The client has not sent the entire request within the allowed time.
    ERR_HTTP_REQUEST_TIMEOUT,

    /// Changing the socket encoding is not allowed per RFC 7230 Section 3.
    ERR_HTTP_SOCKET_ENCODING,

    /// The Trailer header was set even though the transfer encoding does not support that.
    ERR_HTTP_TRAILER_INVALID,

    /// HTTP/2 ALTSVC frames require a valid origin.
    ERR_HTTP2_ALTSVC_INVALID_ORIGIN,

    /// HTTP/2 ALTSVC frames are limited to a maximum of 16,382 payload bytes.
    ERR_HTTP2_ALTSVC_LENGTH,

    /// For HTTP/2 requests using the CONNECT method, the :authority pseudo-header is required.
    ERR_HTTP2_CONNECT_AUTHORITY,

    /// For HTTP/2 requests using the CONNECT method, the :path pseudo-header is forbidden.
    ERR_HTTP2_CONNECT_PATH,

    /// For HTTP/2 requests using the CONNECT method, the :scheme pseudo-header is forbidden.
    ERR_HTTP2_CONNECT_SCHEME,

    /// A non-specific HTTP/2 error has occurred.
    ERR_HTTP2_ERROR,

    /// New HTTP/2 Streams may not be opened after the Http2Session has received a GOAWAY frame from the connected peer.
    ERR_HTTP2_GOAWAY_SESSION,

    /// Multiple values were provided for an HTTP/2 header field that was required to have only a single value.
    ERR_HTTP2_HEADER_SINGLE_VALUE,

    /// An additional headers was specified after an HTTP/2 response was initiated.
    ERR_HTTP2_HEADERS_AFTER_RESPOND,

    /// An attempt was made to send multiple response headers.
    ERR_HTTP2_HEADERS_SENT,

    /// Informational HTTP status codes (1xx) may not be set as the response status code on HTTP/2 responses.
    ERR_HTTP2_INFO_STATUS_NOT_ALLOWED,

    /// HTTP/1 connection specific headers are forbidden to be used in HTTP/2 requests and responses.
    ERR_HTTP2_INVALID_CONNECTION_HEADERS,

    /// An invalid HTTP/2 header value was specified.
    ERR_HTTP2_INVALID_HEADER_VALUE,

    /// An invalid HTTP informational status code has been specified. Informational status codes must be an integer between 100 and 199 (inclusive).
    ERR_HTTP2_INVALID_INFO_STATUS,

    /// HTTP/2 ORIGIN frames require a valid origin.
    ERR_HTTP2_INVALID_ORIGIN,

    /// Input Buffer and Uint8Array instances passed to the http2.getUnpackedSettings() API must have a length that is a multiple of six.
    ERR_HTTP2_INVALID_PACKED_SETTINGS_LENGTH,

    /// Only valid HTTP/2 pseudoheaders (:status, :path, :authority, :scheme, and :method) may be used.
    ERR_HTTP2_INVALID_PSEUDOHEADER,

    /// An action was performed on an Http2Session object that had already been destroyed.
    ERR_HTTP2_INVALID_SESSION,

    /// An invalid value has been specified for an HTTP/2 setting.
    ERR_HTTP2_INVALID_SETTING_VALUE,

    /// An operation was performed on a stream that had already been destroyed.
    ERR_HTTP2_INVALID_STREAM,

    /// Whenever an HTTP/2 SETTINGS frame is sent to a connected peer, the peer is required to send an acknowledgment that it has received and applied the new SETTINGS. By default, a maximum number of unacknowledged SETTINGS frames may be sent at any given time. This error code is used when that limit has been reached.
    ERR_HTTP2_MAX_PENDING_SETTINGS_ACK,

    /// An attempt was made to initiate a new push stream from within a push stream. Nested push streams are not permitted.
    ERR_HTTP2_NESTED_PUSH,

    /// Out of memory when using the http2session.setLocalWindowSize(windowSize) API.
    ERR_HTTP2_NO_MEM,

    /// An attempt was made to directly manipulate (read, write, pause, resume, etc.) a socket attached to an Http2Session.
    ERR_HTTP2_NO_SOCKET_MANIPULATION,

    /// HTTP/2 ORIGIN frames are limited to a length of 16382 bytes.
    ERR_HTTP2_ORIGIN_LENGTH,

    /// The number of streams created on a single HTTP/2 session reached the maximum limit.
    ERR_HTTP2_OUT_OF_STREAMS,

    /// A message payload was specified for an HTTP response code for which a payload is forbidden.
    ERR_HTTP2_PAYLOAD_FORBIDDEN,

    /// An HTTP/2 ping was canceled.
    ERR_HTTP2_PING_CANCEL,

    /// HTTP/2 ping payloads must be exactly 8 bytes in length.
    ERR_HTTP2_PING_LENGTH,

    /// An HTTP/2 pseudo-header has been used inappropriately. Pseudo-headers are header key names that begin with the : prefix.
    ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED,

    /// An attempt was made to create a push stream, which had been disabled by the client.
    ERR_HTTP2_PUSH_DISABLED,

    /// An attempt was made to use the Http2Stream.prototype.responseWithFile() API to send a directory.
    ERR_HTTP2_SEND_FILE,

    /// An attempt was made to use the Http2Stream.prototype.responseWithFile() API to send something other than a regular file, but offset or length options were provided.
    ERR_HTTP2_SEND_FILE_NOSEEK,

    /// The Http2Session closed with a non-zero error code.
    ERR_HTTP2_SESSION_ERROR,

    /// The Http2Session settings canceled.
    ERR_HTTP2_SETTINGS_CANCEL,

    /// An attempt was made to connect a Http2Session object to a net.Socket or tls.TLSSocket that had already been bound to another Http2Session object.
    ERR_HTTP2_SOCKET_BOUND,

    /// An attempt was made to use the socket property of an Http2Session that has already been closed.
    ERR_HTTP2_SOCKET_UNBOUND,

    /// Use of the 101 Informational status code is forbidden in HTTP/2.
    ERR_HTTP2_STATUS_101,

    /// An invalid HTTP status code has been specified. Status codes must be an integer between 100 and 599 (inclusive).
    ERR_HTTP2_STATUS_INVALID,

    /// An Http2Stream was destroyed before any data was transmitted to the connected peer.
    ERR_HTTP2_STREAM_CANCEL,

    /// A non-zero error code was been specified in an RST_STREAM frame.
    ERR_HTTP2_STREAM_ERROR,

    /// When setting the priority for an HTTP/2 stream, the stream may be marked as a dependency for a parent stream. This error code is used when an attempt is made to mark a stream and dependent of itself.
    ERR_HTTP2_STREAM_SELF_DEPENDENCY,

    /// The limit of acceptable invalid HTTP/2 protocol frames sent by the peer, as specified through the maxSessionInvalidFrames option, has been exceeded.
    ERR_HTTP2_TOO_MANY_INVALID_FRAMES,

    /// Trailing headers have already been sent on the Http2Stream.
    ERR_HTTP2_TRAILERS_ALREADY_SENT,

    /// The http2stream.sendTrailers() method cannot be called until after the 'wantTrailers' event is emitted on an Http2Stream object. The 'wantTrailers' event will only be emitted if the waitForTrailers option is set for the Http2Stream.
    ERR_HTTP2_TRAILERS_NOT_READY,

    /// http2.connect() was passed a URL that uses any protocol other than http: or https:.
    ERR_HTTP2_UNSUPPORTED_PROTOCOL,

    /// An attempt was made to construct an object using a non-public constructor.
    ERR_ILLEGAL_CONSTRUCTOR,

    /// An import assertion has failed, preventing the specified module to be imported.
    /// Added in: v17.1.0
    ERR_IMPORT_ASSERTION_TYPE_FAILED,

    /// An import assertion is missing, preventing the specified module to be imported.
    /// Added in: v17.1.0
    ERR_IMPORT_ASSERTION_TYPE_MISSING,

    /// An import assertion is not supported by this version of Node.js.
    /// Added in: v17.1.0
    ERR_IMPORT_ASSERTION_TYPE_UNSUPPORTED,

    /// An option pair is incompatible with each other and cannot be used at the same time.
    ERR_INCOMPATIBLE_OPTION_PAIR,

    /// Stability: 1 - Experimental
    ERR_INPUT_TYPE_NOT_ALLOWED,

    /// The --input-type flag was used to attempt to execute a file. This flag can only be used with input via --eval, --print or STDIN.
    /// While using the inspector module, an attempt was made to activate the inspector when it already started to listen on a port. Use inspector.close() before activating it on a different address.
    ERR_INSPECTOR_ALREADY_ACTIVATED,

    /// While using the inspector module, an attempt was made to connect when the inspector was already connected.
    ERR_INSPECTOR_ALREADY_CONNECTED,

    /// While using the inspector module, an attempt was made to use the inspector after the session had already closed.
    ERR_INSPECTOR_CLOSED,

    /// An error occurred while issuing a command via the inspector module.
    ERR_INSPECTOR_COMMAND,

    /// The inspector is not active when inspector.waitForDebugger() is called.
    ERR_INSPECTOR_NOT_ACTIVE,

    /// The inspector module is not available for use.
    ERR_INSPECTOR_NOT_AVAILABLE,

    /// While using the inspector module, an attempt was made to use the inspector before it was connected.
    ERR_INSPECTOR_NOT_CONNECTED,

    /// An API was called on the main thread that can only be used from the worker thread.
    ERR_INSPECTOR_NOT_WORKER,

    /// There was a bug in Node.js or incorrect usage of Node.js internals. To fix the error, open an issue at https://github.com/nodejs/node/issues.
    ERR_INTERNAL_ASSERTION,

    /// The provided IP address was not valid for the given address family.
    ERR_INVALID_ADDRESS,

    /// The provided address family is not understood by the Node.js API.
    ERR_INVALID_ADDRESS_FAMILY,

    /// An argument of the wrong type was passed to a Node.js API.
    ERR_INVALID_ARG_TYPE,

    /// An invalid or unsupported value was passed for a given argument.
    ERR_INVALID_ARG_VALUE,

    /// An invalid asyncId or triggerAsyncId was passed using AsyncHooks. An id less than -1 should never happen.
    ERR_INVALID_ASYNC_ID,

    /// A swap was performed on a Buffer but its size was not compatible with the operation.
    ERR_INVALID_BUFFER_SIZE,

    /// A callback function was required but was not been provided to a Node.js API.
    ERR_INVALID_CALLBACK,

    /// Invalid characters were detected in headers.
    ERR_INVALID_CHAR,

    /// A cursor on a given stream cannot be moved to a specified row without a specified column.
    ERR_INVALID_CURSOR_POS,

    /// A file descriptor ('fd') was not valid (e.g. it was a negative value).
    ERR_INVALID_FD,

    /// A file descriptor ('fd') type was not valid.
    ERR_INVALID_FD_TYPE,

    /// A Node.js API that consumes file: URLs (such as certain functions in the fs module) encountered a file URL with an incompatible host. This situation can only occur on Unix-like systems where only localhost or an empty host is supported.
    ERR_INVALID_FILE_URL_HOST,

    /// A Node.js API that consumes file: URLs (such as certain functions in the fs module) encountered a file URL with an incompatible path. The exact semantics for determining whether a path can be used is platform-dependent.
    ERR_INVALID_FILE_URL_PATH,

    /// An attempt was made to send an unsupported "handle" over an IPC communication channel to a child process. See subprocess.send() and process.send() for more information.
    ERR_INVALID_HANDLE_TYPE,

    /// An invalid HTTP token was supplied.
    ERR_INVALID_HTTP_TOKEN,

    /// An IP address is not valid.
    ERR_INVALID_IP_ADDRESS,

    /// Added in: v15.0.0, v14.18.0
    /// An attempt was made to load a module that does not exist or was otherwise not valid.
    ERR_INVALID_MODULE,

    /// The imported module string is an invalid URL, package name, or package subpath specifier.
    ERR_INVALID_MODULE_SPECIFIER,

    /// An invalid package.json file failed parsing.
    ERR_INVALID_PACKAGE_CONFIG,

    /// The package.json "exports" field contains an invalid target mapping value for the attempted module resolution.
    ERR_INVALID_PACKAGE_TARGET,

    /// While using the Performance Timing API (perf_hooks), a performance mark is invalid.
    ERR_INVALID_PERFORMANCE_MARK,

    /// An invalid options.protocol was passed to http.request().
    ERR_INVALID_PROTOCOL,

    /// Both breakEvalOnSigint and eval options were set in the REPL config, which is not supported.
    ERR_INVALID_REPL_EVAL_CONFIG,

    /// The input may not be used in the REPL. The conditions under which this error is used are described in the REPL documentation.
    ERR_INVALID_REPL_INPUT,

    /// Thrown in case a function option does not provide a valid value for one of its returned object properties on execution.
    ERR_INVALID_RETURN_PROPERTY,

    /// Thrown in case a function option does not provide an expected value type for one of its returned object properties on execution.
    ERR_INVALID_RETURN_PROPERTY_VALUE,

    /// Thrown in case a function option does not return an expected value type on execution, such as when a function is expected to return a promise.
    ERR_INVALID_RETURN_VALUE,

    /// Indicates that an operation cannot be completed due to an invalid state. For instance, an object may have already been destroyed, or may be performing another operation.
    /// Added in: v15.0.0
    ERR_INVALID_STATE,

    /// A Buffer, TypedArray, DataView or string was provided as stdio input to an asynchronous fork. See the documentation for the child_process module for more information.
    ERR_INVALID_SYNC_FORK_INPUT,

    /// A Node.js API function was called with an incompatible this value.
    /// ```js
    /// const urlSearchParams = new URLSearchParams('foo=bar&baz=new');
    /// const buf = Buffer.alloc(1);
    /// urlSearchParams.has.call(buf, 'foo');
    /// ```
    /// Throws a TypeError with code 'ERR_INVALID_THIS'
    ERR_INVALID_THIS,

    /// An invalid transfer object was passed to postMessage().
    ERR_INVALID_TRANSFER_OBJECT,

    /// An element in the iterable provided to the WHATWG URLSearchParams constructor did not represent a [name, value] tuple – that is, if an element is not iterable, or does not consist of exactly two elements.
    ERR_INVALID_TUPLE,

    /// An invalid URI was passed.
    ERR_INVALID_URI,

    /// An invalid URL was passed to the WHATWG URL constructor or the legacy url.parse() to be parsed. The thrown error object typically has an additional property 'input' that contains the URL that failed to parse.
    ERR_INVALID_URL,

    /// An attempt was made to use a URL of an incompatible scheme (protocol) for a specific purpose. It is only used in the WHATWG URL API support in the fs module (which only accepts URLs with 'file' scheme), but may be used in other Node.js APIs as well in the future.
    ERR_INVALID_URL_SCHEME,

    /// An attempt was made to use an IPC communication channel that was already closed.
    ERR_IPC_CHANNEL_CLOSED,

    /// An attempt was made to disconnect an IPC communication channel that was already disconnected. See the documentation for the child_process module for more information.
    ERR_IPC_DISCONNECTED,

    /// An attempt was made to create a child Node.js process using more than one IPC communication channel. See the documentation for the child_process module for more information.
    ERR_IPC_ONE_PIPE,

    /// An attempt was made to open an IPC communication channel with a synchronously forked Node.js process. See the documentation for the child_process module for more information.
    ERR_IPC_SYNC_FORK,

    /// An attempt was made to load a resource, but the resource did not match the integrity defined by the policy manifest. See the documentation for policy manifests for more information.
    ERR_MANIFEST_ASSERT_INTEGRITY,

    /// An attempt was made to load a resource, but the resource was not listed as a dependency from the location that attempted to load it. See the documentation for policy manifests for more information.
    ERR_MANIFEST_DEPENDENCY_MISSING,

    /// An attempt was made to load a policy manifest, but the manifest had multiple entries for a resource which did not match each other. Update the manifest entries to match in order to resolve this error. See the documentation for policy manifests for more information.
    ERR_MANIFEST_INTEGRITY_MISMATCH,

    /// A policy manifest resource had an invalid value for one of its fields. Update the manifest entry to match in order to resolve this error. See the documentation for policy manifests for more information.
    ERR_MANIFEST_INVALID_RESOURCE_FIELD,

    /// A policy manifest resource had an invalid value for one of its dependency mappings. Update the manifest entry to match to resolve this error. See the documentation for policy manifests for more information.
    ERR_MANIFEST_INVALID_SPECIFIER,

    /// An attempt was made to load a policy manifest, but the manifest was unable to be parsed. See the documentation for policy manifests for more information.
    ERR_MANIFEST_PARSE_POLICY,

    /// An attempt was made to read from a policy manifest, but the manifest initialization has not yet taken place. This is likely a bug in Node.js.
    ERR_MANIFEST_TDZ,

    /// A policy manifest was loaded, but had an unknown value for its "onerror" behavior. See the documentation for policy manifests for more information.
    ERR_MANIFEST_UNKNOWN_ONERROR,

    /// An attempt was made to allocate memory (usually in the C++ layer) but it failed.
    ERR_MEMORY_ALLOCATION_FAILED,

    /// Added in: v14.5.0, v12.19.0
    /// A message posted to a MessagePort could not be deserialized in the target vm Context. Not all Node.js objects can be successfully instantiated in any context at this time, and attempting to transfer them using postMessage() can fail on the receiving side in that case.
    ERR_MESSAGE_TARGET_CONTEXT_UNAVAILABLE,

    /// A method is required but not implemented.
    ERR_METHOD_NOT_IMPLEMENTED,

    /// A required argument of a Node.js API was not passed. This is only used for strict compliance with the API specification (which in some cases may accept func(undefined) but not func()). In most native Node.js APIs, func(undefined) and func() are treated identically, and the ERR_INVALID_ARG_TYPE error code may be used instead.
    ERR_MISSING_ARGS,

    /// For APIs that accept options objects, some options might be mandatory. This code is thrown if a required option is missing.
    ERR_MISSING_OPTION,

    /// An attempt was made to read an encrypted key without specifying a passphrase.
    ERR_MISSING_PASSPHRASE,

    /// The V8 platform used by this instance of Node.js does not support creating Workers. This is caused by lack of embedder support for Workers. In particular, this error will not occur with standard builds of Node.js.
    ERR_MISSING_PLATFORM_FOR_WORKER,

    /// Added in: v15.0.0
    /// An object that needs to be explicitly listed in the transferList argument is in the object passed to a postMessage() call, but is not provided in the transferList for that call. Usually, this is a MessagePort.
    /// In Node.js versions prior to v15.0.0, the error code being used here was ERR_MISSING_MESSAGE_PORT_IN_TRANSFER_LIST. However, the set of transferable object types has been expanded to cover more types than MessagePort.
    ERR_MISSING_TRANSFERABLE_IN_TRANSFER_LIST,

    /// Stability: 1 - Experimental
    /// An ES Module could not be resolved.
    ERR_MODULE_NOT_FOUND,

    /// A callback was called more than once.
    /// A callback is almost always meant to only be called once as the query can either be fulfilled or rejected but not both at the same time. The latter would be possible by calling a callback more than once.
    ERR_MULTIPLE_CALLBACK,

    /// While using Node-API, a constructor passed was not a function.
    ERR_NAPI_CONS_FUNCTION,

    /// While calling napi_create_dataview(), a given offset was outside the bounds of the dataview or offset + length was larger than a length of given buffer.
    ERR_NAPI_INVALID_DATAVIEW_ARGS,

    /// While calling napi_create_typedarray(), the provided offset was not a multiple of the element size.
    ERR_NAPI_INVALID_TYPEDARRAY_ALIGNMENT,

    /// While calling napi_create_typedarray(), (length * size_of_element) + byte_offset was larger than the length of given buffer.
    ERR_NAPI_INVALID_TYPEDARRAY_LENGTH,

    /// An error occurred while invoking the JavaScript portion of the thread-safe function.
    ERR_NAPI_TSFN_CALL_JS,

    /// An error occurred while attempting to retrieve the JavaScript undefined value.
    ERR_NAPI_TSFN_GET_UNDEFINED,

    /// On the main thread, values are removed from the queue associated with the thread-safe function in an idle loop. This error indicates that an error has occurred when attempting to start the loop.
    ERR_NAPI_TSFN_START_IDLE_LOOP,

    /// Once no more items are left in the queue, the idle loop must be suspended. This error indicates that the idle loop has failed to stop.
    ERR_NAPI_TSFN_STOP_IDLE_LOOP,

    /// An attempt was made to use crypto features while Node.js was not compiled with OpenSSL crypto support.
    ERR_NO_CRYPTO,

    /// An attempt was made to use features that require ICU, but Node.js was not compiled with ICU support.
    ERR_NO_ICU,

    /// A non-context-aware native addon was loaded in a process that disallows them.
    ERR_NON_CONTEXT_AWARE_DISABLED,

    /// A given value is out of the accepted range.
    ERR_OUT_OF_RANGE,

    /// The package.json "imports" field does not define the given internal package specifier mapping.
    ERR_PACKAGE_IMPORT_NOT_DEFINED,

    /// The package.json "exports" field does not export the requested subpath. Because exports are encapsulated, private internal modules that are not exported cannot be imported through the package resolution, unless using an absolute URL.
    ERR_PACKAGE_PATH_NOT_EXPORTED,

    /// An invalid timestamp value was provided for a performance mark or measure.
    ERR_PERFORMANCE_INVALID_TIMESTAMP,

    /// Invalid options were provided for a performance measure.
    ERR_PERFORMANCE_MEASURE_INVALID_OPTIONS,

    /// Accessing Object.prototype.__proto__ has been forbidden using --disable-proto=throw. Object.getPrototypeOf and Object.setPrototypeOf should be used to get and set the prototype of an object.
    ERR_PROTO_ACCESS,

    /// Stability: 1 - Experimental
    /// An attempt was made to require() an ES Module.
    ERR_REQUIRE_ESM,

    /// Script execution was interrupted by SIGINT (For example, Ctrl+C was pressed.)
    ERR_SCRIPT_EXECUTION_INTERRUPTED,

    /// Script execution timed out, possibly due to bugs in the script being executed.
    ERR_SCRIPT_EXECUTION_TIMEOUT,

    /// The server.listen() method was called while a net.Server was already listening. This applies to all instances of net.Server, including HTTP, HTTPS, and HTTP/2 Server instances.
    ERR_SERVER_ALREADY_LISTEN,

    /// The server.close() method was called when a net.Server was not running. This applies to all instances of net.Server, including HTTP, HTTPS, and HTTP/2 Server instances.
    ERR_SERVER_NOT_RUNNING,

    /// An attempt was made to bind a socket that has already been bound.
    ERR_SOCKET_ALREADY_BOUND,

    /// An invalid (negative) size was passed for either the recvBufferSize or sendBufferSize options in dgram.createSocket().
    ERR_SOCKET_BAD_BUFFER_SIZE,

    /// An API function expecting a port >= 0 and < 65536 received an invalid value.
    ERR_SOCKET_BAD_PORT,

    /// An API function expecting a socket type (udp4 or udp6) received an invalid value.
    ERR_SOCKET_BAD_TYPE,

    /// While using dgram.createSocket(), the size of the receive or send Buffer could not be determined.
    ERR_SOCKET_BUFFER_SIZE,

    /// An attempt was made to operate on an already closed socket.
    ERR_SOCKET_CLOSED,

    /// A dgram.connect() call was made on an already connected socket.
    ERR_SOCKET_DGRAM_IS_CONNECTED,

    /// A dgram.disconnect() or dgram.remoteAddress() call was made on a disconnected socket.
    ERR_SOCKET_DGRAM_NOT_CONNECTED,

    /// A call was made and the UDP subsystem was not running.
    ERR_SOCKET_DGRAM_NOT_RUNNING,

    /// A string was provided for a Subresource Integrity check, but was unable to be parsed. Check the format of integrity attributes by looking at the Subresource Integrity specification.
    ERR_SRI_PARSE,

    /// A stream method was called that cannot complete because the stream was finished.
    ERR_STREAM_ALREADY_FINISHED,

    /// An attempt was made to call stream.pipe() on a Writable stream.
    ERR_STREAM_CANNOT_PIPE,

    /// A stream method was called that cannot complete because the stream was destroyed using stream.destroy().
    ERR_STREAM_DESTROYED,

    /// An attempt was made to call stream.write() with a null chunk.
    ERR_STREAM_NULL_VALUES,

    /// An error returned by stream.finished() and stream.pipeline(), when a stream or a pipeline ends non gracefully with no explicit error.
    ERR_STREAM_PREMATURE_CLOSE,

    /// An attempt was made to call stream.push() after a null(EOF) had been pushed to the stream.
    ERR_STREAM_PUSH_AFTER_EOF,

    /// An attempt was made to call stream.unshift() after the 'end' event was emitted.
    ERR_STREAM_UNSHIFT_AFTER_END_EVENT,

    /// Prevents an abort if a string decoder was set on the Socket or if the decoder is in objectMode.
    /// const Socket = require('net').Socket;
    /// const instance = new Socket();
    /// instance.setEncoding('utf8');
    ERR_STREAM_WRAP,

    /// An attempt was made to call stream.write() after stream.end() has been called.
    ERR_STREAM_WRITE_AFTER_END,

    /// An attempt has been made to create a string longer than the maximum allowed length.
    ERR_STRING_TOO_LONG,

    /// An artificial error object used to capture the call stack for diagnostic reports.
    ERR_SYNTHETIC,

    /// An unspecified or non-specific system error has occurred within the Node.js process. The error object will have an err.info object property with additional details.
    ERR_SYSTEM_ERROR,

    /// This error is thrown by checkServerIdentity if a user-supplied subjectaltname property violates encoding rules. Certificate objects produced by Node.js itself always comply with encoding rules and will never cause this error.
    ERR_TLS_CERT_ALTNAME_FORMAT,

    /// While using TLS, the host name/IP of the peer did not match any of the subjectAltNames in its certificate.
    ERR_TLS_CERT_ALTNAME_INVALID,

    /// While using TLS, the parameter offered for the Diffie-Hellman (DH) key-agreement protocol is too small. By default, the key length must be greater than or equal to 1024 bits to avoid vulnerabilities, even though it is strongly recommended to use 2048 bits or larger for stronger security.
    ERR_TLS_DH_PARAM_SIZE,

    /// A TLS/SSL handshake timed out. In this case, the server must also abort the connection.
    ERR_TLS_HANDSHAKE_TIMEOUT,

    /// The context must be a SecureContext.
    /// Added in: v13.3.0
    ERR_TLS_INVALID_CONTEXT,

    /// The specified secureProtocol method is invalid. It is either unknown, or disabled because it is insecure.
    ERR_TLS_INVALID_PROTOCOL_METHOD,

    /// Valid TLS protocol versions are 'TLSv1', 'TLSv1.1', or 'TLSv1.2'.
    ERR_TLS_INVALID_PROTOCOL_VERSION,

    /// The TLS socket must be connected and securily established. Ensure the 'secure' event is emitted before continuing.
    /// Added in: v13.10.0, v12.17.0
    ERR_TLS_INVALID_STATE,

    /// Attempting to set a TLS protocol minVersion or maxVersion conflicts with an attempt to set the secureProtocol explicitly. Use one mechanism or the other.
    ERR_TLS_PROTOCOL_VERSION_CONFLICT,

    /// Failed to set PSK identity hint. Hint may be too long.
    ERR_TLS_PSK_SET_IDENTIY_HINT_FAILED,

    /// An attempt was made to renegotiate TLS on a socket instance with TLS disabled.
    ERR_TLS_RENEGOTIATION_DISABLED,

    /// While using TLS, the server.addContext() method was called without providing a host name in the first parameter.
    ERR_TLS_REQUIRED_SERVER_NAME,

    /// An excessive amount of TLS renegotiations is detected, which is a potential vector for denial-of-service attacks.
    ERR_TLS_SESSION_ATTACK,

    /// An attempt was made to issue Server Name Indication from a TLS server-side socket, which is only valid from a client.
    ERR_TLS_SNI_FROM_SERVER,

    /// The trace_events.createTracing() method requires at least one trace event category.
    ERR_TRACE_EVENTS_CATEGORY_REQUIRED,

    /// The trace_events module could not be loaded because Node.js was compiled with the --without-v8-platform flag.
    ERR_TRACE_EVENTS_UNAVAILABLE,

    /// A Transform stream finished while it was still transforming.
    ERR_TRANSFORM_ALREADY_TRANSFORMING,

    /// A Transform stream finished with data still in the write buffer.
    ERR_TRANSFORM_WITH_LENGTH_0,

    /// The initialization of a TTY failed due to a system error.
    ERR_TTY_INIT_FAILED,

    /// Function was called within a process.on('exit') handler that shouldn't be called within process.on('exit') handler.
    ERR_UNAVAILABLE_DURING_EXIT,

    /// process.setUncaughtExceptionCaptureCallback() was called twice, without first resetting the callback to null.
    /// This error is designed to prevent accidentally overwriting a callback registered from another module.
    ERR_UNCAUGHT_EXCEPTION_CAPTURE_ALREADY_SET,

    /// A string that contained unescaped characters was received.
    ERR_UNESCAPED_CHARACTERS,

    /// An unhandled error occurred (for instance, when an 'error' event is emitted by an EventEmitter but an 'error' handler is not registered).
    ERR_UNHANDLED_ERROR,

    /// Used to identify a specific kind of internal Node.js error that should not typically be triggered by user code. Instances of this error point to an internal bug within the Node.js binary itself.
    ERR_UNKNOWN_BUILTIN_MODULE,

    /// A Unix group or user identifier that does not exist was passed.
    ERR_UNKNOWN_CREDENTIAL,

    /// An invalid or unknown encoding option was passed to an API.
    ERR_UNKNOWN_ENCODING,

    /// Stability: 1 - Experimental
    /// An attempt was made to load a module with an unknown or unsupported file extension.
    ERR_UNKNOWN_FILE_EXTENSION,

    /// An attempt was made to load a module with an unknown or unsupported format.
    ERR_UNKNOWN_MODULE_FORMAT,

    /// An invalid or unknown process signal was passed to an API expecting a valid signal (such as subprocess.kill()).
    ERR_UNKNOWN_SIGNAL,

    /// import a directory URL is unsupported. Instead, self-reference a package using its name and define a custom subpath in the "exports" field of the package.json file.
    /// ```js
    /// import './'; // unsupported
    /// import './index.js'; // supported
    /// import 'package-name'; // supported
    /// ```
    ERR_UNSUPPORTED_DIR_IMPORT,

    /// import with URL schemes other than file and data is unsupported.
    ERR_UNSUPPORTED_ESM_URL_SCHEME,

    /// While using the Performance Timing API (perf_hooks), no valid performance entry types are found.
    ERR_VALID_PERFORMANCE_ENTRY_TYPE,

    /// A dynamic import callback was not specified.
    ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING,

    /// The module attempted to be linked is not eligible for linking, because of one of the following reasons:
    /// - It has already been linked (linkingStatus is 'linked')
    /// - It is being linked (linkingStatus is 'linking')
    /// - Linking has failed for this module (linkingStatus is 'errored')
    ERR_VM_MODULE_ALREADY_LINKED,

    /// The cachedData option passed to a module constructor is invalid.
    ERR_VM_MODULE_CACHED_DATA_REJECTED,

    /// Cached data cannot be created for modules which have already been evaluated.
    ERR_VM_MODULE_CANNOT_CREATE_CACHED_DATA,

    /// The module being returned from the linker function is from a different context than the parent module. Linked modules must share the same context.
    ERR_VM_MODULE_DIFFERENT_CONTEXT,

    /// The linker function returned a module for which linking has failed.
    ERR_VM_MODULE_LINKING_ERRORED,

    /// The module was unable to be linked due to a failure.
    ERR_VM_MODULE_LINK_FAILURE,

    /// The fulfilled value of a linking promise is not a vm.Module object.
    ERR_VM_MODULE_NOT_MODULE,

    /// The current module's status does not allow for this operation. The specific meaning of the error depends on the specific function.
    ERR_VM_MODULE_STATUS,

    /// The WASI instance has already started.
    ERR_WASI_ALREADY_STARTED,

    /// The WASI instance has not been started.
    ERR_WASI_NOT_STARTED,

    /// The Worker initialization failed.
    ERR_WORKER_INIT_FAILED,

    /// The execArgv option passed to the Worker constructor contains invalid flags.
    ERR_WORKER_INVALID_EXEC_ARGV,

    /// An operation failed because the Worker instance is not currently running.
    ERR_WORKER_NOT_RUNNING,

    /// The Worker instance terminated because it reached its memory limit.
    ERR_WORKER_OUT_OF_MEMORY,

    /// The path for the main script of a worker is neither an absolute path nor a relative path starting with ./ or ../.
    ERR_WORKER_PATH,

    /// All attempts at serializing an uncaught exception from a worker thread failed.
    ERR_WORKER_UNSERIALIZABLE_ERROR,

    /// The requested functionality is not supported in worker threads.
    ERR_WORKER_UNSUPPORTED_OPERATION,

    /// Creation of a zlib object failed due to incorrect configuration.
    ERR_ZLIB_INITIALIZATION_FAILED,

    /// Too much HTTP header data was received. In order to protect against malicious or malconfigured clients, if more than 8 KB of HTTP header data is received then HTTP parsing will abort without a request or response object being created, and an Error with this code will be emitted.
    HPE_HEADER_OVERFLOW,

    /// Server is sending both a Content-Length header and Transfer-Encoding: chunked.
    /// Transfer-Encoding: chunked allows the server to maintain an HTTP persistent connection for dynamically generated content. In this case, the Content-Length HTTP header cannot be used.
    /// Use Content-Length or Transfer-Encoding: chunked.
    HPE_UNEXPECTED_CONTENT_LENGTH,

    /// History
    /// A module file could not be resolved while attempting a require() or import operation.
    MODULE_NOT_FOUND,

    // -- Deprecated ---

    /// The value passed to postMessage() contained an object that is not supported for transferring.
    ERR_CANNOT_TRANSFER_OBJECT,

    /// The UTF-16 encoding was used with hash.digest(). While the hash.digest() method does allow an encoding argument to be passed in, causing the method to return a string rather than a Buffer, the UTF-16 encoding (e.g. ucs or utf16le) is not supported.
    /// Added in: v9.0.0Removed in: v12.12.0
    ERR_CRYPTO_HASH_DIGEST_NO_UTF16,

    /// Added in: v9.0.0Removed in: v10.0.0
    ERR_HTTP2_FRAME_ERROR,

    /// Used when a failure occurs sending an individual frame on the HTTP/2 session.
    /// Added in: v9.0.0Removed in: v10.0.0
    ERR_HTTP2_HEADERS_OBJECT,

    /// Used when an HTTP/2 Headers Object is expected.
    /// Added in: v9.0.0Removed in: v10.0.0
    /// Used when a required header is missing in an HTTP/2 message.
    ERR_HTTP2_HEADER_REQUIRED,

    /// HTTP/2 informational headers must only be sent prior to calling the Http2Stream.prototype.respond() method.
    /// Added in: v9.0.0Removed in: v10.0.0
    ERR_HTTP2_INFO_HEADERS_AFTER_RESPOND,

    /// Used when an action has been performed on an HTTP/2 Stream that has already been closed.
    /// Added in: v9.0.0Removed in: v10.0.0
    ERR_HTTP2_STREAM_CLOSED,

    /// Used when an invalid character is found in an HTTP response status message (reason phrase).
    /// Added in: v10.0.0Removed in: v11.0.0
    ERR_HTTP_INVALID_CHAR,

    /// A given index was out of the accepted range (e.g. negative offsets).
    /// Added in: v8.0.0Removed in: v15.0.0
    ERR_INDEX_OUT_OF_RANGE,

    /// An invalid or unexpected value was passed in an options object.
    ERR_INVALID_OPT_VALUE,

    /// Added in: v9.0.0Removed in: v15.0.0
    /// An invalid or unknown file encoding was passed.
    ERR_INVALID_OPT_VALUE_ENCODING,

    /// Removed in: v15.0.0
    /// This error code was replaced by ERR_MISSING_TRANSFERABLE_IN_TRANSFER_LIST in Node.js v15.0.0, because it is no longer accurate as other types of transferable objects also exist now.
    ERR_MISSING_MESSAGE_PORT_IN_TRANSFER_LIST,

    /// Added in: v9.0.0Removed in: v10.0.0
    /// Used by the Node-API when Constructor.prototype is not an object.
    ERR_NAPI_CONS_PROTOTYPE_OBJECT,

    /// A Node.js API was called in an unsupported manner, such as Buffer.write(string, encoding, offset[, length]).
    ERR_NO_LONGER_SUPPORTED,

    /// An operation failed. This is typically used to signal the general failure of an asynchronous operation.
    /// Added in: v15.0.0
    ERR_OPERATION_FAILED,

    /// Added in: v9.0.0Removed in: v10.0.0
    /// Used generically to identify that an operation caused an out of memory condition.
    ERR_OUTOFMEMORY,

    /// Added in: v9.0.0Removed in: v10.0.0
    /// The repl module was unable to parse data from the REPL history file.
    ERR_PARSE_HISTORY_DATA,

    /// Data could not be sent on a socket.
    ERR_SOCKET_CANNOT_SEND,

    /// An attempt was made to close the process.stderr stream. By design, Node.js does not allow stdout or stderr streams to be closed by user code.
    ERR_STDERR_CLOSE,

    /// An attempt was made to close the process.stdout stream. By design, Node.js does not allow stdout or stderr streams to be closed by user code.
    ERR_STDOUT_CLOSE,

    /// Added in: v9.0.0Removed in: v10.0.0
    /// Used when an attempt is made to use a readable stream that has not implemented readable._read().
    ERR_STREAM_READ_NOT_IMPLEMENTED,

    /// Added in: v9.0.0Removed in: v10.0.0
    /// Used when a TLS renegotiation request has failed in a non-specific way.
    /// Added in: v10.5.0Removed in: v14.0.0
    ERR_TLS_RENEGOTIATION_FAILED,

    /// A SharedArrayBuffer whose memory is not managed by the JavaScript engine or by Node.js was encountered during serialization. Such a SharedArrayBuffer cannot be serialized.
    /// This can only happen when native addons create SharedArrayBuffers in "externalized" mode, or put existing SharedArrayBuffer into externalized mode.
    ERR_TRANSFERRING_EXTERNALIZED_SHAREDARRAYBUFFER,

    /// Added in: v8.0.0Removed in: v11.7.0
    /// An attempt was made to launch a Node.js process with an unknown stdin file type. This error is usually an indication of a bug within Node.js itself, although it is possible for user code to trigger it.
    ERR_UNKNOWN_STDIN_TYPE,

    /// Added in: v8.0.0Removed in: v11.7.0
    /// An attempt was made to launch a Node.js process with an unknown stdout or stderr file type. This error is usually an indication of a bug within Node.js itself, although it is possible for user code to trigger it.
    ERR_UNKNOWN_STREAM_TYPE,

    /// The V8 BreakIterator API was used but the full ICU data set is not installed.
    ERR_V8BREAKITERATOR,

    /// Added in: v9.0.0Removed in: v10.0.0
    /// Used when a given value is out of the accepted range.
    ERR_VALUE_OUT_OF_RANGE,

    /// The module must be successfully linked before instantiation.
    ERR_VM_MODULE_NOT_LINKED,

    /// Added in: v11.0.0Removed in: v16.9.0
    /// The pathname used for the main script of a worker has an unknown file extension.
    ERR_WORKER_UNSUPPORTED_EXTENSION,

    /// Added in: v9.0.0Removed in: v10.0.0
    ERR_ZLIB_BINDING_CLOSED,

    /// Used when an attempt is made to use a zlib object after it has already been closed.
    /// CPU USAGE
    ERR_CPU_USAGE,

    /// Used by node:util parseArgs
    ERR_PARSE_ARGS_INVALID_OPTION_VALUE,

    /// Used by node:util parseArgs
    ERR_PARSE_ARGS_UNKNOWN_OPTION,

    /// Used by node:util parseArgs
    ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL,
};
