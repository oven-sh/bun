// Ported from Node.js lib/internal/quic/state.js (v26.3.0).
const { uncurryThis } = require("internal/primordials");
const { isArrayBuffer } = require("node:util/types");
const { inspect } = require("node:util");

const JSONStringify = JSON.stringify;
const DataViewPrototypeGetBigInt64 = uncurryThis(DataView.prototype.getBigInt64);
const DataViewPrototypeGetBigUint64 = uncurryThis(DataView.prototype.getBigUint64);
const DataViewPrototypeGetUint16 = uncurryThis(DataView.prototype.getUint16);
const DataViewPrototypeGetUint32 = uncurryThis(DataView.prototype.getUint32);
const DataViewPrototypeGetUint8 = uncurryThis(DataView.prototype.getUint8);
const DataViewPrototypeSetUint16 = uncurryThis(DataView.prototype.setUint16);
const DataViewPrototypeSetUint32 = uncurryThis(DataView.prototype.setUint32);
const DataViewPrototypeSetUint8 = uncurryThis(DataView.prototype.setUint8);

const kIsLittleEndian = require("node:os").endianness() === "LE";

const { kFinishClose, kInspect, kPrivateConstructor } = require("internal/quic/symbols");

function ERR_ILLEGAL_CONSTRUCTOR() {
  return $ERR_ILLEGAL_CONSTRUCTOR();
}
function ERR_INVALID_ARG_TYPE(name, expected, actual) {
  return $ERR_INVALID_ARG_TYPE(name, expected, actual);
}

const {
  IDX_STATE_SESSION_LISTENER_FLAGS,
  IDX_STATE_SESSION_CLOSING,
  IDX_STATE_SESSION_GRACEFUL_CLOSE,
  IDX_STATE_SESSION_SILENT_CLOSE,
  IDX_STATE_SESSION_STATELESS_RESET,
  IDX_STATE_SESSION_HANDSHAKE_COMPLETED,
  IDX_STATE_SESSION_HANDSHAKE_CONFIRMED,
  IDX_STATE_SESSION_STREAM_OPEN_ALLOWED,
  IDX_STATE_SESSION_PRIORITY_SUPPORTED,
  IDX_STATE_SESSION_HEADERS_SUPPORTED,
  IDX_STATE_SESSION_WRAPPED,
  IDX_STATE_SESSION_APPLICATION_TYPE,
  IDX_STATE_SESSION_NO_ERROR_CODE,
  IDX_STATE_SESSION_INTERNAL_ERROR_CODE,
  IDX_STATE_SESSION_MAX_DATAGRAM_SIZE,
  IDX_STATE_SESSION_LAST_DATAGRAM_ID,
  IDX_STATE_SESSION_MAX_PENDING_DATAGRAMS,

  IDX_STATE_ENDPOINT_BOUND,
  IDX_STATE_ENDPOINT_RECEIVING,
  IDX_STATE_ENDPOINT_LISTENING,
  IDX_STATE_ENDPOINT_CLOSING,
  IDX_STATE_ENDPOINT_BUSY,
  IDX_STATE_ENDPOINT_MAX_CONNECTIONS_PER_HOST,
  IDX_STATE_ENDPOINT_MAX_CONNECTIONS_TOTAL,
  IDX_STATE_ENDPOINT_PENDING_CALLBACKS,

  IDX_STATE_STREAM_ID,
  IDX_STATE_STREAM_PENDING,
  IDX_STATE_STREAM_FIN_SENT,
  IDX_STATE_STREAM_FIN_RECEIVED,
  IDX_STATE_STREAM_READ_ENDED,
  IDX_STATE_STREAM_WRITE_ENDED,
  IDX_STATE_STREAM_RESET,
  IDX_STATE_STREAM_HAS_OUTBOUND,
  IDX_STATE_STREAM_HAS_READER,
  IDX_STATE_STREAM_WANTS_BLOCK,
  IDX_STATE_STREAM_WANTS_HEADERS,
  IDX_STATE_STREAM_WANTS_RESET,
  IDX_STATE_STREAM_WANTS_TRAILERS,
  IDX_STATE_STREAM_RECEIVED_EARLY_DATA,
  IDX_STATE_STREAM_WRITE_DESIRED_SIZE,
  IDX_STATE_STREAM_HIGH_WATER_MARK,
  IDX_STATE_STREAM_RESET_CODE,
} = require("internal/quic/binding");

