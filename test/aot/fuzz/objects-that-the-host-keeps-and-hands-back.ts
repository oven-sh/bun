// A function makes an object and hands it to the host: a timer, a promise, an event, a signal, a stream, a store of an async context, a socket, a file. The host keeps it.
// Turns of the event loop later the host hands it to a callback that changes it, or writes into it itself. Then the maker reads it again: it knows all about its object only until the host has it.
//
//   objects   a literal, an instance of a class, lists of whole numbers, fractions and objects, a Map, bytes
//   kept by   timers and their arguments, nextTick, timers/promises, promises in every combinator, thenables, Array.fromAsync, EventTarget and the events of the host, EventEmitter, events.once, process.emit,
//             AbortController and AbortSignal, AsyncLocalStorage, web streams, node:stream in object mode, util.promisify and callbackify, a MessageChannel (which hands back a copy), Bun.peek, sockets and servers with `data`
//   written   by the host itself, for bytes: fs.read, a file handle, fs.readv, a reader that brings its own buffer, encodeInto, Buffer.copy
//   changed   a store of another kind, a delete, a new member, an accessor, another prototype, a freeze; elements of another kind, a hole, another length; other bytes, a detached buffer
//   read      before and after, by name and in loops
import type { Random } from "./random";

const prelude = `declare function require(name: string): any;
declare const process: any;
declare const Bun: any;
declare function setImmediate(callback: (...given: any[]) => void, ...given: any[]): unknown;
const { EventEmitter, once } = require("node:events");
const { AsyncLocalStorage } = require("node:async_hooks");
const { Readable, PassThrough } = require("node:stream");
const later = require("node:timers/promises");
const util = require("node:util");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
class Point {
  a: number;
  b = "b";
  c: { d: number } | null;
  constructor(a: number) {
    this.a = a;
    this.c = { d: a };
  }
}
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "THROWS " + (error as Error).constructor.name;
  }
}
function sum(list: ArrayLike<number>): number {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}
function deep(list: { d: number }[]): string {
  let text = "";
  for (let i = 0; i < list.length; i++) text += list[i].d + ";";
  return text;
}
const file = path.join(os.tmpdir(), "kept-by-the-host-" + process.pid + "-" + Math.floor(performance.now() * 1000) + ".txt");
fs.writeFileSync(file, "abcdefghijklmnop");
process.on("exit", () => attempt(() => fs.unlinkSync(file)));
`;

type Kind = "record" | "numbers" | "objects" | "map" | "bytes";
const made: [Kind, string, string][] = [
  ["record", `{ a: seed, b: "b", c: { d: seed } as { d: number } | null }`, `N.a + "," + N.b + "," + attempt(() => N.c!.d) + "," + Object.keys(N).join("+")`],
  ["record", `new Point(seed)`, `N.a + "," + N.b + "," + attempt(() => N.c!.d) + "," + Object.keys(N).join("+")`],
  ["numbers", `[seed, 2, 3]`, `sum(N) + "," + N.length + "," + N[0]`],
  ["numbers", `[seed + 0.5, 1.5]`, `sum(N) + "," + N.length + "," + N[1]`],
  ["objects", `[{ d: seed }, { d: 2 }]`, `attempt(() => deep(N)) + "," + N.length`],
  ["map", `new Map<number, number>([[1, seed]])`, `N.get(1) + "," + N.size`],
  ["bytes", `new Uint8Array([seed & 127, 2, 3, 4, 5, 6, 7, 8])`, `sum(N) + "," + N.length + "," + N[0]`],
];
const changes: Record<Kind, string[]> = {
  record: [`back.a = "text";`, `back.a = 0.5;`, `delete back.b;`, `back.c = null;`, `back.c.d = "deep";`, `back.extra = 1;`, `Object.defineProperty(back, "a", { get() { return "got"; } });`, `Object.setPrototypeOf(back, { b: "above" }); delete back.b;`, `Object.freeze(back);`, `for (let i = 0; i < 70; i++) back["more" + i] = i; back.a = -1;`, ``], // prettier-ignore
  numbers: [`back[0] = "text";`, `back[1] = 0.25;`, `back.length = 0;`, `back.push("more");`, `back[5] = 1;`, `delete back[0];`, `back.reverse();`, `back[0] = null;`, `back[0] = 2 ** 40;`, ``],
  objects: [`back[0] = null;`, `back[0] = { d: "x" };`, `back[1].d = 0.5;`, `back.length = 1;`, `back.push({ e: 1 });`, `delete back[1];`, `back[0] = 7;`, ``],
  map: [`back.set(1, "text");`, `back.clear();`, `back.delete(1);`, `back.set(2, 2);`, ``],
  bytes: [`back[0] = 200;`, `back.fill(9);`, `structuredClone(back.buffer, { transfer: [back.buffer] });`, ``],
};

