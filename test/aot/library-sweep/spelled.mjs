// Run by ./sweep.ts, on the binary that is swept, without --aot: spelled.mjs <folder>
// Writes a project whose test files spell uses of what Bun's library makes or holds: every global that is not the language's, the members of process, Bun and console, what every
// public module of the library exports. Each is read, called without arguments and with ("x", () => {}), constructed, iterated, handed to util.inspect, and so are the members of
// what it makes. A list at the end has what needs arguments to mean anything. One use a test file.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
const require = createRequire(import.meta.url);
const folder = process.argv[2];

const ecma = new Set("Object Function Array Number parseFloat parseInt Infinity NaN undefined Boolean String Symbol Date Promise RegExp Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError globalThis JSON Math Intl ArrayBuffer Atomics Uint8Array Int8Array Uint16Array Int16Array Uint32Array Int32Array Float16Array Float32Array Float64Array Uint8ClampedArray BigUint64Array BigInt64Array DataView Map BigInt Set WeakMap WeakSet WeakRef Proxy Reflect FinalizationRegistry SharedArrayBuffer decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape eval isFinite isNaN Iterator SuppressedError DisposableStack AsyncDisposableStack WebAssembly".split(" "));
const notGlobals = new Set("describe it test expect beforeAll beforeEach afterAll afterEach jest vi xit xtest xdescribe setDefaultTimeout mock spyOn self global window Loader $_BunCommonJSModule_$ alert confirm prompt close onmessage onerror name".split(" "));
const isName = s => /^[A-Za-z_$][\w$]*$/.test(s);
// Never called: what ends or changes the process, starts another, goes to the network, writes files, closes the standard streams, waits, or faults on purpose.
const neverCalled = /^(exit|abort|kill|reallyExit|_kill|execve|dlopen|chdir|umask|set\w*|initgroups|_debug\w*|_st\w+ProfilerIdleNotifier|openStdin|binding|_linkedBinding|disconnect|send|loadEnvFile|emitWarning|_fatalException|_tickCallback|_rawDebug|ref|unref|hasRef|close\w*|open\w*|start\w*|stop\w*|fork|spawn\w*|exec\w*|write\w*|append\w*|generateHeapSnapshot\w*|waitFor\w*|take\w*|sleep\w*|gc|fullGC|edenGC|shrink|serve|listen|connect\w*|createConnection|request|get|fetch|lookup\w*|resolve\w*|reverse|prefetch|udpSocket|build|plugin|registerMacro|mmap|rm\w*|unlink\w*|rename\w*|truncate\w*|ftruncate\w*|mkdir\w*|mkdtemp\w*|cp\w*|copy\w*|link\w*|symlink\w*|l?chmod\w*|fchmod\w*|l?chown\w*|fchown\w*|l?utimes\w*|futimes\w*|fsync\w*|fdatasync\w*|watch\w*|unwatch\w*|end|destroy\w*|_destroy|_final|cork|uncork|pause|resume|removeAllListeners|removeListener|off|runMain|_initPaths|_preloadModules|enableCompileCache|flushCompileCache|register|wait|waitAsync|drainMicrotasks|profile\w*|clear|table|group\w*|dir\w*|trace|time\w*|count\w*|assert|log|info|warn|error|debug|reportError|postMessage|terminate|restart|reload|publish|upgrade|segfault|crash\w*|panic\w*|raise\w*|_load|_resolveFilename|require|createRequire|import|eval\w*|run\w*|compile\w*|Script|SourceTextModule|SyntheticModule|measureMemory|cwd|createWriteStream|openAsBlob|mkfifo|loadExtension|fileControl|getHeapSnapshot|gcAndSweep|heapStats|Worker|WebSocket|EventSource|createServer|createSecureServer|createSocket|bind|subscribe|unsubscribe|psubscribe|duplicate)$/;
const neverTouched = [/^Bun\.unsafe/, /^Bun\.jest/, /^Bun\.stdin\./, /^Bun\.\$/, /^Bun\.(FFI|ffi)/, /^process\.(mainModule|binding|report|stdin\.)/, /^node_(repl|inspector|cluster|test|wasi|sqlite|child_process|worker_threads)\b.*\(/, /^bun_(ffi|test)/, /internal/i, /^Bun\.(redis|sql|SQL|postgres|s3|S3Client|RedisClient|Cookie\w*|secrets|Archive|Image|WebView|cron)\b.*\(/];
const may = (path, name, calls) => !neverTouched.some(r => r.test(calls ? path + "(" : path)) && !(calls && neverCalled.test(name));

const uses = [];   // { id, root, imports: Set, code }
const seenObjects = new Set();
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
// What else a program uses changes what the compiler believes of the library's objects, so each root stands in a program of its own, and so does each use that brings node:util along.
const only = process.env.ONLY_MATCH ? new RegExp(process.env.ONLY_MATCH) : null;
function add(root, id, code, imports) { if (id.startsWith("inspect ")) root = id; if (only && !only.test(id)) return; uses.push({ id, root, code, imports }); }
const looksLikeClass = (f, name) => typeof f === "function" && f.prototype && (/^[A-Z]/.test(name) || Object.getOwnPropertyNames(f.prototype).length > 1);
function namesOf(o) { try { return Object.getOwnPropertyNames(o).filter(isName); } catch { return []; } }
function read(o, k) { try { return [true, o[k]]; } catch { return [false]; } }

function instanceUses(root, path, value, imports) {
  let made; try { made = new value(); } catch { return; }
  const names = new Set();
  for (let p = Object.getPrototypeOf(made), n = 0; p && p !== Object.prototype && n < 5; p = Object.getPrototypeOf(p), n++) for (const k of namesOf(p)) if (k !== "constructor" && !k.startsWith("_")) names.add(k);
  add(root, `inspect new ${path}()`, `typeof node_util.inspect(new ${path}())`, new Set([...imports, "node:util"]));
  for (const k of [...names].slice(0, 40)) {
    const [ok, v] = read(made, k);
    add(root, `new ${path}().${k}`, `new ${path}().${k}`, imports);
    if (ok && typeof v === "function" && may(path + "." + k, k, true)) { add(root, `new ${path}().${k}()`, `new ${path}().${k}()`, imports); add(root, `new ${path}().${k}("x", f)`, `new ${path}().${k}("x", () => {})`, imports); }
  }
}
function walk(root, path, value, depth, imports) {
  const name = path.slice(path.lastIndexOf(".") + 1);
  if (!may(path, name, false)) return;
  add(root, path, path, imports);
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return;
  if (seenObjects.has(value)) return;
  seenObjects.add(value);
  if (typeof value === "function") {
    if (looksLikeClass(value, name)) {
      if (may(path, name, true)) { add(root, `new ${path}()`, `new ${path}()`, imports); instanceUses(root, path, value, imports); }
    } else if (may(path, name, true)) { add(root, `${path}()`, `${path}()`, imports); add(root, `${path}("x", f)`, `${path}("x", () => {})`, imports); }
  } else {
    add(root, `inspect ${path}`, `typeof node_util.inspect(${path}, { depth: 1 })`, new Set([...imports, "node:util"]));
    if (typeof value[Symbol.iterator] === "function" && !/std(in|out|err)/.test(path)) add(root, `[...${path}]`, `[...${path}].length >= 0`, imports);
    // What an object inherits from the library: the methods of a stream, of an emitter.
    const inherited = new Set();
    for (let p = Object.getPrototypeOf(value), n = 0; p && p !== Object.prototype && p !== Function.prototype && n < 6; p = Object.getPrototypeOf(p), n++) for (const k of namesOf(p)) if (k !== "constructor" && !k.startsWith("_")) inherited.add(k);
    for (const k of [...inherited].slice(0, 60)) {
      const [ok, v] = read(value, k);
      add(root, `${path}.${k}`, `${path}.${k}`, imports);
      if (ok && typeof v === "function" && may(path + "." + k, k, true)) { add(root, `${path}.${k}()`, `${path}.${k}()`, imports); add(root, `${path}.${k}("x", f)`, `${path}.${k}("x", () => {})`, imports); }
    }
  }
  if (depth <= 0) return;
  for (const k of namesOf(value)) {
    if (["prototype", "length", "name", "caller", "arguments", "constructor", "default"].includes(k)) continue;
    const [ok, v] = read(value, k);
    if (!ok) { add(root, `${path}.${k}`, `${path}.${k}`, imports); continue; }
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") continue;
    walk(depth >= 2 ? `${path}.${k}` : root, `${path}.${k}`, v, depth - 1, imports);
  }
}

for (const k of namesOf(globalThis)) {
  if (ecma.has(k) || notGlobals.has(k)) continue;
  const [ok, v] = read(globalThis, k);
  if (ok) walk(k, k, v, k === "process" || k === "Bun" ? 2 : 1, new Set());
}
const modules = [...new Set([...builtinModules.filter(m => !m.startsWith("_") && !m.includes("internal")).map(m => m.startsWith("node:") || m.startsWith("bun") ? m : "node:" + m), "bun:jsc", "bun:sqlite"])].filter(m => !/^(bun|bun:main|bun:wrap|bun:test|bun:ffi|undici|ws|node:test.*|node:sqlite|node:wasi|detect-libc|isomorphic-fetch|node-fetch|vercel_fetch|@vercel\/fetch|utf-8-validate|abort-controller)$/.test(m));
for (const m of modules) {
  let exports; try { exports = require(m); } catch { continue; }
  const local = m.replace(/[^\w]/g, "_");
  walk(local, local, exports, 2, new Set([m]));
}

// What needs arguments to mean anything.
const curated = `
process.stdout.write("")
process.stderr.write("")
process.stdout.write("", () => {})
process.stdout.isTTY
process.stdout.columns
process.stdout.writable
process.stdout.fd
process.stderr.fd
process.stdout.on("drain", () => {}).listenerCount("drain")
process.stdout.getWindowSize?.()
process.stdin.isTTY
process.stdin.fd
process.on("x", () => {}).listenerCount("x")
process.emit("x")
process.nextTick(() => {})
process.hrtime.bigint() > 0n
process.memoryUsage.rss() > 0
process.env.PATH !== 1
process.versions.bun.length > 0
process.release.name
process.config.variables !== null
process.getBuiltinModule("node:fs").existsSync(".")
new node_stream.Readable({ read() {} }).push("a")
new node_stream.Readable({ read() { this.push(null); } }).on("data", () => {}).readableFlowing
new node_stream.Writable({ write(c, e, f) { f(); } }).write("a")
new node_stream.Transform({ transform(c, e, f) { f(null, c); } }).write("a")
new node_stream.PassThrough().pipe(new node_stream.PassThrough()).writable
new node_stream.Duplex({ read() {}, write(c, e, f) { f(); } }).write("a")
node_stream.Readable.from(["a", "b"]).readable
node_stream.Readable.from(["a"]).pipe(new node_stream.PassThrough()).readable
node_stream.Readable.toWeb(node_stream.Readable.from(["a"])).locked
node_stream.Readable.fromWeb(new ReadableStream({ start(c) { c.close(); } })).readable
node_stream.finished(new node_stream.PassThrough(), () => {})
node_stream.pipeline(node_stream.Readable.from(["a"]), new node_stream.PassThrough(), () => {}).writable
node_stream_promises.pipeline(node_stream.Readable.from(["a"]), new node_stream.Writable({ write(c, e, f) { f(); } }))
node_stream.addAbortSignal(new AbortController().signal, new node_stream.PassThrough()).readable
node_fs.createReadStream(import.meta.path).on("error", () => {}).path.length > 0
node_fs.createReadStream(import.meta.path).pipe(new node_stream.PassThrough()).readable
node_fs.createReadStream(import.meta.path, { start: 0, end: 3 }).bytesRead
node_fs.readFileSync(import.meta.path).length > 0
node_fs.statSync(import.meta.path).isFile()
node_fs.readdirSync(import.meta.dir, { withFileTypes: true })[0].isFile() !== 1
node_fs.opendirSync(import.meta.dir).closeSync()
node_fs.promises.readFile(import.meta.path)
node_fs.promises.stat(import.meta.path)
node_fs.promises.open(import.meta.path).then(h => h.close())
node_fs_promises.readdir(import.meta.dir)
new node_events.EventEmitter().on("a", () => {}).emit("a")
new node_events.EventEmitter().once("a", () => {}).listeners("a").length
new node_events.EventEmitter().eventNames().length
node_events.once(new node_events.EventEmitter(), "a", { signal: AbortSignal.abort() }).catch(() => {})
node_events.on(new node_events.EventEmitter(), "a")[Symbol.asyncIterator]
node_events.getEventListeners(new node_events.EventEmitter(), "a").length
node_events.EventEmitter.listenerCount(new node_events.EventEmitter(), "a")
new (class extends node_events.EventEmitter {})().on("a", () => {}).emit("a")
new (class extends node_stream.Readable { _read() { this.push(null); } })().read()
new (class extends node_stream.Writable { _write(c, e, f) { f(); } })().write("a")
new node_async_hooks.AsyncLocalStorage().run(1, () => 2)
new node_async_hooks.AsyncLocalStorage().getStore()
node_async_hooks.AsyncLocalStorage.bind(() => 1)()
node_async_hooks.AsyncLocalStorage.snapshot()(() => 1)
new node_async_hooks.AsyncResource("x").runInAsyncScope(() => 1)
clearTimeout(setTimeout(() => {}, 1))
setTimeout(() => {}, 1).unref().hasRef()
setTimeout(() => {}, 1).refresh()[Symbol.toPrimitive]() > 0
clearInterval(setInterval(() => {}, 1000))
clearImmediate(setImmediate(() => {}))
setImmediate(() => {}).hasRef()
node_timers.setTimeout(() => {}, 1).close()
node_timers_promises.setTimeout(1)
node_timers_promises.setImmediate()
node_util.promisify(setTimeout)(1)
node_util.promisify(node_fs.stat)(import.meta.path)
node_util.promisify((f) => f(null, 1))()
node_util.callbackify(async () => 1)(() => {})
node_util.inspect(process.stdout, { depth: 0 }).length > 0
node_util.inspect(new node_stream.PassThrough(), { depth: 0 }).length > 0
node_util.format("%s %d %j %o", "a", 1, {}, [])
node_util.types.isPromise(Promise.resolve())
node_util.inherits(function A() {}, node_events.EventEmitter)
node_util.deprecate(() => 1, "x")()
node_util.parseArgs({ args: [] }).positionals.length
node_util.styleText("red", "x").length > 0
node_util.stripVTControlCharacters("x")
new node_util.TextDecoder().decode(new node_util.TextEncoder().encode("a"))
node_util.isDeepStrictEqual({ a: 1 }, { a: 1 })
new node_util.MIMEType("text/plain").essence
Buffer.from("a").toString("hex")
Buffer.alloc(2).fill(1).readUInt8(0)
Buffer.concat([Buffer.from("a"), Buffer.from("b")]).length
Buffer.from("a").equals(Buffer.from("a"))
node_buffer.Buffer.byteLength("a")
new node_buffer.Blob(["a"]).size
new node_buffer.File(["a"], "f").name
new Blob(["a"]).text()
new Blob(["a"]).stream().getReader().read()
new File(["a"], "f").arrayBuffer()
new Response("a").text()
new Response("a").body.getReader().read()
new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1)); c.close(); } })).arrayBuffer()
new Request("http://x/").headers.get("a")
new Headers({ a: "b" }).get("a")
[...new Headers({ a: "b" })].length
[...new URLSearchParams("a=1")].length
[...new FormData().entries()].length
new ReadableStream({ start(c) { c.close(); } }).getReader().read()
new ReadableStream({ start(c) { c.close(); } }).tee().length
new ReadableStream({ start(c) { c.close(); } }).pipeThrough(new TransformStream()).locked
new ReadableStream({ start(c) { c.close(); } }).pipeTo(new WritableStream())
new ReadableStream({ type: "bytes", start(c) { c.close(); } }).getReader({ mode: "byob" }).closed
new ReadableStream({ start(c) { c.close(); } })[Symbol.asyncIterator]().next()
new WritableStream({ write() {} }).getWriter().write("a")
new TransformStream().writable.getWriter().closed.catch(() => {})
new TextDecoderStream().readable.locked
new TextEncoderStream().writable.locked
new CompressionStream("gzip").readable.locked
new DecompressionStream("gzip").writable.locked
new ByteLengthQueuingStrategy({ highWaterMark: 1 }).size(new Uint8Array(1))
new CountQueuingStrategy({ highWaterMark: 1 }).size()
Bun.readableStreamToText(new ReadableStream({ start(c) { c.close(); } }))
Bun.readableStreamToArray(new ReadableStream({ start(c) { c.close(); } }))
Bun.readableStreamToArrayBuffer(new ReadableStream({ start(c) { c.close(); } }))
Bun.readableStreamToBytes(new ReadableStream({ start(c) { c.close(); } }))
Bun.readableStreamToJSON(new ReadableStream({ start(c) { c.enqueue("1"); c.close(); } }))
Bun.readableStreamToBlob(new ReadableStream({ start(c) { c.close(); } }))
Bun.file(import.meta.path).stream().getReader().read()
Bun.file(import.meta.path).text()
Bun.file(import.meta.path).size > 0
Bun.stdout.size >= 0
Bun.stderr.type
Bun.stdout.writer().flush()
new Bun.ArrayBufferSink().start()
Bun.inspect(process.stdout).length > 0
Bun.inspect.table([{ a: 1 }]).length > 0
Bun.deepEquals({ a: 1 }, { a: 1 })
Bun.peek(Promise.resolve(1))
Bun.peek.status(Promise.resolve(1))
Bun.escapeHTML("<")
Bun.stringWidth("a")
Bun.fileURLToPath("file:///a")
Bun.color("red", "hex")
Bun.semver.satisfies("1.0.0", "*")
new Bun.Glob("*").match("a")
new Bun.Transpiler().transformSync("1")
Bun.TOML.parse("a=1").a
new Bun.CryptoHasher("sha256").update("a").digest("hex").length
Bun.hash("a") > 0n
node_zlib.createGzip().write("a")
node_zlib.createGunzip().on("error", () => {}).writable
node_zlib.createDeflate().pipe(node_zlib.createInflate()).readable
node_zlib.createBrotliCompress().writable
node_zlib.gzipSync("a").length > 0
node_zlib.gunzipSync(node_zlib.gzipSync("a")).toString()
node_zlib.deflate("a", () => {})
node_util.promisify(node_zlib.gzip)("a")
node_crypto.createHash("sha256").update("a").digest("hex").length
node_crypto.createHash("sha256").write("a")
node_stream.Readable.from(["a"]).pipe(node_crypto.createHash("sha256")).writable
node_crypto.createHmac("sha256", "k").update("a").digest("hex").length
node_crypto.randomBytes(4).length
node_crypto.randomUUID().length
node_crypto.createCipheriv("aes-128-cbc", Buffer.alloc(16), Buffer.alloc(16)).update("a").length >= 0
node_crypto.getHashes().length > 0
node_crypto.webcrypto.getRandomValues(new Uint8Array(2)).length
node_crypto.subtle.digest("SHA-256", new Uint8Array(1))
node_crypto.createSecretKey(Buffer.alloc(16)).type
node_crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1))
node_crypto.pbkdf2Sync("a", "b", 1, 4, "sha256").length
node_crypto.scryptSync("a", "b", 4).length
crypto.randomUUID().length
crypto.subtle.digest("SHA-256", new Uint8Array(1))
node_readline.createInterface({ input: new node_stream.PassThrough() }).close()
node_readline.createInterface({ input: node_stream.Readable.from(["a\\n"]) })[Symbol.asyncIterator]().next()
node_readline.createInterface({ input: new node_stream.PassThrough(), output: new node_stream.PassThrough() }).setPrompt("x")
node_readline_promises.createInterface({ input: new node_stream.PassThrough() }).close()
node_net.createServer().listening
new node_net.Socket().destroyed
new node_net.Socket().on("error", () => {}).readyState
node_net.isIP("1.1.1.1")
new node_net.BlockList().check("1.1.1.1")
new node_net.SocketAddress({ address: "1.1.1.1" }).family
node_http.createServer(() => {}).listening
new node_http.Agent().maxSockets
node_http.globalAgent.protocol
new node_http.IncomingMessage(new node_net.Socket()).headers
new node_http.ServerResponse(new node_http.IncomingMessage(new node_net.Socket())).statusCode
new node_http.ServerResponse(new node_http.IncomingMessage(new node_net.Socket())).setHeader("a", "b").getHeader("a")
new node_http.OutgoingMessage().getHeaderNames().length
node_http.STATUS_CODES[200]
node_http.METHODS.length > 0
node_http.validateHeaderName("a")
node_https.createServer(() => {}).listening
node_https.globalAgent.protocol
node_http2.constants.NGHTTP2_NO_ERROR
node_tls.createSecureContext().context !== 1
node_tls.rootCertificates.length > 0
node_tls.getCiphers().length > 0
node_dgram.createSocket("udp4").close()
node_dns.getServers().length >= 0
new node_dns.Resolver().getServers().length >= 0
new node_dns_promises.Resolver().getServers().length >= 0
node_os.cpus().length > 0
node_os.userInfo().username.length > 0
node_os.networkInterfaces() !== null
node_path.join("a", "b")
node_path.posix.parse("/a/b.c").ext
node_path.win32.basename("a\\\\b")
node_url.parse("http://a/b?c=1", true).query.c
node_url.format({ host: "a" })
node_url.pathToFileURL("/a").href
node_url.fileURLToPath("file:///a")
new node_url.URL("http://a/").searchParams.get("a")
node_querystring.parse("a=1").a
node_querystring.stringify({ a: 1 })
new node_string_decoder.StringDecoder("utf8").write(Buffer.from("a"))
node_assert.strictEqual(1, 1)
node_assert.deepStrictEqual({ a: [1] }, { a: [1] })
node_assert.throws(() => { throw new Error("x"); })
node_assert.rejects(Promise.reject(new Error("x")))
new node_assert.AssertionError({ message: "x" }).code
node_assert_strict.equal(1, 1)
node_perf_hooks.performance.now() > 0
node_perf_hooks.performance.mark("a").name
node_perf_hooks.performance.measure("b").duration >= 0
node_perf_hooks.performance.getEntriesByName("a").length >= 0
node_perf_hooks.performance.timerify(() => 1)()
node_perf_hooks.performance.eventLoopUtilization().idle >= 0
node_perf_hooks.monitorEventLoopDelay().enable()
node_perf_hooks.createHistogram().record(1)
new node_perf_hooks.PerformanceObserver(() => {}).observe({ entryTypes: ["mark"] })
performance.mark("c").name
performance.timeOrigin > 0
performance.toJSON() !== null
node_vm.isContext({})
node_vm.createContext({}) !== null
node_v8.getHeapStatistics().total_heap_size > 0
node_v8.serialize({ a: 1 }).length > 0
node_v8.deserialize(node_v8.serialize({ a: 1 })).a
node_tty.isatty(1)
node_module.builtinModules.length > 0
node_module.isBuiltin("fs")
node_module.findSourceMap("x")
node_diagnostics_channel.channel("a").hasSubscribers
node_diagnostics_channel.subscribe("a", () => {})
node_diagnostics_channel.tracingChannel("a").start.name
node_punycode.encode("a")
node_constants.O_RDONLY
node_console.Console !== undefined
new node_console.Console(new node_stream.PassThrough()).log("a")
new node_console.Console({ stdout: new node_stream.PassThrough(), stderr: new node_stream.PassThrough() }).error("a")
new console.Console(new node_stream.PassThrough()).table([1])
console.log.name
node_domain.create().run(() => 1)
node_trace_events.getEnabledCategories()
node_worker_threads.isMainThread
node_worker_threads.threadId >= 0
new node_worker_threads.MessageChannel().port1.close()
node_worker_threads.getEnvironmentData("a")
node_child_process.ChildProcess.name
node_cluster.isPrimary
new MessageChannel().port1.close()
new BroadcastChannel("a").close()
new EventTarget().addEventListener("a", () => {})
new EventTarget().dispatchEvent(new Event("a"))
new CustomEvent("a", { detail: 1 }).detail
new AbortController().signal.aborted
AbortSignal.timeout(1000).aborted
AbortSignal.any([new AbortController().signal]).aborted
new AbortController().signal.addEventListener("abort", () => {})
node_events.addAbortListener(new AbortController().signal, () => {})[Symbol.dispose]()
structuredClone(new Map([[1, { a: 1 }]])).size
queueMicrotask(() => {})
new TextDecoder().decode(new TextEncoder().encode("a"))
atob(btoa("a"))
new URL("http://a/b").pathname
URL.canParse("http://a/")
navigator.userAgent.length > 0
navigator.hardwareConcurrency > 0
new bun_sqlite.Database(":memory:").query("select 1 as a").get().a
new bun_sqlite.Database(":memory:").prepare("select 1 as a").all().length
new bun_sqlite.Database(":memory:").transaction(() => 1)()
new bun_sqlite.Database(":memory:").close()
bun_jsc.heapSize() > 0
bun_jsc.memoryUsage().current > 0
bun_jsc.describe({}).length > 0
bun_jsc.serialize({ a: 1 }).byteLength > 0
bun_jsc.jscDescribe?.({})
`.split("\n").filter(Boolean);
for (const code of curated) {
  const imports = new Set([...code.matchAll(/\b((?:node|bun)_[a-z0-9_]+?)(?=\.|\b)/g)].map(m => m[1]).filter(l => modules.some(x => x.replace(/[^\w]/g, "_") === l)).map(l => modules.find(x => x.replace(/[^\w]/g, "_") === l)));
  add("curated: " + code, code, code, imports);
}

rmSync(folder, { recursive: true, force: true });
mkdirSync(folder + "/test", { recursive: true });
writeFileSync(folder + "/package.json", `{ "name": "library-sweep", "type": "module" }`);
writeFileSync(folder + "/tsconfig.json", "{}");
const helper = `
function say(v: any): string {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "function") return "function";
  if (t !== "object") return t === "boolean" ? String(v) : t;
  if (typeof v.then === "function") { try { v.then(() => {}, () => {}); } catch {} return "thenable"; }
  return Object.prototype.toString.call(v);
}
function use(id: string, f: () => unknown) {
  let text: string;
  try { text = say(f()); } catch (e: any) { text = "throws " + (e && e.constructor ? e.constructor.name : typeof e); }
  console.log("RESULT|" + WHERE + "|" + id + "|" + text);
}
`;
const manifest = [];
const importsOf = list => [...new Set(list.flatMap(u => [...u.imports]))].map(m => `import * as ${m.replace(/[^\w]/g, "_")} from ${JSON.stringify(m)};`).join("\n");
let file = 0;
const byRoot = new Map();
for (const u of uses) { if (!byRoot.has(u.id)) byRoot.set(u.id, []); byRoot.get(u.id).push(u); }
for (const [root, list] of byRoot) {
  const n = String(file++).padStart(5, "0");
  const lines = list.map(u => `  use(${JSON.stringify(u.id)}, () => ${u.code});`).join("\n");
  writeFileSync(`${folder}/test/here-${n}.test.ts`, `// @ts-nocheck\nimport { test } from "bun:test";\n${importsOf(list)}\nconst WHERE = "here";\n${helper}\ntest("uses", () => {\n${lines}\n});\n`);
  for (const u of list) manifest.push([n, u.root, u.id].join("\t"));
}
writeFileSync(folder + "/manifest.tsv", manifest.join("\n") + "\n");
console.log(uses.length + " uses in " + file + " files, " + new Set(uses.map(u => u.root)).size + " roots");
