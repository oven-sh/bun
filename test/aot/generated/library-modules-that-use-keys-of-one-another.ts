// A module of Bun's library makes a symbol, or keeps an object under a name that only the library can write, and another module of the
// library takes it from there and uses it as a key: node:fs/promises makes the keys under which internal/fs/streams counts who holds a
// file handle, internal/readline/interface those of node:readline, internal/streams/state those of every stream. Each subject here is a
// short program that goes through the public functions behind which such a key is used. `programAbout` puts the import of one more
// module, or of all of them, in front of it: that module is beside the subject in the executable and the subject never calls it.
// The test builds each program as it is and with a package marked as external, which says that code the build has not seen may run.
import { tls } from "harness";
import { builtinModules } from "node:module";

export type Subject = { name: string; text: string; files?: Record<string, string>; entryPoints?: string[] };

const inFolder = (imports: string, body: string) => `${imports}
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = mkdtempSync(join(tmpdir(), "keys-"));
const file = join(folder, "text.txt");
writeFileSync(file, "first\\nsecond\\nthird\\n");
try {
${body}
} catch (error) {
  console.log("THREW", error.name + ": " + error.message);
} finally {
  rmSync(folder, { recursive: true, force: true });
}
`;

const guarded = (imports: string, body: string) => `${imports}
try {
${body}
} catch (error) {
  console.log("THREW", error.name + ": " + error.message);
}
`;

const collector = `let shown = "";
  const output = new Writable({ write(chunk, encoding, done) { shown += chunk; done(); } });`;