// `N` is the object, `F` the callback that gets it back and ends the wait.
const keepers = [
  `setTimeout(F, 0, N);`,
  `setTimeout(F, 2, N);`,
  `setImmediate(F, N);`,
  `process.nextTick(F, N);`,
  `const timer = setInterval((back: any) => { clearInterval(timer); F(back); }, 1, N);`,
  `later.setTimeout(1, N).then(F);`,
  `later.setImmediate(N).then(F);`,
  `Promise.resolve(N).then(F);`,
  `Promise.reject(N).catch(F);`,
  `Promise.all([1, N]).then(all => F(all[1]));`,
  `Promise.race([N]).then(F);`,
  `Promise.any([Promise.reject(1), N]).then(F);`,
  `Promise.allSettled([N]).then((all: any) => F(all[0].value));`,
  `Promise.resolve({ then(resolve: (value: unknown) => void) { resolve(N); } }).then(F);`,
  `(Array as any).fromAsync([N]).then((all: any) => F(all[0]));`,
  `(async () => N)().then(F);`,
  `const { promise, resolve } = (Promise as any).withResolvers(); promise.then(F); setTimeout(resolve, 0, N);`,
  `const target = new EventTarget(); target.addEventListener("e", (event: any) => F(event.detail)); setTimeout(() => target.dispatchEvent(new CustomEvent("e", { detail: N })));`,
  `const target = new EventTarget(); target.addEventListener("message", (event: any) => F(event.data)); setTimeout(() => target.dispatchEvent(new MessageEvent("message", { data: N })));`,
  `const emitter = new EventEmitter(); emitter.once("e", F); setTimeout(() => emitter.emit("e", N));`,
  `const emitter = new EventEmitter(); once(emitter, "e").then((all: any) => F(all[0])); emitter.emit("e", N);`,
  `process.once("kept by the host", F); setImmediate(() => process.emit("kept by the host", N));`,
  `const controller = new AbortController(); controller.signal.addEventListener("abort", () => F(controller.signal.reason)); setTimeout(() => controller.abort(N));`,
  `const signal = (AbortSignal as any).any([AbortSignal.abort(N)]); setTimeout(() => F(signal.reason));`,
  `const store = new AsyncLocalStorage(); store.run(N, () => setTimeout(() => F(store.getStore())));`,
  `new ReadableStream({ start(controller) { controller.enqueue(N); controller.close(); } }).getReader().read().then(read => F(read.value));`,
  `new ReadableStream({ pull(controller) { controller.enqueue(N); } }).getReader().read().then(read => F(read.value));`,
  `const through = new TransformStream(); through.writable.getWriter().write(N); through.readable.getReader().read().then(read => F(read.value));`,
  `new WritableStream({ write(chunk) { F(chunk); } }).getWriter().write(N);`,
  `Readable.from([N]).once("data", F);`,
  `const through = new PassThrough({ objectMode: true }); through.once("data", F); through.write(N);`,
  `(async () => { for await (const back of Readable.from([N])) F(back); })();`,
  `util.promisify((given: any, answer: any) => setTimeout(answer, 0, null, given))(N).then(F);`,
  `util.callbackify(async (given: any) => given)(N, (_: unknown, back: any) => F(back));`,
  `const { port1, port2 } = new MessageChannel(); port2.onmessage = (event: any) => { port1.close(); F(event.data); }; port1.postMessage(N);`,
  `const kept = Promise.resolve(N); setTimeout(() => F(Bun.peek(kept)));`,
  `const error = new AggregateError([N], "e", { cause: N }); setTimeout(() => F(error.errors[0] === error.cause ? error.cause : null));`,
  `const server = Bun.listen({ hostname: "127.0.0.1", port: 0, data: N, socket: { open(socket: any) { const back = socket.data; socket.end(); server.stop(true); F(back); }, data() {} } }); Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { open() {}, data() {}, close() {}, error() {} } });`,
  `const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open() {}, data() {} } }); Bun.connect({ hostname: "127.0.0.1", port: server.port, data: N, socket: { open(socket: any) { const back = socket.data; socket.end(); server.stop(true); F(back); }, data() {}, close() {}, error() {} } });`,
  `const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request: Request, self: any) { return self.upgrade(request, { data: N }) ? undefined : new Response("no"); }, websocket: { open(socket: any) { const back = socket.data; socket.close(); server.stop(true); F(back); }, message() {} } }); new WebSocket("ws://127.0.0.1:" + server.port);`,
];
// The host writes by itself. `N` is the bytes, `D` ends the wait.
const writers = [
  `const fd = fs.openSync(file, "r"); fs.read(fd, N, 0, N.length, 0, () => { fs.closeSync(fd); D(); });`,
  `const fd = fs.openSync(file, "r"); fs.read(fd, { buffer: N, position: 3 }, () => { fs.closeSync(fd); D(); });`,
  `const fd = fs.openSync(file, "r"); fs.readv(fd, [N.subarray(0, 2), N.subarray(4)], 1, () => { fs.closeSync(fd); D(); });`,
  `fs.promises.open(file, "r").then(async (handle: any) => { await handle.read(N, 0, 4, 2); await handle.close(); D(); });`,
  `const fd = fs.openSync(file, "r"); fs.readSync(fd, N, 0, 5, 0); fs.closeSync(fd); setTimeout(D);`,
  `new Response("abcdefgh").body!.getReader({ mode: "byob" }).read(N).then(D, D);`,
  `new TextEncoder().encodeInto("zyxw", N); setTimeout(D);`,
  `setTimeout(() => { require("node:buffer").Buffer.from("zyxw").copy(N, 2); D(); });`,
  `new Blob(["zyxwvuts"]).arrayBuffer().then(buffer => { N.set(new Uint8Array(buffer)); D(); });`,
];

