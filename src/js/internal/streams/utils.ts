"use strict";

const streamState = require("internal/streams/state");
const { isReadableState, isWritableState } = streamState;
const kState: typeof streamState.kState = streamState.kState;
const kErroredValue: typeof streamState.kErroredValue = streamState.kErroredValue;

const enum Flag {
  AutoDestroy = 1 << 2,
  EmitClose = 1 << 3,
  Destroyed = 1 << 4,
  Closed = 1 << 5,
  Errored = 1 << 7,
  ReadableEnded = 1 << 9,
  ReadableEndEmitted = 1 << 10,
  WritableFinished = 1 << 13,
  HasWritable = 1 << 21,
  Writable = 1 << 22,
  WritableEnded = 1 << 30,
}

const SymbolIterator = Symbol.iterator;
const SymbolAsyncIterator = Symbol.asyncIterator;

// We need to use Symbol.for to make these globally available
// for interoperability with readable-stream, i.e. readable-stream
// and node core needs to be able to read/write private state
// from each other for proper interoperability.
const kIsDestroyed = Symbol.for("nodejs.stream.destroyed");
const kIsErrored = Symbol.for("nodejs.stream.errored");
const kIsReadable = Symbol.for("nodejs.stream.readable");
const kIsWritable = Symbol.for("nodejs.stream.writable");
const kIsDisturbed = Symbol.for("nodejs.stream.disturbed");

const kIsClosedPromise = Symbol.for("nodejs.webstream.isClosedPromise");
const kControllerErrorFunction = Symbol.for("nodejs.webstream.controllerErrorFunction");

declare global {
  namespace $Node {
    /** Whatever passes for a stream of node: one of ours, one of another implementation (the `readable-stream` package), a request or a response of node:http, an old-style stream. */
    interface AnyStream extends EventEmitter {
      _readableState?: ReadableState | ForeignState;
      _writableState?: WritableState | ForeignState;
      pipe?(destination: AnyStream, options?: PipeOptions): unknown;
      read?(size?: number): unknown;
      pause?(): unknown;
      resume?(): unknown;
      write?(chunk: unknown, encoding?: string | null | ErrorCallback, callback?: ErrorCallback): boolean | undefined;
      end?(chunk?: unknown, encoding?: string | null | ErrorCallback, callback?: ErrorCallback): unknown;
      readable?: boolean;
      readableObjectMode?: boolean;
      readableDidRead?: boolean;
      readableAborted?: boolean;
      readableErrored?: Error | null;
      writable?: boolean;
      writableObjectMode?: boolean;
      writableEnded?: boolean;
      writableFinished?: boolean;
      writableNeedDrain?: boolean;
      _isStdio?: boolean;
      writableErrored?: Error | null;
      destroyed?: boolean;
      closed?: boolean;
      errored?: Error | null;
      destroy?(error?: Error | null): unknown;
      close?(): unknown;
      // node:http
      aborted?: boolean;
      req?: AnyStream | null;
      socket?: unknown;
      setHeader?: unknown;
      abort?(): unknown;
      upgradeOrConnect?: boolean;
      _closed?: boolean;
      _defaultKeepAlive?: boolean;
      _removedConnection?: boolean;
      _removedContLen?: boolean;
      _sent100?: boolean;
      _consuming?: boolean;
      _dumped?: boolean;
      [kIsDestroyed]?: boolean;
      [kIsErrored]?: boolean;
      [kIsReadable]?: boolean;
      [kIsWritable]?: boolean;
      [kIsDisturbed]?: boolean;
    }

    type MaybeStream = AnyStream | null | undefined;

    /** A web stream of a polyfill, which is errored through node's symbol. */
    interface PolyfilledWebStream {
      [kControllerErrorFunction]?(error: unknown): void;
    }
  }
}

