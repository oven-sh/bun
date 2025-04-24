// Import Timer type correctly
type Timer = NodeJS.Timeout;
import type FakeSocket from "internal/http/FakeSocket"; // Import type directly
import type { NodeHTTPHeaderState } from "internal/http"; // Import type directly
import type { Stream } from "node:stream"; // Use Node's Stream type
import type { Headers } from "internal/http"; // Import Headers type directly

// Use require for runtime dependencies
// @ts-ignore StreamImpl is used
const { Stream: StreamImpl } = require("node:stream"); // Runtime Stream class from node:stream
const { validateFunction } = require("internal/validators");
const {
  headerStateSymbol,
  NodeHTTPHeaderState: NodeHTTPHeaderStateEnum, // Runtime enum value
  kAbortController,
  fakeSocketSymbol,
  headersSymbol,
  kBodyChunks,
  kEmitState,
  // ClientRequestEmitState, // Not used directly
  kEmptyObject,
  validateMsecs,
  hasServerResponseFinished,
  timeoutTimerSymbol,
  kHandle,
  getHeader,
  setHeader,
  Headers: HeadersImpl, // Internal Headers implementation
  getRawKeys,
} = require("internal/http");
const { validateHeaderName, validateHeaderValue } = require("node:_http_common");
const { FakeSocket: FakeSocketImpl } = require("internal/http/FakeSocket"); // Runtime class value
const { EventEmitter } = require("node:events"); // Needed for prototype chain
const { Buffer } = require("node:buffer"); // Import Buffer for byteLength
// Use global $ERR_ functions instead of importing from internal/errors

// Define the interface for OutgoingMessage instances
interface OutgoingMessage extends Stream {
  // Properties from constructor/prototype
  sendDate: boolean;
  finished: boolean;
  writable: boolean;
  destroyed: boolean;
  _hasBody: boolean;
  _trailer: string;
  _contentLength: number | undefined;
  _closed: boolean;
  _header: string | undefined;
  _headerSent: boolean;
  timeout: number;
  outputSize: number;
  outputData: any[];
  usesChunkedEncodingByDefault: boolean;

  // Symbols - Use 'any' cast as workaround for TS1169
  [headerStateSymbol: symbol]: NodeHTTPHeaderState;
  [kAbortController: symbol]: AbortController | undefined;
  [fakeSocketSymbol: symbol]: InstanceType<typeof FakeSocketImpl> | undefined;
  [headersSymbol: symbol]: Headers | undefined; // Use imported Headers type
  [kBodyChunks: symbol]: any[] | undefined;
  [kEmitState: symbol]: number;
  [kHandle: symbol]: any | undefined;
  [timeoutTimerSymbol: symbol]: Timer | null;

  // Methods from prototype (with 'this' correctly typed)
  appendHeader(name: string, value: string | string[]): this;
  _implicitHeader(): void;
  flushHeaders(): void;
  getHeader(name: string): string | string[] | undefined;
  // Write overloads
  write(chunk: any, encoding?: BufferEncoding, callback?: (error?: Error | null) => void): boolean;
  write(chunk: any, callback?: (error?: Error | null) => void): boolean;
  getHeaderNames(): string[];
  getRawHeaderNames(): string[];
  getHeaders(): Record<string, string | string[]>;
  removeHeader(name: string): void;
  setHeader(name: string, value: number | string | string[]): this;
  hasHeader(name: string): boolean;
  headers: Record<string, string | string[]>; // Getter/setter pair
  addTrailers(headers: NodeJS.Dict<string> | ReadonlyArray<[string, string]>): void;
  setTimeout(msecs: number, callback?: () => void): this;
  connection: InstanceType<typeof FakeSocketImpl> | undefined; // Getter
  socket: InstanceType<typeof FakeSocketImpl> | undefined; // Getter/setter pair
  chunkedEncoding: boolean; // Getter/setter pair
  writableObjectMode: boolean; // Getter
  writableLength: number; // Getter
  writableHighWaterMark: number; // Getter
  writableNeedDrain: boolean; // Getter
  writableEnded: boolean; // Getter
  writableFinished: boolean; // Getter
  // End overloads
  end(chunk?: any, encoding?: BufferEncoding, callback?: () => void): this;
  end(chunk?: any, callback?: () => void): this;
  end(callback?: () => void): this;
  destroy(err?: Error): this;

  // Inherited Stream/EventEmitter methods are covered by `extends Stream`
  // Re-declare with correct 'this' if needed, but Stream should handle it.
  emit(event: string | symbol, ...args: any[]): boolean;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
  pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean }): T;

  // Observable Node fields (add types if needed)
  _keepAliveTimeout: number;
  _defaultKeepAlive: boolean;
  shouldKeepAlive: boolean;
  _onPendingData: () => void;
  strictContentLength: boolean;
  _removedTE: boolean;
  _removedContLen: boolean;
  _removedConnection: boolean;

  // Internal state if needed for compatibility
  _writableState?: any; // Define properly if needed
}

