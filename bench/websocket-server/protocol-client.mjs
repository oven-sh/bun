import { createHash, randomBytes, randomFillSync } from "node:crypto";
import { writeSync } from "node:fs";
import http2 from "node:http2";
import net from "node:net";

const PROTOCOL = process.env.PROTOCOL ?? "h1";
const WORKLOAD = process.env.WORKLOAD ?? "echo";
const PORT = Number(process.env.PORT);
const STREAMS = Number(process.env.STREAMS ?? 8);
const SESSIONS = Number(process.env.SESSIONS ?? STREAMS);
const PAYLOAD_SIZE = Number(process.env.PAYLOAD_SIZE ?? 16);
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 2_000);
const DURATION_MS = Number(process.env.DURATION_MS ?? 5_000);
const H2_STREAM_WINDOW_SIZE = Number(process.env.H2_STREAM_WINDOW_SIZE ?? 16 * 1024 * 1024);
const H2_CONNECTION_WINDOW_SIZE = Number(process.env.H2_CONNECTION_WINDOW_SIZE ?? 64 * 1024 * 1024);
const H1_CLIENT = process.env.H1_CLIENT ?? "raw";
const PIPELINE_DEPTH = Number(process.env.PIPELINE_DEPTH ?? 1);
const MAX_INFLIGHT_PAYLOAD_BYTES_PER_SOCKET = Number(process.env.MAX_INFLIGHT_PAYLOAD_BYTES_PER_SOCKET ?? 128 * 1024);

if (!Number.isInteger(PORT) || PORT < 1) throw new Error(`invalid PORT: ${process.env.PORT}`);
if (!Number.isInteger(STREAMS) || STREAMS < 1) throw new Error(`invalid STREAMS: ${STREAMS}`);
if (!Number.isInteger(SESSIONS) || SESSIONS < 1 || SESSIONS > STREAMS) {
  throw new Error(`SESSIONS must be between 1 and STREAMS: ${SESSIONS}`);
}
if (!Number.isInteger(PAYLOAD_SIZE) || PAYLOAD_SIZE < 16 || PAYLOAD_SIZE > 1024 * 1024) {
  throw new Error(`PAYLOAD_SIZE must be between 16 and 1048576: ${PAYLOAD_SIZE}`);
}
for (const [name, value] of [
  ["H2_STREAM_WINDOW_SIZE", H2_STREAM_WINDOW_SIZE],
  ["H2_CONNECTION_WINDOW_SIZE", H2_CONNECTION_WINDOW_SIZE],
]) {
  if (!Number.isInteger(value) || value < 65_535 || value > 0x7fffffff) {
    throw new Error(`${name} must be an integer between 65535 and 2147483647: ${value}`);
  }
}
if (PROTOCOL !== "h1" && PROTOCOL !== "h2") throw new Error(`invalid PROTOCOL: ${PROTOCOL}`);
if (WORKLOAD !== "echo" && WORKLOAD !== "pubsub-self") throw new Error(`invalid WORKLOAD: ${WORKLOAD}`);
if (H1_CLIENT !== "raw" && H1_CLIENT !== "ws") throw new Error(`invalid H1_CLIENT: ${H1_CLIENT}`);
if (!Number.isInteger(PIPELINE_DEPTH) || PIPELINE_DEPTH < 1) {
  throw new Error(`PIPELINE_DEPTH must be a positive integer: ${PIPELINE_DEPTH}`);
}
if (!Number.isInteger(MAX_INFLIGHT_PAYLOAD_BYTES_PER_SOCKET) || MAX_INFLIGHT_PAYLOAD_BYTES_PER_SOCKET < PAYLOAD_SIZE) {
  throw new Error(
    `MAX_INFLIGHT_PAYLOAD_BYTES_PER_SOCKET must be an integer >= PAYLOAD_SIZE: ${MAX_INFLIGHT_PAYLOAD_BYTES_PER_SOCKET}`,
  );
}

