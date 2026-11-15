// Freezing, deleting, defining by a descriptor and another prototype do not touch a private name.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class A { #x = 1; y = 2; inc() { return ++this.#x; } static get(o) { return o.#x; } static has(o) { return #x in o; } static inc(o) { return ++o.#x; } }
function attempt(f) { try { report(f()); } catch (e) { report(e instanceof TypeError ? "TypeError" : "other"); } }
const frozen = Object.freeze(new A);
const sealed = Object.seal(new A);
const closed = Object.preventExtensions(new A);
attempt(() => frozen.inc() + frozen.inc());
attempt(() => sealed.inc());
attempt(() => closed.inc());
const other = new A;
Object.setPrototypeOf(other, null);
attempt(() => A.get(other) + A.inc(other));
const gone = new A;
delete gone.y;
gone.z = 1;
attempt(() => gone.inc());
attempt(() => gone.y);
const defined = new A;
Object.defineProperty(defined, "y", { get() { return 5; } });
Object.defineProperty(defined, "#x", { value: 100 });
attempt(() => defined.inc() + defined.y + defined["#x"]);
const a = new A;
attempt(() => A.has({ ...a }));
attempt(() => A.has(Object.assign(Object.create(A.prototype), a)));
attempt(() => Reflect.ownKeys(a).length);
const proxy = new Proxy(a, {});
attempt(() => A.has(proxy));
attempt(() => A.get(proxy));
attempt(() => proxy.inc());
attempt(() => Object.hasOwn(a, "#x"));
attempt(() => ("#x" in a));
attempt(() => a["#x"]);
let keys = "";
for (const k in a) keys += k;
report(keys);
let total = 0;
for (let i = 0;i < 300; i++) total += frozen.inc() + gone.inc() + defined.inc() + A.get(other);
report(total);
report("end");
