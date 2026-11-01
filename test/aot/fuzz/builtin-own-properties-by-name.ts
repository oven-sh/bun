// Reads own properties of the running Bun's built-ins by their literal names, stores the results in fields of a
// literal, and prints their types. Enumerating with computed keys would only test the run time; literal names test what
// the compiler believes about, say, `process.env.TZ`. Run it with --validate: the executable then stops at a value the
// compiler assumed impossible, which says more than the output.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Random } from "./random";

/** `key` as a program writes it: "name" or Symbol.iterator. `read`: base.name or base[key]. */
type Found = { base: string; key: string; read: string; copied: string; mayBeRead: boolean };
type Root = { text: string; made?: string; read: () => unknown; only?: boolean };
type Walked = { text: string; made?: string; found: Found[] };

const maxDepth = 2;
const wellKnown = new Map<symbol, string>();
for (const name of Object.getOwnPropertyNames(Symbol)) if (typeof (Symbol as any)[name] === "symbol") wellKnown.set((Symbol as any)[name], "Symbol." + name);
const isIdentifier = (text: string) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(text);
const keyText = (key: string | symbol) => (typeof key === "symbol" ? wellKnown.get(key) : JSON.stringify(key));
const member = (base: string, key: string | symbol) => (typeof key === "string" && isIdentifier(key) ? base + "." + key : base + "[" + keyText(key) + "]");

// Reading these opens a file, a channel or a debugger.
const neverRead = /^(stdin|openStdin|mainModule|binding|_linkedBinding|dlopen|debugPort|report|channel|connected|webkitURL)$/;
// A compiled program has no ShadowRealm. The others are the global object again, belong to the file rather than the
// realm, or are installed by the fuzzer's runner.
const skippedRoots = new Set(["ShadowRealm", "globalThis", "self", "window", "global", "Loader", "$", "require", "module", "exports", "__filename", "__dirname", "onmessage", "onerror", "name"]);
// These depend on the machine, on how the program was started, or on what the executable contains.
const skippedBases = /^(process\.env|Bun\.env|process\.versions|process\.release|process\.argv|process\.execArgv|Bun\.argv|require\.cache)$/;

