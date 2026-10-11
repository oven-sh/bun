// The wire between a node:test run() child and the run() that spawned it.
//
// The child reports each finished test in-band on stdout, the pipe its own
// output travels on, like node's v8-serializer reporter. One event is one frame:
//
//   0xFF "bun:test:run" <u32 big-endian payload length> <payload> 0xFE
//
// and the payload is the UTF-8 JSON of { type, data }. The child builds and
// writes it in jsNodeTestWriteRunFrame (jest.rs). The parent finds frames in
// the raw stdout bytes, before any text decoding. No UTF-8 encoder emits 0xFF
// or 0xFE, so text a test prints can neither start a frame nor stand where one
// ends, and every byte outside a frame is test:stdout. node splits the same
// way (runner.js FileTest.parseMessage) around the V8 serializer header
// 0xFF 0x0F; the tag keeps a node parent from handing one of these frames to
// its V8 deserializer.

const kLeadByte = 0xff;
const kEndByte = 0xfe;
const kTag = "bun:test:run";
const kPrefixLength = 1 + kTag.length;
const kHeaderLength = kPrefixLength + 4;
// Every payload the child writes starts with this.
const kPayloadStart = '{"type":"test:';
// The bound of a `bun test --parallel` frame (cli/test/parallel/Frame.rs). The
// child does not write a longer payload (RUN_FRAME_MAX_PAYLOAD in jest.rs).
const kMaxPayloadLength = 64 * 1024 * 1024;
// How far an error's `cause` chain goes over the wire.
const kMaxCauseDepth = 8;

type RunEvent = { type: "test:pass" | "test:fail"; data: Record<string, any> };

// -----------------------------------------------------------------------------
// Child side
// -----------------------------------------------------------------------------

type WriteFrame = (event: { type: string; data: Record<string, unknown> }, stdoutSink: unknown) => boolean;

let writeFrame: WriteFrame | undefined;
let stdoutSink: unknown;

// What the parent gets in place of an error the child could not read or encode.
function standInError(why: string) {
  return {
    __proto__: null,
    message: `The error of this test could not be reported: ${why}`,
    code: "ERR_TEST_FAILURE",
    failureType: "testCodeFailure",
    name: "Error",
  };
}

// Errors cross the process boundary as plain JSON; the parent rebuilds an Error.
function serializeRunError(error: unknown, depth = 0) {
  try {
    if (Error.isError(error)) {
      const cause = (error as { cause?: unknown }).cause;
      return {
        __proto__: null,
        message: (error as Error).message,
        stack: (error as Error).stack,
        code: (error as { code?: string }).code,
        failureType: (error as { failureType?: string }).failureType,
        name: (error as Error).name,
        cause: cause !== undefined && depth < kMaxCauseDepth ? serializeRunError(cause, depth + 1) : undefined,
      };
    }
    return { __proto__: null, message: String(error), stack: undefined, code: undefined, name: "Error" };
  } catch {
    return standInError("reading it threw");
  }
}

function writeRunFrame(type: string, data: Record<string, unknown>) {
  if (writeFrame === undefined) {
    writeFrame = $newRustFunction("jest.rs", "jsNodeTestWriteRunFrame", 2) as WriteFrame;
    try {
      stdoutSink = process.stdout[require("internal/fs/streams").kWriteStreamFastPath];
    } catch {}
  }
  let why = `it is larger than ${kMaxPayloadLength >> 20} MiB`;
  try {
    if (writeFrame({ type, data }, stdoutSink)) return;
  } catch {
    why = "it has no JSON form";
  }
  if (data.error === undefined) return;
  // An error can be that large or hold a value JSON cannot: the verdict goes
  // out again without it. What is left that JSON cannot hold is a name or an
  // expectFailure label; the exit code then fails the file.
  try {
    writeFrame({ type, data: { ...data, error: standInError(why) } }, stdoutSink);
  } catch {}
}

// -----------------------------------------------------------------------------
// Parent side
// -----------------------------------------------------------------------------

