// A proxy without traps is handed to Object.setPrototypeOf and Object.defineProperty: the target gets another prototype and an accessor in the place of a field, other instances of its class keep theirs.
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
