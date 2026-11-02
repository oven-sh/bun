// Run by ./sweep.ts, on the binary that is swept, without --aot: handed.mjs <folder>
// What the library HANDS to a program: arguments and `this` of callbacks, values of promises, what factories return. Servers listen on the loopback address alone, at a port that the
// system picks; children run the binary itself with a line of text.
// Each scenario has one place, %USE%. It is run once here with a probe that lists the members of the objects at that place; then one test file is written for each use.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
const folder = process.argv[2];
process.on("uncaughtException", () => {});
process.on("unhandledRejection", () => {});
const only = process.env.ONLY_MATCH ? new RegExp(process.env.ONLY_MATCH) : null;
const maxMembers = Number(process.env.MEMBERS ?? 45);
const httpServer = `const server = node_http.createServer((q, s) => { s.setHeader("x-a", "b"); s.end("ok"); }); await new Promise(r => server.listen(0, "127.0.0.1", r)); const at = { host: "127.0.0.1", port: server.address().port, path: "/a?b=1", headers: { "x-a": "b" } };`;
const S = [];
const add = (name, objects, code) => S.push({ name, objects, code });

add("http handler", ["req", "res", "req.headers", "req.socket"], `const server = node_http.createServer((req, res) => { done(() => %USE%); try { res.end("ok"); } catch {} }); server.listen(0, "127.0.0.1", () => { node_http.get({ host: "127.0.0.1", port: server.address().port, path: "/a?b=1", headers: { "x-a": "b" } }, r => { r.resume(); r.on("end", () => server.close()); }).on("error", () => server.close()); });`);
add("http request event", ["this"], `const server = node_http.createServer(); server.on("request", function (req, res) { done(() => %USE%); try { res.end("ok"); } catch {} }); server.listen(0, "127.0.0.1", () => { node_http.get({ host: "127.0.0.1", port: server.address().port }, r => { r.resume(); r.on("end", () => server.close()); }).on("error", () => server.close()); });`);
add("http response", ["r", "r.headers"], `${httpServer} node_http.get(at, r => { done(() => %USE%); try { r.resume(); } catch {} server.close(); }).on("error", () => server.close());`);
add("http response chunk", ["chunk"], `${httpServer} node_http.get(at, r => { r.on("data", chunk => done(() => %USE%)); r.on("end", () => server.close()); }).on("error", () => server.close());`);
add("http client request", ["request"], `${httpServer} const request = node_http.get(at, r => { r.resume(); server.close(); }); request.on("error", () => server.close()); done(() => %USE%);`);
add("http client socket event", ["socket"], `${httpServer} node_http.get(at, r => { r.resume(); server.close(); }).on("error", () => server.close()).on("socket", socket => done(() => %USE%));`);
add("http post body", ["chunk"], `const server = node_http.createServer((req, res) => { req.on("data", chunk => done(() => %USE%)); req.on("end", () => res.end("ok")); }); server.listen(0, "127.0.0.1", () => { const q = node_http.request({ host: "127.0.0.1", port: server.address().port, method: "POST" }, r => { r.resume(); r.on("end", () => server.close()); }); q.on("error", () => server.close()); q.end("body"); });`);
add("Bun.serve fetch", ["req", "srv", "req.headers"], `const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req, srv) { done(() => %USE%); return new Response("ok"); } }); try { await (await fetch(server.url)).text(); } catch {} server.stop(true);`);
add("fetch response", ["response", "response.headers", "response.body"], `const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch() { return new Response("ok", { headers: { "x-a": "b" } }); } }); const response = await fetch(server.url); done(() => %USE%); server.stop(true);`);
add("net connection", ["socket"], `const server = node_net.createServer(socket => { socket.on("error", () => {}); done(() => %USE%); try { socket.destroy(); } catch {} server.close(); }); server.listen(0, "127.0.0.1", () => { node_net.connect(server.address().port, "127.0.0.1").on("error", () => {}); });`);
add("net connection event", ["this"], `const server = node_net.createServer(); server.on("connection", function (socket) { socket.on("error", () => {}); done(() => %USE%); socket.destroy(); server.close(); }); server.listen(0, "127.0.0.1", () => { node_net.connect(server.address().port, "127.0.0.1").on("error", () => {}); });`);
add("net client", ["client"], `const server = node_net.createServer(socket => { socket.on("error", () => {}); socket.end("hi"); }); server.listen(0, "127.0.0.1", () => { const client = node_net.connect(server.address().port, "127.0.0.1", () => { done(() => %USE%); try { client.destroy(); } catch {} server.close(); }); client.on("error", () => {}); });`);
add("net data", ["chunk", "this"], `const server = node_net.createServer(socket => { socket.on("error", () => {}); socket.end("hi"); }); server.listen(0, "127.0.0.1", () => { const client = node_net.connect(server.address().port, "127.0.0.1"); client.on("error", () => {}); client.on("data", function (chunk) { done(() => %USE%); client.destroy(); server.close(); }); });`);
add("udp message", ["message", "info", "this"], `const socket = node_dgram.createSocket("udp4"); socket.on("error", () => {}); socket.on("message", function (message, info) { done(() => %USE%); try { socket.close(); } catch {} }); socket.bind(0, "127.0.0.1", () => socket.send("hi", socket.address().port, "127.0.0.1"));`);
add("websocket server message", ["ws", "message"], `const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("no"); }, websocket: { open(ws) { ws.send("hi"); }, message(ws, message) { done(() => %USE%); try { ws.close(); } catch {} } } }); const client = new WebSocket("ws://127.0.0.1:" + server.port); client.onmessage = () => client.send("back"); client.onclose = () => server.stop(true);`);
add("websocket client message", ["event", "event.target"], `const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("no"); }, websocket: { open(ws) { ws.send("hi"); }, message() {} } }); const client = new WebSocket("ws://127.0.0.1:" + server.port); client.onmessage = event => { done(() => %USE%); client.close(); }; client.onclose = () => server.stop(true);`);
add("websocket client close", ["event"], `const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(req, srv) { return srv.upgrade(req) ? undefined : new Response("no"); }, websocket: { open(ws) { ws.close(1000, "bye"); }, message() {} } }); const client = new WebSocket("ws://127.0.0.1:" + server.port); client.onclose = event => { done(() => %USE%); server.stop(true); };`);
add("spawned child", ["child", "child.stdout", "child.stdin", "child.stderr", "child.stdio"], `const child = node_child_process.spawn(process.execPath, ["-e", "console.log(1)"]); child.on("error", () => {}); done(() => %USE%);`);
add("child close", ["code", "signal", "this"], `const child = node_child_process.spawn(process.execPath, ["-e", "console.log(1)"]); child.on("error", () => {}); child.on("close", function (code, signal) { done(() => %USE%); });`);
add("child exit", ["code", "signal"], `const child = node_child_process.spawn(process.execPath, ["-e", "1"]); child.on("error", () => {}); child.on("exit", (code, signal) => done(() => %USE%));`);
add("child stdout data", ["chunk", "this"], `const child = node_child_process.spawn(process.execPath, ["-e", "console.log(1)"]); child.on("error", () => {}); child.stdout.on("data", function (chunk) { done(() => %USE%); });`);
add("execFile callback", ["error", "stdout", "stderr"], `node_child_process.execFile(process.execPath, ["-e", "console.log(1)"], (error, stdout, stderr) => done(() => %USE%));`);
add("spawnSync result", ["result", "result.stdout", "result.output"], `const result = node_child_process.spawnSync(process.execPath, ["-e", "console.log(1)"]); done(() => %USE%);`);
add("Bun.spawn", ["proc", "proc.stdout"], `const proc = Bun.spawn([process.execPath, "-e", "console.log(1)"], { stdout: "pipe" }); done(() => %USE%); await proc.exited;`);
add("Bun.spawn onExit", ["proc", "code", "signal", "error"], `Bun.spawn([process.execPath, "-e", "1"], { onExit(proc, code, signal, error) { done(() => %USE%); } });`);
add("fs.watch", ["type", "name", "this"], `const dir = node_fs.mkdtempSync(import.meta.dir + "/w-"); const watcher = node_fs.watch(dir, function (type, name) { done(() => %USE%); try { watcher.close(); } catch {} node_fs.rmSync(dir, { recursive: true, force: true }); }); node_fs.writeFileSync(dir + "/a", "a");`);
add("fs.watch watcher", ["watcher"], `const dir = node_fs.mkdtempSync(import.meta.dir + "/w-"); const watcher = node_fs.watch(dir, () => {}); done(() => %USE%); try { watcher.close(); } catch {} node_fs.rmSync(dir, { recursive: true, force: true });`);
add("fs.stat callback", ["error", "stats"], `node_fs.stat(import.meta.path, (error, stats) => done(() => %USE%));`);
add("fs.readdir callback", ["list", "list[0]"], `node_fs.readdir(import.meta.dir, { withFileTypes: true }, (error, list) => done(() => %USE%));`);
add("fs.readFile callback", ["data"], `node_fs.readFile(import.meta.path, (error, data) => done(() => %USE%));`);
add("fs.promises.open", ["handle"], `const handle = await node_fs.promises.open(import.meta.path); done(() => %USE%); try { await handle.close(); } catch {}`);
add("fs.promises.stat", ["stats"], `const stats = await node_fs.promises.stat(import.meta.path); done(() => %USE%);`);
add("fs.promises.opendir", ["dir", "entry"], `const dir = await node_fs.promises.opendir(import.meta.dir); const entry = await dir.read(); done(() => %USE%); try { await dir.close(); } catch {}`);
add("fs read stream", ["stream"], `const stream = node_fs.createReadStream(import.meta.path); stream.on("error", () => {}); done(() => %USE%); try { stream.destroy(); } catch {}`);
add("fs read stream data", ["chunk", "this"], `const stream = node_fs.createReadStream(import.meta.path); stream.on("data", function (chunk) { done(() => %USE%); stream.destroy(); });`);
add("fs read stream open", ["fd", "this"], `const stream = node_fs.createReadStream(import.meta.path); stream.on("open", function (fd) { done(() => %USE%); stream.destroy(); });`);
add("readable data", ["chunk", "this"], `node_stream.Readable.from(["a", "b"]).on("data", function (chunk) { done(() => %USE%); });`);
add("readable readable", ["this"], `new node_stream.Readable({ read() { this.push("a"); this.push(null); } }).on("readable", function () { done(() => %USE%); });`);
add("readable read", ["this", "size"], `new node_stream.Readable({ read(size) { done(() => %USE%); this.push(null); } }).resume();`);
add("writable write", ["chunk", "encoding", "callback", "this"], `new node_stream.Writable({ write(chunk, encoding, callback) { done(() => %USE%); try { callback(); } catch {} } }).write("a");`);
add("writable final", ["this"], `new node_stream.Writable({ write(c, e, f) { f(); }, final(callback) { done(() => %USE%); callback(); } }).end("a");`);
add("transform transform", ["chunk", "encoding", "this"], `new node_stream.Transform({ transform(chunk, encoding, callback) { done(() => %USE%); try { callback(null, chunk); } catch {} } }).end("a");`);
add("transform flush", ["this"], `const t = new node_stream.Transform({ transform(c, e, f) { f(null, c); }, flush(callback) { done(() => %USE%); callback(); } }); t.resume(); t.end("a");`);
add("subclass of Readable", ["this"], `new (class extends node_stream.Readable { _read() { done(() => %USE%); this.push(null); } })().resume();`);
add("subclass of Writable", ["this", "chunk"], `new (class extends node_stream.Writable { _write(chunk, e, f) { done(() => %USE%); f(); } })().write("a");`);
add("pipeline source", ["source"], `node_stream.pipeline(node_stream.Readable.from(["a"]), async function* (source) { done(() => %USE%); for await (const c of source) yield c; }, new node_stream.PassThrough().resume(), () => {});`);
add("pipeline callback", ["error"], `node_stream.pipeline(node_stream.Readable.from(["a"]), new node_stream.PassThrough().resume(), error => done(() => %USE%));`);
add("pipeline result", ["last"], `const last = node_stream.pipeline(node_stream.Readable.from(["a"]), new node_stream.PassThrough(), () => {}); done(() => %USE%); last.resume();`);
add("pipe result", ["piped"], `const piped = node_stream.Readable.from(["a"]).pipe(new node_stream.PassThrough()); done(() => %USE%); piped.resume();`);
add("pipe event", ["source", "this"], `const to = new node_stream.PassThrough(); to.on("pipe", function (source) { done(() => %USE%); }); node_stream.Readable.from(["a"]).pipe(to).resume();`);
add("for await of a stream", ["chunk"], `for await (const chunk of node_stream.Readable.from([{ a: 1 }])) done(() => %USE%);`);
add("stream iterator", ["iterator", "step"], `const iterator = node_stream.Readable.from(["a"])[Symbol.asyncIterator](); const step = await iterator.next(); done(() => %USE%);`);
add("readline line", ["line", "this"], `const rl = node_readline.createInterface({ input: node_stream.Readable.from(["a\\nb\\n"]) }); rl.on("line", function (line) { done(() => %USE%); rl.close(); });`);
add("readline interface", ["rl"], `const rl = node_readline.createInterface({ input: new node_stream.PassThrough() }); done(() => %USE%); try { rl.close(); } catch {}`);
add("readline for await", ["line"], `for await (const line of node_readline.createInterface({ input: node_stream.Readable.from(["a\\n"]) })) done(() => %USE%);`);
add("events.once", ["values"], `const e = new node_events.EventEmitter(); const p = node_events.once(e, "x"); e.emit("x", { a: 1 }, 2); const values = await p; done(() => %USE%);`);
add("events.on", ["iterator", "step", "step.value"], `const e = new node_events.EventEmitter(); const iterator = node_events.on(e, "x"); e.emit("x", { a: 1 }); const step = await iterator.next(); done(() => %USE%); iterator.return();`);
add("emitter listener", ["this", "value"], `new node_events.EventEmitter().on("x", function (value) { done(() => %USE%); }).emit("x", { a: 1 });`);
add("emitter newListener", ["name", "listener", "this"], `new node_events.EventEmitter().on("newListener", function (name, listener) { done(() => %USE%); }).on("x", () => {});`);
add("subclass of EventEmitter", ["this"], `new (class extends node_events.EventEmitter { go() { done(() => %USE%); } })().go();`);
add("process listener", ["this", "value"], `process.once("handed", function (value) { done(() => %USE%); }); process.emit("handed", { a: 1 });`);
add("timeout this", ["this"], `setTimeout(function () { done(() => %USE%); }, 1);`);
add("timeout object", ["timer"], `const timer = setTimeout(() => {}, 1); done(() => %USE%); clearTimeout(timer);`);
add("interval this", ["this"], `const timer = setInterval(function () { done(() => %USE%); clearInterval(timer); }, 1);`);
add("immediate this", ["this"], `setImmediate(function () { done(() => %USE%); });`);
add("immediate object", ["immediate"], `const immediate = setImmediate(() => {}); done(() => %USE%);`);
add("timers/promises", ["value"], `const value = await node_timers_promises.setTimeout(1, { a: 1 }); done(() => %USE%);`);
add("timers/promises interval", ["iterator", "step"], `const iterator = node_timers_promises.setInterval(1, { a: 1 }); const step = await iterator.next(); done(() => %USE%); iterator.return();`);
add("abort event", ["event", "this", "event.target"], `const c = new AbortController(); c.signal.addEventListener("abort", function (event) { done(() => %USE%); }); c.abort(new Error("x"));`);
add("abort signal", ["signal", "signal.reason"], `const c = new AbortController(); c.abort(new Error("x")); const signal = c.signal; done(() => %USE%);`);
add("event target listener", ["event", "this"], `const t = new EventTarget(); t.addEventListener("x", function (event) { done(() => %USE%); }); t.dispatchEvent(new CustomEvent("x", { detail: { a: 1 } }));`);
add("message port event", ["event", "event.data", "event.target"], `const c = new MessageChannel(); c.port2.onmessage = event => { done(() => %USE%); c.port1.close(); }; c.port1.postMessage({ a: 1 });`);
add("worker_threads port message", ["value", "this"], `const c = new node_worker_threads.MessageChannel(); c.port2.on("message", function (value) { done(() => %USE%); c.port1.close(); }); c.port1.postMessage({ a: 1 });`);
add("broadcast channel", ["event"], `const a = new BroadcastChannel("handed"), b = new BroadcastChannel("handed"); b.onmessage = event => { done(() => %USE%); a.close(); b.close(); }; a.postMessage({ a: 1 });`);
add("worker message", ["value"], `const w = new node_worker_threads.Worker("require('node:worker_threads').parentPort.postMessage({ a: 1 })", { eval: true }); w.on("error", () => {}); w.on("message", value => { done(() => %USE%); w.terminate(); });`);
add("worker object", ["w"], `const w = new node_worker_threads.Worker("1", { eval: true }); w.on("error", () => {}); done(() => %USE%); w.terminate();`);
add("performance observer", ["list", "observer", "list.getEntries()[0]"], `const o = new node_perf_hooks.PerformanceObserver((list, observer) => { done(() => %USE%); o.disconnect(); }); o.observe({ entryTypes: ["mark"] }); node_perf_hooks.performance.mark("handed");`);
add("performance mark", ["mark"], `const mark = node_perf_hooks.performance.mark("handed"); done(() => %USE%);`);
add("histogram", ["h"], `const h = node_perf_hooks.createHistogram(); h.record(1); done(() => %USE%);`);
add("async local storage", ["store", "als"], `const als = new node_async_hooks.AsyncLocalStorage(); als.run({ a: 1 }, () => { const store = als.getStore(); done(() => %USE%); });`);
add("async local storage later", ["store"], `const als = new node_async_hooks.AsyncLocalStorage(); als.run({ a: 1 }, () => setTimeout(() => { const store = als.getStore(); done(() => %USE%); }, 1));`);
add("async resource", ["this", "value", "resource"], `const resource = new node_async_hooks.AsyncResource("handed"); resource.runInAsyncScope(function (value) { done(() => %USE%); }, { t: 1 }, { a: 1 });`);
add("zlib callback", ["error", "data"], `node_zlib.gzip("a", (error, data) => done(() => %USE%));`);
add("zlib stream", ["z"], `const z = node_zlib.createGzip(); done(() => %USE%); try { z.destroy(); } catch {}`);
add("zlib stream data", ["chunk", "this"], `const z = node_zlib.createGzip(); z.on("data", function (chunk) { done(() => %USE%); }); z.end("a");`);
add("crypto hash", ["hash"], `const hash = node_crypto.createHash("sha256"); done(() => %USE%);`);
add("crypto randomBytes callback", ["error", "data"], `node_crypto.randomBytes(4, (error, data) => done(() => %USE%));`);
add("crypto key", ["key"], `const key = node_crypto.createSecretKey(Buffer.alloc(16)); done(() => %USE%);`);
add("crypto cipher", ["cipher"], `const cipher = node_crypto.createCipheriv("aes-128-cbc", Buffer.alloc(16), Buffer.alloc(16)); done(() => %USE%);`);
add("promisified", ["stats"], `const stats = await node_util.promisify(node_fs.stat)(import.meta.path); done(() => %USE%);`);
add("inspect.custom", ["depth", "options", "inspect"], `node_util.inspect({ [node_util.inspect.custom](depth, options, inspect) { done(() => %USE%); return "x"; } });`);
add("parseArgs", ["parsed", "parsed.values"], `const parsed = node_util.parseArgs({ args: ["--a", "b"], options: { a: { type: "string" } } }); done(() => %USE%);`);
add("diagnostics channel", ["message", "name"], `node_diagnostics_channel.subscribe("handed", (message, name) => done(() => %USE%)); node_diagnostics_channel.channel("handed").publish({ a: 1 });`);
add("diagnostics channel object", ["channel"], `const channel = node_diagnostics_channel.channel("handed"); done(() => %USE%);`);
add("url parse", ["parsed", "parsed.query"], `const parsed = node_url.parse("http://a/b?c=1", true); done(() => %USE%);`);
add("path parse", ["parsed"], `const parsed = node_path.parse("/a/b.c"); done(() => %USE%);`);
add("os", ["cpus[0]", "user"], `const cpus = node_os.cpus(), user = node_os.userInfo(); done(() => %USE%);`);
add("assertion error", ["error"], `let error; try { node_assert.strictEqual(1, 2); } catch (e) { error = e; } done(() => %USE%);`);
add("system error", ["error"], `let error; try { node_fs.readFileSync("/nonexistent/x"); } catch (e) { error = e; } done(() => %USE%);`);
add("argument error", ["error"], `let error; try { node_fs.readFileSync(1.5); } catch (e) { error = e; } done(() => %USE%);`);
add("string decoder", ["decoder"], `const decoder = new node_string_decoder.StringDecoder("utf8"); done(() => %USE%);`);
add("console object", ["c"], `const c = new node_console.Console(new node_stream.PassThrough().resume()); done(() => %USE%);`);
add("domain", ["this", "d"], `const d = node_domain.create(); d.run(function () { done(() => %USE%); });`);
add("readable stream start", ["controller"], `new ReadableStream({ start(controller) { done(() => %USE%); try { controller.close(); } catch {} } });`);
add("readable stream pull", ["controller", "this"], `new ReadableStream({ pull(controller) { done(() => %USE%); try { controller.close(); } catch {} } }).getReader().read();`);
add("byte stream pull", ["controller", "controller.byobRequest"], `new ReadableStream({ type: "bytes", pull(controller) { done(() => %USE%); try { controller.close(); controller.byobRequest?.respond(0); } catch {} } }).getReader({ mode: "byob" }).read(new Uint8Array(4));`);
add("readable stream reader", ["reader", "step"], `const reader = new ReadableStream({ start(c) { c.enqueue({ a: 1 }); c.close(); } }).getReader(); const step = await reader.read(); done(() => %USE%);`);
add("readable stream tee", ["pair", "pair[0]"], `const pair = new ReadableStream({ start(c) { c.close(); } }).tee(); done(() => %USE%);`);
add("readable stream iterator", ["iterator", "step"], `const iterator = new ReadableStream({ start(c) { c.enqueue("a"); c.close(); } })[Symbol.asyncIterator](); const step = await iterator.next(); done(() => %USE%);`);
add("writable stream write", ["chunk", "controller"], `new WritableStream({ write(chunk, controller) { done(() => %USE%); } }).getWriter().write({ a: 1 });`);
add("writable stream writer", ["writer"], `const writer = new WritableStream({ write() {} }).getWriter(); done(() => %USE%);`);
add("transform stream transform", ["chunk", "controller"], `const t = new TransformStream({ transform(chunk, controller) { done(() => %USE%); } }); t.writable.getWriter().write({ a: 1 }); t.readable.getReader().read();`);
add("transform stream ends", ["t.readable", "t.writable"], `const t = new TransformStream(); done(() => %USE%);`);
add("response body reader", ["reader", "step", "step.value"], `const reader = new Response("a").body.getReader(); const step = await reader.read(); done(() => %USE%);`);
add("blob stream", ["stream"], `const stream = new Blob(["a"]).stream(); done(() => %USE%);`);
add("Bun.file stream", ["stream", "step"], `const stream = Bun.file(import.meta.path).stream(); const step = await stream.getReader().read(); done(() => %USE%);`);
add("toWeb", ["web"], `const web = node_stream.Readable.toWeb(node_stream.Readable.from(["a"])); done(() => %USE%);`);
add("fromWeb", ["node"], `const node = node_stream.Readable.fromWeb(new ReadableStream({ start(c) { c.close(); } })); done(() => %USE%); node.resume();`);
add("headers forEach", ["value", "key", "parent"], `new Headers({ a: "b" }).forEach((value, key, parent) => done(() => %USE%));`);
add("search params forEach", ["value", "key", "parent"], `new URLSearchParams("a=b").forEach((value, key, parent) => done(() => %USE%));`);
add("sqlite", ["db", "statement", "row"], `const db = new bun_sqlite.Database(":memory:"); const statement = db.query("select 1 as a"); const row = statement.get(); done(() => %USE%); try { db.close(); } catch {}`);
add("nextTick", ["value"], `process.nextTick(value => done(() => %USE%), { a: 1 });`);
add("hrtime and usage", ["time", "memory", "usage"], `const time = process.hrtime(), memory = process.memoryUsage(), usage = process.resourceUsage(); done(() => %USE%);`);

