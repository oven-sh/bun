// Decoder for `application/vnd.amazon.eventstream` — the framing AWS uses
// for streaming responses (Bedrock InvokeModelWithResponseStream /
// ConverseStream, S3 Select, Transcribe, Lambda response streaming …).
//
// Frame layout (all integers big-endian):
//   u32 total_length | u32 headers_length | u32 prelude_crc32
//   headers … | payload … | u32 message_crc32
// A header is: u8 name_length | name | u8 value_type | value.

const { isAnyArrayBuffer, isUint8Array } = require("node:util/types");

type HeaderValue = boolean | number | bigint | string | Uint8Array | Date;
type Headers = Record<string, HeaderValue>;

const PRELUDE_LENGTH = 12;
const MIN_MESSAGE_LENGTH = 16;
// The service-side limits are 128 KiB of headers and 16 MiB of payload;
// anything larger is a framing error, not something to buffer.
const MAX_MESSAGE_LENGTH = 24 * 1024 * 1024;
// How much of a non-2xx body to read for the error message.
const MAX_ERROR_BODY = 64 * 1024;

const strictDecoder = new TextDecoder("utf-8", { fatal: true });
const textDecoder = new TextDecoder("utf-8");
const crc32 = Bun.hash.crc32;
const Uint8ArraySubarray = Uint8Array.prototype.subarray;
const Uint8ArrayToHex = Uint8Array.prototype.toHex;

class AWSEventStreamMessage {
  headers: Headers;
  payload: Uint8Array;

  constructor(headers: Headers, payload: Uint8Array) {
    this.headers = headers;
    this.payload = payload;
  }

  /** `:message-type` (`"event"`; exception/error frames are thrown, not yielded). */
  get type(): string | undefined {
    const v = this.headers[":message-type"];
    return typeof v === "string" ? v : undefined;
  }

  /** `:event-type`. */
  get event(): string | undefined {
    const v = this.headers[":event-type"];
    return typeof v === "string" ? v : undefined;
  }

  get contentType(): string | undefined {
    const v = this.headers[":content-type"];
    return typeof v === "string" ? v : undefined;
  }

  text(): string {
    return textDecoder.decode(this.payload);
  }

  json(): unknown {
    return JSON.parse(textDecoder.decode(this.payload));
  }
}

function framingError(message: string): Error {
  return $ERR_AWS_EVENT_STREAM(`Invalid AWS event stream: ${message}`);
}

function hex(bytes: Uint8Array, from: number, to: number): string {
  return Uint8ArrayToHex.$call(Uint8ArraySubarray.$call(bytes, from, to));
}

function utf8(bytes: Uint8Array, from: number, to: number): string {
  try {
    return strictDecoder.decode(Uint8ArraySubarray.$call(bytes, from, to));
  } catch {
    throw framingError("header is not valid UTF-8");
  }
}

/** `bytes` is a buffer this module owns (one frame), so views into it are fine to hand out. */
function parseHeaders(bytes: Uint8Array, view: DataView, start: number, end: number): Headers {
  const headers: Headers = Object.create(null);
  let i = start;
  while (i < end) {
    const nameLength = bytes[i++];
    if (i + nameLength + 1 > end) throw framingError("truncated header");
    const name = utf8(bytes, i, i + nameLength);
    i += nameLength;
    const type = bytes[i++];
    let value: HeaderValue;
    switch (type) {
      case 0:
        value = true;
        break;
      case 1:
        value = false;
        break;
      case 2:
        if (i + 1 > end) throw framingError("truncated header");
        value = view.getInt8(i);
        i += 1;
        break;
      case 3:
        if (i + 2 > end) throw framingError("truncated header");
        value = view.getInt16(i);
        i += 2;
        break;
      case 4:
        if (i + 4 > end) throw framingError("truncated header");
        value = view.getInt32(i);
        i += 4;
        break;
      case 5:
        if (i + 8 > end) throw framingError("truncated header");
        value = view.getBigInt64(i);
        i += 8;
        break;
      case 6:
      case 7: {
        if (i + 2 > end) throw framingError("truncated header");
        const length = view.getUint16(i);
        i += 2;
        if (i + length > end) throw framingError("truncated header");
        value = type === 6 ? Uint8ArraySubarray.$call(bytes, i, i + length) : utf8(bytes, i, i + length);
        i += length;
        break;
      }
      case 8:
        if (i + 8 > end) throw framingError("truncated header");
        value = new Date(Number(view.getBigInt64(i)));
        i += 8;
        break;
      case 9:
        if (i + 16 > end) throw framingError("truncated header");
        value = `${hex(bytes, i, i + 4)}-${hex(bytes, i + 4, i + 6)}-${hex(bytes, i + 6, i + 8)}-${hex(bytes, i + 8, i + 10)}-${hex(bytes, i + 10, i + 16)}`;
        i += 16;
        break;
      default:
        throw framingError(`unknown header value type ${type}`);
    }
    headers[name] = value;
  }
  return headers;
}

