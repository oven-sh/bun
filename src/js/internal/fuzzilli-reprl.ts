// Comprehensive REPRL wrapper for Bun fuzzing with all runtime APIs exposed
// Based on workerd's approach to maximize fuzzing coverage
// https://bun.com/docs/runtime

const REPRL_CRFD = 100; // Control read FD
const REPRL_CWFD = 101; // Control write FD
const REPRL_DRFD = 102; // Data read FD
const REPRL_DWFD = 103; // Data write FD

const fs = require("node:fs");

// ============================================================================
// Expose ALL Bun APIs to globalThis for fuzzing
// https://bun.com/docs/runtime/bun-apis
// ============================================================================

// Bun global is already available
globalThis.Bun = Bun;

// File system APIs
globalThis.file = Bun.file;
globalThis.write = Bun.write;

// Process APIs
globalThis.spawn = Bun.spawn;
globalThis.spawnSync = Bun.spawnSync;
globalThis.$ = Bun.$;
globalThis.sleep = Bun.sleep;
globalThis.which = Bun.which;

// Crypto APIs
globalThis.password = Bun.password;

// Network APIs
globalThis.serve = Bun.serve;
globalThis.connect = Bun.connect;
globalThis.listen = Bun.listen;

// Compression
globalThis.deflateSync = Bun.deflateSync;
globalThis.gzipSync = Bun.gzipSync;
globalThis.inflateSync = Bun.inflateSync;
globalThis.gunzipSync = Bun.gunzipSync;

// Utilities
globalThis.inspect = Bun.inspect;
globalThis.nanoseconds = Bun.nanoseconds;
globalThis.readableStreamToArrayBuffer = Bun.readableStreamToArrayBuffer;
globalThis.readableStreamToBlob = Bun.readableStreamToBlob;
globalThis.readableStreamToJSON = Bun.readableStreamToJSON;
globalThis.readableStreamToText = Bun.readableStreamToText;
globalThis.resolveSync = Bun.resolveSync;
globalThis.resolve = Bun.resolve;
globalThis.FileSystemRouter = Bun.FileSystemRouter;
globalThis.Glob = Bun.Glob;
globalThis.Transpiler = Bun.Transpiler;

// Build/dev
globalThis.build = Bun.build;
globalThis.plugin = Bun.plugin;

// Env
globalThis.env = Bun.env;
globalThis.main = Bun.main;
globalThis.argv = Bun.argv;
globalThis.revision = Bun.revision;
globalThis.version = Bun.version;

// ============================================================================
// Web Standard APIs (already global but re-expose explicitly)
// https://bun.com/docs/runtime/web-apis
// ============================================================================

// Fetch API
globalThis.fetch = fetch;
globalThis.Request = Request;
globalThis.Response = Response;
globalThis.Headers = Headers;

// URL APIs
globalThis.URL = URL;
globalThis.URLSearchParams = URLSearchParams;

// Streams
globalThis.ReadableStream = ReadableStream;
globalThis.WritableStream = WritableStream;
globalThis.TransformStream = TransformStream;
globalThis.ByteLengthQueuingStrategy = ByteLengthQueuingStrategy;
globalThis.CountQueuingStrategy = CountQueuingStrategy;
globalThis.ReadableStreamBYOBReader = ReadableStreamBYOBReader;
globalThis.ReadableStreamDefaultReader = ReadableStreamDefaultReader;

// Text APIs
globalThis.TextEncoder = TextEncoder;
globalThis.TextDecoder = TextDecoder;
globalThis.atob = atob;
globalThis.btoa = btoa;

// Blob/File
globalThis.Blob = Blob;
globalThis.File = File;
globalThis.FormData = FormData;

// WebSocket
globalThis.WebSocket = WebSocket;

// Events
globalThis.EventTarget = EventTarget;
globalThis.Event = Event;
globalThis.CustomEvent = CustomEvent;
globalThis.MessageEvent = MessageEvent;
globalThis.ErrorEvent = ErrorEvent;
globalThis.CloseEvent = CloseEvent;

// Abort
globalThis.AbortController = AbortController;
globalThis.AbortSignal = AbortSignal;

// MessageChannel
globalThis.MessageChannel = MessageChannel;
globalThis.MessagePort = MessagePort;
globalThis.BroadcastChannel = BroadcastChannel;

// Timers
globalThis.setTimeout = setTimeout;
globalThis.setInterval = setInterval;
globalThis.clearTimeout = clearTimeout;
globalThis.clearInterval = clearInterval;
globalThis.setImmediate = setImmediate;
globalThis.clearImmediate = clearImmediate;
globalThis.queueMicrotask = queueMicrotask;

// Performance
globalThis.performance = performance;
globalThis.Performance = Performance;

// Crypto
globalThis.crypto = crypto;
globalThis.Crypto = Crypto;
globalThis.SubtleCrypto = SubtleCrypto;
globalThis.CryptoKey = CryptoKey;

// DOM Exception
globalThis.DOMException = DOMException;

// Structured clone
globalThis.structuredClone = structuredClone;

// Console
globalThis.console = console;

// Navigator
globalThis.navigator = navigator;

// HTML Rewriter
globalThis.HTMLRewriter = HTMLRewriter;

// ============================================================================
// Node.js Compatibility APIs
// https://bun.com/docs/runtime/nodejs-apis
// ============================================================================