function isReadableNodeStream(obj: any, strict?: boolean): obj is $Node.Readable;
function isReadableNodeStream(obj: $Node.MaybeStream, strict = false): obj is $Node.Readable {
  return !!(
    obj &&
    typeof obj.pipe === "function" &&
    typeof obj.on === "function" &&
    (!strict || (typeof obj.pause === "function" && typeof obj.resume === "function")) &&
    (!obj._writableState || readableSideOf(obj._readableState) !== false) && // Duplex
    (!obj._writableState || obj._readableState) // Writable has .pipe.
  );
}

function readableSideOf(state) {
  return isReadableState(state) ? state.readable : state?.readable;
}

function writableSideOf(state) {
  if (!isWritableState(state)) return state?.writable;
  return (state[kState] & Flag.HasWritable) !== 0 ? (state[kState] & Flag.Writable) !== 0 : undefined;
}

function isWritableNodeStream(obj: any): obj is $Node.Writable;
function isWritableNodeStream(obj: $Node.MaybeStream): obj is $Node.Writable {
  return !!(
    obj &&
    typeof obj.write === "function" &&
    typeof obj.on === "function" &&
    (!obj._readableState || writableSideOf(obj._writableState) !== false) // Duplex
  );
}

function isDuplexNodeStream(obj: any): obj is $Node.Duplex;
function isDuplexNodeStream(obj: $Node.MaybeStream): obj is $Node.Duplex {
  return !!(
    obj &&
    typeof obj.pipe === "function" &&
    obj._readableState &&
    typeof obj.on === "function" &&
    typeof obj.write === "function"
  );
}

function isNodeStream(obj: any): obj is $Node.AnyStream;
function isNodeStream(obj: $Node.MaybeStream): obj is $Node.AnyStream {
  return !!(
    obj &&
    (obj._readableState ||
      obj._writableState ||
      (typeof obj.write === "function" && typeof obj.on === "function") ||
      (typeof obj.pipe === "function" && typeof obj.on === "function"))
  );
}

function isReadableStream(obj): obj is ReadableStream {
  return $inheritsReadableStream(obj);
}

function isWritableStream(obj): obj is WritableStream {
  return $inheritsWritableStream(obj);
}

function isTransformStream(obj): obj is TransformStream {
  return $inheritsTransformStream(obj);
}

function isWebStream(obj): obj is ReadableStream | WritableStream | TransformStream {
  return isReadableStream(obj) || isWritableStream(obj) || isTransformStream(obj);
}

function isIterable(obj, isAsync: true): obj is AsyncIterable<unknown>;
function isIterable(obj, isAsync: false): obj is Iterable<unknown>;
function isIterable(obj, isAsync?: boolean): obj is Iterable<unknown> | AsyncIterable<unknown>;
function isIterable(obj, isAsync?: boolean) {
  if (obj == null) return false;
  if (isAsync === true) return typeof obj[SymbolAsyncIterator] === "function";
  if (isAsync === false) return typeof obj[SymbolIterator] === "function";
  return typeof obj[SymbolAsyncIterator] === "function" || typeof obj[SymbolIterator] === "function";
}

function isDestroyed(stream: $Node.MaybeStream) {
  if (!isNodeStream(stream)) return null;
  const wState = stream._writableState as $Node.WritableState | $Node.ForeignState | undefined;
  const rState = stream._readableState as $Node.ReadableState | $Node.ForeignState | undefined;
  const state = wState || rState;
  return !!(
    stream.destroyed ||
    stream[kIsDestroyed] ||
    (isWritableState(state) || isReadableState(state) ? (state[kState] & Flag.Destroyed) !== 0 : state?.destroyed)
  );
}

// Have been end():d.
function isWritableEnded(stream: $Node.MaybeStream) {
  if (!isWritableNodeStream(stream)) return null;
  return isWritableSideEnded(stream);
}