// Define the constructor function with an explicit type
function OutgoingMessage(this: OutgoingMessage, options?: any) {
  // Use $call intrinsic for calling parent constructor
  (StreamImpl.prototype as any).$call.call(this, options); // Correct way to call parent constructor

  this.sendDate = true;
  this.finished = false;
  this[headerStateSymbol as symbol] = NodeHTTPHeaderStateEnum.none;
  this[kAbortController as symbol] = undefined;

  this.writable = true;
  this.destroyed = false;
  this._hasBody = true;
  this._trailer = "";
  this._contentLength = undefined;
  this._closed = false;
  this._header = undefined;
  this._headerSent = false;

  // Initialize potentially undefined properties accessed later
  this[fakeSocketSymbol as symbol] = undefined;
  this[headersSymbol as symbol] = undefined;
  this[kBodyChunks as symbol] = undefined;
  this[kEmitState as symbol] = 0;
  this[kHandle as symbol] = undefined;
  this[timeoutTimerSymbol as symbol] = null;
  this.outputData = [];
  this.outputSize = 0;
  this.timeout = 0;
}

// Define the prototype with explicit types where necessary
const OutgoingMessagePrototype: Omit<OutgoingMessage, typeof EventEmitter.captureRejectionSymbol> & {
  [EventEmitter.captureRejectionSymbol]?: never;
} = Object.assign(Object.create(StreamImpl.prototype), {
  // Default values for observable properties in Node.js
  _keepAliveTimeout: 0,
  _defaultKeepAlive: true,
  shouldKeepAlive: true,
  _onPendingData: function nop() {},
  outputSize: 0,
  outputData: [] as any[],
  strictContentLength: false,
  _removedTE: false,
  _removedContLen: false,
  _removedConnection: false,
  usesChunkedEncodingByDefault: true,
  _closed: false,
  sendDate: true,
  finished: false,
  [headerStateSymbol as symbol]: NodeHTTPHeaderStateEnum.none,
  [kAbortController as symbol]: undefined as AbortController | undefined,
  writable: true,
  destroyed: false,
  _hasBody: true,
  _trailer: "",
  _contentLength: undefined as number | undefined,
  _header: undefined as string | undefined,
  _headerSent: false,
  timeout: 0,
  [timeoutTimerSymbol as symbol]: null as Timer | null,
  [fakeSocketSymbol as symbol]: undefined as InstanceType<typeof FakeSocketImpl> | undefined,
  [headersSymbol as symbol]: undefined as Headers | undefined, // Use imported Headers type
  [kBodyChunks as symbol]: undefined as any[] | undefined,
  [kEmitState as symbol]: 0,
  [kHandle as symbol]: undefined as any | undefined,
  _writableState: undefined as any, // Placeholder for internal stream state if needed

  appendHeader(name: string, value: string | string[]) {
    var headers = (this[headersSymbol as symbol] ??= new HeadersImpl());
    headers.append(name, value);
    return this;
  },

  _implicitHeader() {
    // This is typically implemented by ServerResponse or ClientRequest
    throw $ERR_METHOD_NOT_IMPLEMENTED("_implicitHeader()");
  },

  flushHeaders() {
    // This is typically implemented by ServerResponse or ClientRequest
  },

  getHeader(name: string) {
    return getHeader(this[headersSymbol as symbol], name);
  },

  write(
    chunk: any,
    encodingOrCb?: BufferEncoding | ((error?: Error | null) => void),
    cb?: (error?: Error | null) => void,
  ): boolean {
    let encoding: BufferEncoding | undefined;

    if (typeof encodingOrCb === "function") {
      cb = encodingOrCb;
      encoding = undefined;
    } else {
      encoding = encodingOrCb;
    }

    if (typeof cb !== "function") {
      cb = undefined;
    }

    // Check if response has finished before attempting to write
    hasServerResponseFinished(this, chunk, cb);

    if (chunk != null) {
      // Determine encoding for byteLength calculation, default to utf8 for strings
      const encodingForLen = encoding || (typeof chunk === "string" ? "utf8" : undefined);
      const len = Buffer.byteLength(chunk, encodingForLen);
      if (len > 0) {
        this.outputSize += len;
        // Store chunk directly, matching original simple logic
        this.outputData.push(chunk);
      }
    }

    // Simplified high water mark check
    return this.writableHighWaterMark >= this.outputSize;
  },

  getHeaderNames() {
    var headers = this[headersSymbol as symbol];
    if (!headers) return [];
    return Array.from(headers.keys());
  },

  getRawHeaderNames(): string[] {
    var headers = this[headersSymbol as symbol];
    if (!headers) return [];
    // Use Function.prototype.$call.call for safety and correctness
    return Function.prototype.$call.call(getRawKeys, headers) as string[];
  },

  getHeaders() {
    const headers = this[headersSymbol as symbol];
    if (!headers) return kEmptyObject;
    return headers.toJSON();
  },

  removeHeader(name: string) {
    // Check if headers are already sent
    if (this._headerSent || this[headerStateSymbol as symbol] === NodeHTTPHeaderStateEnum.sent) {
      throw $ERR_HTTP_HEADERS_SENT("remove");
    }
    const headers = this[headersSymbol as symbol];
    if (!headers) return;
    headers.delete(name);
  },

  setHeader(name: string, value: number | string | string[]) {
    // Check if headers are already sent
    if (this._headerSent || this[headerStateSymbol as symbol] === NodeHTTPHeaderStateEnum.sent) {
      throw $ERR_HTTP_HEADERS_SENT("set");
    }
    validateHeaderName(name);
    validateHeaderValue(name, value);
    const headers = (this[headersSymbol as symbol] ??= new HeadersImpl());
    setHeader(headers, name, value);
    return this;
  },

  hasHeader(name: string) {
    const headers = this[headersSymbol as symbol];
    if (!headers) return false;
    return headers.has(name);
  },

  get headers(): Record<string, string | string[]> {
    const headers = this[headersSymbol as symbol];
    if (!headers) return kEmptyObject;
    return headers.toJSON();
  },
  set headers(value: Record<string, string | string[]>) { // Use Record instead of HeadersInit
    // Create new internal HeadersImpl instance
    this[headersSymbol as symbol] = new HeadersImpl(value);
  },

  addTrailers(_headers: NodeJS.Dict<string> | ReadonlyArray<[string, string]>) {
    // Node.js specific trailer handling
    throw new Error("addTrailers not implemented");
  },

  setTimeout(msecs: number, callback?: () => void) {
    if (this.destroyed) return this;

    this.timeout = msecs = validateMsecs(msecs, "timeout");

    const existingTimer = this[timeoutTimerSymbol as symbol];
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    if (msecs === 0) {
      if (callback != null) {
        validateFunction(callback, "callback");
        this.removeListener("timeout", callback);
      }
      this[timeoutTimerSymbol as symbol] = null;
    } else {
      // Use global setTimeout
      this[timeoutTimerSymbol as symbol] = setTimeout(onTimeout.bind(this), msecs);
      // Ensure timer doesn't keep process alive if possible
      if (this[timeoutTimerSymbol as symbol]?.unref) {
        this[timeoutTimerSymbol as symbol]!.unref();
      }

      if (callback != null) {
        validateFunction(callback, "callback");
        this.once("timeout", callback);
      }
    }

    return this;
  },

  get connection(): InstanceType<typeof FakeSocketImpl> | undefined {
    return this.socket;
  },

  get socket(): InstanceType<typeof FakeSocketImpl> | undefined {
    // Lazily create FakeSocket instance using FakeSocketImpl
    this[fakeSocketSymbol as symbol] = this[fakeSocketSymbol as symbol] ?? new FakeSocketImpl();
    return this[fakeSocketSymbol as symbol];
  },

  set socket(value: InstanceType<typeof FakeSocketImpl> | undefined) {
    this[fakeSocketSymbol as symbol] = value;
  },

  get chunkedEncoding(): boolean {
    // Reflects Node's default behavior for HTTP/1.1 when no Content-Length is set
    return this.usesChunkedEncodingByDefault && this._contentLength == null;
  },

  set chunkedEncoding(value: boolean) {
    // Setting this is usually implicit based on headers/protocol in Node
    // Reflect the intention for compatibility if needed
    this.usesChunkedEncodingByDefault = !!value;
  },

  get writableObjectMode(): boolean {
    return false; // Default for Node streams unless specified
  },

  get writableLength(): number {
    // Simplified approximation of Node's internal buffer length
    return this.outputSize;
  },

  get writableHighWaterMark(): number {
    // Get HWM from internal state if available, otherwise default
    return this._writableState?.highWaterMark || 16 * 1024;
  },

  get writableNeedDrain(): boolean {
    // Simplified check based on output size vs HWM
    return !this.destroyed && !this.finished && this.outputSize > this.writableHighWaterMark;
  },

  get writableEnded(): boolean {
    return this.finished;
  },

  get writableFinished(): boolean {
    // Approximation of Node's state: finished and buffer flushed
    return this.finished && this.outputSize === 0 && !this.destroyed;
  },

  end(chunk?: any, encodingOrCb?: BufferEncoding | (() => void), cb?: () => void): OutgoingMessage {
    if (typeof chunk === "function") {
      cb = chunk;
      chunk = undefined;
      encodingOrCb = undefined;
    } else if (typeof encodingOrCb === "function") {
      cb = encodingOrCb;
      encodingOrCb = undefined;
    }

    if (chunk != null) {
      const encoding = typeof encodingOrCb === "string" ? encodingOrCb : undefined;
      this.write(chunk, encoding); // Write the final chunk
    }

    if (this.finished) {
      // If already finished, invoke callback immediately if provided
      if (typeof cb === "function") {
        process.nextTick(cb);
      }
      return this;
    }

    this.finished = true;

    // Emit 'finish' asynchronously, after the current tick, similar to Node.js
    process.nextTick(
      (self: OutgoingMessage, callbackFn?: () => void) => { // Explicitly type self
        // Ensure not destroyed before emitting 'finish'
        if (!self.destroyed) {
          self.emit("finish");
        }
        if (typeof callbackFn === "function") {
          callbackFn();
        }
      },
      this,
      cb,
    );

    return this;
  },

  destroy(err?: Error): OutgoingMessage {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.finished = true; // Destroy implies finished
    this.writable = false;
    this.outputSize = 0;
    this.outputData = [];

    const handle = this[kHandle as symbol];
    if (handle && typeof (handle as { abort?: () => void }).abort === "function") {
      (handle as { abort: () => void }).abort();
    }

    const existingTimer = this[timeoutTimerSymbol as symbol];
    if (existingTimer) {
      clearTimeout(existingTimer);
      this[timeoutTimerSymbol as symbol] = null;
    }

    // Emit 'error' (if provided) and 'close' asynchronously
    process.nextTick(
      (self: OutgoingMessage, error?: Error) => { // Explicitly type self
        if (error && !self.emit("error", error)) {
          // If no 'error' listener, potentially re-throw or handle differently
          // console.error('Error:', error); // Example handling
        }
        self.emit("close");
      },
      this,
      err,
    );
    return this;
  },

  // Explicitly declare Stream methods on the prototype for clarity
  emit(event: string | symbol, ...args: any[]): boolean {
    // Use the inherited emit method from EventEmitter (via Stream)
    return EventEmitter.prototype.emit.$call(this, event, ...args);
  },
  on(event: string | symbol, listener: (...args: any[]) => void): OutgoingMessage {
    EventEmitter.prototype.on.$call(this, event, listener);
    return this;
  },
  once(event: string | symbol, listener: (...args: any[]) => void): OutgoingMessage {
    EventEmitter.prototype.once.$call(this, event, listener);
    return this;
  },
  removeListener(event: string | symbol, listener: (...args: any[]) => void): OutgoingMessage {
    EventEmitter.prototype.removeListener.$call(this, event, listener);
    return this;
  },
  pipe<T extends NodeJS.WritableStream>(destination: T, options?: { end?: boolean }): T {
    return StreamImpl.prototype.pipe.$call(this, destination, options);
  },
});