const kEmptyObject = { __proto__: null };

class QuicEndpointState {
  /** @type {DataView} */
  #handle;

  /**
   * @param {symbol} privateSymbol
   * @param {ArrayBuffer} buffer
   */
  constructor(privateSymbol, buffer) {
    if (privateSymbol !== kPrivateConstructor) {
      throw new ERR_ILLEGAL_CONSTRUCTOR();
    }
    if (!isArrayBuffer(buffer)) {
      throw new ERR_INVALID_ARG_TYPE("buffer", ["ArrayBuffer"], buffer);
    }
    this.#handle = new DataView(buffer);
  }

  /** @type {boolean} */
  get isBound() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, IDX_STATE_ENDPOINT_BOUND) !== 0;
  }

  /** @type {boolean} */
  get isReceiving() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, IDX_STATE_ENDPOINT_RECEIVING) !== 0;
  }

  /** @type {boolean} */
  get isListening() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, IDX_STATE_ENDPOINT_LISTENING) !== 0;
  }

  /** @type {boolean} */
  get isClosing() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, IDX_STATE_ENDPOINT_CLOSING) !== 0;
  }

  /** @type {boolean} */
  get isBusy() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, IDX_STATE_ENDPOINT_BUSY) !== 0;
  }

  /** @type {number} */
  get maxConnectionsPerHost() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint16(handle, IDX_STATE_ENDPOINT_MAX_CONNECTIONS_PER_HOST, kIsLittleEndian);
  }

  set maxConnectionsPerHost(val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    DataViewPrototypeSetUint16(handle, IDX_STATE_ENDPOINT_MAX_CONNECTIONS_PER_HOST, val, kIsLittleEndian);
  }

  /** @type {number} */
  get maxConnectionsTotal() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint16(handle, IDX_STATE_ENDPOINT_MAX_CONNECTIONS_TOTAL, kIsLittleEndian);
  }

  set maxConnectionsTotal(val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    DataViewPrototypeSetUint16(handle, IDX_STATE_ENDPOINT_MAX_CONNECTIONS_TOTAL, val, kIsLittleEndian);
  }

  /** @type {bigint} */
  get pendingCallbacks() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetBigUint64(handle, IDX_STATE_ENDPOINT_PENDING_CALLBACKS, kIsLittleEndian);
  }

  toString() {
    return JSONStringify(this.toJSON());
  }

  toJSON() {
    if (this.#handle === undefined) return kEmptyObject;
    const {
      isBound,
      isReceiving,
      isListening,
      isClosing,
      isBusy,
      maxConnectionsPerHost,
      maxConnectionsTotal,
      pendingCallbacks,
    } = this;
    return {
      __proto__: null,
      isBound,
      isReceiving,
      isListening,
      isClosing,
      isBusy,
      maxConnectionsPerHost,
      maxConnectionsTotal,
      pendingCallbacks: Number(pendingCallbacks),
    };
  }

  [kInspect](depth, options) {
    if (this.#handle === undefined) {
      return "QuicEndpointState { <Closed> }";
    }

    if (depth < 0) {
      return "QuicEndpointState { }";
    }

    const opts = {
      __proto__: null,
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };

    const {
      isBound,
      isReceiving,
      isListening,
      isClosing,
      isBusy,
      maxConnectionsPerHost,
      maxConnectionsTotal,
      pendingCallbacks,
    } = this;

    return `QuicEndpointState ${inspect(
      {
        isBound,
        isReceiving,
        isListening,
        isClosing,
        isBusy,
        maxConnectionsPerHost,
        maxConnectionsTotal,
        pendingCallbacks,
      },
      opts,
    )}`;
  }

  [kFinishClose]() {
    this.#handle = undefined;
  }
}