const made: readonly string[] = [
  `new URL("http://a.example/b?c=d#e")`, `new URLSearchParams("a=b")`, `new Headers({ a: "b" })`, `new Request("http://a.example/")`, `new Response("a")`, `new Blob(["a"])`, `new File(["a"], "a.txt")`, `new FormData()`,
  `new TextDecoder()`, `new TextEncoder()`, `new AbortController()`, `new AbortController().signal`, `new Event("a")`, `new CustomEvent("a", { detail: 1 })`, `new EventTarget()`, `new MessageChannel()`, `new MessageChannel().port1`,
  `new ErrorEvent("a")`, `new MessageEvent("a")`, `new CloseEvent("a")`, `new DOMException("a")`, `new BroadcastChannel("a")`, `new ReadableStream()`, `new WritableStream()`, `new TransformStream()`, `new ReadableStream().getReader()`,
  `new Date(0)`, `/a/g`, `new Map()`, `new Set()`, `new WeakMap()`, `new WeakSet()`, `new WeakRef({})`, `new Error("a")`, `new TypeError("a")`, `new AggregateError([])`, `new ArrayBuffer(8)`, `new SharedArrayBuffer(8)`, `new Uint8Array(2)`, `new Float64Array(2)`,
  `new DataView(new ArrayBuffer(8))`, `new Proxy({}, {})`, `Promise.resolve(1)`, `new String("ab")`, `new Number(1)`, `new Boolean(true)`, `Object(Symbol.iterator)`, `Object(1n)`, `[1, 2]`, `[1, 2].values()`, `new Map().entries()`, `new Set().values()`, `"a".matchAll(/a/g)`,
  `"ab"[Symbol.iterator]()`, `(function () { return arguments; })(1, 2)`, `(function () { "use strict"; return arguments; })(1, 2)`, `function () {}`, `() => 1`, `class {}`, `async function () {}`, `function* () {}`, `(function* () {})()`, `(async function* () {})()`,
  `(function () {}).bind(null)`, `/(?<a>a)/d.exec("a")`, `/(?<a>a)/d.exec("a").groups`, `/(?<a>a)/d.exec("a").indices`, `Object.getOwnPropertyDescriptor({ a: 1 }, "a")`, `Object.entries({ a: 1 })[0]`, `new Intl.NumberFormat()`, `new Intl.DateTimeFormat()`, `new Intl.Collator()`,
  `new Intl.DateTimeFormat().resolvedOptions()`, `new Intl.Locale("en")`, `new Intl.Segmenter()`, `Iterator.from([1])`, `[1].values().map(each => each)`, `new FinalizationRegistry(() => {})`, `structuredClone({ a: 1 })`, `JSON.parse('{"a":1}')`,
  `Buffer.alloc(2)`, `Buffer.from("ab")`, `process.memoryUsage()`, `process.cpuUsage()`, `process.hrtime()`, `process.resourceUsage()`, `process.config`, `process.features`, `process.stdout`, `process.stderr`,
  `process.emitWarning`, `process.nextTick`, `process.allowedNodeEnvironmentFlags`, `process.getActiveResourcesInfo()`, `process.title`, `performance.timeOrigin`, `performance.toJSON()`, `performance.mark("a")`, `performance.timing`, `performance.eventLoopUtilization()`,
  `Bun.version`, `Bun.file("a")`, `Bun.stdout`, `Bun.stderr`, `Bun.stdin`, `new Bun.Glob("*")`, `new Bun.Transpiler()`, `new Bun.CryptoHasher("sha256")`, `Bun.hash`, `Bun.password`, `Bun.semver`, `Bun.TOML`, `Bun.unsafe`, `Bun.dns`, `Bun.nanoseconds()`, `Bun.inspect`, `Bun.inspect.custom`,
  `new Bun.ArrayBufferSink()`, `Bun.color`, `new Bun.Cookie("a", "b")`, `new Bun.CookieMap()`, `Bun.S3Client`, `Bun.s3`, `Bun.sql`, `Bun.redis`, `Bun.which`, `Bun.spawnSync`, `Bun.FFI`, `Bun.SHA256`, `new Bun.SHA256()`, `new Bun.MD5()`,
  `require("node:fs").statSync(".")`, `require("node:fs").statSync(".", { bigint: true })`, `require("node:fs").readdirSync(".", { withFileTypes: true })[0]`, `new (require("node:events"))()`, `new (require("node:stream").Readable)()`, `new (require("node:stream").Writable)()`, `new (require("node:stream").Duplex)()`,
  `new (require("node:stream").Transform)()`, `new (require("node:stream").PassThrough)()`, `require("node:os").cpus()[0]`, `require("node:os").userInfo()`, `require("node:os").networkInterfaces()`, `require("node:os").constants`, `require("node:path").parse("/a/b.c")`, `require("node:url").parse("http://a.example/b?c")`,
  `require("node:util").inspect`, `require("node:util").promisify`, `new (require("node:util").TextDecoder)()`, `require("node:util").parseArgs({ args: [] })`, `require("node:crypto").createHash("sha256")`, `require("node:crypto").createHmac("sha256", "a")`, `require("node:crypto").randomBytes(2)`, `require("node:crypto").webcrypto`,
  `require("node:crypto").createSecretKey(Buffer.alloc(16))`, `require("node:crypto").generateKeyPairSync("ed25519").publicKey`, `require("node:zlib").createGzip()`, `require("node:zlib").constants`, `new (require("node:async_hooks").AsyncLocalStorage)()`, `new (require("node:async_hooks").AsyncResource)("a")`,
  `require("node:http").createServer()`, `new (require("node:http").Agent)()`, `require("node:http").globalAgent`, `new (require("node:http").IncomingMessage)(null)`, `new (require("node:http").ServerResponse)({})`, `new (require("node:http").OutgoingMessage)()`, `require("node:http").STATUS_CODES`, `require("node:net").createServer()`, `new (require("node:net").Socket)()`,
  `new (require("node:net").BlockList)()`, `new (require("node:net").SocketAddress)()`, `new (require("node:string_decoder").StringDecoder)()`, `require("node:querystring").parse("a=b")`, `require("node:vm").createContext({})`, `setTimeout(() => {}, 0)`, `setImmediate(() => {})`,
  `require("node:worker_threads")`, `new (require("node:worker_threads").MessageChannel)().port1`, `require("node:perf_hooks").performance`, `require("node:perf_hooks").createHistogram()`, `require("node:module")`, `require("node:module").createRequire("/a/b.js")`, `require`, `module`, `require.main`, `require.extensions`, `require.resolve`,
  `require("node:child_process").spawnSync("true")`, `require("node:readline").createInterface({ input: new (require("node:stream").Readable)({ read() {} }) })`, `require("node:tty")`, `require("node:dgram").createSocket("udp4")`, `require("node:dns").getServers()`, `new (require("node:dns").Resolver)()`, `require("node:assert").AssertionError`, `new (require("node:assert").AssertionError)({ message: "a" })`,
  `require("node:diagnostics_channel").channel("a")`, `require("node:tls").createSecureContext()`, `require("node:tls").rootCertificates`, `require("node:v8").getHeapStatistics()`, `require("node:buffer").constants`, `new (require("node:buffer").Blob)(["a"])`, `require("node:timers")`, `require("node:constants")`,
];