function road(random: Random, k: number): string {
  const [kind, make, read] = random.pick(made);
  const byItself = kind === "bytes" && random.chance(0.6);
  const change = byItself ? "" : random.pick(changes[kind]);
  const keep = byItself ? random.pick(writers).replace(/\bN\b/g, "fresh").replace(/\bD\b/g, "ended") : random.pick(keepers).replace(/\bN\b/g, "fresh").replace(/\bF\b/g, "given");
  const look = read.replace(/\bN\b/g, "fresh");
  const turns = random.pick([1, 3, 40]);
  return `async function road${k}(seed: number): Promise<string> {
  const fresh = ${make};
  const before = ${look};
  await new Promise<void>(done => {
    const given = (back: any): void => {
      attempt(() => { ${change} });
      done();
    };
    const ended = (): void => done();
    ${keep}
  }).catch(error => console.log("${k} refused " + (error as Error).constructor.name));
  return before + " | " + ${look};
}
{
  const answers = new Set<string>();
  let answer = "";
  for (let turn = 0; turn < ${turns}; turn++) answers.add((answer = await road${k}(turn)).replace(/\\d+/g, "n"));
  console.log("${k} " + answer + " | " + [...answers].join(" / "));
}`;
}

export function generate(random: Random): string {
  return prelude + Array.from({ length: random.between(2, 6) }, (_, k) => road(random, k)).join("\n") + "\n";
}