class QuicSessionState {
  /** @type {DataView} */
  #handle;
  /** @type {number} */
  #offset = 0;

  /**
   * @param {symbol} privateSymbol
   * @param {DataView|ArrayBuffer} view
   * @param {number} [byteOffset]
   */
  constructor(privateSymbol, view, byteOffset = 0) {
    if (privateSymbol !== kPrivateConstructor) {
      throw new ERR_ILLEGAL_CONSTRUCTOR();
    }
    if (isArrayBuffer(view)) {
      this.#handle = new DataView(view);
    } else {
      this.#handle = view;
    }
    this.#offset = byteOffset;
  }

  // Bit positions must match the SessionListenerFlags enum in session.cc.
  static #LISTENER_PATH_VALIDATION = 1 << 0;
  static #LISTENER_DATAGRAM = 1 << 1;
  static #LISTENER_DATAGRAM_STATUS = 1 << 2;
  static #LISTENER_SESSION_TICKET = 1 << 3;
  static #LISTENER_NEW_TOKEN = 1 << 4;
  static #LISTENER_ORIGIN = 1 << 5;

  #getListenerFlag(flag) {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return (
      (DataViewPrototypeGetUint32(handle, this.#offset + IDX_STATE_SESSION_LISTENER_FLAGS, kIsLittleEndian) & flag) !==
      0
    );
  }