const effectivePipelineDepth = Math.min(
  PIPELINE_DEPTH,
  Math.floor(MAX_INFLIGHT_PAYLOAD_BYTES_PER_SOCKET / PAYLOAD_SIZE),
);
const NativeWebSocket = H1_CLIENT === "ws" ? (await import("ws")).WebSocket : null;

function benchmarkPath(id) {
  return WORKLOAD === "pubsub-self" ? `/bench?topic=${process.pid}-${id}` : "/bench";
}

class ByteQueue {
  chunks = [];
  index = 0;
  offset = 0;
  length = 0;

  push(chunk) {
    if (chunk.length === 0) return;
    this.chunks.push(chunk);
    this.length += chunk.length;
  }

  read(length) {
    if (this.length < length) return;
    const first = this.chunks[this.index];
    if (first.length - this.offset >= length) {
      const result = first.subarray(this.offset, this.offset + length);
      this.offset += length;
      this.length -= length;
      if (this.offset === first.length) {
        this.index++;
        this.offset = 0;
        if (this.index === this.chunks.length) {
          this.chunks.length = 0;
          this.index = 0;
        }
      }
      return result;
    }

    const result = Buffer.allocUnsafe(length);
    let written = 0;
    while (written < length) {
      const chunk = this.chunks[this.index];
      const available = chunk.length - this.offset;
      const take = Math.min(available, length - written);
      chunk.copy(result, written, this.offset, this.offset + take);
      written += take;
      this.offset += take;
      this.length -= take;
      if (this.offset === chunk.length) {
        this.index++;
        this.offset = 0;
      }
    }
    if (this.index === this.chunks.length) {
      this.chunks.length = 0;
      this.index = 0;
    } else if (this.index > 32 && this.index * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.index);
      this.index = 0;
    }
    return result;
  }
}

class ServerFrameParser {
  queue = new ByteQueue();
  header;

  constructor(onFrame) {
    this.onFrame = onFrame;
  }

  push(chunk) {
    this.queue.push(chunk);
    while (true) {
      if (!this.header) {
        const prefix = this.queue.read(2);
        if (!prefix) return;
        if (prefix[1] & 0x80) throw new Error("server sent a masked WebSocket frame");
        this.header = {
          fin: Boolean(prefix[0] & 0x80),
          rsv: prefix[0] & 0x70,
          opcode: prefix[0] & 0x0f,
          length: prefix[1] & 0x7f,
          extended: prefix[1] & 0x7f,
        };
      }

      if (this.header.extended === 126) {
        const extended = this.queue.read(2);
        if (!extended) return;
        this.header.length = extended.readUInt16BE();
        this.header.extended = 0;
      } else if (this.header.extended === 127) {
        const extended = this.queue.read(8);
        if (!extended) return;
        const length = extended.readBigUInt64BE();
        if (length > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`server frame is too large: ${length}`);
        this.header.length = Number(length);
        this.header.extended = 0;
      } else {
        this.header.extended = 0;
      }

      if (this.header.length !== PAYLOAD_SIZE) {
        throw new Error(`unexpected server frame length: ${this.header.length}, expected ${PAYLOAD_SIZE}`);
      }

      const payload = this.queue.read(this.header.length);
      if (!payload) return;
      const header = this.header;
      this.header = undefined;
      if (!header.fin || header.rsv !== 0 || header.opcode !== 2) {
        throw new Error(`unexpected server frame: ${JSON.stringify(header)}`);
      }
      this.onFrame(payload);
    }
  }
}

function makePayload(streamId) {
  const payload = Buffer.alloc(PAYLOAD_SIZE);
  payload.writeBigUInt64BE(BigInt(streamId), 0);
  for (let i = 16; i < payload.length; i++) payload[i] = (streamId * 31 + i) & 0xff;
  return payload;
}