function isWritableSideEnded(stream: $Node.AnyStream) {
  if (stream.writableEnded === true) return true;
  const wState = stream._writableState as $Node.WritableState | $Node.ForeignState | undefined;
  if (isWritableState(wState)) return (wState[kState] & (Flag.Errored | Flag.WritableEnded)) === Flag.WritableEnded;
  if (wState?.errored) return false;
  if (typeof wState?.ended !== "boolean") return null;
  return wState.ended;
}

// Have emitted 'finish'.
function isWritableFinished(stream: $Node.MaybeStream, strict) {
  if (!isWritableNodeStream(stream)) return null;
  return isWritableSideFinished(stream, strict);
}

function isWritableSideFinished(stream: $Node.AnyStream, strict) {
  if (stream.writableFinished === true) return true;
  const wState = stream._writableState as $Node.WritableState | $Node.ForeignState | undefined;
  if (isWritableState(wState)) {
    const flags = wState[kState];
    if ((flags & Flag.Errored) !== 0) return false;
    return (
      (flags & Flag.WritableFinished) !== 0 ||
      (strict === false && (flags & Flag.WritableEnded) !== 0 && wState.length === 0)
    );
  }
  if (wState?.errored) return false;
  if (typeof wState?.finished !== "boolean") return null;
  return !!(wState.finished || (strict === false && wState.ended === true && wState.length === 0));
}

// Have emitted 'end'.
function isReadableFinished(stream: $Node.MaybeStream, strict?) {
  if (!isReadableNodeStream(stream)) return null;
  return isReadableSideFinished(stream, strict);
}

function isReadableSideFinished(stream: $Node.AnyStream, strict?) {
  const rState = stream._readableState as $Node.ReadableState | $Node.ForeignState | undefined;
  if (isReadableState(rState)) {
    const flags = rState[kState];
    if ((flags & Flag.Errored) !== 0) return false;
    return (
      (flags & Flag.ReadableEndEmitted) !== 0 ||
      (strict === false && (flags & Flag.ReadableEnded) !== 0 && rState.length === 0)
    );
  }
  if (rState?.errored) return false;
  if (typeof rState?.endEmitted !== "boolean") return null;
  return !!(rState.endEmitted || (strict === false && rState.ended === true && rState.length === 0));
}

function isReadable(stream: $Node.MaybeStream) {
  if (stream && stream[kIsReadable] != null) return stream[kIsReadable];
  if (typeof stream?.readable !== "boolean") return null;
  if (isDestroyed(stream)) return false;
  return isReadableNodeStream(stream) && stream.readable && !isReadableSideFinished(stream);
}

function isWritable(stream: $Node.MaybeStream) {
  if (stream && stream[kIsWritable] != null) return stream[kIsWritable];
  if (typeof stream?.writable !== "boolean") return null;
  if (isDestroyed(stream)) return false;
  return isWritableNodeStream(stream) && stream.writable && !isWritableSideEnded(stream);
}

function isFinished(stream: $Node.MaybeStream, opts?) {
  if (!isNodeStream(stream)) {
    return null;
  }

  if (isDestroyed(stream)) {
    return true;
  }

  if (opts?.readable !== false && isReadable(stream)) {
    return false;
  }

  if (opts?.writable !== false && isWritable(stream)) {
    return false;
  }

  return true;
}

function isWritableErrored(stream: $Node.MaybeStream) {
  if (!isNodeStream(stream)) {
    return null;
  }

  return errorOfWritableSide(stream);
}

function errorOfWritableSide(stream: $Node.AnyStream) {
  const writableErrored = stream.writableErrored;
  if (writableErrored) {
    return writableErrored;
  }

  const state = stream._writableState;
  if (isWritableState(state)) return (state[kState] & Flag.Errored) !== 0 ? (state[kErroredValue] ?? null) : null;
  return state?.errored ?? null;
}

function isReadableErrored(stream: $Node.MaybeStream) {
  if (!isNodeStream(stream)) {
    return null;
  }

  return errorOfReadableSide(stream);
}

