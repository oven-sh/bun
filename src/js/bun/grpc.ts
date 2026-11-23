// https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md
const { validateFunction, validateInteger, validateNumber, validateObject } = require("internal/validators");

const takeTrailers: (response: Response) => Headers | undefined = $bindgen("grpc_binding.bind.ts", "takeTrailers");

type Frame = Uint8Array<ArrayBuffer>;
type MessageIterator = AsyncIterator<unknown> | Iterator<unknown>;
type Handler = (request: Uint8Array | AsyncGenerator<Uint8Array>, context: CallContext) => unknown;

interface Outgoing {
  messages: AsyncIterable<unknown> | Iterable<unknown>;
  frame(message: unknown): Frame;
}

interface CallOptions {
  headers?: Bun.HeadersInit;
  signal?: AbortSignal;
  timeout?: number;
  onHeaders?(headers: Headers): void;
  onTrailers?(trailers: Headers): void;
}

interface ClientOptions {
  headers?: Bun.HeadersInit;
  timeout?: number;
  tls?: BunFetchRequestInit["tls"];
  unix?: string;
  fetch?(url: string, init: BunFetchRequestInit): Promise<Response>;
  maxReceiveMessageLength?: number;
}

interface RoutesOptions {
  maxReceiveMessageLength?: number;
  onError?(error: unknown, context: CallContext): unknown;
}

const Status = Object.freeze({
  OK: 0,
  CANCELLED: 1,
  UNKNOWN: 2,
  INVALID_ARGUMENT: 3,
  DEADLINE_EXCEEDED: 4,
  NOT_FOUND: 5,
  ALREADY_EXISTS: 6,
  PERMISSION_DENIED: 7,
  RESOURCE_EXHAUSTED: 8,
  FAILED_PRECONDITION: 9,
  ABORTED: 10,
  OUT_OF_RANGE: 11,
  UNIMPLEMENTED: 12,
  INTERNAL: 13,
  UNAVAILABLE: 14,
  DATA_LOSS: 15,
  UNAUTHENTICATED: 16,
});

class GrpcError extends Error {
  // @ts-expect-error: a string on the errors of Node.js
  code: number;
  trailers: Headers;

  constructor(code: number, message?: string, options?: { trailers?: Bun.HeadersInit; cause?: unknown }) {
    validateInteger(code, "code", Status.CANCELLED, Status.UNAUTHENTICATED);
    super(message, options);
    this.code = code;
    this.trailers = new Headers(options?.trailers);
  }
}
Object.defineProperty(GrpcError.prototype, "name", { value: "GrpcError", writable: true, configurable: true });

/** The trailers of these are from another server. */
const receivedErrors = new WeakSet<GrpcError>();

const contentType = "application/grpc";
const acceptedEncodings = "identity,gzip,deflate";
const prefixLength = 5;
const longestTimer = 2 ** 31 - 1;

function isGrpcContentType(value: string | null): boolean {
  if (value === contentType) return true;
  return value !== null && /^application\/grpc(\+proto)?\s*(;|$)/i.test(value);
}

const fieldsOfOneMessage = [
  "accept-encoding",
  "content-encoding",
  "content-length",
  "content-type",
  "grpc-accept-encoding",
  "grpc-encoding",
  "grpc-message",
  "grpc-status",
  "te",
  "transfer-encoding",
];

function keepMetadata(headers: Headers): Headers {
  for (const name of fieldsOfOneMessage) headers.delete(name);
  return headers;
}

function messageLimitOf(options: { maxReceiveMessageLength?: number } | undefined): number {
  const limit = options?.maxReceiveMessageLength ?? 4 * 1024 * 1024;
  validateInteger(limit, "options.maxReceiveMessageLength", 0, 2 ** 32 - 1);
  return limit;
}

function validateTimeout(timeout: unknown) {
  if (timeout !== undefined) validateNumber(timeout, "options.timeout", 0, longestTimer);
}

function deadlineExceeded(): GrpcError {
  return new GrpcError(Status.DEADLINE_EXCEEDED, "Deadline exceeded");
}

function iteratorOf(messages: Outgoing["messages"], name: string): MessageIterator {
  const start = messages?.[Symbol.asyncIterator] ?? messages?.[Symbol.iterator];
  if (!$isCallable(start) || typeof messages === "string") {
    throw $ERR_INVALID_ARG_TYPE(name, ["AsyncIterable", "Iterable"], messages);
  }
  return start.$call(messages);
}

async function closeIterator(iterator: MessageIterator) {
  try {
    await iterator.return?.();
  } catch {}
}