function makeClientFrame(payload) {
  const extended = payload.length < 126 ? 0 : payload.length <= 0xffff ? 2 : 8;
  const frame = Buffer.allocUnsafe(2 + extended + 4 + payload.length);
  frame[0] = 0x82;
  let maskOffset;
  if (extended === 0) {
    frame[1] = 0x80 | payload.length;
    maskOffset = 2;
  } else if (extended === 2) {
    frame[1] = 0x80 | 126;
    frame.writeUInt16BE(payload.length, 2);
    maskOffset = 4;
  } else {
    frame[1] = 0x80 | 127;
    frame.writeBigUInt64BE(BigInt(payload.length), 2);
    maskOffset = 10;
  }
  const mask = frame.subarray(maskOffset, maskOffset + 4);
  randomFillSync(mask);
  for (let i = 0; i < payload.length; i++) frame[maskOffset + 4 + i] = payload[i] ^ mask[i & 3];
  return frame;
}

let phase = "setup";
let measuredMessages = 0;
let measuredBytes = 0;
let pending = 0;
let settleMeasurement;
const closed = [];

function makeLogicalStream(id, send, close) {
  const payload = makePayload(id);
  let sequence = 0n;
  let currentMeasured = false;

  return {
    close,
    start() {
      this.sendNext();
    },
    sendNext() {
      if (phase === "stopped") return;
      sequence++;
      payload.writeBigUInt64BE(sequence, 8);
      currentMeasured = phase === "measure";
      pending++;
      send(payload);
    },
    receive(actual) {
      if (!actual.equals(payload)) {
        throw new Error(
          `echo mismatch on stream ${id}, sequence ${sequence}: expected ${payload.toString("hex", 0, 24)}, got ${actual.toString("hex", 0, 24)}`,
        );
      }
      pending--;
      if (currentMeasured && phase !== "stopped") {
        measuredMessages++;
        measuredBytes += actual.length;
      }
      if (phase === "stopped") {
        if (pending === 0) settleMeasurement?.();
      } else {
        this.sendNext();
      }
    },
  };
}

async function openH1(id) {
  const socket = net.connect({ host: "127.0.0.1", port: PORT });
  socket.setNoDelay(true);
  const key = randomBytes(16).toString("base64");
  const expectedAccept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  let logical;
  let handshake = Buffer.alloc(0);
  let postUpgradeData;
  let upgraded = false;
  const parser = new ServerFrameParser(payload => logical.receive(payload));
  const opened = new Promise((resolve, reject) => {
    socket.once("connect", () => {
      socket.write(
        `GET ${benchmarkPath(id)} HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${PORT}\r\n` +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          `Sec-WebSocket-Key: ${key}\r\n` +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );
    });
    socket.once("error", reject);
    socket.on("data", chunk => {
      if (upgraded) {
        parser.push(chunk);
        return;
      }
      if (handshake.length + chunk.length > 16 * 1024) {
        reject(new Error(`H1 WebSocket ${id} returned oversized upgrade headers`));
        socket.destroy();
        return;
      }
      handshake = Buffer.concat([handshake, chunk]);
      const headerEnd = handshake.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;
      const lines = handshake.subarray(0, headerEnd).toString("latin1").split("\r\n");
      if (!/^HTTP\/1\.1 101(?: |$)/.test(lines.shift() ?? "")) {
        reject(new Error(`H1 WebSocket ${id} upgrade failed: ${lines.join(" | ")}`));
        socket.destroy();
        return;
      }
      const headers = new Map();
      for (const line of lines) {
        const colon = line.indexOf(":");
        if (colon <= 0) {
          reject(new Error(`H1 WebSocket ${id} returned a malformed header: ${JSON.stringify(line)}`));
          socket.destroy();
          return;
        }
        headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
      }
      if (headers.get("upgrade")?.toLowerCase() !== "websocket") {
        reject(new Error(`H1 WebSocket ${id} returned an invalid Upgrade header`));
        socket.destroy();
        return;
      }
      const connectionTokens = (headers.get("connection") ?? "").split(",").map(token => token.trim().toLowerCase());
      if (!connectionTokens.includes("upgrade")) {
        reject(new Error(`H1 WebSocket ${id} returned an invalid Connection header`));
        socket.destroy();
        return;
      }
      if (headers.get("sec-websocket-accept") !== expectedAccept) {
        reject(new Error(`H1 WebSocket ${id} returned an invalid Sec-WebSocket-Accept`));
        socket.destroy();
        return;
      }
      upgraded = true;
      postUpgradeData = handshake.subarray(headerEnd + 4);
      handshake = Buffer.alloc(0);
      resolve();
    });
  });
  socket.on("error", error => {
    if (phase !== "stopped") throw error;
  });
  socket.on("close", () => {
    if (phase !== "stopped") throw new Error(`H1 WebSocket ${id} closed early`);
  });
  await opened;
  logical = makeLogicalStream(
    id,
    payload => socket.write(makeClientFrame(payload)),
    () => socket.destroy(),
  );
  if (postUpgradeData.length !== 0) parser.push(postUpgradeData);
  return logical;
}