/** Parse one whole frame; `bytes` is exactly the frame and owned by us. */
function parseMessage(bytes: Uint8Array, headersLength: number): AWSEventStreamMessage {
  const totalLength = bytes.length;
  const view = new DataView(bytes.buffer, bytes.byteOffset, totalLength);
  const expected = view.getUint32(totalLength - 4);
  if (crc32(Uint8ArraySubarray.$call(bytes, 0, totalLength - 4)) !== expected) {
    throw framingError("message checksum mismatch");
  }
  const headers = parseHeaders(bytes, view, PRELUDE_LENGTH, PRELUDE_LENGTH + headersLength);
  const payload = Uint8ArraySubarray.$call(bytes, PRELUDE_LENGTH + headersLength, totalLength - 4);
  return new AWSEventStreamMessage(headers, payload);
}

/** An `exception` / `error` frame becomes a thrown Error, like the SDKs do:
 * `name` is the service's exception type as sent (casing varies by service). */
function errorFromMessage(message: AWSEventStreamMessage): Error | undefined {
  const type = message.type;
  if (type === "exception") {
    let detail: string | undefined;
    try {
      const body = message.json() as any;
      detail = body?.message ?? body?.Message;
    } catch {}
    if (typeof detail !== "string") detail = message.text();
    const name = String(message.headers[":exception-type"] ?? "Exception");
    const err = $ERR_AWS_EVENT_STREAM_EXCEPTION(detail || name) as Error & { headers: Headers; body: string };
    err.name = name;
    err.headers = message.headers;
    err.body = message.text();
    return err;
  }
  if (type === "error") {
    const name = String(message.headers[":error-code"] ?? "Error");
    const text = message.headers[":error-message"];
    const err = $ERR_AWS_EVENT_STREAM_ERROR(typeof text === "string" && text ? text : name) as Error & {
      headers: Headers;
    };
    err.name = name;
    err.headers = message.headers;
    return err;
  }
  return undefined;
}

function toBytes(chunk: unknown): Uint8Array {
  if (isUint8Array(chunk)) return chunk as Uint8Array;
  if (isAnyArrayBuffer(chunk)) return new Uint8Array(chunk as ArrayBuffer);
  if (ArrayBuffer.isView(chunk)) return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  throw $ERR_INVALID_ARG_TYPE("chunk", ["ArrayBuffer", "ArrayBufferView"], chunk);
}

/** A non-2xx response carries a plain (JSON) error document, not frames. */
async function responseError(response: Response): Promise<Error> {
  let body = "";
  const stream = response.bodyUsed ? null : response.body;
  if (stream && !stream.locked) {
    const reader = stream.getReader();
    const parts: Uint8Array[] = [];
    let size = 0;
    try {
      while (size < MAX_ERROR_BODY) {
        const { value, done } = await reader.read();
        if (done) break;
        const bytes = toBytes(value);
        parts.push(bytes);
        size += bytes.length;
      }
    } catch {}
    reader.cancel().catch(() => {});
    body = textDecoder.decode(Buffer.concat(parts).subarray(0, MAX_ERROR_BODY));
  }
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    if (typeof (parsed?.message ?? parsed?.Message) === "string") detail = parsed.message ?? parsed.Message;
  } catch {}
  if (detail.length > 512) detail = detail.slice(0, 512) + "…";
  const err = $ERR_AWS_EVENT_STREAM_RESPONSE(`HTTP ${response.status}${detail ? `: ${detail}` : ""}`) as Error & {
    status: number;
    headers: globalThis.Headers;
    body: string;
  };
  const type = response.headers.get("x-amzn-errortype");
  if (type) err.name = type.split(":")[0] || err.name;
  err.status = response.status;
  err.headers = response.headers;
  err.body = body;
  return err;
}