/** Splits the bytes of a body into messages. */
class MessageParser {
  #encoding: string;
  #limit: number;
  #chunk: Uint8Array = new Uint8Array(0);
  #offset = 0;
  #prefix = new Uint8Array(prefixLength);
  #prefixFilled = 0;
  /** A message that spans chunks. */
  #message: Uint8Array | undefined;
  #messageFilled = 0;

  constructor(headers: Headers, limit: number) {
    this.#encoding = headers.get("grpc-encoding") ?? "identity";
    this.#limit = limit;
  }

  /** After `next()` has returned `undefined`. */
  push(chunk: Uint8Array) {
    this.#chunk = chunk;
    this.#offset = 0;
  }

  end() {
    if (this.#prefixFilled !== 0) throw new GrpcError(Status.INTERNAL, "The stream ended in the middle of a message");
  }

  next(): Uint8Array | undefined {
    const chunk = this.#chunk;
    const prefix = this.#prefix;
    while (this.#prefixFilled < prefixLength) {
      if (this.#offset === chunk.length) return undefined;
      prefix[this.#prefixFilled++] = chunk[this.#offset++];
    }
    const length = ((prefix[1] << 24) | (prefix[2] << 16) | (prefix[3] << 8) | prefix[4]) >>> 0;
    if (length > this.#limit) throw this.#tooLong();

    let message = this.#message;
    if (message === undefined && length <= chunk.length - this.#offset) {
      message = chunk.subarray(this.#offset, (this.#offset += length));
    } else {
      const before = this.#messageFilled;
      const part = chunk.subarray(this.#offset, this.#offset + length - before);
      const filled = (this.#messageFilled += part.length);
      this.#offset += part.length;
      if (message === undefined || message.length < filled) {
        // The peer has to send the bytes, not only to declare them.
        const grown = new Uint8Array(Math.min(length, filled * 2));
        if (message !== undefined) grown.set(message);
        message = this.#message = grown;
      }
      message.set(part, before);
      if (filled < length) return undefined;
      this.#message = undefined;
      this.#messageFilled = 0;
    }
    this.#prefixFilled = 0;

    return prefix[0] === 0 ? message : this.#decompress(prefix[0], message);
  }

  #tooLong(): GrpcError {
    return new GrpcError(Status.RESOURCE_EXHAUSTED, `Received a message longer than ${this.#limit} bytes`);
  }

  #decompress(flag: number, message: Uint8Array): Uint8Array {
    const encoding = this.#encoding;
    if (flag !== 1 || encoding === "identity") {
      throw new GrpcError(
        Status.INTERNAL,
        `Received a message with the compression flag ${flag} and ${encoding} encoding`,
      );
    }
    if (encoding !== "gzip" && encoding !== "deflate") {
      throw new GrpcError(Status.UNIMPLEMENTED, `Received a message with the unsupported encoding ${encoding}`);
    }
    const { gunzipSync, inflateSync } = require("node:zlib");
    const options = { maxOutputLength: Math.max(this.#limit, 1) };
    try {
      return (encoding === "gzip" ? gunzipSync : inflateSync)(message, options) as Uint8Array;
    } catch (cause) {
      if ((cause as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw this.#tooLong();
      throw new GrpcError(Status.INTERNAL, `Received a message that is not valid ${encoding}`, { cause });
    }
  }
}

// https://github.com/grpc/grpc/blob/master/doc/http-grpc-status-mapping.md
function codeOfHttpStatus(status: number): number {
  switch (status) {
    case 400:
      return Status.INTERNAL;
    case 401:
      return Status.UNAUTHENTICATED;
    case 403:
      return Status.PERMISSION_DENIED;
    case 404:
      return Status.UNIMPLEMENTED;
    case 429:
    case 502:
    case 503:
    case 504:
      return Status.UNAVAILABLE;
    default:
      return Status.UNKNOWN;
  }
}

function codeOfFetchError(error: { code?: unknown }): number {
  switch (error.code) {
    case "HTTP2CompressionError":
    case "HTTP2ContentLengthMismatch":
    case "HTTP2FlowControlError":
    case "HTTP2FrameSizeError":
    case "HTTP2ProtocolError":
    case "HTTP2StreamReset":
      return Status.INTERNAL;
    case "HTTP2Cancel":
      return Status.CANCELLED;
    case "HTTP2InadequateSecurity":
      return Status.PERMISSION_DENIED;
    case "HTTP2EnhanceYourCalm":
    case "HTTP2HeaderListTooLarge":
      return Status.RESOURCE_EXHAUSTED;
    default:
      return Status.UNAVAILABLE;
  }
}

function percentDecode(message: string): string {
  try {
    return decodeURIComponent(message);
  } catch {
    return message;
  }
}

interface Target {
  origin: string;
  headers: Headers;
  timeout: number | undefined;
  limit: number;
  fetch(url: string, init: BunFetchRequestInit): Promise<Response>;
  tls: BunFetchRequestInit["tls"];
  unix: string | undefined;
}

class ClientCall {
  #target: Target;
  #options: CallOptions | undefined;
  #controller = new AbortController();
  #timer: Timer | undefined;
  #deadline = Infinity;
  #onAbort: (() => void) | undefined;
  #response: Response | undefined;
  #reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  #parser: MessageParser | undefined;
  #requests: MessageIterator | undefined;
  #isComplete = false;

  constructor(target: Target, options: CallOptions | undefined) {
    this.#target = target;
    this.#options = options;
  }

  async start(path: string, request: Frame | Outgoing) {
    const { origin, fetch, tls, unix, limit } = this.#target;
    const options = this.#options;
    const headers = new Headers(this.#target.headers);
    if (options !== undefined) {
      validateObject(options, "options");
      validateTimeout(options.timeout);
      for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
    }
    keepMetadata(headers);
    headers.set("content-type", contentType);
    headers.set("te", "trailers");
    headers.set("grpc-accept-encoding", acceptedEncodings);
    headers.set("accept-encoding", "identity");

    const timeout = options?.timeout ?? this.#target.timeout;
    if (timeout !== undefined) {
      // At most 8 digits.
      headers.set("grpc-timeout", timeout <= 99999999 ? Math.ceil(timeout) + "m" : Math.ceil(timeout / 1000) + "S");
      this.#deadline = performance.now() + timeout;
      this.#timer = setTimeout(() => this.#controller.abort(deadlineExceeded()), timeout);
    }
    const signal = options?.signal;
    if (signal !== undefined) {
      this.#onAbort = () => {
        this.#controller.abort(new GrpcError(Status.CANCELLED, "The call was aborted", { cause: signal.reason }));
      };
      if (signal.aborted) this.#onAbort();
      else signal.addEventListener("abort", this.#onAbort);
    }

    const body = $isTypedArrayView(request) ? (request as Frame) : this.#stream(request as Outgoing);
    let response: Response;
    try {
      response = await fetch(origin + path, {
        method: "POST",
        headers,
        body,
        protocol: "http2",
        duplex: "half",
        redirect: "manual",
        proxy: false,
        timeout: false,
        signal: this.#controller.signal,
        tls,
        unix,
      });
    } catch (error) {
      throw this.#transportFailed(error);
    }
    this.#response = response;

    const responseHeaders = response.headers;
    if (responseHeaders.has("grpc-status")) return this.#complete(responseHeaders);
    const { status } = response;
    if (status !== 200) throw new GrpcError(codeOfHttpStatus(status), `Received the HTTP status ${status}`);
    const type = responseHeaders.get("content-type");
    if (!isGrpcContentType(type)) throw new GrpcError(Status.UNKNOWN, `Received the content type ${type}`);
    options?.onHeaders?.(responseHeaders);
    this.#parser = new MessageParser(responseHeaders, limit);
    this.#reader = response.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  }

  /** `undefined` once the call has ended well. */
  async read(): Promise<Uint8Array | undefined> {
    while (!this.#isComplete) {
      const { signal } = this.#controller;
      if (signal.aborted) throw signal.reason;
      const message = this.#parser!.next();
      if (message !== undefined) return message;
      let result;
      try {
        result = await this.#reader!.read();
      } catch (error) {
        throw this.#transportFailed(error);
      }
      if (result.done) {
        this.#complete(takeTrailers(this.#response!));
        this.#parser!.end();
      } else {
        this.#parser!.push(result.value);
      }
    }
    return undefined;
  }

  close() {
    clearTimeout(this.#timer);
    if (this.#onAbort !== undefined) this.#options!.signal!.removeEventListener("abort", this.#onAbort);
    if (!this.#isComplete) this.#controller.abort();
    this.#closeRequests();
  }

  #closeRequests() {
    const requests = this.#requests;
    this.#requests = undefined;
    if (requests !== undefined) closeIterator(requests);
  }

  #stream(requests: Outgoing): ReadableStream<Uint8Array> {
    const iterator = (this.#requests = iteratorOf(requests.messages, "requests"));
    return new ReadableStream<Uint8Array>(
      {
        pull: async controller => {
          try {
            const { done, value } = await iterator.next();
            if (!done) return controller.enqueue(requests.frame(value));
            this.#requests = undefined;
            controller.close();
          } catch (error) {
            if (!this.#isComplete) this.#controller.abort(error);
          }
        },
        cancel: () => this.#closeRequests(),
      },
      { highWaterMark: 0 },
    );
  }

  #complete(trailers: Headers | undefined) {
    this.#isComplete = true;
    const status = trailers?.get("grpc-status");
    if (status == null) throw new GrpcError(Status.INTERNAL, "The response has no grpc-status");
    this.#options?.onTrailers?.(trailers!);
    if (status === "0") return;
    const code = /^([1-9]|1[0-6])$/.test(status) ? Number(status) : Status.UNKNOWN;
    const error = new GrpcError(code, percentDecode(trailers!.get("grpc-message") ?? ""), { trailers });
    receivedErrors.add(error);
    throw error;
  }

  #transportFailed(cause: unknown): unknown {
    const { signal } = this.#controller;
    if (signal.aborted) return signal.reason;
    // The server has the same deadline, and may reset the stream before the timer fires.
    if (performance.now() >= this.#deadline) return deadlineExceeded();
    if (!Error.isError(cause)) return cause;
    return new GrpcError(codeOfFetchError(cause), cause.message, { cause });
  }
}

class Channel {
  #target: Target;

  constructor(url: string | URL, options?: ClientOptions) {
    const { protocol, href } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") {
      throw $ERR_INVALID_ARG_VALUE("url", url, 'must start with "http://" or "https://"');
    }
    if (options !== undefined) validateObject(options, "options");
    validateTimeout(options?.timeout);
    const fetch = options?.fetch ?? Bun.fetch;
    validateFunction(fetch, "options.fetch");
    const headers = new Headers(options?.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", "grpc-bun/" + Bun.version);
    this.#target = {
      origin: href.replace(/\/*([?#].*)?$/, ""),
      headers,
      timeout: options?.timeout,
      limit: messageLimitOf(options),
      fetch,
      tls: options?.tls,
      unix: options?.unix,
    };
  }

  async call(path: string, request: Frame | Outgoing, options?: CallOptions): Promise<Uint8Array> {
    const call = new ClientCall(this.#target, options);
    try {
      await call.start(path, request);
      const message = await call.read();
      if (message === undefined || (await call.read()) !== undefined) {
        throw new GrpcError(Status.UNIMPLEMENTED, "The response does not have exactly one message");
      }
      return message;
    } finally {
      call.close();
    }
  }

  async *stream(path: string, request: Frame | Outgoing, options?: CallOptions): AsyncGenerator<Uint8Array> {
    const call = new ClientCall(this.#target, options);
    try {
      await call.start(path, request);
      for (let message = await call.read(); message !== undefined; message = await call.read()) yield message;
    } finally {
      call.close();
    }
  }
}

/** `GrpcCall` in `grpc_binding.bind.ts` */
interface NativeCall {
  listener: ((event: Event) => void) | undefined;
  readonly server: Bun.Server<unknown>;
  readonly path: string;
  readonly host: string;
  readonly headers: Headers;
  readonly responseHeaders: Headers;
  readonly responseTrailers: Headers;
  readonly interruptionCode: number;
  readonly interruptionMessage: string;
  requestIP(): Bun.SocketAddress | null;
  timeout(seconds: number): void;
  read(): Uint8Array | null | undefined;
  write(frame: Frame): boolean;
  end(code: number, message: string, frame?: Frame): void;
}

const enum Event {
  Readable,
  Writable,
  Interrupted,
}

class CallContext {
  #call: ServerCall;

  constructor(call: ServerCall) {
    this.#call = call;
  }

  get server() {
    return this.#call.native.server;
  }
  get path() {
    return this.#call.native.path;
  }
  get host() {
    return this.#call.native.host;
  }
  get headers() {
    return this.#call.native.headers;
  }
  get signal() {
    return this.#call.signal();
  }
  get responseHeaders() {
    return this.#call.native.responseHeaders;
  }
  get responseTrailers() {
    return this.#call.native.responseTrailers;
  }
  requestIP() {
    return this.#call.native.requestIP();
  }
  timeout(seconds: number) {
    validateInteger(seconds, "seconds", 0, 255);
    this.#call.native.timeout(seconds);
  }
}

class ServerCall {
  native: NativeCall;
  context: CallContext;
  #frame: Outgoing["frame"];
  #onError: RoutesOptions["onError"];
  #controller: AbortController | undefined;
  #interruption: GrpcError | undefined;
  #responses: MessageIterator | undefined;
  #onReadable: (() => void) | undefined;
  #onWritable: (() => void) | undefined;
  #hasEnded = false;

  constructor(native: NativeCall, frame: Outgoing["frame"], onError: RoutesOptions["onError"]) {
    this.native = native;
    this.context = new CallContext(this);
    this.#frame = frame;
    this.#onError = onError;
  }

  #listen() {
    this.native.listener ??= event => {
      if (event !== Event.Readable) this.#onWritable?.();
      if (event !== Event.Writable) this.#onReadable?.();
      if (event !== Event.Interrupted) return;
      this.#closeResponses();
      this.#controller?.abort(this.#interrupted());
    };
  }

  #interrupted(): GrpcError | undefined {
    const code = this.native.interruptionCode;
    if (code !== Status.OK) return (this.#interruption ??= new GrpcError(code, this.native.interruptionMessage));
  }

  signal(): AbortSignal {
    let controller = this.#controller;
    if (controller === undefined) {
      controller = this.#controller = new AbortController();
      const interruption = this.#interrupted();
      if (interruption === undefined) this.#listen();
      else controller.abort(interruption);
    }
    return controller.signal;
  }

  async *requests(): AsyncGenerator<Uint8Array> {
    this.#listen();
    while (true) {
      const message = this.native.read();
      if (message === null) return;
      if (message !== undefined) {
        yield message;
        continue;
      }
      const interruption = this.#interrupted();
      if (interruption !== undefined) throw interruption;
      if (this.#hasEnded) throw new GrpcError(Status.CANCELLED, "The call ended before the last request");
      const { promise, resolve } = Promise.withResolvers<void>();
      this.#onReadable = resolve;
      await promise;
    }
  }

  respond(response: unknown) {
    try {
      this.#end(Status.OK, "", this.#frame(response));
    } catch (error) {
      this.fail(error);
    }
  }

  async stream(responses: unknown) {
    this.#listen();
    try {
      const iterator = (this.#responses = iteratorOf((await responses) as Outgoing["messages"], "responses"));
      if (this.#interrupted() !== undefined) return this.#closeResponses();
      while (this.#responses !== undefined) {
        const { done, value } = await iterator.next();
        if (done || this.#responses === undefined) break;
        if (this.native.write(this.#frame(value))) continue;
        const { promise, resolve } = Promise.withResolvers<void>();
        this.#onWritable = resolve;
        await promise;
      }
      this.#responses = undefined;
      this.#end(Status.OK, "");
    } catch (error) {
      this.fail(error);
    }
  }

  fail(error: unknown) {
    this.#closeResponses();
    if (this.native.interruptionCode !== Status.OK) return;
    try {
      if (!(error instanceof GrpcError)) error = this.#report(error);
      if (error instanceof GrpcError) this.#endWith(error);
    } catch (thrown) {
      console.error(thrown);
    } finally {
      if (!this.#hasEnded) this.#end(Status.UNKNOWN, "Unknown error");
    }
  }

  #endWith(error: GrpcError) {
    const { code } = error;
    validateInteger(code, "error.code", Status.CANCELLED, Status.UNAUTHENTICATED);
    if (!receivedErrors.has(error)) {
      for (const [name, value] of error.trailers) this.native.responseTrailers.set(name, value);
    }
    this.#end(code, String(error.message));
  }

  #end(code: number, message: string, frame?: Frame) {
    this.native.end(code, message, frame);
    this.#hasEnded = true;
    this.#onReadable?.();
  }

  #closeResponses() {
    const responses = this.#responses;
    this.#responses = undefined;
    if (responses !== undefined) closeIterator(responses);
  }

  #report(error: unknown): unknown {
    if (this.#onError !== undefined) return this.#onError(error, this.context);
    console.error(error);
  }
}

function route(
  requestStream: boolean,
  responseStream: boolean,
  handler: Handler | undefined,
  frame: Outgoing["frame"],
  options?: RoutesOptions,
) {
  if (options !== undefined) validateObject(options, "options");
  const limit = messageLimitOf(options);
  const onError = options?.onError;
  if (onError !== undefined) validateFunction(onError, "options.onError");

  function start(native: NativeCall, request: Uint8Array) {
    const call = new ServerCall(native, frame, onError);
    try {
      const output = handler!(requestStream ? call.requests() : request, call.context);
      if (responseStream) {
        call.stream(output);
      } else if ($isCallable((output as PromiseLike<unknown> | undefined)?.then)) {
        Promise.$resolve(output).$then(
          response => call.respond(response),
          error => call.fail(error),
        );
      } else {
        call.respond(output);
      }
    } catch (error) {
      call.fail(error);
    }
  }
  return $bindgen("grpc_binding.bind.ts", "createRoute")(requestStream, limit, handler && start);
}

export default { Channel, GrpcError, Status, route };