const families: Record<string, (found: Found, name: string) => string> = {
  descriptions: ({ base, key }, name) => `
  const described = Object.getOwnPropertyDescriptor(${base}, ${key});
  if (described === undefined) return ${name} + " none";
  const kept = { get: described.get, set: described.set, value: described.value };
  return ${name} + " " + kind(kept.get) + " " + kind(kept.set) + " " + kind(kept.value);`,
  reads: ({ base, key, read }, name) => `
  const kept = { value: ${read} };
  return ${name} + " " + kind(kept.value) + " " + (${key} in ${base}) + " " + Object.hasOwn(${base}, ${key}) + " " + typeof ${read} + " " + (${read} === undefined) + " " + (${read} == null);`,
  above: ({ base }) => `
  const kept = { above: Object.getPrototypeOf(${base}) };
  return ${JSON.stringify(base)} + " " + kind(kept.above) + " " + (kept.above === Object.prototype) + " " + (kept.above === Function.prototype) + " " + (kept.above === Array.prototype) + " " + typeof ${base} + " " + Array.isArray(${base});`,
  copies: ({ base, key, copied }, name) => `
  const copy = Object.defineProperties({}, Object.getOwnPropertyDescriptors(${base}));
  let value;
  try { value = ${copied}; } catch (error) { return ${name} + " the read threw " + error.name; }
  const kept = { value };
  const described = Object.getOwnPropertyDescriptor(copy, ${key});
  const parts = { get: described.get, set: described.set, value: described.value };
  return ${name} + " " + kind(kept.value) + " " + kind(parts.get) + " " + kind(parts.set) + " " + kind(parts.value);`,
};

