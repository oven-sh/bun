// Species: proxy programs  proxy changes prototype and defines accessors. It prints what plain Bun prints.
const log = [];
class Base { kind() { return "base"; } }
class Body extends Base { constructor() { super(); this.hits = 1; } kind() { return "body"; } }
const b = new Body();
const p = new Proxy(b, {});
Object.setPrototypeOf(p, { kind() { return "replaced"; } });
log.push(b.kind(), String(b instanceof Body));
Object.defineProperty(p, "hits", { get() { log.push("getter ran"); return "g"; }, configurable: true });
log.push(String(b.hits), String(new Body().hits), new Body().kind());
console.log(log.join("; "));