// The Error a serialized error stands for, or undefined when it is not one
// serializeRunError() writes.
function rebuildError(serialized: unknown, depth: number): Error | undefined {
  if (typeof serialized !== "object" || serialized === null || $isArray(serialized)) return undefined;
  Object.setPrototypeOf(serialized, null);
  const { message, stack, name, code, failureType, cause } = serialized as Record<string, any>;
  // A test can fail with an error whose `message` is an object, and Error()
  // throws on one that has no string form.
  const messageIsObject = typeof message === "object" && message !== null;
  const error = new Error(messageIsObject ? undefined : message);
  if (messageIsObject) error.message = message;
  error.stack = stack;
  if (name !== undefined && name !== "Error") error.name = name;
  if (code !== undefined) (error as any).code = code;
  if (failureType !== undefined) (error as any).failureType = failureType;
  if (cause !== undefined && depth < kMaxCauseDepth) {
    const rebuiltCause = rebuildError(cause, depth + 1);
    if (rebuiltCause === undefined) return undefined;
    error.cause = rebuiltCause;
  }
  return error;
}

// The event in a frame's payload, with its error rebuilt, or undefined when the
// payload is not one the child side writes. A test can write bytes to stdout,
// so this is stricter than node, which republishes whatever `type` a frame
// names (runner.js:321).
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
  // From here on every field is read as an own property.
  Object.setPrototypeOf(data, null);
  const { nesting, error } = data;
  if (nesting !== undefined && typeof nesting !== "number") return undefined;
  if (error !== undefined) {
    const rebuilt = rebuildError(error, 0);
    if (rebuilt === undefined) return undefined;
    data.error = rebuilt;
  }
  return event;
}

// Splits a run() child's stdout into events and printed text. `onText` gets one
// line at a time; a line the child left open is closed before the next event,
// so a test's output stays ahead of its verdict. `onDamaged` is told of each
// frame that began like one of the child's and does not end where its length
// says: another writer of the same stdout printed inside it, or the child ended
// while writing it, and its verdict is lost.
function createRunOutputDecoder(
  onText: (message: string) => void,
  onEvent: (event: RunEvent) => void,
  onDamaged: () => void,
) {
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

  function startsLikePayload(bytes: Uint8Array, at: number) {
    const end = at + kPayloadStart.length < bytes.length ? at + kPayloadStart.length : bytes.length;
    for (let i = at; i < end; i++) {
      if (bytes[i] !== kPayloadStart.charCodeAt(i - at)) return false;
    }
    return true;
  }

  // Bytes that look like a frame and are not one are text. The scan goes on
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
      if (available < kHeaderLength) {
        if (ended) continue;
        // A header that is not all here is looked at again with the next byte.
        if (lead > textStart) text(bytes.subarray(textStart, lead));
        pending = [bytes.subarray(lead)];
        pendingLength = available;
        pendingNeeds = available + 1;
        return;
      }
      const at = lead + kPrefixLength;
      const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
      if (length > kMaxPayloadLength) continue;
      const payloadStart = lead + kHeaderLength;
      const needs = kHeaderLength + length + 1;
      // Neither a payload nor the end byte is a lead byte: one inside the
      // frame means it was cut, whether or not the rest of it is here yet.
      const inside = bytes.indexOf(kLeadByte, payloadStart);
      const cut = inside !== -1 && inside < lead + needs;
      if (!cut && available < needs && !ended) {
        if (lead > textStart) text(bytes.subarray(textStart, lead));
        pending = [bytes.subarray(lead)];
        pendingLength = available;
        pendingNeeds = needs;
        return;
      }
      if (cut || available < needs || bytes[lead + needs - 1] !== kEndByte) {
        if (startsLikePayload(bytes, payloadStart)) onDamaged();
        continue;
      }
      const event = decodeRunEvent(payloadDecoder, bytes.subarray(payloadStart, lead + needs - 1));
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
        $arrayPush(pending, chunk);
        pendingLength += chunk.length;
        // The open frame is decided when all of it is here, or when a lead
        // byte shows that it was cut. Until then its chunks are only kept.
        if (pendingLength < pendingNeeds && chunk.indexOf(kLeadByte) === -1) return;
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

export default { createRunOutputDecoder, serializeRunError, writeRunFrame };