function rootsOfRunningBun(): Root[] {
  const roots: Root[] = [];
  // In a separate file each is created once, in a variable.
  made.forEach((text, index) => roots.push({ text: "made" + index, made: text, read: () => (0, eval)("(" + text + ")") }));
  for (const key of Object.getOwnPropertyNames(globalThis)) if (isIdentifier(key) && !skippedRoots.has(key)) roots.push({ text: key, read: () => (globalThis as any)[key] });
  roots.push({ text: "globalThis", read: () => globalThis, only: true });
  const modules = (require("node:module").builtinModules as string[]).filter(name => !/^(bun:|internal|_|node:test|test|repl|node:repl|inspector|trace_events|wasi|sqlite|node:sqlite|vm$|node:vm$)/.test(name) && !name.includes("/"));
  for (const name of [...new Set(modules.map(name => name.replace(/^node:/, "")))]) roots.push({ text: `require("node:${name}")`, read: () => require("node:" + name) });
  for (const name of ["bun:ffi", "bun:jsc", "bun:sqlite"]) roots.push({ text: `require("${name}")`, read: () => require(name) });
  for (const name of ["fs/promises", "path/posix", "path/win32", "stream/promises", "stream/web", "timers/promises", "util/types", "dns/promises", "readline/promises", "assert/strict"]) roots.push({ text: `require("node:${name}")`, read: () => require("node:" + name) });
  return roots;
}

function walk(found: Found[], seen: Set<unknown>, text: string, object: unknown, depth: number, only: boolean) {
  if ((typeof object !== "object" && typeof object !== "function") || object === null || seen.has(object) || skippedBases.test(text)) return;
  seen.add(object);
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(object).filter(key => keyText(key) !== undefined && key !== "ShadowRealm").slice(0, 400);
  } catch {
    return;
  }
  for (const key of keys) found.push({ base: text, key: keyText(key)!, read: member(text, key), copied: member("copy", key), mayBeRead: typeof key !== "string" || !neverRead.test(key) });
  if (depth >= maxDepth || only) return;
  for (const key of keys) {
    if (typeof key === "string" && (neverRead.test(key) || /^\d+$/.test(key))) continue;
    let value;
    try {
      value = (object as any)[key];
    } catch {
      continue;
    }
    walk(found, seen, member(text, key), value, depth + 1, false);
  }
  let above = null;
  try {
    above = Object.getPrototypeOf(object);
  } catch {}
  if (above) walk(found, seen, `Object.getPrototypeOf(${text})`, above, depth + 1, false);
}

// The objects in the list include sockets, servers, timers and streams, so a separate process creates and enumerates
// them, once.
if (import.meta.main) {
  const walked: Walked[] = [];
  for (const root of rootsOfRunningBun()) {
    let object;
    try {
      object = root.read();
    } catch {
      continue;
    }
    // A value that is reachable from two roots is queried under both spellings.
    const found: Found[] = [];
    walk(found, new Set(), root.text, object, root.made ? maxDepth - 1 : 0, !!root.only);
    if (found.length) walked.push({ text: root.text, made: root.made, found });
  }
  writeFileSync(process.argv[2], JSON.stringify(walked));
  process.exit(0);
}

let walked: Walked[] | undefined;

export function generate(random: Random): { file: string; text: string } {
  if (!walked) {
    const folder = mkdtempSync(join(tmpdir(), "written-names-"));
    Bun.spawnSync([process.execPath, import.meta.path, join(folder, "walked.json")], { stdout: "ignore", stderr: "ignore" });
    walked = JSON.parse(readFileSync(join(folder, "walked.json"), "utf8")) as Walked[];
    rmSync(folder, { recursive: true });
  }
  const root = random.pick(walked);
  const family = random.pick(Object.keys(families));
  const first = root.found.length > 120 ? random.below(root.found.length - 120) : 0;
  const found = root.found.slice(first, first + 120);
  let text = `"use strict";\nconst kind = value => (value === null ? "null" : typeof value);\nconst cases = [];\n`;
  if (root.made) text += `const ${root.text} = ${root.made};\n`;
  found.forEach((each, index) => {
    if (family !== "descriptions" && family !== "above" && !each.mayBeRead) return;
    if (family === "above" && index && found[index - 1].base === each.base) return;
    text += `cases.push(function () {${families[family](each, JSON.stringify(each.read))}\n});\n`;
  });
  text += `
for (let index = 0; index < cases.length; index++) {
  let line;
  try { line = cases[index](); } catch (error) { line = "threw " + error.name; }
  console.log(index + " " + line);
}
process.exit(0);
`;
  return { file: "main.cjs", text };
}
