// The wire between a node:test run() child and the run() that spawned it.
//
// The child reports each finished test in-band on stdout, the pipe its own
// output travels on, like node's v8-serializer reporter. One event is one frame:
//
//   0xFF "bun:test:run" <u32 big-endian payload length> <payload>
//
// and the payload is the UTF-8 JSON of { type, data }. The parent finds frames
// in the raw stdout bytes, before any text decoding. No UTF-8 encoder emits
// 0xFF, so text a test prints cannot start a frame, and the length says where a
// frame ends, so text printed next to one cannot end it. Every byte outside a
// frame is test:stdout. node splits the same way (runner.js
// FileTest.parseMessage) around the V8 serializer header 0xFF 0x0F; the tag
// keeps a node parent from handing one of these frames to its V8 deserializer.

const kLeadByte = 0xff;
const kTag = "bun:test:run";
const kPrefixLength = 1 + kTag.length;
const kHeaderLength = kPrefixLength + 4;
// The bound of a `bun test --parallel` frame (cli/test/parallel/Frame.rs).
const kMaxPayloadLength = 64 * 1024 * 1024;

type RunEvent = { type: "test:pass" | "test:fail"; data: Record<string, any> };

// -----------------------------------------------------------------------------
// Child side
// -----------------------------------------------------------------------------

type WriteFrame = (frame: Uint8Array, stdoutSink: unknown) => void;

let encoder: TextEncoder | undefined;
let writeFrame: WriteFrame | undefined;
let stdoutSink: unknown;

// Only an error is unbounded. The parent takes a longer frame for text, so the
// verdict goes out with a short stand-in.
function truncateError(error: Record<string, unknown>) {
  const { message, name, code, failureType } = error;
  return {
    message: `${String(message).slice(0, 1024)}... (the error is too large to report)`,
    name,
    code,
    failureType,
  };
}

function encodeRunFrame(type: string, data: Record<string, unknown>): Uint8Array | undefined {
  encoder ??= new TextEncoder();
  let payload = encoder.encode(JSON.stringify({ type, data }));
  let { length } = payload;
  if (length > kMaxPayloadLength) {
    const { error } = data;
    if (typeof error !== "object" || error === null) return undefined;
    payload = encoder.encode(
      JSON.stringify({ type, data: { ...data, error: truncateError(error as Record<string, unknown>) } }),
    );
    ({ length } = payload);
    if (length > kMaxPayloadLength) return undefined;
  }
  const frame = new Uint8Array(kHeaderLength + length);
  frame[0] = kLeadByte;
  for (let i = 0; i < kTag.length; i++) frame[i + 1] = kTag.charCodeAt(i);
  frame[kPrefixLength] = length >>> 24;
  frame[kPrefixLength + 1] = (length >>> 16) & 0xff;
  frame[kPrefixLength + 2] = (length >>> 8) & 0xff;
  frame[kPrefixLength + 3] = length & 0xff;
  frame.set(payload, kHeaderLength);
  return frame;
}

// console.* writes fd 1 directly and process.stdout queues what the pipe does
// not take at once, so a frame sent through process.stdout.write() can sit half
// written while a console.log() lands inside it. The frame is written the way
// console.log() writes, all of it before the call returns, after anything
// process.stdout still has queued.
function writeRunFrame(type: string, data: Record<string, unknown>) {
  const frame = encodeRunFrame(type, data);
  if (frame === undefined) return;
  if (writeFrame === undefined) {
    writeFrame = $newRustFunction("jest.rs", "jsNodeTestWriteRunFrame", 2) as WriteFrame;
    try {
      stdoutSink = process.stdout[require("internal/fs/streams").kWriteStreamFastPath];
    } catch {}
  }
  writeFrame(frame, stdoutSink);
}

// -----------------------------------------------------------------------------
// Parent side
// -----------------------------------------------------------------------------

// rebuildError() in node:test follows `cause` this deep.
const kMaxCauseDepth = 8;

function isSerializedError(error: unknown, depth: number): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { cause } = error as { cause?: unknown };
  return cause === undefined || depth >= kMaxCauseDepth || isSerializedError(cause, depth + 1);
}