// Assign the prototype correctly, casting to satisfy the interface
OutgoingMessage.prototype = OutgoingMessagePrototype as OutgoingMessage;
// Ensure constructor points back
(OutgoingMessage.prototype as any).constructor = OutgoingMessage;

// Set prototype chain for static methods and instanceof checks
Object.setPrototypeOf(OutgoingMessage, StreamImpl);

// Timeout handler - explicitly type 'this'
function onTimeout(this: OutgoingMessage) {
  this[timeoutTimerSymbol as symbol] = null; // Clear timer ref
  const controller = this[kAbortController as symbol];
  if (controller) {
    controller.abort(); // Abort associated controller if exists
  }

  // Only emit timeout and potentially abort handle if not already destroyed
  if (!this.destroyed) {
    // Use the correctly defined emit method
    this.emit("timeout");
    // Aborting the handle here might be redundant if destroy() is called by timeout listeners
    // const handle = this[kHandle as symbol];
    // if (handle && typeof handle.abort === 'function') {
    //   handle.abort();
    // }
  }
}

// Export explicitly typed constructor and prototype
// Use 'unknown' cast for constructor to satisfy TS4082 (private name export issue)
export default {
  OutgoingMessage: OutgoingMessage as unknown as { new (options?: any): OutgoingMessage },
  FakeSocket: FakeSocketImpl, // Export the runtime FakeSocket class
  OutgoingMessagePrototype,
} as unknown;