  #setListenerFlag(flag, val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    const current = DataViewPrototypeGetUint32(
      handle,
      this.#offset + IDX_STATE_SESSION_LISTENER_FLAGS,
      kIsLittleEndian,
    );
    DataViewPrototypeSetUint32(
      handle,
      this.#offset + IDX_STATE_SESSION_LISTENER_FLAGS,
      val ? current | flag : current & ~flag,
      kIsLittleEndian,
    );
  }

  /** @type {boolean} */
  get hasPathValidationListener() {
    return this.#getListenerFlag(QuicSessionState.#LISTENER_PATH_VALIDATION);
  }
  set hasPathValidationListener(val) {
    this.#setListenerFlag(QuicSessionState.#LISTENER_PATH_VALIDATION, val);
  }

  /** @type {boolean} */
  get hasDatagramListener() {
    return this.#getListenerFlag(QuicSessionState.#LISTENER_DATAGRAM);
  }
  set hasDatagramListener(val) {
    this.#setListenerFlag(QuicSessionState.#LISTENER_DATAGRAM, val);
  }

  /** @type {boolean} */
  get hasDatagramStatusListener() {
    return this.#getListenerFlag(QuicSessionState.#LISTENER_DATAGRAM_STATUS);
  }
  set hasDatagramStatusListener(val) {
    this.#setListenerFlag(QuicSessionState.#LISTENER_DATAGRAM_STATUS, val);
  }

  /** @type {boolean} */
  get hasSessionTicketListener() {
    return this.#getListenerFlag(QuicSessionState.#LISTENER_SESSION_TICKET);
  }
  set hasSessionTicketListener(val) {
    this.#setListenerFlag(QuicSessionState.#LISTENER_SESSION_TICKET, val);
  }

  /** @type {boolean} */
  get hasNewTokenListener() {
    return this.#getListenerFlag(QuicSessionState.#LISTENER_NEW_TOKEN);
  }
  set hasNewTokenListener(val) {
    this.#setListenerFlag(QuicSessionState.#LISTENER_NEW_TOKEN, val);
  }

  /** @type {boolean} */
  get hasOriginListener() {
    return this.#getListenerFlag(QuicSessionState.#LISTENER_ORIGIN);
  }
  set hasOriginListener(val) {
    this.#setListenerFlag(QuicSessionState.#LISTENER_ORIGIN, val);
  }

  /** @type {boolean} */
  get isClosing() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_CLOSING) !== 0;
  }

  /** @type {boolean} */
  get isGracefulClose() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_GRACEFUL_CLOSE) !== 0;
  }

  /** @type {boolean} */
  get isSilentClose() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_SILENT_CLOSE) !== 0;
  }

  /** @type {boolean} */
  get isStatelessReset() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_STATELESS_RESET) !== 0;
  }

  /** @type {boolean} */
  get isHandshakeCompleted() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_HANDSHAKE_COMPLETED) !== 0;
  }

  /** @type {boolean} */
  get isHandshakeConfirmed() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_HANDSHAKE_CONFIRMED) !== 0;
  }

  /** @type {boolean} */
  get isStreamOpenAllowed() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_STREAM_OPEN_ALLOWED) !== 0;
  }

  /** @type {boolean} */
  get isPrioritySupported() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_PRIORITY_SUPPORTED) !== 0;
  }

  /** @type {number} */
  get headersSupported() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_HEADERS_SUPPORTED);
  }

  /** @type {boolean} */
  get isWrapped() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_WRAPPED) !== 0;
  }

  /** @type {number} */
  get applicationType() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_SESSION_APPLICATION_TYPE);
  }

  /** @type {bigint} */
  get noErrorCode() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetBigUint64(handle, this.#offset + IDX_STATE_SESSION_NO_ERROR_CODE, kIsLittleEndian);
  }

  /** @type {bigint} */
  get internalErrorCode() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetBigUint64(handle, this.#offset + IDX_STATE_SESSION_INTERNAL_ERROR_CODE, kIsLittleEndian);
  }

  /** @type {number} */
  get maxDatagramSize() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint16(handle, this.#offset + IDX_STATE_SESSION_MAX_DATAGRAM_SIZE, kIsLittleEndian);
  }

  /** @type {bigint} */
  get lastDatagramId() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetBigUint64(handle, this.#offset + IDX_STATE_SESSION_LAST_DATAGRAM_ID, kIsLittleEndian);
  }

  /** @type {number} */
  get maxPendingDatagrams() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint16(handle, this.#offset + IDX_STATE_SESSION_MAX_PENDING_DATAGRAMS, kIsLittleEndian);
  }

  set maxPendingDatagrams(val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    DataViewPrototypeSetUint16(handle, this.#offset + IDX_STATE_SESSION_MAX_PENDING_DATAGRAMS, val, kIsLittleEndian);
  }

  toString() {
    return JSONStringify(this.toJSON());
  }

  toJSON() {
    if (this.#handle === undefined) return kEmptyObject;
    const {
      hasPathValidationListener,
      hasDatagramListener,
      hasDatagramStatusListener,
      hasSessionTicketListener,
      hasNewTokenListener,
      hasOriginListener,
      isClosing,
      isGracefulClose,
      isSilentClose,
      isStatelessReset,
      isHandshakeCompleted,
      isHandshakeConfirmed,
      isStreamOpenAllowed,
      isPrioritySupported,
      headersSupported,
      isWrapped,
      applicationType,
      noErrorCode,
      internalErrorCode,
      maxDatagramSize,
      lastDatagramId,
      maxPendingDatagrams,
    } = this;
    return {
      __proto__: null,
      hasPathValidationListener,
      hasDatagramListener,
      hasDatagramStatusListener,
      hasSessionTicketListener,
      hasNewTokenListener,
      hasOriginListener,
      isClosing,
      isGracefulClose,
      isSilentClose,
      isStatelessReset,
      isHandshakeCompleted,
      isHandshakeConfirmed,
      isStreamOpenAllowed,
      isPrioritySupported,
      headersSupported,
      isWrapped,
      applicationType,
      noErrorCode: `${noErrorCode}`,
      internalErrorCode: `${internalErrorCode}`,
      maxDatagramSize: `${maxDatagramSize}`,
      lastDatagramId: `${lastDatagramId}`,
      maxPendingDatagrams,
    };
  }

  [kInspect](depth, options) {
    if (this.#handle === undefined) {
      return "QuicSessionState { <Closed> }";
    }

    if (depth < 0) {
      return "QuicSessionState { }";
    }

    const opts = {
      __proto__: null,
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };

    const {
      hasPathValidationListener,
      hasDatagramListener,
      hasDatagramStatusListener,
      hasSessionTicketListener,
      hasNewTokenListener,
      hasOriginListener,
      isClosing,
      isGracefulClose,
      isSilentClose,
      isStatelessReset,
      isHandshakeCompleted,
      isHandshakeConfirmed,
      isStreamOpenAllowed,
      isPrioritySupported,
      headersSupported,
      isWrapped,
      applicationType,
      noErrorCode,
      internalErrorCode,
      maxDatagramSize,
      lastDatagramId,
      maxPendingDatagrams,
    } = this;

    return `QuicSessionState ${inspect(
      {
        hasPathValidationListener,
        hasDatagramListener,
        hasDatagramStatusListener,
        hasSessionTicketListener,
        hasNewTokenListener,
        hasOriginListener,
        isClosing,
        isGracefulClose,
        isSilentClose,
        isStatelessReset,
        isHandshakeCompleted,
        isHandshakeConfirmed,
        isStreamOpenAllowed,
        isPrioritySupported,
        headersSupported,
        isWrapped,
        applicationType,
        noErrorCode,
        internalErrorCode,
        maxDatagramSize,
        lastDatagramId,
        maxPendingDatagrams,
      },
      opts,
    )}`;
  }

  [kFinishClose]() {
    this.#handle = undefined;
  }
}

class QuicStreamState {
  /** @type {DataView} */
  #handle;
  /** @type {number} */
  #offset = 0;
  /** @type {bigint|undefined} */
  #id = undefined;

  /**
   * @param {symbol} privateSymbol
   * @param {DataView|ArrayBuffer} view
   * @param {number} [byteOffset]
   */
  constructor(privateSymbol, view, byteOffset = 0) {
    if (privateSymbol !== kPrivateConstructor) {
      throw new ERR_ILLEGAL_CONSTRUCTOR();
    }
    if (isArrayBuffer(view)) {
      this.#handle = new DataView(view);
    } else {
      this.#handle = view;
    }
    this.#offset = byteOffset;
  }

  /** @type {bigint} */
  get id() {
    const handle = this.#handle;
    if (handle === undefined) return this.#id;
    return DataViewPrototypeGetBigInt64(handle, this.#offset + IDX_STATE_STREAM_ID, kIsLittleEndian);
  }

  /** @type {boolean} */
  get pending() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_PENDING) !== 0;
  }

  /** @type {boolean} */
  get finSent() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_FIN_SENT) !== 0;
  }

  /** @type {boolean} */
  get finReceived() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_FIN_RECEIVED) !== 0;
  }

  /** @type {boolean} */
  get readEnded() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_READ_ENDED) !== 0;
  }

  /** @type {boolean} */
  get writeEnded() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_WRITE_ENDED) !== 0;
  }

  /** @type {boolean} */
  get reset() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_RESET) !== 0;
  }

  /** @type {boolean} */
  get hasOutbound() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_HAS_OUTBOUND) !== 0;
  }

  /** @type {boolean} */
  get hasReader() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_HAS_READER) !== 0;
  }

  /** @type {boolean} */
  get wantsBlock() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_WANTS_BLOCK) !== 0;
  }

  /** @type {boolean} */
  set wantsBlock(val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    DataViewPrototypeSetUint8(handle, this.#offset + IDX_STATE_STREAM_WANTS_BLOCK, val ? 1 : 0);
  }

  /** @type {boolean} */
  get wantsHeaders() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_WANTS_HEADERS) !== 0;
  }

  /** @type {boolean} */
  set wantsHeaders(val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    DataViewPrototypeSetUint8(handle, this.#offset + IDX_STATE_STREAM_WANTS_HEADERS, val ? 1 : 0);
  }

  /** @type {boolean} */
  get wantsReset() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_WANTS_RESET) !== 0;
  }

  /** @type {boolean} */
  set wantsReset(val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    DataViewPrototypeSetUint8(handle, this.#offset + IDX_STATE_STREAM_WANTS_RESET, val ? 1 : 0);
  }

  /** @type {boolean} */
  get wantsTrailers() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_WANTS_TRAILERS) !== 0;
  }

  /** @type {boolean} */
  set wantsTrailers(val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    DataViewPrototypeSetUint8(handle, this.#offset + IDX_STATE_STREAM_WANTS_TRAILERS, val ? 1 : 0);
  }

  /** @type {boolean} */
  get early() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint8(handle, this.#offset + IDX_STATE_STREAM_RECEIVED_EARLY_DATA) !== 0;
  }

  /** @type {bigint} */
  get resetCode() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetBigUint64(handle, this.#offset + IDX_STATE_STREAM_RESET_CODE, kIsLittleEndian);
  }

  /** @type {bigint} */
  get writeDesiredSize() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint32(handle, this.#offset + IDX_STATE_STREAM_WRITE_DESIRED_SIZE, kIsLittleEndian);
  }

  set writeDesiredSize(val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    DataViewPrototypeSetUint32(handle, this.#offset + IDX_STATE_STREAM_WRITE_DESIRED_SIZE, val, kIsLittleEndian);
  }

  /** @type {number} */
  get highWaterMark() {
    const handle = this.#handle;
    if (handle === undefined) return undefined;
    return DataViewPrototypeGetUint32(handle, this.#offset + IDX_STATE_STREAM_HIGH_WATER_MARK, kIsLittleEndian);
  }

  set highWaterMark(val) {
    const handle = this.#handle;
    if (handle === undefined) return;
    DataViewPrototypeSetUint32(handle, this.#offset + IDX_STATE_STREAM_HIGH_WATER_MARK, val, kIsLittleEndian);
  }

  toString() {
    return JSONStringify(this.toJSON());
  }

  toJSON() {
    if (this.#handle === undefined) return kEmptyObject;
    const {
      id,
      pending,
      finSent,
      finReceived,
      readEnded,
      writeEnded,
      reset,
      hasOutbound,
      hasReader,
      wantsBlock,
      wantsReset,
      wantsHeaders,
      wantsTrailers,
      early,
      resetCode,
      writeDesiredSize,
      highWaterMark,
    } = this;
    return {
      __proto__: null,
      id: `${id}`,
      pending,
      finSent,
      finReceived,
      readEnded,
      writeEnded,
      reset,
      hasOutbound,
      hasReader,
      wantsBlock,
      wantsReset,
      wantsHeaders,
      wantsTrailers,
      early,
      resetCode: `${resetCode}`,
      writeDesiredSize,
      highWaterMark,
    };
  }

  [kInspect](depth, options) {
    if (this.#handle === undefined) {
      return "QuicStreamState { <Closed> }";
    }

    if (depth < 0) {
      return "QuicStreamState { }";
    }

    const opts = {
      __proto__: null,
      ...options,
      depth: options.depth == null ? null : options.depth - 1,
    };

    const {
      id,
      pending,
      finSent,
      finReceived,
      readEnded,
      writeEnded,
      reset,
      hasOutbound,
      hasReader,
      wantsBlock,
      wantsReset,
      wantsHeaders,
      wantsTrailers,
      early,
      resetCode,
      writeDesiredSize,
      highWaterMark,
    } = this;

    return `QuicStreamState ${inspect(
      {
        id,
        pending,
        finSent,
        finReceived,
        readEnded,
        writeEnded,
        reset,
        hasOutbound,
        hasReader,
        wantsBlock,
        wantsReset,
        wantsHeaders,
        wantsTrailers,
        early,
        resetCode,
        writeDesiredSize,
        highWaterMark,
      },
      opts,
    )}`;
  }

  [kFinishClose]() {
    this.#id = this.id;
    this.#handle = undefined;
  }
}

export default {
  QuicEndpointState,
  QuicSessionState,
  QuicStreamState,
};
