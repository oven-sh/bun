// No UTF-8 text write emits 0xFF or 0xFE, so text that a test prints cannot start a frame or stand where one ends.
const kLeadByte = 0xff;
const kEndByte = 0xfe;
// Not node's 0xFF 0x0F, so a node parent does not hand one of these frames to its V8 deserializer.
const kTag = "bun:test:run";
const kPrefixLength = 1 + kTag.length;
// A frame: lead byte, tag, u32 big-endian payload length, UTF-8 JSON of { type, data }, end byte.
const kHeaderLength = kPrefixLength + 4;
// The bound of a `bun test --parallel` frame (cli/test/parallel/Frame.rs).
const kMaxPayloadLength = 64 * 1024 * 1024;
// How far an error's `cause` chain goes over the wire.
const kMaxCauseDepth = 8;
// The lead byte and "bun:". A test does not print these five by chance, and one lead byte alone is only a byte.
const kFrameStartLength = 5;

// The events a child reports. A new one also needs its shape in decodeRunEvent().
export type RunEvent = { type: "test:pass" | "test:fail"; data: Record<string, any> };

// Child side. These are taken when node:test loads in a run() child, before the file under test can replace them.
const JSONStringify = JSON.stringify;
const isError = Error.isError;
const setPrototypeOf = Object.setPrototypeOf;
const arraySlice = Array.prototype.slice;
const typedArraySet = Uint8Array.prototype.set;
const encode = TextEncoder.prototype.encode;
const encoder = new TextEncoder();
const kTagBytes: Uint8Array = encode.$call(encoder, kTag);
const { writeSync } = require("node:fs");
const { sleepSync } = Bun;
const printError = console.error;
const thisProcess = process;

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
    if (isError(error)) {
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

// The UTF-8 JSON of a value, or the reason it has none that fits a frame.
function encodeJSON(value: unknown): Uint8Array | string {
  let bytes: Uint8Array;
  try {
    bytes = encode.$call(encoder, JSONStringify(value));
  } catch {
    return "it has no JSON form";
  }
  return bytes.length > kMaxPayloadLength ? `it is larger than ${kMaxPayloadLength >> 20} MiB` : bytes;
}

// The payload of an event, or the reason it has none.
function encodeRunEvent(type: RunEvent["type"], data: Record<string, unknown>) {
  // No prototype, like `data` and its errors: a toJSON that the file under test put on every object does not apply.
  return encodeJSON({ __proto__: null, type, data });
}

// null: process.stdout is not the stream of fd 1 (the file replaced it, or this is a worker thread).
let stdoutSink: import("bun").FileSink | null | undefined;
let notSentNoted = false;

// Says on stderr, once, why a verdict did not go out.
function verdictNotSent(name: unknown, why: unknown) {
  if (notSentNoted) return;
  notSentNoted = true;
  const shown = typeof name === "string" && name.length <= 200 ? JSONStringify(name) : "";
  try {
    printError(`node:test: the result of test ${shown} was not reported to run():`, why);
  } catch {
    // The note is a courtesy, and `why` is a value of the file under test.
  }
}

function sendRunEvent(type: RunEvent["type"], data: Record<string, unknown>) {
  // A copy without a prototype: a toJSON on every array does not apply to it.
  if (data.tags !== undefined) data.tags = setPrototypeOf(arraySlice.$call(data.tags), null);
  let payload = encodeRunEvent(type, data);
  if (typeof payload === "string") {
    // The label and the error come from the file under test. The verdict goes out without the one that cannot be sent.
    const label = data.expectFailure;
    if (label !== undefined && label !== true && typeof encodeJSON(label) === "string") {
      data = { __proto__: null, ...data, expectFailure: true };
      payload = encodeRunEvent(type, data);
    }
    if (typeof payload === "string" && data.error !== undefined) {
      payload = encodeRunEvent(type, { __proto__: null, ...data, error: standInError(payload) });
    }
    if (typeof payload === "string") return verdictNotSent(data.name, payload);
  }

  const { length } = payload;
  const frame = new Uint8Array(kHeaderLength + length + 1);
  frame[0] = kLeadByte;
  typedArraySet.$call(frame, kTagBytes, 1);
  frame[kPrefixLength] = length >>> 24;
  frame[kPrefixLength + 1] = (length >>> 16) & 0xff;
  frame[kPrefixLength + 2] = (length >>> 8) & 0xff;
  frame[kPrefixLength + 3] = length & 0xff;
  typedArraySet.$call(frame, payload, kHeaderLength);
  frame[kHeaderLength + length] = kEndByte;

  let sink = stdoutSink;
  if (sink === undefined) {
    const stream = thisProcess.stdout as unknown as { _isStdio?: boolean; fd?: number } & Record<symbol, unknown>;
    // The file can put another stream in place of process.stdout, also one with a sink of its own.
    const found =
      stream._isStdio === true && stream.fd === 1
        ? stream[require("internal/fs/streams").kWriteStreamFastPath]
        : undefined;
    sink = stdoutSink = typeof found === "object" && found !== null ? (found as import("bun").FileSink) : null;
  }
  if (sink !== null) {
    // Through the queue of process.stdout, so that the frame stays behind what that has queued.
    const pending = sink.write(frame);
    if ($isPromise(pending)) pending.$then(undefined, (err: unknown) => verdictNotSent(data.name, err));
    return;
  }
  for (let offset = 0; offset < frame.length;) {
    try {
      offset += writeSync(1, frame, offset);
    } catch (err) {
      // fd 1 does not block once process.stdout existed. Wait for the parent to read, so the frame goes out whole.
      if ((err as { code?: string })?.code !== "EAGAIN") throw err;
      sleepSync(1);
    }
  }
}

// Sends one event. Nothing that goes wrong here ends the test it reports.
function writeRunFrame(type: RunEvent["type"], data: Record<string, unknown>) {
  try {
    // Before the write: the file cannot end green when its process exits, with no code, before the frame is out.
    if (type === "test:fail" && !data.todo && !data.skip) thisProcess.exitCode ||= 1;
    sendRunEvent(type, data);
  } catch (err) {
    verdictNotSent(data.name, err);
  }
}

// Parent side. The Error of a serialized error, or undefined when serializeRunError() did not write it.
function rebuildError(serialized: unknown, depth: number): Error | undefined {
  if (typeof serialized !== "object" || serialized === null || $isArray(serialized)) return undefined;
  Object.setPrototypeOf(serialized, null);
  const { message, stack, name, code, failureType, cause } = serialized as Record<string, any>;
  // Error() throws on a `message` object that has no string form.
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

// The event of a payload, or undefined when the child side did not write it. node republishes any `type` (runner.js:321).
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

// Splits stdout into lines of text, events, and frames that began and are not whole (a lost verdict: onDamaged).
function createRunOutputDecoder(
  onText: (message: string) => void,
  onEvent: (event: RunEvent) => void,
  onDamaged: () => void,
) {
  // ignoreBOM: closeLine() restarts this decoder, which would otherwise drop a U+FEFF after each event.
  const textDecoder = new TextDecoder("utf-8", { ignoreBOM: true });
  const payloadDecoder = new TextDecoder("utf-8", { fatal: true });
  // Decoded text after the last "\n".
  let line = "";
  // The chunks of a frame that has started and is not all here, their length, and the length that decides it.
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
    // A character that the bytes before an event left unfinished ends here as U+FFFD, not with the bytes after it.
    line += textDecoder.decode();
    if (line.length === 0) return;
    const message = line + "\n";
    line = "";
    onText(message);
  }

  // Bytes that are not a frame are text. The scan goes on right after their lead byte, so they hide no real frame.
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
      while (i < prefix && bytes[lead + i] === kTagBytes[i - 1]) i++;
      if (i < prefix) {
        // Other bytes where the tag goes on: a frame that began here was cut.
        if (i >= kFrameStartLength) onDamaged();
        continue;
      }
      if (available < kHeaderLength) {
        if (ended) {
          if (available >= kFrameStartLength) onDamaged();
          continue;
        }
        // A header that is not all here is looked at again with the next byte.
        if (lead > textStart) text(bytes.subarray(textStart, lead));
        pending = [bytes.subarray(lead)];
        pendingLength = available;
        pendingNeeds = available + 1;
        return;
      }
      const at = lead + kPrefixLength;
      const length = ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
      // The child writes no such length: other bytes stand in the length field.
      if (length > kMaxPayloadLength) {
        onDamaged();
        continue;
      }
      const payloadStart = lead + kHeaderLength;
      const needs = kHeaderLength + length + 1;
      // A lead byte inside means the frame was cut, whether or not the rest of it is here yet.
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
        onDamaged();
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
        // The open frame is decided when all of it is here, or when a lead byte shows that it was cut.
        if (pendingLength < pendingNeeds && chunk.indexOf(kLeadByte) === -1) return;
        chunk = takePending();
      }
      scan(chunk, false);
    },
    end() {
      if (pending !== undefined) scan(takePending(), true);
      closeLine();
    },
  };
}

export default { createRunOutputDecoder, serializeRunError, writeRunFrame };
