// What cannot touch a private name: freezing, sealing, deleting, defining, another prototype, a proxy, JSON, spread, keys.
class A { #x = 1; y = 2; inc() { return ++this.#x; } static get(o: any) { return o.#x; } static has(o: any) { return #x in o; } }
function attempt(name: string, f: () => unknown) { try { console.log(name, f()); } catch (e: any) { console.log(name, e instanceof TypeError, e.constructor.name); } }
const frozen = Object.freeze(new A()), sealed = Object.seal(new A()), closed = Object.preventExtensions(new A());
attempt("frozen", () => frozen.inc() + frozen.inc()); attempt("sealed", () => sealed.inc()); attempt("closed", () => closed.inc());
const other = new A(); Object.setPrototypeOf(other, null); attempt("no prototype", () => A.get(other) + A.prototype.inc.call(other));
const gone: any = new A(); delete gone.y; gone.z = 1; attempt("deleted", () => gone.inc() + Object.keys(gone).join());
const defined: any = new A(); Object.defineProperty(defined, "y", { get() { return 5; } }); Object.defineProperty(defined, "#x", { value: 100 }); attempt("defined", () => defined.inc() + defined.y + defined["#x"]);
const a = new A(); attempt("json", () => JSON.stringify(a) + Object.keys(a) + Reflect.ownKeys(a).length + Object.getOwnPropertySymbols(a).length + JSON.stringify({ ...a }) + JSON.stringify(Object.assign({}, a)) + JSON.stringify(structuredClone(a)));
attempt("copy", () => A.has({ ...a })); attempt("assign", () => A.has(Object.assign(Object.create(A.prototype), a)));
const proxy = new Proxy(a, {}); attempt("proxy has", () => A.has(proxy)); attempt("proxy get", () => A.get(proxy)); attempt("proxy inc", () => (proxy as A).inc());
for (const k in a) console.log("key", k);
attempt("hasOwn", () => Object.hasOwn(a, "#x") + " " + ("#x" in a) + " " + (a as any)["#x"]);
