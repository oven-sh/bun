// An object that the runtime hands out, and something done with it that reaches one of its methods without naming it: what hands the object out, times what is done with it, times whether it is held in a
// constant first. Each program is one line, or two, and is built alone.
//
//   bun write-handed-out-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<handed out>--<done>--<held>.mjs
//   bun write-handed-out-sweep.ts count
//   bun write-handed-out-sweep.ts named <pattern> <folder> [most]
//
// A build that leaves out what a program cannot reach has to know what comes in with an object: `JSON.stringify()` calls `toJSON()`, a template calls `toString()`, a spread calls `Symbol.iterator`, and the
// program names none of them, nor the class, where a function of the runtime made the object. A program that uses much of the library anyway hides what was left out, so these hold nothing else. Where what
// is handed out differs from run to run, the program prints the kind of the answer alone.
import { mkdirSync, writeFileSync } from "fs";

// What the program imports, the expression, and whether it gives the same at every run and holds no place in a file.
const handedOut: [string, string, string, boolean][] = [
  ["zstd-compressed", "", 'Bun.zstdCompressSync("aaaa")', true],
  ["zstd-decompressed", "", 'Bun.zstdDecompressSync(Bun.zstdCompressSync("aaaa"))', true],
  ["gzipped", "", 'Bun.gzipSync("aaaa")', true],
  ["gunzipped", "", 'Bun.gunzipSync(Bun.gzipSync("aaaa"))', true],
  ["deflated", "", 'Bun.deflateSync("aaaa")', true],
  ["inflated", "", 'Bun.inflateSync(Bun.deflateSync("aaaa"))', true],
  ["a-hash-of-the-hasher", "", 'Bun.CryptoHasher.hash("sha256", "a")', true],
  ["a-digest-of-a-hasher", "", 'new Bun.CryptoHasher("sha256").update("a").digest()', true],
  ["a-digest-as-a-buffer", "", 'new Bun.CryptoHasher("sha256").update("a").digest("buffer")', true],
  ["an-md5-as-a-buffer", "", 'Bun.MD5.hash("a", "buffer")', true],
  ["a-sha256-as-a-buffer", "", 'Bun.SHA256.hash("a", "buffer")', true],
  ["a-sha256", "", 'Bun.SHA256.hash("a")', true],
  ["a-sha1", "", 'Bun.SHA1.hash("a")', true],
  ["a-uuid-of-a-name-as-a-buffer", "", 'Bun.randomUUIDv5("a", "dns", "buffer")', true],
  ["a-uuid-of-the-time-as-a-buffer", "", 'Bun.randomUUIDv7("buffer")', false],
  ["a-number-hash", "", 'Bun.hash("a")', true],
  ["a-file", "", 'Bun.file("nothing-here.txt")', true],
  ["a-slice-of-a-file", "", 'Bun.file("nothing-here.txt").slice(0, 1)', true],
  ["a-glob", "", 'new Bun.Glob("*.none")', true],
  ["a-color-as-a-list", "", 'Bun.color("red", "[rgb]")', true],
  ["a-color-as-a-record", "", 'Bun.color("red", "{rgb}")', true],
  ["parsed-toml", "", 'Bun.TOML.parse("a = 1")', true],
  ["a-url-of-a-path", "", 'Bun.pathToFileURL("/a/b")', true],
  ["buffers-joined", "", "Bun.concatArrayBuffers([new Uint8Array([1]), new Uint8Array([2])])", true],
  [
    "buffers-joined-as-a-view",
    "",
    "Bun.concatArrayBuffers([new Uint8Array([1]), new Uint8Array([2])], Infinity, true)",
    true,
  ],
  ["memory-nobody-cleared", "", "Bun.allocUnsafe(2)", false],
  ["the-arguments-of-bun", "", "Bun.argv", false],
  ["a-blob", "", 'new Blob(["a"])', true],
  ["a-slice-of-a-blob", "", 'new Blob(["ab"]).slice(0, 1)', true],
  ["the-bytes-of-a-blob", "", 'await new Blob(["a"]).bytes()', true],
  ["the-buffer-of-a-blob", "", 'await new Blob(["a"]).arrayBuffer()', true],
  ["a-file-of-the-web", "", 'new File(["a"], "f.txt", { lastModified: 0 })', true],
  ["a-response", "", 'new Response("a")', true],
  ["the-headers-of-a-response", "", 'new Response("a").headers', true],
  ["the-body-of-a-response", "", 'new Response("a").body', true],
  ["the-bytes-of-a-response", "", 'await new Response("a").bytes()', true],
  ["the-blob-of-a-response", "", 'await new Response("a").blob()', true],
  [
    "the-form-of-a-response",
    "",
    'await new Response("a=1", { headers: { "content-type": "application/x-www-form-urlencoded" } }).formData()',
    true,
  ],
  ["a-request", "", 'new Request("http://h.example/")', true],
  ["the-signal-of-a-request", "", 'new Request("http://h.example/").signal', true],
  ["headers", "", 'new Headers({ a: "1" })', true],
  ["the-entries-of-headers", "", 'new Headers({ a: "1" }).entries()', true],
  ["a-form", "", "new FormData()", true],
  ["a-url", "", 'new URL("http://h.example/p?a=1")', true],
  ["the-parameters-of-a-url", "", 'new URL("http://h.example/p?a=1").searchParams', true],
  ["parameters", "", 'new URLSearchParams("a=1")', true],
  ["the-keys-of-parameters", "", 'new URLSearchParams("a=1").keys()', true],
  ["encoded-text", "", 'new TextEncoder().encode("a")', true],
  ["what-encoding-into-says", "", 'new TextEncoder().encodeInto("a", new Uint8Array(2))', true],
  ["a-decoder", "", "new TextDecoder()", true],
  ["a-buffer-of-a-text", "", 'Buffer.from("a")', true],
  ["a-buffer-of-zeros", "", "Buffer.alloc(2)", true],
  ["a-part-of-a-buffer", "", 'Buffer.from("ab").subarray(0, 1)', true],
  ["buffers-concatenated", "", 'Buffer.concat([Buffer.from("a"), Buffer.from("b")])', true],
  ["the-memory-of-a-buffer", "", "Buffer.alloc(2).buffer", true],
  ["a-clone-of-a-buffer", "", 'structuredClone(Buffer.from("a"))', true],
  ["a-clone-of-a-date", "", "structuredClone(new Date(0))", true],
  ["a-clone-of-a-map", "", "structuredClone(new Map([[1, 2]]))", true],
  ["a-clone-of-an-error", "", 'structuredClone(new RangeError("e"))', false],
  ["a-clone-of-a-pattern", "", "structuredClone(/r/g)", true],
  ["random-bytes-of-the-web", "", "crypto.getRandomValues(new Uint8Array(2))", false],
  ["the-subtle-part-of-crypto", "", "crypto.subtle", true],
  ["a-digest-of-the-web", "", 'await crypto.subtle.digest("SHA-256", new Uint8Array(1))', true],
  ["a-signal", "", "new AbortController().signal", true],
  ["an-event", "", 'new Event("a")', false],
  ["a-custom-event", "", 'new CustomEvent("a", { detail: 1 })', false],
  ["an-event-target", "", "new EventTarget()", true],
  ["a-port", "", "new MessageChannel().port1", true],
  ["a-readable-stream", "", "new ReadableStream()", true],
  ["a-reader", "", "new ReadableStream().getReader()", true],
  ["a-writable-stream", "", "new WritableStream()", true],
  ["the-readable-side-of-a-transform", "", "new TransformStream().readable", true],
  ["a-compression-stream", "", 'new CompressionStream("gzip")', true],
  ["a-decoder-stream", "", "new TextDecoderStream()", true],
  ["a-mark", "", 'performance.mark("a")', false],
  ["the-entries-of-performance", "", "performance.getEntries()", false],
  ["performance", "", "performance", false],
  ["a-dom-exception", "", 'new DOMException("m", "n")', true],
  ["the-navigator", "", "navigator", false],
  ["the-high-resolution-time", "", "process.hrtime()", false],
  ["the-memory-in-use", "", "process.memoryUsage()", false],
  ["the-versions", "", "process.versions", false],
  ["the-release", "", "process.release", false],
  ["the-features", "", "process.features", true],
  ["a-timer", "", "clearTimeout(setTimeout(() => {}, 0)) ?? setTimeout(() => {}, 0)", false],
  ["an-immediate", "", "setImmediate(() => {})", false],
  ["what-a-format-resolved", "", 'new Intl.NumberFormat("en").resolvedOptions()', true],
  ["the-parts-of-a-number", "", 'new Intl.NumberFormat("en").formatToParts(1)', true],
  ["the-segments-of-a-text", "", 'new Intl.Segmenter("en").segment("ab")', true],
  ["a-locale", "", 'new Intl.Locale("en-US")', true],
  ["the-matches-of-a-pattern", "", '"aa".matchAll(/a/g)', true],
  ["a-match", "", '/(?<n>a)/.exec("a")', true],
  ["the-groups-of-a-match", "", '/(?<n>a)/.exec("a").groups', true],
  ["the-entries-of-a-list", "", "[1].entries()", true],
  ["the-entries-of-a-map", "", "new Map([[1, 2]]).entries()", true],
  ["a-weak-reference", "", "new WeakRef({})", true],
  ["a-data-view", "", "new DataView(new ArrayBuffer(2))", true],
  ["shared-memory", "", "new SharedArrayBuffer(2)", true],
  ["gzipped-by-node", 'import zlib from "node:zlib";', 'zlib.gzipSync("aaaa")', true],
  ["deflated-by-node", 'import zlib from "node:zlib";', 'zlib.deflateSync("aaaa")', true],
  ["compressed-by-brotli", 'import zlib from "node:zlib";', 'zlib.brotliCompressSync("aaaa")', true],
  ["a-digest-of-node", 'import crypto from "node:crypto";', 'crypto.createHash("sha256").update("a").digest()', true],
  [
    "an-hmac-of-node",
    'import crypto from "node:crypto";',
    'crypto.createHmac("sha256", "k").update("a").digest()',
    true,
  ],
  ["random-bytes-of-node", 'import crypto from "node:crypto";', "crypto.randomBytes(2)", false],
  ["a-derived-key", 'import crypto from "node:crypto";', 'crypto.pbkdf2Sync("p", "s", 1, 4, "sha256")', true],
  ["a-key-object", 'import crypto from "node:crypto";', 'crypto.createSecretKey(Buffer.from("k"))', true],
  ["the-state-of-a-folder", 'import fs from "node:fs";', 'fs.statSync("/")', false],
  ["an-entry-of-a-folder", 'import fs from "node:fs";', 'fs.readdirSync("/", { withFileTypes: true })[0]', false],
  ["a-file-read-whole", 'import fs from "node:fs";', 'fs.readFileSync("/dev/null")', true],
  ["a-path-taken-apart", 'import path from "node:path";', 'path.parse("/a/b.c")', true],
  ["a-url-taken-apart", 'import url from "node:url";', 'url.parse("http://h.example/p?a=1")', true],
  ["a-query-taken-apart", 'import querystring from "node:querystring";', 'querystring.parse("a=1")', true],
  ["the-processors", 'import os from "node:os";', "os.cpus()", false],
  ["the-user", 'import os from "node:os";', "os.userInfo()", false],
  ["serialized-by-v8", 'import v8 from "node:v8";', "v8.serialize({ a: 1 })", true],
  ["the-heap-by-v8", 'import v8 from "node:v8";', "v8.getHeapStatistics()", false],
  ["an-emitter", 'import { EventEmitter } from "node:events";', "new EventEmitter()", true],
  ["a-stream-of-a-list", 'import { Readable } from "node:stream";', "Readable.from([1])", true],
  ["a-pass-through", 'import { PassThrough } from "node:stream";', "new PassThrough()", true],
  ["a-decoder-of-node", 'import { StringDecoder } from "node:string_decoder";', 'new StringDecoder("utf8")', true],
  ["an-address", 'import net from "node:net";', 'new net.SocketAddress({ address: "127.0.0.1", port: 1 })', true],
  ["a-block-list", 'import net from "node:net";', "new net.BlockList()", true],
  ["an-assertion-error", 'import assert from "node:assert";', 'new assert.AssertionError({ message: "m" })', false],
  ["a-mime-type", 'import util from "node:util";', 'new util.MIMEType("text/plain")', true],
  ["parsed-arguments", 'import util from "node:util";', "util.parseArgs({ args: [] })", true],
  ["a-histogram", 'import { createHistogram } from "node:perf_hooks";', "createHistogram()", true],
];