export const subjects: Subject[] = [
  {
    name: "a file handle is read as a stream",
    text: inFolder(
      `import { open } from "node:fs/promises";`,
      `  const handle = await open(file, "r");
  handle.on("close", () => console.log("the handle has closed"));
  let text = "";
  for await (const chunk of handle.createReadStream({ encoding: "utf8" })) text += chunk;
  console.log("read", JSON.stringify(text), handle.fd);
  console.log("closed again", await handle.close().then(() => "yes", error => error.code));`,
    ),
  },
  {
    name: "a file handle is written as a stream",
    text: inFolder(
      `import { open } from "node:fs/promises";
import { finished } from "node:stream/promises";`,
      `  const handle = await open(file, "w");
  const stream = handle.createWriteStream();
  stream.write("one ");
  stream.end("two");
  await finished(stream);
  console.log("written", stream.bytesWritten, JSON.stringify(readFileSync(file, "utf8")), handle.fd);`,
    ),
  },
  {
    name: "the lines of a file handle",
    text: inFolder(
      `import { open } from "node:fs/promises";`,
      `  const handle = await open(file, "r");
  for await (const line of handle.readLines()) console.log("line", line);
  console.log("fd", handle.fd);`,
    ),
  },
  {
    name: "the streams of node:fs are handed a file handle",
    text: inFolder(
      `import { createReadStream, createWriteStream } from "node:fs";
import { open } from "node:fs/promises";
import { finished } from "node:stream/promises";`,
      `  const read = await open(file, "r");
  for await (const chunk of createReadStream(null, { fd: read, encoding: "utf8", start: 6 })) console.log("chunk", JSON.stringify(chunk));
  console.log("fd", read.fd);
  const written = await open(file, "a");
  const stream = createWriteStream(null, { fd: written });
  stream.end("fourth\\n");
  await finished(stream);
  console.log(JSON.stringify(readFileSync(file, "utf8")), stream.bytesWritten, written.fd);
  const refused = await open(file, "r");
  try {
    createReadStream(null, { fd: refused, fs: {} });
  } catch (error) {
    console.log(error.code);
  }
  await refused.close();`,
    ),
  },
  {
    name: "every method of a file handle",
    text: inFolder(
      `import { appendFile, open, readFile, writeFile } from "node:fs/promises";`,
      `  const handle = await open(file, "r+");
  console.log("stat", (await handle.stat()).size);
  const { bytesRead, buffer } = await handle.read(Buffer.alloc(5), 0, 5, 0);
  console.log("read", bytesRead, String(buffer));
  console.log("readv", (await handle.readv([Buffer.alloc(2), Buffer.alloc(3)], 6)).bytesRead);
  console.log("write", (await handle.write("FIRST", 0)).bytesWritten);
  console.log("writev", (await handle.writev([Buffer.from("SEC"), Buffer.from("OND")], 6)).bytesWritten);
  await handle.sync();
  await handle.datasync();
  await handle.truncate(12);
  console.log("readFile of the module", JSON.stringify(await readFile(handle, "utf8")));
  await appendFile(handle, "!");
  await handle.appendFile("?");
  await handle.utimes(1, 1);
  await handle.chmod(0o644);
  console.log("mtime", (await handle.stat()).mtimeMs);
  await handle.close();
  console.log(JSON.stringify(readFileSync(file, "utf8")), handle.fd);
  const again = await open(file, "w");
  await writeFile(again, "whole");
  await again.writeFile(" and more");
  await again[Symbol.asyncDispose]();
  console.log(JSON.stringify(readFileSync(file, "utf8")), again.fd);
  const web = await open(file, "r");
  let text = "";
  for await (const chunk of web.readableWebStream()) text += Buffer.from(chunk);
  console.log("web", JSON.stringify(text));
  await web.close();
  console.log("read when closed", await web.read(Buffer.alloc(1)).then(() => "read", error => error.code));`,
    ),
  },
  {
    name: "a file handle is handed to a worker",
    text: inFolder(
      `import { once } from "node:events";
import { open } from "node:fs/promises";
import { Worker } from "node:worker_threads";`,
      `  const handle = await open(file, "r");
  const worker = new Worker(new URL("./reader.mjs", import.meta.url), { workerData: { handle, list: [handle] }, transferList: [handle] });
  console.log("what was sent", handle.fd);
  worker.on("message", message => console.log("the worker has", message));
  console.log("exit", (await once(worker, "exit"))[0]);`,
    ),
    files: {
      "reader.mjs": `import { parentPort, workerData } from "node:worker_threads";
const { handle, list } = workerData;
parentPort.postMessage([handle.constructor.name, handle === list[0], handle.fd > 0, JSON.stringify(await handle.readFile("utf8"))].join(" "));
await handle.close();
`,
    },
    entryPoints: ["reader.mjs"],
  },
  {
    name: "a folder is walked and a file is streamed by its path",
    text: inFolder(
      `import { createReadStream, createWriteStream, ReadStream, WriteStream } from "node:fs";
import { opendir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";`,
      `  const copy = join(folder, "copy.txt");
  const from = createReadStream(file, { highWaterMark: 4 });
  const to = createWriteStream(copy);
  await pipeline(from, to);
  console.log(from instanceof ReadStream, to instanceof WriteStream, from.bytesRead, to.bytesWritten, from.closed, to.closed, from.path === file);
  const names = [];
  for await (const entry of await opendir(folder)) names.push(entry.name + ":" + entry.isFile());
  console.log(names.sort().join(" "));
  const missing = createReadStream(join(folder, "missing"));
  console.log(await new Promise(resolve => missing.on("error", error => resolve(error.code))));`,
    ),
  },
  {
    name: "lines are read out of a stream",
    text: guarded(
      `import { once } from "node:events";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";`,
      `  for await (const line of createInterface({ input: Readable.from(["a\\nb", "c\\r\\nd\\n"]), crlfDelay: Infinity })) console.log("line", line);
  const heard = createInterface({ input: Readable.from(["x\\ny"]) });
  heard.on("line", line => console.log("heard", line));
  heard.on("history", history => console.log("history", history.length));
  await once(heard, "close");
  console.log("closed", heard.closed, heard.terminal);`,
    ),
  },
  {
    name: "a line is edited in a terminal",
    text: guarded(
      `import { clearLine, clearScreenDown, createInterface, cursorTo, emitKeypressEvents, moveCursor } from "node:readline";
import { PassThrough, Writable } from "node:stream";`,
      `  ${collector}
  const input = new PassThrough();
  const lines = createInterface({ input, output, terminal: true, prompt: "> ", historySize: 10, completer: line => [["help", "hello"].filter(word => word.startsWith(line)), line] });
  lines.on("line", line => console.log("line", JSON.stringify(line)));
  const state = what => console.log(what, JSON.stringify(lines.line), lines.cursor, JSON.stringify(lines.getCursorPos()));
  lines.prompt();
  lines.write("hello wide world");
  state("typed");
  for (const key of [
    { ctrl: true, name: "a" }, { name: "right" }, { name: "delete" }, { ctrl: true, name: "e" }, { name: "backspace" }, { meta: true, name: "b" },
    { name: "left" }, { ctrl: true, name: "w" }, { meta: true, name: "f" }, { meta: true, name: "b" }, { meta: true, name: "d" }, { ctrl: true, name: "b" },
    { ctrl: true, name: "f" }, { ctrl: true, name: "h" }, { ctrl: true, name: "d" }, { name: "home" }, { name: "end" }, { ctrl: true, name: "k" },
  ]) {
    lines.write(null, key);
    state((key.ctrl ? "ctrl " : key.meta ? "meta " : "") + key.name);
  }
  lines.write(null, { name: "return" });
  lines.write("second\\n");
  lines.write(null, { name: "up" });
  state("up");
  lines.write(null, { name: "up" });
  state("up");
  lines.write(null, { name: "down" });
  state("down");
  lines.write(null, { ctrl: true, name: "u" });
  state("ctrl u");
  lines.write(null, { ctrl: true, name: "y" });
  state("ctrl y");
  lines.write(null, { ctrl: true, name: "u" });
  lines.write("he");
  lines.write(null, { name: "tab" });
  await new Promise(resolve => setImmediate(resolve));
  state("tab");
  lines.setPrompt("$ ");
  console.log(lines.getPrompt(), JSON.stringify(lines.history));
  lines.pause();
  lines.resume();
  lines.close();
  cursorTo(output, 1, 2);
  moveCursor(output, -1, 1);
  clearLine(output, 0);
  clearScreenDown(output);
  console.log("shown", JSON.stringify(shown));
  const keys = new PassThrough();
  emitKeypressEvents(keys);
  keys.on("keypress", (text, key) => console.log("key", JSON.stringify(text), key.name, key.ctrl, key.meta, key.shift));
  keys.write("a\\x1b[A\\x01");
  await new Promise(resolve => setImmediate(resolve));`,
    ),
  },
  {
    name: "questions are asked",
    text: guarded(
      `import { createInterface } from "node:readline";
import { createInterface as createPromised, Readline } from "node:readline/promises";
import { PassThrough, Writable } from "node:stream";
import { promisify } from "node:util";`,
      `  ${collector}
  const input = new PassThrough();
  const promised = createPromised({ input, output });
  const answer = promised.question("who? ");
  input.write("me\\n");
  console.log("answer", await answer);
  const controller = new AbortController();
  const given = promised.question("again? ", { signal: controller.signal });
  controller.abort();
  console.log(await given.catch(error => error.name + " " + error.code));
  promised.close();
  console.log(await promised.question("late? ").catch(error => error.code));
  const second = new PassThrough();
  const called = createInterface({ input: second, output });
  called.question("what? ", reply => console.log("reply", reply));
  second.write("this\\n");
  const asked = promisify(called.question).call(called, "and? ");
  second.write("that\\n");
  console.log("promisified", await asked);
  called.close();
  await new Readline(output).cursorTo(1).moveCursor(1, 0).clearLine(1).clearScreenDown().commit();
  console.log("shown", JSON.stringify(shown));`,
    ),
  },
  {
    name: "readables and writables go through their states",
    text: guarded(
      `import { once } from "node:events";
import { Duplex, Readable, Writable } from "node:stream";`,
      `  const closed = stream => new Promise(resolve => stream.once("close", resolve));
  const readable = new Readable({ construct(done) { console.log("constructed"); done(); }, read() {}, highWaterMark: 8 });
  readable.setEncoding("utf8");
  console.log(readable.push("ab"), readable.push("cdefgh"), readable.readableLength, readable.readableEncoding, readable.readableFlowing);
  await once(readable, "readable");
  console.log(JSON.stringify(readable.read(3)), readable.readableLength);
  readable.unshift("z");
  console.log(JSON.stringify(readable.read()), readable.readableDidRead, readable.isPaused());
  readable.push(null);
  readable.resume();
  await once(readable, "end");
  console.log(readable.readableEnded, readable.readable, readable.destroyed, readable.closed, readable.readableAborted);
  const chunks = [];
  const writable = new Writable({
    highWaterMark: 4,
    decodeStrings: false,
    writev(all, done) { chunks.push(all.map(({ chunk, encoding }) => chunk + ":" + encoding).join(",")); done(); },
    final(done) { chunks.push("final"); done(); },
  });
  writable.setDefaultEncoding("latin1");
  writable.cork();
  console.log(writable.write("ab"), writable.write("cd", "utf8"), writable.writableCorked, writable.writableLength, writable.writableNeedDrain);
  writable.uncork();
  await once(writable, "drain");
  writable.end("e", () => chunks.push("ended"));
  await once(writable, "close");
  console.log(chunks.join(" | "), writable.writableFinished, writable.writableEnded, writable.writable, writable.errored);
  const broken = new Writable({ write(chunk, encoding, done) { done(new Error("refused")); } });
  broken.on("error", error => console.log("error", error.message));
  broken.write("x", error => console.log("callback", error.message));
  await closed(broken);
  console.log(broken.errored.message, broken.destroyed, broken.writableAborted);
  console.log(broken.write("y", error => console.log("late", error.code)));
  const duplex = new Duplex({ allowHalfOpen: false, read() { this.push(null); }, write(chunk, encoding, done) { done(); } });
  duplex.resume();
  await once(duplex, "close");
  console.log(duplex.writableEnded, duplex.readableEnded, duplex.allowHalfOpen);
  const destroyed = new Readable({ read() {}, destroy(error, done) { console.log("destroy", error?.message); done(error); } });
  destroyed.on("error", error => console.log("told", error.message));
  destroyed.destroy(new Error("gone"));
  await closed(destroyed);
  console.log(destroyed.errored.message, destroyed.readableAborted);`,
    ),
  },
  {
    name: "streams are joined and told to stop",
    text: guarded(
      `import { addAbortSignal, compose, Duplex, finished, isDestroyed, isDisturbed, isErrored, isReadable, isWritable, PassThrough, pipeline, Readable, Transform, Writable } from "node:stream";
import { finished as finishedPromise, pipeline as pipelinePromise } from "node:stream/promises";`,
      `  const upper = () => new Transform({ transform(chunk, encoding, done) { done(null, String(chunk).toUpperCase()); }, flush(done) { done(null, "!"); } });
  let text = "";
  await pipelinePromise(Readable.from(["a", "b"]), upper(), new PassThrough(), async function* (source) { for await (const chunk of source) yield chunk + "-"; }, new Writable({ write(chunk, encoding, done) { text += chunk; done(); } }));
  console.log(text);
  console.log(await new Promise(resolve => pipeline(Readable.from(["a"]), new Transform({ transform(chunk, encoding, done) { done(new Error("in the middle")); } }), new PassThrough(), error => resolve(error.message))));
  console.log((await compose(upper(), upper()).end("x").toArray()).join(""));
  const controller = new AbortController();
  const stopped = addAbortSignal(controller.signal, new Readable({ read() {} }));
  const told = finishedPromise(stopped).catch(error => error.name);
  controller.abort();
  console.log(await told, isErrored(stopped), isDestroyed(stopped), isReadable(stopped), isDisturbed(stopped));
  const early = new PassThrough();
  const stop = finished(early, error => console.log("never"));
  stop();
  early.destroy();
  console.log(await finishedPromise(early).catch(error => error.code), isWritable(early));
  console.log(await Readable.from([1, 2, 3, 4, 5, 6]).filter(n => n % 2 === 0).map(async n => n * 10, { concurrency: 2 }).drop(1).take(2).toArray());
  console.log(await Readable.from([1, 2, 3]).reduce((sum, n) => sum + n, 0), await Readable.from([1, 2]).some(n => n > 1), await Readable.from([1, 2]).every(n => n > 1), await Readable.from([1, 2]).find(n => n > 1));
  console.log(await Readable.from([[1], [2, 3]]).flatMap(list => list).toArray(), await Readable.from(["a"]).asIndexedPairs?.().toArray());
  const second = new AbortController();
  const mapped = Readable.from([1, 2, 3]).map(async (n, { signal }) => new Promise((resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))), { signal: second.signal }).toArray();
  second.abort();
  console.log(await mapped.catch(error => error.name));
  const both = Duplex.from({ readable: Readable.from(["out"]), writable: new Writable({ write(chunk, encoding, done) { console.log("in", String(chunk)); done(); } }) });
  both.end("given");
  console.log((await both.toArray()).join(""));
  console.log((await Duplex.from(async function* (source) { for await (const chunk of source) yield String(chunk) + "?"; }).end("asked").toArray()).join(""));`,
    ),
  },
  {
    name: "streams of Node.js become streams of the web and back",
    text: guarded(
      `import { addAbortSignal, Duplex, finished, isDisturbed, isErrored, isReadable, Readable, Writable } from "node:stream";
import { arrayBuffer, blob, buffer, json, text } from "node:stream/consumers";
import { finished as finishedPromise } from "node:stream/promises";`,
      `  const web = Readable.toWeb(Readable.from(["a", "b"]));
  const parts = [];
  for await (const chunk of web) parts.push(chunk);
  console.log(parts.join(""), web.locked);
  console.log((await Readable.fromWeb(new ReadableStream({ start(controller) { controller.enqueue("x"); controller.enqueue("y"); controller.close(); } }), { encoding: "utf8" }).toArray()).join(""));
  let written = "";
  const writer = Writable.toWeb(new Writable({ write(chunk, encoding, done) { written += chunk; done(); } })).getWriter();
  await writer.write("one");
  await writer.close();
  const back = Writable.fromWeb(new WritableStream({ write(chunk) { written += " " + chunk; } }), { decodeStrings: false });
  back.end("two");
  await finishedPromise(back);
  console.log(written);
  const pair = Duplex.toWeb(new Duplex({ read() { this.push("r"); this.push(null); }, write(chunk, encoding, done) { done(); } }));
  console.log(Object.keys(pair).sort().join(), String((await pair.readable.getReader().read()).value));
  const joined = Duplex.fromWeb(new TransformStream({ transform(chunk, controller) { controller.enqueue(String(chunk).toUpperCase()); } }), { encoding: "utf8" });
  joined.end("shout");
  console.log((await joined.toArray()).join(""));
  const closing = new ReadableStream({ start(controller) { controller.close(); } });
  const done = finishedPromise(closing);
  await closing.getReader().read();
  console.log(await done, isReadable(closing), isDisturbed(closing), isErrored(closing));
  const controller = new AbortController();
  const stopped = addAbortSignal(controller.signal, new ReadableStream({ pull() {} }));
  controller.abort();
  console.log(await stopped.getReader().read().catch(error => error.name), isErrored(stopped));
  console.log(await new Promise(resolve => finished(new WritableStream({ start(controller) { controller.error(new Error("no room")); } }), error => resolve(error.message))));
  console.log(await text(Readable.from(["t", "e"])), await json(Readable.from(['{"a":', "1}"])), (await buffer(Readable.from(["b"]))).length, (await arrayBuffer(Readable.from(["ab"]))).byteLength, (await blob(Readable.from(["abc"]))).size);
  console.log(await text(new Blob(["from a blob"]).stream()));`,
    ),
  },
  {
    name: "emitters and event targets",
    text: guarded(
      `import { addAbortListener, EventEmitter, EventEmitterAsyncResource, getEventListeners, getMaxListeners, on, once, setMaxListeners } from "node:events";`,
      `  const capturing = new EventEmitter({ captureRejections: true });
  capturing.on("error", error => console.log("captured", error.message));
  capturing.on("go", async () => { throw new Error("rejected"); });
  capturing.emit("go");
  await new Promise(resolve => setImmediate(resolve));
  const own = new EventEmitter({ captureRejections: true });
  own[Symbol.for("nodejs.rejection")] = (error, name, ...given) => console.log("own", error.message, name, given.join());
  own.on("go", async () => { throw new Error("again"); });
  own.emit("go", 1, 2);
  await new Promise(resolve => setImmediate(resolve));
  const emitter = new EventEmitter();
  setImmediate(() => { emitter.emit("tick", 1); emitter.emit("tick", 2); emitter.emit("end"); });
  for await (const [value] of on(emitter, "tick", { close: ["end"] })) console.log("tick", value);
  setImmediate(() => emitter.emit("once", "a", "b"));
  console.log(await once(emitter, "once"));
  setImmediate(() => emitter.emit("error", new Error("instead")));
  console.log(await once(emitter, "never").catch(error => error.message));
  const controller = new AbortController();
  const waiting = once(emitter, "never", { signal: controller.signal });
  controller.abort();
  console.log(await waiting.catch(error => error.name), emitter.listenerCount("never"), emitter.listenerCount("error"));
  const target = new EventTarget();
  const heard = () => {};
  target.addEventListener("seen", heard);
  setMaxListeners(3, target, emitter);
  console.log(getEventListeners(target, "seen").length, getMaxListeners(target), getMaxListeners(emitter), getEventListeners(emitter, "x").length);
  setImmediate(() => target.dispatchEvent(new Event("seen")));
  console.log((await once(target, "seen"))[0].type);
  const second = new AbortController();
  second.signal.addEventListener("abort", event => event.stopImmediatePropagation());
  const disposable = addAbortListener(second.signal, () => console.log("told of the abort"));
  second.abort();
  disposable[Symbol.dispose]();
  const resource = new EventEmitterAsyncResource({ name: "made" });
  resource.on("go", () => console.log("in a resource", typeof resource.asyncId, resource.asyncResource.constructor.name));
  resource.emit("go");
  resource.emitDestroy();`,
    ),
  },
  {
    name: "functions that take a callback are promisified",
    text: inFolder(
      `import { closeSync, exists, openSync, read, readv, write, writev } from "node:fs";
import { lookup } from "node:dns";
import { finished, pipeline, Readable, PassThrough } from "node:stream";
import { callbackify, promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { pbkdf2, randomBytes, scrypt } from "node:crypto";`,
      `  const fd = openSync(file, "r+");
  const keys = value => Object.keys(value).join();
  console.log(keys(await promisify(read)(fd, Buffer.alloc(3), 0, 3, 0)), keys(await promisify(write)(fd, "x", 0)), keys(await promisify(readv)(fd, [Buffer.alloc(1)], 0)), keys(await promisify(writev)(fd, [Buffer.from("y")], 0)));
  closeSync(fd);
  console.log(await promisify(exists)(file), await promisify(exists)(file + "?"));
  console.log(await promisify(setTimeout)(1, "late"), await promisify(setImmediate)("soon"));
  console.log(keys(await promisify(lookup)("127.0.0.1")));
  console.log(String(await promisify(gunzip)(await promisify(gzip)("packed"))));
  console.log((await promisify(randomBytes)(4)).length, (await promisify(pbkdf2)("a", "b", 1, 4, "sha1")).toString("hex"), (await promisify(scrypt)("a", "b", 4)).toString("hex"));
  const through = new PassThrough();
  through.resume();
  await promisify(pipeline)(Readable.from(["a"]), through);
  console.log(await promisify(finished)(through), promisify(finished).name, promisify(pipeline).name);
  console.log(await new Promise(resolve => callbackify(async value => value + 1)(1, (error, value) => resolve(value))));
  function own(done) { done(null, "not this"); }
  own[promisify.custom] = async () => "its own";
  console.log(await promisify(own)(), promisify(own) === own[promisify.custom]);`,
    ),
  },
  {
    name: "sockets talk to a server",
    text: guarded(
      `import { once } from "node:events";
import { connect, createServer, isIP, Socket } from "node:net";`,
      `  const server = createServer({ allowHalfOpen: true }, socket => {
    socket.setEncoding("utf8");
    let text = "";
    socket.on("data", chunk => (text += chunk));
    socket.on("end", () => socket.end("echo " + text));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port, family } = server.address();
  const client = connect({ port, host: "127.0.0.1" });
  console.log(client.connecting, client.pending, client.readyState);
  client.setTimeout(60000, () => console.log("never"));
  client.setNoDelay(true).setKeepAlive(true, 1000).ref().unref().ref();
  await once(client, "connect");
  console.log(client.connecting, client.readyState, client.remoteAddress, client.remotePort === port, client.remoteFamily, family, client.timeout);
  client.cork();
  client.write("a");
  client.write("b");
  client.uncork();
  client.end("c");
  let answer = "";
  for await (const chunk of client) answer += chunk;
  console.log(answer, client.bytesWritten, client.bytesRead, client.destroyed, client.readyState);
  console.log(await new Promise(resolve => server.getConnections((error, count) => resolve(count))), server.listening);
  server.close();
  await once(server, "close");
  console.log(server.listening, server.address());
  const refused = connect({ port, host: "127.0.0.1" });
  console.log((await once(refused, "error"))[0].code, refused.destroyed);
  const idle = new Socket();
  idle.setTimeout(5);
  idle.on("timeout", () => console.log("idle"));
  const holdsTheLoop = setInterval(() => {}, 1000);
  await once(idle, "timeout");
  clearInterval(holdsTheLoop);
  idle.destroy();
  console.log(isIP("::1"), idle.destroyed);`,
    ),
  },
  {
    name: "a server of node:http answers a client",
    text: guarded(
      `import { once } from "node:events";
import { Agent, createServer, get, request, STATUS_CODES } from "node:http";`,
      `  const server = createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", chunk => (body += chunk));
    req.on("end", () => {
      res.setHeader("x-one", "1");
      res.appendHeader("x-many", "a");
      res.appendHeader("x-many", "b");
      res.removeHeader("x-none");
      console.log("server", req.method, req.url, req.httpVersion, req.headers["x-sent"], req.complete, res.hasHeader("x-one"), res.getHeaderNames().join(), JSON.stringify(req.trailers));
      if (req.url === "/chunks") {
        res.writeHead(201, "Made", { trailer: "x-last" });
        res.write("first ");
        res.cork();
        res.write("second ");
        res.uncork();
        res.addTrailers({ "x-last": "end" });
        res.end("third");
      } else res.end("got " + body);
      console.log("sent", res.headersSent, res.writableEnded, res.statusCode, res.statusMessage);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  const read = async response => {
    let text = "";
    response.setEncoding("utf8");
    for await (const chunk of response) text += chunk;
    return text;
  };
  const posted = request({ port, host: "127.0.0.1", method: "POST", path: "/post", agent, headers: { "x-sent": "yes" } });
  posted.setTimeout(60000);
  posted.write("some ");
  posted.end("body");
  const [first] = await once(posted, "response");
  console.log("client", first.statusCode, first.statusMessage, first.headers["x-one"], first.headers["x-many"], await read(first), first.complete, posted.getHeader("x-sent"), posted.path, posted.method, posted.reusedSocket);
  const [second] = await once(get({ port, host: "127.0.0.1", path: "/chunks", agent }), "response");
  console.log("client", second.statusCode, second.statusMessage, second.headers["transfer-encoding"], await read(second), JSON.stringify(second.trailers), second.rawTrailers.join());
  agent.destroy();
  const stopped = get({ port, host: "127.0.0.1", path: "/never" });
  stopped.destroy(new Error("given up"));
  console.log((await once(stopped, "error"))[0].message, stopped.destroyed, STATUS_CODES[404]);
  server.closeAllConnections();
  server.close();
  await once(server, "close");
  console.log(server.listening);`,
    ),
  },
  {
    name: "a server of node:https answers a client",
    text: guarded(
      `import { once } from "node:events";
import { Agent, createServer, get, globalAgent } from "node:https";
import { connect, createSecureContext, getCiphers, rootCertificates } from "node:tls";`,
      `  const cert = ${JSON.stringify(tls.cert)};
  const key = ${JSON.stringify(tls.key)};
  const server = createServer({ cert, key }, (req, res) => {
    console.log("server", req.url, req.socket.encrypted, typeof req.socket.getPeerCertificate);
    res.end("secret");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const agent = new Agent({ keepAlive: false, rejectUnauthorized: false });
  const [response] = await once(get({ port, host: "127.0.0.1", path: "/over-tls", agent }), "response");
  let text = "";
  for await (const chunk of response) text += chunk;
  console.log("client", response.statusCode, text, response.socket.encrypted, agent.defaultPort, agent.protocol, globalAgent.defaultPort);
  agent.destroy();
  const socket = connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
  await once(socket, "secureConnect");
  console.log(socket.encrypted, socket.authorized, typeof socket.getProtocol(), typeof socket.getCipher().name);
  socket.destroy();
  server.closeAllConnections();
  server.close();
  await once(server, "close");
  console.log(typeof createSecureContext({ cert, key }).context, getCiphers().length > 0, rootCertificates.length > 0);`,
    ),
  },
  {
    name: "a session of node:http2",
    text: guarded(
      `import { once } from "node:events";
import { connect, constants, createServer, getDefaultSettings } from "node:http2";`,
      `  const server = createServer();
  server.on("stream", (stream, headers) => {
    console.log("server", headers[":method"], headers[":path"], headers["x-sent"]);
    stream.respond({ ":status": 200, "x-answer": "yes" });
    stream.end("over two");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const session = connect("http://127.0.0.1:" + server.address().port);
  const stream = session.request({ ":path": "/two", "x-sent": "1" });
  stream.setEncoding("utf8");
  const [headers] = await once(stream, "response");
  let text = "";
  for await (const chunk of stream) text += chunk;
  console.log("client", headers[":status"], headers["x-answer"], text, stream.closed, stream.rstCode, session.closed, session.destroyed, session.encrypted);
  await new Promise(resolve => session.close(resolve));
  console.log(session.closed, constants.NGHTTP2_NO_ERROR, typeof getDefaultSettings().maxFrameSize);
  server.close();
  await once(server, "close");`,
    ),
  },
  {
    name: "web sockets of the package ws",
    text: guarded(
      `import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";`,
      `  const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
  server.on("connection", (socket, request) => {
    console.log("server", request.url, request.headers.upgrade, server.clients.size);
    socket.on("message", (data, isBinary) => socket.send("echo " + data, () => socket.close(1000, "done")));
  });
  await once(server, "listening");
  const client = new WebSocket("ws://127.0.0.1:" + server.address().port + "/path");
  await once(client, "open");
  client.send("hello");
  const [data, isBinary] = await once(client, "message");
  console.log("client", String(data), isBinary, client.readyState === WebSocket.OPEN);
  const [code, reason] = await once(client, "close");
  console.log(code, String(reason), client.readyState === WebSocket.CLOSED);
  await new Promise(resolve => server.close(resolve));`,
    ),
  },
  {
    name: "datagrams",
    text: guarded(
      `import { createSocket } from "node:dgram";
import { once } from "node:events";`,
      `  const socket = createSocket({ type: "udp4", reuseAddr: true });
  socket.bind(0, "127.0.0.1");
  await once(socket, "listening");
  const { port, address, family } = socket.address();
  socket.setBroadcast(true);
  socket.setTTL(64);
  socket.ref().unref().ref();
  console.log(address, family, socket.getRecvBufferSize() > 0, socket.getSendBufferSize() > 0, socket.getSendQueueCount(), socket.getSendQueueSize());
  const sender = createSocket("udp4");
  sender.send(["two ", "parts"], port, "127.0.0.1", error => console.log("sent", error));
  const [message, from] = await once(socket, "message");
  console.log(String(message), from.address, from.family, from.size);
  sender.connect(port, "127.0.0.1");
  await once(sender, "connect");
  console.log(sender.remoteAddress().port === port);
  sender.send("connected");
  console.log(String((await once(socket, "message"))[0]));
  sender.disconnect();
  sender.close();
  await once(sender, "close");
  socket.close(() => console.log("closed"));
  await once(socket, "close");
  try {
    socket.send("late", port);
  } catch (error) {
    console.log(error.code);
  }`,
    ),
  },
  {
    name: "bytes are packed and unpacked in streams",
    text: guarded(
      `import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { brotliCompressSync, brotliDecompressSync, constants, crc32, createBrotliCompress, createBrotliDecompress, createDeflate, createGunzip, createGzip, createInflate, deflateSync, gunzipSync, inflateSync } from "node:zlib";`,
      `  for (const [name, pack, unpack] of [["gzip", createGzip, createGunzip], ["deflate", createDeflate, createInflate], ["brotli", createBrotliCompress, createBrotliDecompress]]) {
    const packer = pack();
    const unpacker = unpack();
    let text = "";
    await pipeline(Readable.from(["aaaa", "bbbb"]), packer, unpacker, async source => { for await (const chunk of source) text += chunk; });
    console.log(name, text, packer.bytesWritten, unpacker.bytesWritten > 0, packer.destroyed, packer.constructor.name);
  }
  const level = createDeflate({ level: 1 });
  level.resume();
  level.write("x");
  await new Promise(resolve => level.params(9, constants.Z_DEFAULT_STRATEGY, resolve));
  await new Promise(resolve => level.flush(resolve));
  level.reset();
  await new Promise(resolve => level.close(resolve));
  console.log(level.destroyed, String(inflateSync(deflateSync("sync"))), String(brotliDecompressSync(brotliCompressSync("br"))), crc32("abc"));
  try {
    gunzipSync(Buffer.from("not packed"));
  } catch (error) {
    console.log(error.code, error.errno);
  }
  const bad = createGunzip();
  bad.end("not packed");
  console.log(await new Promise(resolve => bad.on("error", error => resolve(error.code))));`,
    ),
  },
  {
    name: "hashes, ciphers and keys",
    text: guarded(
      `import { createCipheriv, createDecipheriv, createHash, createHmac, createPrivateKey, createPublicKey, createSecretKey, createSign, createVerify, generateKeyPairSync, KeyObject, sign, subtle, verify } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";`,
      `  const hash = createHash("sha256");
  await pipeline(Readable.from(["a", "b"]), hash);
  console.log(hash.read().toString("hex").slice(0, 16), createHash("sha1").update("ab").copy().digest("base64"), createHmac("md5", "key").update("ab").digest("hex"));
  const secret = createSecretKey(Buffer.alloc(32, 1));
  console.log(secret.type, secret.symmetricKeySize, secret.equals(createSecretKey(Buffer.alloc(32, 1))), secret.export().length, secret.export({ format: "jwk" }).kty, secret instanceof KeyObject);
  const iv = Buffer.alloc(16, 2);
  const cipher = createCipheriv("aes-256-cbc", secret, iv);
  const packed = Buffer.concat([cipher.update("hidden"), cipher.final()]);
  const decipher = createDecipheriv("aes-256-cbc", secret, iv);
  console.log(packed.toString("hex"), decipher.update(packed, undefined, "utf8") + decipher.final("utf8"));
  const streamed = createCipheriv("aes-256-cbc", secret, iv);
  streamed.end("hidden");
  console.log(Buffer.concat(await streamed.toArray()).equals(packed));
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  console.log(publicKey.type, privateKey.type, publicKey.asymmetricKeyType, verify(null, Buffer.from("m"), publicKey, sign(null, Buffer.from("m"), privateKey)));
  console.log(createPublicKey(privateKey).equals(publicKey), createPrivateKey(privateKey.export({ type: "pkcs8", format: "pem" })).equals(privateKey));
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  console.log(createVerify("sha256").update("m").verify(pair.publicKey, createSign("sha256").update("m").sign(pair.privateKey)), JSON.stringify(pair.publicKey.asymmetricKeyDetails));
  const webKey = await subtle.importKey("raw", Buffer.alloc(16, 3), "AES-GCM", true, ["encrypt"]);
  console.log(KeyObject.from(webKey).symmetricKeySize, secret.toCryptoKey?.("AES-CBC", true, ["encrypt"]).type);`,
    ),
  },
  {
    name: "queries of Bun.SQL on a database in memory",
    text: guarded(
      `import { SQL } from "bun";`,
      `  const sql = new SQL("sqlite://:memory:");
  await sql\`create table things (id integer primary key, name text)\`;
  await sql\`insert into things \${sql([{ id: 1, name: "one" }, { id: 2, name: "two" }, { id: 3, name: "three" }])}\`;
  console.log(JSON.stringify(await sql\`select * from things where id in \${sql([1, 3])} order by id\`));
  console.log(JSON.stringify(await sql\`select name from things where id = \${2}\`.values()), JSON.stringify(await sql\`select \${sql("name")} from things order by id limit 1\`));
  const query = sql\`select count(*) as n from things\`;
  console.log(query.active, query.cancelled, JSON.stringify(await query.execute()), query.active);
  console.log(JSON.stringify(await sql.unsafe("select id from things where id > ? order by id", [1])));
  await sql\`update things set \${sql({ name: "uno" })} where id = 1\`;
  console.log(await sql.begin(async inside => {
    await inside\`insert into things (id, name) values (4, 'four')\`;
    await inside.savepoint(async deeper => { await deeper\`delete from things where id = 2\`; });
    return (await inside\`select count(*) as n from things\`)[0].n;
  }));
  console.log(await sql.begin(async inside => {
    await inside\`delete from things\`;
    throw new Error("taken back");
  }).catch(error => error.message), (await sql\`select count(*) as n from things\`)[0].n, (await sql\`select name from things where id = 1\`)[0].name);
  console.log(await sql\`select * from nothing\`.catch(error => error.name + " " + error.code));
  const result = await sql\`select 1 as a\`;
  console.log(result.count, result.command, Array.isArray(result));
  await sql.close();
  console.log(await sql\`select 1\`.catch(error => error.code));`,
    ),
  },
  {
    name: "timers",
    text: guarded(
      `import { clearTimeout as clear, setTimeout as later } from "node:timers";
import { scheduler, setImmediate as soon, setInterval as every, setTimeout as wait } from "node:timers/promises";`,
      `  const timer = later(() => console.log("never"), 60000);
  console.log(timer.hasRef(), timer.unref().hasRef(), timer.ref().hasRef(), timer.refresh() === timer, typeof timer[Symbol.toPrimitive](), timer.constructor.name);
  clear(+timer);
  const closed = later(() => console.log("never"), 60000);
  closed.close();
  closed[Symbol.dispose]();
  console.log(await wait(1, "waited"), await soon("soon"));
  let turns = 0;
  for await (const value of every(1, "turn")) if (++turns === 3) break;
  console.log(turns);
  const controller = new AbortController();
  const stopped = wait(60000, "never", { signal: controller.signal });
  controller.abort();
  console.log(await stopped.catch(error => error.name + " " + error.code));
  await scheduler.wait(1);
  await scheduler.yield();
  console.log(await wait(1, "unref", { ref: true }));`,
    ),
  },
  {
    name: "stores that follow asynchronous calls",
    text: guarded(
      `import { AsyncLocalStorage, AsyncResource, executionAsyncId } from "node:async_hooks";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";`,
      `  const store = new AsyncLocalStorage();
  await store.run("outer", async () => {
    await null;
    console.log(store.getStore());
    await store.run("inner", async () => { await new Promise(resolve => setTimeout(resolve, 1)); console.log(store.getStore()); });
    console.log(store.exit(() => store.getStore()), store.getStore());
    for await (const chunk of Readable.from(["in a stream"])) console.log(chunk, store.getStore());
  });
  const snapshot = store.run("kept", () => AsyncLocalStorage.snapshot());
  const bound = store.run("bound", () => AsyncLocalStorage.bind(() => store.getStore()));
  console.log(snapshot(() => store.getStore()), bound(), store.getStore());
  const resource = store.run("of the resource", () => new AsyncResource("made"));
  console.log(resource.runInAsyncScope(() => store.getStore()), typeof resource.asyncId(), typeof resource.triggerAsyncId(), typeof executionAsyncId(), resource.bind(() => store.getStore())());
  resource.emitDestroy();
  const emitter = new EventEmitter();
  store.run("where it listens", () => emitter.on("go", () => console.log(store.getStore())));
  store.run("where it emits", () => emitter.emit("go"));
  store.enterWith("entered");
  await null;
  console.log(store.getStore());
  store.disable();
  console.log(store.getStore());`,
    ),
  },
  {
    name: "a console on streams, and the streams of the process",
    text: guarded(
      `import { Console } from "node:console";
import { Writable } from "node:stream";
import { isatty } from "node:tty";`,
      `  ${collector}
  const made = new Console({ stdout: output, stderr: output, colorMode: false });
  made.log("a %s", "line");
  made.group("group");
  made.error({ nested: [1, { deep: true }] });
  made.groupEnd();
  made.table([{ a: 1 }]);
  made.count();
  made.assert(false, "asserted");
  made.dir({ shown: 1 }, { depth: 0 });
  console.log(JSON.stringify(shown));
  await new Promise(resolve => process.stdout.write("written to the process\\n", resolve));
  console.log(process.stdout.fd, process.stderr.fd, process.stdout.writable, process.stdout.destroyed, process.stdout.writableLength, typeof process.stdout.isTTY, typeof isatty(1), process.stdout.constructor.name === process.stderr.constructor.name);`,
    ),
  },
  {
    name: "a child sorts what it is sent",
    text: guarded(
      `import { exec, execSync, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";`,
      `  const lines = text => String(text).split(/\\r?\\n/).filter(line => line).join();
  const child = spawn("sort", [], { stdio: ["pipe", "pipe", "inherit"] });
  child.stdin.write("b\\n");
  child.stdin.end("a\\n");
  let text = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", chunk => (text += chunk));
  const [code, signal] = await once(child, "close");
  console.log(lines(text), code, signal, child.exitCode, child.killed, child.connected, typeof child.pid, child.stdin.destroyed, child.stdio.length, child.spawnfile);
  console.log(lines(spawnSync("sort", { input: "d\\nc\\n" }).stdout), lines(execSync("echo said")));
  const { stdout, stderr } = await promisify(exec)("echo promised");
  console.log(lines(stdout), JSON.stringify(stderr));
  const missing = spawn("a-program-that-is-not-there");
  console.log((await once(missing, "error"))[0].code);`,
    ),
  },
  {
    name: "errors of emitters inside a domain",
    text: guarded(
      `import { create } from "node:domain";
import { EventEmitter } from "node:events";`,
      `  const domain = create();
  domain.on("error", error => console.log("the domain heard", error.message, error.domainEmitter?.constructor.name, error.domainThrown));
  const emitter = new EventEmitter();
  domain.add(emitter);
  emitter.emit("error", new Error("from a member"));
  domain.run(() => new EventEmitter().emit("error", new Error("from one made inside")));
  console.log(emitter.domain === domain, domain.bind((a, b) => a + b)(1, 2));
  domain.remove(emitter);
  console.log(emitter.domain === domain);
  domain.exit();`,
    ),
  },
  {
    name: "requests and responses of the package undici",
    text: guarded(
      `import { once } from "node:events";
import { createServer } from "node:http";
import { fetch, FormData, Headers, request, Request, Response } from "undici";`,
      `  const server = createServer((req, res) => res.end("served " + req.url));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  console.log(await (await fetch(origin + "/fetched")).text());
  const { statusCode, body } = await request(origin + "/requested");
  console.log(statusCode, await body.text());
  console.log(new Headers({ a: "1" }).get("a"), new Request(origin, { method: "POST" }).method, await new Response("made").text(), [...new FormData().keys()].length);
  server.closeAllConnections();
  server.close();
  await once(server, "close");`,
    ),
  },
];

// `bun:test` is there only under `bun test`. The others say something, wait for something or start something when they are loaded.
const notBeside = new Set([
  "bun:test",
  "repl",
  "inspector",
  "inspector/promises",
  "trace_events",
  "wasi",
  "sys",
  "punycode",
  "_stream_wrap",
  "_tls_common",
  "_tls_wrap",
]);

export const modulesBeside: string[] = builtinModules
  .filter(name => !notBeside.has(name))
  .map(name => (name.includes(":") || name === "bun" || name === "ws" || name === "undici" ? name : `node:${name}`));

export function programAbout(subject: Subject, beside: string[]): string {
  return beside.map(name => `import ${JSON.stringify(name)};\n`).join("") + subject.text;
}