async function openH1WithWs(id) {
  const payload = makePayload(id);
  const measuredQueue = [];
  const websocket = new NativeWebSocket(`ws://127.0.0.1:${PORT}${benchmarkPath(id)}`, {
    perMessageDeflate: false,
    maxPayload: PAYLOAD_SIZE,
    skipUTF8Validation: true,
  });
  await new Promise((resolve, reject) => {
    websocket.once("open", resolve);
    websocket.once("error", reject);
  });

  const logical = {
    close() {
      websocket.terminate();
    },
    start() {
      for (let i = 0; i < effectivePipelineDepth; i++) this.sendNext();
    },
    sendNext() {
      if (phase === "stopped") return;
      measuredQueue.push(phase === "measure");
      pending++;
      websocket.send(payload, { binary: true, compress: false }, error => {
        if (error && phase !== "stopped") throw error;
      });
    },
    receive(actual, isBinary) {
      if (!isBinary) throw new Error(`H1 WebSocket ${id} returned a text message`);
      if (!Buffer.isBuffer(actual)) actual = Buffer.from(actual);
      if (!actual.equals(payload)) {
        throw new Error(
          `echo mismatch on stream ${id}: expected ${payload.toString("hex", 0, 24)}, got ${actual.toString("hex", 0, 24)}`,
        );
      }
      const wasMeasured = measuredQueue.shift();
      if (wasMeasured === undefined) throw new Error(`unexpected echo on H1 WebSocket ${id}`);
      pending--;
      if (wasMeasured && phase !== "stopped") {
        measuredMessages++;
        measuredBytes += actual.length;
      }
      if (phase === "stopped") {
        if (pending === 0) settleMeasurement?.();
      } else {
        this.sendNext();
      }
    },
  };
  websocket.on("message", (data, isBinary) => logical.receive(data, isBinary));
  websocket.on("error", error => {
    if (phase !== "stopped") throw error;
  });
  websocket.on("close", () => {
    if (phase !== "stopped") throw new Error(`H1 WebSocket ${id} closed early`);
  });
  return logical;
}

async function openH2Session(index) {
  const session = http2.connect(`http://127.0.0.1:${PORT}`, {
    settings: {
      enableConnectProtocol: true,
      initialWindowSize: H2_STREAM_WINDOW_SIZE,
    },
  });
  const settings = await new Promise((resolve, reject) => {
    session.once("remoteSettings", resolve);
    session.once("error", reject);
  });
  if (!settings.enableConnectProtocol) {
    session.destroy();
    throw new Error(`H2 session ${index} did not receive SETTINGS_ENABLE_CONNECT_PROTOCOL=1`);
  }
  // Keep the benchmark from measuring Node's default 64 KiB receive windows.
  // RFC 8441 multiplexes multiple tunnels through one connection window, so
  // large-message throughput otherwise collapses as sessions are consolidated.
  session.setLocalWindowSize(H2_CONNECTION_WINDOW_SIZE);
  session.on("error", error => {
    if (phase !== "stopped") throw error;
  });
  // Measurement is complete before teardown. Force-close the transport so a
  // graceful H2 GOAWAY cannot leave Node waiting on already-closed CONNECT
  // streams until the parent watchdog fires.
  closed.push(() => session.destroy());
  return session;
}