type Source = { response: Response } | { chunks: AsyncIterable<unknown> | Iterable<unknown> };

/** Argument errors are the caller's, so they throw from `eventStream()` itself. */
function classify(source: unknown): Source {
  if (source instanceof Response) return { response: source };
  if (source instanceof Blob) return { chunks: source.stream() as AsyncIterable<unknown> };
  if (isAnyArrayBuffer(source) || ArrayBuffer.isView(source)) return { chunks: [source] };
  if (source && typeof source === "object" && Symbol.asyncIterator in source) {
    return { chunks: source as AsyncIterable<unknown> };
  }
  throw $ERR_INVALID_ARG_TYPE(
    "source",
    ["Response", "ReadableStream", "AsyncIterable", "Blob", "ArrayBuffer", "ArrayBufferView"],
    source,
  );
}

async function chunksOf(source: Source): Promise<AsyncIterable<unknown> | Iterable<unknown>> {
  if ("chunks" in source) return source.chunks;
  const { response } = source;
  if (!response.ok) throw await responseError(response);
  if (response.bodyUsed) throw $ERR_AWS_EVENT_STREAM_RESPONSE("the response body was already consumed");
  return (response.body as AsyncIterable<unknown> | null) ?? [];
}

async function* run(source: Source): AsyncGenerator<AWSEventStreamMessage> {
  // Incoming bytes are copied straight into the frame they belong to: first
  // the 12-byte prelude, then, once that says how long the frame is, a
  // buffer of exactly that size. A chunk is fully consumed before anything
  // is yielded, so a producer may recycle it as soon as we suspend.
  const prelude = new Uint8Array(PRELUDE_LENGTH);
  const preludeView = new DataView(prelude.buffer);
  let preludeFilled = 0;
  let frame: Uint8Array | undefined;
  let frameFilled = 0;
  let headersLength = 0;
  const ready: AWSEventStreamMessage[] = [];
  let failure: Error | undefined;

  for await (const raw of await chunksOf(source)) {
    const chunk = toBytes(raw);
    let pos = 0;
    try {
      while (pos < chunk.length) {
        if (frame === undefined) {
          const n = Math.min(PRELUDE_LENGTH - preludeFilled, chunk.length - pos);
          prelude.set(Uint8ArraySubarray.$call(chunk, pos, pos + n), preludeFilled);
          preludeFilled += n;
          pos += n;
          if (preludeFilled < PRELUDE_LENGTH) break;
          const totalLength = preludeView.getUint32(0);
          headersLength = preludeView.getUint32(4);
          if (crc32(Uint8ArraySubarray.$call(prelude, 0, 8)) !== preludeView.getUint32(8)) {
            throw framingError("prelude checksum mismatch");
          }
          if (
            totalLength < MIN_MESSAGE_LENGTH ||
            totalLength > MAX_MESSAGE_LENGTH ||
            headersLength > totalLength - MIN_MESSAGE_LENGTH
          ) {
            throw framingError(`bad frame lengths (${totalLength}, ${headersLength})`);
          }
          frame = new Uint8Array(totalLength);
          frame.set(prelude);
          frameFilled = PRELUDE_LENGTH;
          preludeFilled = 0;
        }
        const n = Math.min(frame.length - frameFilled, chunk.length - pos);
        frame.set(Uint8ArraySubarray.$call(chunk, pos, pos + n), frameFilled);
        frameFilled += n;
        pos += n;
        if (frameFilled < frame.length) break;
        const complete = frame;
        frame = undefined;
        ready.push(parseMessage(complete, headersLength));
      }
    } catch (e) {
      // Deliver what was decoded before the bad frame, then report it.
      failure = e as Error;
    }
    for (let i = 0; i < ready.length; i++) {
      const message = ready[i];
      const error = errorFromMessage(message);
      if (error) throw error;
      yield message;
    }
    ready.length = 0;
    if (failure) throw failure;
  }
  if (frame !== undefined || preludeFilled > 0) throw framingError("stream ended in the middle of a message");
}

function decode(source: unknown): AsyncGenerator<AWSEventStreamMessage> {
  return run(classify(source));
}

export default decode;