globalThis.Buffer = Buffer;
globalThis.process = process;
globalThis.global = globalThis;

// Make common Node modules available
globalThis.require = require;
globalThis.__dirname = "/";
globalThis.__filename = "/fuzzilli.js";

// ============================================================================
// Mock implementations for features that would hang/fail in fuzzing
// ============================================================================

// Mock Bun.serve to avoid actually starting servers
globalThis.MOCK_SERVE = options => ({
  url: new URL("http://localhost:3000"),
  hostname: "localhost",
  port: 3000,
  development: false,
  fetch: options?.fetch || (() => new Response("mock")),
  stop: () => {},
  reload: () => {},
  ref: () => {},
  unref: () => {},
  requestIP: () => null,
  publish: () => 0,
  upgrade: () => false,
  pendingWebsockets: 0,
});

// Mock subprocess operations
globalThis.MOCK_SPAWN = () => ({
  pid: 12345,
  stdin: new WritableStream(),
  stdout: new ReadableStream(),
  stderr: new ReadableStream(),
  exited: Promise.resolve(0),
  kill: () => true,
  ref: () => {},
  unref: () => {},
  resourceUsage: () => ({ cpuTime: { user: 0, system: 0 }, maxRSS: 0 }),
});

// Mock file operations
globalThis.MOCK_FILE = {
  name: "test.txt",
  size: 1024,
  type: "text/plain",
  lastModified: Date.now(),
  text: () => Promise.resolve("Mock file content"),
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(1024)),
  json: () => Promise.resolve({ mock: "data" }),
  blob: () => Promise.resolve(new Blob(["mock"], { type: "text/plain" })),
  stream: () => new ReadableStream(),
  slice: (start, end) => globalThis.MOCK_FILE,
  writer: () => ({ write: () => 0, end: () => 0, flush: () => Promise.resolve() }),
};

// Mock SQLite database
globalThis.MOCK_DB = {
  query: (sql, ...params) => ({
    all: () => [{ id: 1, name: "test" }],
    get: () => ({ id: 1, name: "test" }),
    run: () => ({ changes: 1, lastInsertRowid: 1 }),
    values: () => [[1, "test"]],
  }),
  prepare: sql => globalThis.MOCK_DB.query(sql),
  exec: () => {},
  close: () => {},
  serialize: () => new Uint8Array(100),
  loadExtension: () => {},
};

// Mock Glob
globalThis.MOCK_GLOB = {
  scan: pattern => ({
    [Symbol.asyncIterator]: async function* () {
      yield "file1.txt";
      yield "file2.txt";
    },
  }),
  scanSync: () => ["file1.txt", "file2.txt"],
  match: () => true,
};

// ============================================================================
// REPRL Protocol Loop
// ============================================================================

// Verify we're running under Fuzzilli before starting REPRL loop
// The Zig code should have already checked, but double-check here
try {
  // Try to stat fd 100 to see if it exists
  const stat = fs.fstatSync(REPRL_CRFD);
} catch (e) {
  // FD doesn't exist - not running under Fuzzilli
  console.error("ERROR: REPRL file descriptors not available. Must run under Fuzzilli.");
  process.exit(1);
}

// Send HELO handshake
fs.writeSync(REPRL_CWFD, Buffer.from("HELO"));

// Read HELO response
const response = Buffer.alloc(4);
const responseBytes = fs.readSync(REPRL_CRFD, response, 0, 4, null);
if (responseBytes !== 4) {
  throw new Error(`REPRL handshake failed: expected 4 bytes, got ${responseBytes}`);
}

// Main REPRL loop
while (true) {
  // Read command
  const cmd = Buffer.alloc(4);
  const cmd_n = fs.readSync(REPRL_CRFD, cmd, 0, 4, null);

  if (cmd_n === 0) {
    // EOF
    break;
  }

  if (cmd_n !== 4 || cmd.toString() !== "exec") {
    throw new Error(`Invalid REPRL command: expected 'exec', got ${cmd.toString()}`);
  }

  // Read script size (8 bytes, little-endian)
  const size_bytes = Buffer.alloc(8);
  fs.readSync(REPRL_CRFD, size_bytes, 0, 8, null);
  const script_size = Number(size_bytes.readBigUInt64LE(0));

  // Read script data from REPRL_DRFD
  const script_data = Buffer.alloc(script_size);
  let total_read = 0;
  while (total_read < script_size) {
    const n = fs.readSync(REPRL_DRFD, script_data, total_read, script_size - total_read, null);
    if (n === 0) break;
    total_read += n;
  }

  const script = script_data.toString("utf8");

  // Execute script
  let exit_code = 0;
  try {
    // Use indirect eval to execute in global scope
    (0, eval)(script);
  } catch (e) {
    // Print uncaught exception like workerd does
    console.log(`uncaught:${e}`);
    exit_code = 1;
  }

  // Send status back (4 bytes: exit code in REPRL format)
  // Format: lower 8 bits = signal number, next 8 bits = exit code
  const status = exit_code << 8;
  const status_bytes = Buffer.alloc(4);
  status_bytes.writeUInt32LE(status, 0);
  fs.writeSync(REPRL_CWFD, status_bytes);
}

// Export to satisfy module bundler
export default {};
