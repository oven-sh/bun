// Usage: bun heap-held.ts <plain|lazy>
// Prints the cells that one pending request holds, by type: (count while K requests wait - count before) / K.
// The client is a raw socket, so no client-side promise is counted.
import { heapStats } from "bun:jsc";
import net from "node:net";
const mode = process.argv[2];
const K = 200;
const releases: (() => void)[] = [];
class Lazy<T> extends Promise<T> {
  #start: () => void;
  constructor(work: (resolve: (v: T) => void) => void) {
    let start!: () => void;
    super(resolve => { start = () => work(resolve); });
    this.#start = start;
  }
  then(a?: any, b?: any): any { this.#start(); return super.then(a, b); }
  static get [Symbol.species]() { return Promise; }
}
const server = Bun.serve({
  port: 0,
  idleTimeout: 0,
  fetch() {
    const work = (resolve: (v: Response) => void) => { releases.push(() => resolve(new Response("ok"))); };
    return mode === "lazy" ? new Lazy<Response>(work) : new Promise<Response>(work);
  },
});
const types = ["Promise", "NativePromiseContext", "Function", "JSLexicalEnvironment", "Request", "Object"];
function counts() {
  Bun.gc(true);
  const all = heapStats().objectTypeCounts as Record<string, number>;
  return Object.fromEntries(types.map(t => [t, all[t] ?? 0]));
}
const settle = () => new Promise(r => setImmediate(r));
for (let i = 0; i < 5; i++) await settle();
const before = counts();
const sockets: net.Socket[] = [];
let answered = 0;
for (let i = 0; i < K; i++) {
  const socket = net.connect(server.port, "127.0.0.1");
  socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n"));
  socket.on("data", () => {});
  socket.on("close", () => { answered++; });
  sockets.push(socket);
}
while (releases.length < K) await settle();
for (let i = 0; i < 5; i++) await settle();
const during = counts();
for (const release of releases) release();
while (answered < K) await settle();
const perRequest = Object.fromEntries(types.map(t => [t, ((during[t] - before[t]) / K).toFixed(2)]));
console.log(mode, JSON.stringify(perRequest));
await server.stop(true);
process.exit(0);