// The event in a frame's payload, or undefined when the payload is not one the
// child side above writes. A test can write bytes to stdout, so this is
// stricter than node, which republishes whatever `type` a frame names
// (runner.js:321) and throws on a frame it cannot deserialize.
function decodeRunEvent(decoder: TextDecoder, payload: Uint8Array): RunEvent | undefined {
  let event;
  try {
    event = JSON.parse(decoder.decode(payload));
  } catch {
    return undefined;
  }
  if (typeof event !== "object" || event === null) return undefined;
  const { type, data } = event;
  if (type !== "test:pass" && type !== "test:fail") return undefined;
  if (typeof data !== "object" || data === null || $isArray(data)) return undefined;
  const { nesting, error } = data;
  if (nesting !== undefined && typeof nesting !== "number") return undefined;
  if (error !== undefined && !isSerializedError(error, 0)) return undefined;
  return event;
}

// Splits a run() child's stdout into events and printed text. `onText` gets one
// line at a time; a line the child left open is closed before the next event,
// so a test's output stays ahead of its verdict.
function createRunOutputDecoder(onText: (message: string) => void, onEvent: (event: RunEvent) => void) {
  const textDecoder = new TextDecoder();
  const payloadDecoder = new TextDecoder("utf-8", { fatal: true });
  // Decoded text after the last "\n".
  let line = "";
  // A frame that has started and is not all here: its chunks (the first byte
  // is the lead byte), their length, and the length that decides it.
  let pending: Uint8Array[] | undefined;
  let pendingLength = 0;
  let pendingNeeds = 0;

  function text(bytes: Uint8Array) {
    const decoded = textDecoder.decode(bytes, { stream: true });
    let newline = decoded.indexOf("\n");
    if (newline === -1) {
      line += decoded;
      return;
    }
    // The open line ends at the first "\n" of this text.
    const first = line + decoded.slice(0, newline + 1);
    if (first.length > 1) onText(first);
    let start = newline + 1;
    while ((newline = decoded.indexOf("\n", start)) !== -1) {
      if (newline > start) onText(decoded.slice(start, newline + 1));
      start = newline + 1;
    }
    line = decoded.slice(start);
  }

  function closeLine() {
    if (line.length === 0) return;
    const message = line + "\n";
    line = "";
    onText(message);
  }

  // Bytes that look like a frame and are not one (cut off, longer than the
  // bound, or a payload the child does not write) are text. The scan goes on
  // right after their lead byte, so they cannot hide a real frame behind them.
  function scan(bytes: Uint8Array, ended: boolean) {
    let textStart = 0;
    let from = 0;
    for (;;) {
      const lead = bytes.indexOf(kLeadByte, from);
      if (lead === -1) break;
      from = lead + 1;
      const available = bytes.length - lead;
      const prefix = available < kPrefixLength ? available : kPrefixLength;
      let i = 1;
      while (i < prefix && bytes[lead + i] === kTag.charCodeAt(i - 1)) i++;
      if (i < prefix) continue;
      // A header that is not all here is looked at again with the next byte.
      let needs = available + 1;
      if (available >= kHeaderLength) {
        const at = lead + kPrefixLength;
        const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
        if (length > kMaxPayloadLength) continue;
        needs = kHeaderLength + length;
      }
      if (available < needs) {
        if (ended) continue;
        if (lead > textStart) text(bytes.subarray(textStart, lead));
        pending = [bytes.subarray(lead)];
        pendingLength = available;
        pendingNeeds = needs;
        return;
      }
      const event = decodeRunEvent(payloadDecoder, bytes.subarray(lead + kHeaderLength, lead + needs));
      if (event === undefined) continue;
      if (lead > textStart) text(bytes.subarray(textStart, lead));
      closeLine();
      onEvent(event);
      textStart = from = lead + needs;
    }
    if (textStart < bytes.length) text(bytes.subarray(textStart));
  }

  function takePending() {
    const chunks = pending!;
    pending = undefined;
    if (chunks.length === 1) return chunks[0];
    const bytes = new Uint8Array(pendingLength);
    let offset = 0;
    for (let i = 0; i < chunks.length; i++) {
      bytes.set(chunks[i], offset);
      offset += chunks[i].length;
    }
    return bytes;
  }

  return {
    write(chunk: Uint8Array) {
      if (pending !== undefined) {
        // Chunks of an open frame are kept as they come and joined once.
        $arrayPush(pending, chunk);
        pendingLength += chunk.length;
        if (pendingLength < pendingNeeds) return;
        chunk = takePending();
      }
      scan(chunk, false);
    },
    end() {
      if (pending !== undefined) scan(takePending(), true);
      line += textDecoder.decode();
      closeLine();
    },
  };
}

export default { createRunOutputDecoder, encodeRunFrame, writeRunFrame };