const modulesIn = code => [...new Set([...code.matchAll(/\b(node|bun)_([a-z0-9_]+?)\b(?=\.)/g)].map(m => m[0]))];
const specifier = local => local.replace(/^(node|bun)_/, "$1:").replace(/_/g, "/").replace("child/process", "child_process").replace("worker/threads", "worker_threads").replace("perf/hooks", "perf_hooks").replace("async/hooks", "async_hooks").replace("string/decoder", "string_decoder").replace("diagnostics/channel", "diagnostics_channel");
const importsOf = code => modulesIn(code).map(l => `import * as ${l} from ${JSON.stringify(specifier(l))};`).join("\n");
const isName = s => /^[A-Za-z_$][\w$]*$/.test(s);
const neverCalled = /^(constructor|exit|abort|execve|dlopen|reallyExit|connect|listen|upgrade|publish\w*|subscribe|unsubscribe|reload|ref|unref|kill|send|disconnect|loadExtension|fileControl|serialize|deserialize|requestIP|timeout|stop|terminate|postMessage|__\w+)$/;

// The probe: each scenario once, listing what stands at its place.
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder + "/test", { recursive: true });
writeFileSync(folder + "/package.json", `{ "name": "handed", "type": "module" }`);
writeFileSync(folder + "/tsconfig.json", "{}");
function membersOf(v) {
  if (v === null || (typeof v !== "object" && typeof v !== "function")) return [];
  const names = new Map();
  for (let p = v, n = 0; p && p !== Object.prototype && p !== Function.prototype && p !== Array.prototype && n < 7; p = Object.getPrototypeOf(p), n++) {
    let own = []; try { own = Object.getOwnPropertyNames(p); } catch {}
    for (const k of own) if (isName(k) && k !== "constructor" && !names.has(k)) { let kind = "value"; try { kind = typeof v[k] === "function" ? "function" : "value"; } catch {} names.set(k, kind); }
  }
  // What is public first; then what begins with an underscore.
  return [...names].sort((a, b) => a[0].startsWith("_") - b[0].startsWith("_")).slice(0, maxMembers);
}
globalThis.__members = membersOf;
const uses = [];
let index = 0;
for (const s of S) {
  if (only && !only.test(s.name)) continue;
  const probe = `({ ${s.objects.map((o, i) => `o${i}: (() => { try { return globalThis.__members(${o}); } catch { return null; } })()`).join(", ")} })`;
  const file = `${folder}/probe-${index++}.mjs`;
  writeFileSync(file, `${importsOf(s.code)}\nexport default () => new Promise(resolve => { let called = false; const done = f => { if (called) return; called = true; let v = null; try { v = f(); } catch {} resolve(v); }; setTimeout(() => resolve(null), 4000); (async function () { ${s.code.replace("%USE%", probe)} }).call(undefined).catch(() => resolve(null)); });\n`);
  let found = null;
  try { found = await (await import(file)).default(); } catch (e) { console.log("the probe of", s.name, "fails:", String(e).slice(0, 120)); }
  rmSync(file, { force: true });
  if (!found) { console.log("nothing at the place of:", s.name); continue; }
  s.objects.forEach((o, i) => {
    const members = found["o" + i];
    if (members === null) return;
    uses.push({ s, id: `${s.name}: ${o}`, use: o });
    for (const [k, kind] of members) {
      uses.push({ s, id: `${s.name}: ${o}.${k}`, use: `${o}.${k}` });
      if (kind === "function" && !neverCalled.test(k)) {
        uses.push({ s, id: `${s.name}: ${o}.${k}()`, use: `${o}.${k}()` });
        uses.push({ s, id: `${s.name}: ${o}.${k}("x", f)`, use: `${o}.${k}("x", () => {})` });
      }
    }
  });
}
const say = `function say(v) {
  if (v === null) return "null";
  const t = typeof v;
  if (t === "function") return "function";
  if (t !== "object") return t === "boolean" ? String(v) : t;
  if (typeof v.then === "function") { try { v.then(() => {}, () => {}); } catch {} return "thenable"; }
  return Object.prototype.toString.call(v);
}`;
const manifest = [];
uses.forEach((u, n) => {
  const name = String(n).padStart(5, "0");
  writeFileSync(`${folder}/test/here-${name}.test.ts`, `// @ts-nocheck\nimport { test } from "bun:test";\n${importsOf(u.s.code)}\n${say}\ntest("use", async () => {\n  const seen = await new Promise(resolve => {\n    let called = false;\n    const done = f => { if (called) return; called = true; let text; try { text = say(f()); } catch (e) { text = "throws " + (e && e.constructor ? e.constructor.name : typeof e); } resolve(text); };\n    (async function () { ${u.s.code.replace("%USE%", u.use)} }).call(undefined).catch(e => resolve("the scenario rejects"));\n  });\n  console.log("RESULT|here|" + ${JSON.stringify(u.id)} + "|" + seen);\n}, 4000);\n`);
  manifest.push([name, u.s.name, u.id].join("\t"));
});
writeFileSync(folder + "/manifest.tsv", manifest.join("\n") + "\n");
console.log(uses.length + " uses in " + uses.length + " files, " + new Set(uses.map(u => u.s.name)).size + " of " + S.length + " scenarios");
process.exit(0);
