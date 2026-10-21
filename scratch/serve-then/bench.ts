// Usage: bun bench.ts <mode> <requests>
// Serves <requests> requests, then exits. Prints the port on stdout first.
import vm from "node:vm";
const mode = process.argv[2];
const total = Number(process.argv[3]);
let seen = 0;
const done = () => {
  if (++seen === total) setTimeout(() => { server.stop(true); process.exit(0); }, 200);
};
class Eager<T> extends Promise<T> {}
class Deferred<T> extends Promise<T> {
  resolve!: (v: T) => void;
  constructor() { let r!: (v: T) => void; super(res => { r = res; }); this.resolve = r; }
}
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
class Placeholder<T> extends Promise<T> {
  #inner: Promise<T>;
  constructor(inner: Promise<T>) { super(resolve => resolve(null as any)); this.#inner = inner; }
  then(a?: any, b?: any): any { return this.#inner.then(a, b); }
}
const otherPending = vm.runInNewContext("(later, make) => new Promise(resolve => later(() => resolve(make())))");
const handlers: Record<string, (req: Request) => any> = {
  // a Response, returned synchronously
  "sync": () => { done(); return new Response("ok"); },
  // a native promise that the first drain fulfils
  "async-fulfilled": async () => { done(); return new Response("ok"); },
  // a native promise that is still pending after the first drain
  "async-pending": () => { done(); return new Promise(r => setImmediate(() => r(new Response("ok")))); },
  // pending promises that are not plain and have no then() of their own
  "pending-eager": () => { done(); return new Eager(r => setImmediate(() => r(new Response("ok")))); },
  "pending-deferred": () => { done(); const d = new Deferred<Response>(); setImmediate(() => d.resolve(new Response("ok"))); return d; },
  "pending-props": () => { done(); return Object.assign(new Promise(r => setImmediate(() => r(new Response("ok")))), { json() {}, text() {} }); },
  "pending-other-realm": () => { done(); return otherPending(setImmediate, () => new Response("ok")); },
  // values whose answer changes
  "lazy": () => { done(); return new Lazy<Response>(resolve => resolve(new Response("ok"))); },
  "lazy-later": () => { done(); return new Lazy<Response>(resolve => setImmediate(() => resolve(new Response("ok")))); },
  "placeholder": () => { done(); return new Placeholder(Promise.resolve(new Response("ok"))); },
  "invalid-object": () => { done(); return { forgot: true }; },
  "invalid-async-string": async () => { done(); return "plain string"; },
  // the same values from an `async` handler
  "async-lazy": async () => { done(); return new Lazy<Response>(resolve => resolve(new Response("ok"))); },
  "async-placeholder": async () => { done(); return new Placeholder(Promise.resolve(new Response("ok"))); },
};
// zone.js replaces Promise.prototype.then. "zone-<mode>" runs <mode> in such a process.
if (mode.startsWith("zone-")) {
  const then = Promise.prototype.then;
  Promise.prototype.then = function (this: any, a: any, b: any) { return then.call(this, a, b); } as any;
  handlers[mode] = handlers[mode.slice(5)];
}
const h2 = process.env.BENCH_PROTO === "h2";
const server = Bun.serve({ port: 0, development: false, idleTimeout: 5, ...(h2 ? { http2: true } : {}), fetch: handlers[mode] } as any);
console.log(server.port);
