// Species: proxy programs  accessors get the proxy as this. It prints what plain Bun prints.
const log = [];
class Body { constructor() { this.inner = 1; } get value() { log.push(this instanceof Body ? "get body" : "get other"); return this.inner; } set value(v) { log.push("set " + typeof v); this.inner = v; } }
const b = new Body(); b.value; b.value = 2;
const seen = [];
const p = new Proxy(b, { get(t, k, r) { seen.push(String(k)); return Reflect.get(t, k, r); } });
log.push(String(p.value)); p.value = "s"; log.push(typeof b.inner, seen.join());
console.log(log.join("; "));