// X is what was handed out. Where the second text is given it serves where X differs from run to run.
const deeds: [string, string, string?][] = [
  ["json", "JSON.stringify(X)"],
  ["json-in-a-record", "JSON.stringify({ k: X })"],
  ["json-in-a-list", "JSON.stringify([X])"],
  ["json-of-its-spread", "JSON.stringify({ ...X })"],
  ["in-a-response", "await Response.json({ k: X }).text()"],
  ["string", "String(X)"],
  ["a-template", "`${X}`"],
  ["plus-a-text", 'X + ""'],
  ["to-string", "X.toString()"],
  ["to-locale-string", "X.toLocaleString()"],
  ["to-json", "JSON.stringify(X.toJSON?.())"],
  ["value-of", "typeof X.valueOf()"],
  ["spread", "[...X].length"],
  ["array-from", "Array.from(X).length"],
  ["walked", "(() => {\n  let seen = 0;\n  for (const one of X) seen++;\n  return seen;\n})()"],
  ["keys", "Object.keys(X).join()"],
  ["entries", "Object.entries(X).length"],
  ["own-names", "Object.getOwnPropertyNames(X).length"],
  ["walked-by-name", "(() => {\n  let seen = 0;\n  for (const name in X) seen++;\n  return seen;\n})()"],
  ["its-class", "X.constructor.name"],
  ["its-tag", "Object.prototype.toString.call(X)"],
  ["cloned", "typeof structuredClone(X)"],
  ["inspected", "Bun.inspect(X)"],
  ["printed", "X", "typeof Bun.inspect(X)"],
  ["held-against-itself", "Bun.deepEquals(X, X)"],
  ["awaited", "typeof (await X)"],
  ["its-length", "X.length"],
  ["its-size", "X.size"],
  ["its-byte-length", "X.byteLength"],
  ["its-iterator", "typeof X[Symbol.iterator]"],
  ["is-it-a-view", "ArrayBuffer.isView(X)"],
  ["is-it-a-buffer", "Buffer.isBuffer(X)"],
];

const helds = ["written-in-place", "held-in-a-constant"] as const;

const all = handedOut.length * deeds.length * helds.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [deed, done, wavering] = pick(deeds);
  const [what, imports, made, steady] = pick(handedOut);
  const held = pick(helds);
  const inPlace = held === "written-in-place";
  const waits = inPlace && made.startsWith("await");
  const asked = (steady ? done : (wavering ?? `typeof (${done})`))
    .replaceAll("X", inPlace ? (/^(await|clearTimeout)/.test(made) ? `(${made})` : made) : "x")
    .replace("(() => {", waits ? "(await (async () => {" : "(() => {")
    .replace("})()", waits ? "})())" : "})()");
  return {
    name: `${what}--${deed}--${held}.mjs`,
    text: [imports, inPlace ? "" : `const x = ${made};`, `console.log(${asked});`].filter(Boolean).join("\n") + "\n",
  };
}

const pad = (at: number) => String(at).padStart(4, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