async function openH2(id, session) {
  const stream = session.request(
    {
      ":method": "CONNECT",
      ":protocol": "websocket",
      ":scheme": "http",
      ":authority": `127.0.0.1:${PORT}`,
      ":path": benchmarkPath(id),
      "sec-websocket-version": "13",
    },
    { endStream: false },
  );
  let logical;
  const parser = new ServerFrameParser(payload => logical.receive(payload));
  stream.on("data", chunk => parser.push(chunk));
  stream.on("error", error => {
    if (phase !== "stopped") throw error;
  });
  const headers = await new Promise((resolve, reject) => {
    stream.once("response", resolve);
    stream.once("error", reject);
  });
  if (headers[":status"] !== 200) {
    stream.close();
    throw new Error(`RFC 8441 handshake failed on stream ${id}: status ${headers[":status"]}`);
  }
  logical = makeLogicalStream(
    id,
    payload => stream.write(makeClientFrame(payload)),
    () => stream.close(),
  );
  return logical;
}

const logicalStreams = [];
if (PROTOCOL === "h1") {
  const open = H1_CLIENT === "ws" ? openH1WithWs : openH1;
  for (let i = 0; i < STREAMS; i++) logicalStreams.push(await open(i));
} else {
  const sessions = await Promise.all(Array.from({ length: SESSIONS }, (_, i) => openH2Session(i)));
  for (let i = 0; i < STREAMS; i++) logicalStreams.push(await openH2(i, sessions[i % sessions.length]));
}

phase = "warmup";
for (const stream of logicalStreams) stream.start();
await new Promise(resolve => setTimeout(resolve, WARMUP_MS));

phase = "measure";
measuredMessages = 0;
measuredBytes = 0;
const started = performance.now();
await new Promise(resolve => setTimeout(resolve, DURATION_MS));
const ended = performance.now();
phase = "stopped";

if (pending !== 0) {
  await Promise.race([
    new Promise(resolve => (settleMeasurement = resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${pending} echoes did not settle`)), 10_000)),
  ]);
}
for (const stream of logicalStreams) stream.close();
for (const close of closed) close();

const seconds = (ended - started) / 1_000;
const result = JSON.stringify({
  protocol: PROTOCOL,
  workload: WORKLOAD,
  streams: STREAMS,
  sessions: PROTOCOL === "h1" ? STREAMS : SESSIONS,
  payloadSize: PAYLOAD_SIZE,
  h1Client: PROTOCOL === "h1" ? H1_CLIENT : undefined,
  pipelineDepth: PROTOCOL === "h1" ? effectivePipelineDepth : undefined,
  maxInflightPayloadBytesPerSocket: PROTOCOL === "h1" ? MAX_INFLIGHT_PAYLOAD_BYTES_PER_SOCKET : undefined,
  h2StreamWindowSize: PROTOCOL === "h2" ? H2_STREAM_WINDOW_SIZE : undefined,
  h2ConnectionWindowSize: PROTOCOL === "h2" ? H2_CONNECTION_WINDOW_SIZE : undefined,
  durationMs: ended - started,
  messages: measuredMessages,
  payloadBytes: measuredBytes,
  messagesPerSecond: measuredMessages / seconds,
  payloadMiBPerSecond: measuredBytes / seconds / (1024 * 1024),
});
writeSync(process.stdout.fd, result + "\n");
process.exit(0);