function errorOfReadableSide(stream: $Node.AnyStream) {
  const readableErrored = stream.readableErrored;
  if (readableErrored) {
    return readableErrored;
  }

  const state = stream._readableState;
  if (isReadableState(state)) return (state[kState] & Flag.Errored) !== 0 ? (state[kErroredValue] ?? null) : null;
  return state?.errored ?? null;
}

function isClosed(stream: $Node.MaybeStream) {
  if (!isNodeStream(stream)) {
    return null;
  }

  return isNodeStreamClosed(stream);
}

function isNodeStreamClosed(stream: $Node.AnyStream) {
  const closed = stream.closed;
  if (typeof closed === "boolean") {
    return closed;
  }

  const wState = stream._writableState as $Node.WritableState | $Node.ForeignState | undefined;
  const rState = stream._readableState as $Node.ReadableState | $Node.ForeignState | undefined;

  if (typeof wState?.closed === "boolean" || typeof rState?.closed === "boolean") {
    return wState?.closed || rState?.closed;
  }

  const _closed = stream._closed;
  if (typeof _closed === "boolean" && isOutgoingMessage(stream)) {
    return _closed;
  }

  return null;
}

function isOutgoingMessage(stream: $Node.AnyStream) {
  return (
    typeof stream._closed === "boolean" &&
    typeof stream._defaultKeepAlive === "boolean" &&
    typeof stream._removedConnection === "boolean" &&
    typeof stream._removedContLen === "boolean"
  );
}

function isServerResponse(stream: $Node.AnyStream) {
  return typeof stream._sent100 === "boolean" && isOutgoingMessage(stream);
}

function isServerRequest(stream: $Node.AnyStream) {
  return (
    typeof stream._consuming === "boolean" &&
    typeof stream._dumped === "boolean" &&
    stream.req?.upgradeOrConnect === undefined
  );
}

function willEmitClose(stream: $Node.MaybeStream) {
  if (!isNodeStream(stream)) return null;
  return willNodeStreamEmitClose(stream);
}

function willNodeStreamEmitClose(stream: $Node.AnyStream) {
  const wState = stream._writableState as $Node.WritableState | $Node.ForeignState | undefined;
  const rState = stream._readableState as $Node.ReadableState | $Node.ForeignState | undefined;
  const state = wState || rState;

  if (isWritableState(state) || isReadableState(state)) {
    return (state[kState] & (Flag.AutoDestroy | Flag.EmitClose | Flag.Closed)) === (Flag.AutoDestroy | Flag.EmitClose);
  }

  return (!state && isServerResponse(stream)) || !!(state?.autoDestroy && state.emitClose && state.closed === false);
}

function isDisturbed(stream) {
  return !!(stream && (stream[kIsDisturbed] ?? (stream.readableDidRead || stream.readableAborted)));
}

function isErrored(stream) {
  return !!(
    stream &&
    (stream[kIsErrored] ??
      stream.readableErrored ??
      stream.writableErrored ??
      stream._readableState?.errorEmitted ??
      stream._writableState?.errorEmitted ??
      stream._readableState?.errored ??
      stream._writableState?.errored)
  );
}

export default {
  isDestroyed,
  kIsDestroyed,
  isDisturbed,
  isErrored,
  isReadable,
  kIsClosedPromise,
  kControllerErrorFunction,
  isClosed,
  isDuplexNodeStream,
  isFinished,
  isIterable,
  isReadableNodeStream,
  isReadableStream,
  isReadableFinished,
  isReadableErrored,
  isNodeStream,
  isWebStream,
  isWritable,
  isWritableNodeStream,
  isWritableStream,
  isWritableEnded,
  isWritableFinished,
  isWritableErrored,
  isServerRequest,
  willEmitClose,
  isWritableSideFinished,
  isReadableSideFinished,
  errorOfWritableSide,
  errorOfReadableSide,
  isNodeStreamClosed,
  willNodeStreamEmitClose,
  isTransformStream,
  // bitfields
} as const;
