// `{ ...source }` and `const { a, ...rest } = source` over objects with getters, symbols, properties that are not enumerable, inherited properties, indices, proxies, primitives, null and undefined.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
const show = o => JSON.stringify(o) + ";" + Object.keys(o).join("|");
let log = "";
const plain = { a: 1, b: 2 };
report(show({ ...plain })); report(show({ ...plain, c: 3 })); report(show({ c: 3, ...plain })); report(show({ a: 0, ...plain })); report(show({ ...plain, a: 0 })); report(show({ ...plain, ...plain })); report(show({ ...plain, ...{ b: 5, d: 6 } }));
report(show({ ...null })); report(show({ ...undefined })); report(show({ ...null, a: 1 })); report(show({ ...1 })); report(show({ ...true })); report(show({ ..."ab" })); report(show({ ...[1, 2] })); report(show({ ...(() => 1) })); report(show({ ...Symbol("s") })); report(show({ ...10n }));
const withGetter = { get x() { log += "g"; return 1; }, y: 2 }; const copyOfGetter = { ...withGetter }; report(show(copyOfGetter) + log + "," + (typeof Object.getOwnPropertyDescriptor(copyOfGetter, "x").get) + "," + Object.getOwnPropertyDescriptor(copyOfGetter, "x").value);
const withSetter = { set x(v) { log += "s"; } }; report(show({ ...withSetter }) + "," + ("x" in { ...withSetter }) + log);
const targetSetter = { set a(v) { log += "T"; }, ...plain }; report(show(targetSetter) + log + "," + Object.getOwnPropertyDescriptor(targetSetter, "a").value);
const key = Symbol("k"); const withSymbol = { [key]: 1, a: 2 }; const copyOfSymbol = { ...withSymbol }; report(copyOfSymbol[key] + "," + Object.getOwnPropertySymbols(copyOfSymbol).length + "," + show(copyOfSymbol));
const hidden = {}; Object.defineProperty(hidden, "h", { value: 1, enumerable: false }); Object.defineProperty(hidden, "v", { value: 2, enumerable: true }); Object.defineProperty(hidden, key, { value: 3, enumerable: false }); const copyOfHidden = { ...hidden }; report(show(copyOfHidden) + "," + ("h" in copyOfHidden) + "," + Object.getOwnPropertySymbols(copyOfHidden).length + "," + Object.getOwnPropertyDescriptor(copyOfHidden, "v").writable + "," + Object.getOwnPropertyDescriptor(copyOfHidden, "v").configurable);
const child = Object.create({ inherited: 1 }); child.own = 2; report(show({ ...child }) + "," + ("inherited" in { ...child }));
class Point { constructor() { this.x = 1; this.y = 2; } get sum() { return this.x + this.y; } method() { return 1; } } const copyOfPoint = { ...new Point() }; report(show(copyOfPoint) + "," + (copyOfPoint instanceof Point) + "," + String(copyOfPoint.sum) + "," + (Object.getPrototypeOf(copyOfPoint) === Object.prototype));
const frozen = Object.freeze({ a: 1 }); const copyOfFrozen = { ...frozen }; copyOfFrozen.a = 2; copyOfFrozen.b = 3; report(show(copyOfFrozen) + "," + Object.isFrozen(copyOfFrozen));
const numbered = { 2: "c", 1: "b", z: 0, 0: "a" }; report(show({ ...numbered })); report(show({ y: 1, ...numbered }));
const proto = { ...{ __proto__: { p: 1 }, q: 2 } }; report(show(proto) + "," + String(proto.p)); const ownProto = { ...JSON.parse('{"__proto__": {"p": 1}}') }; report(Object.keys(ownProto).join("|") + "," + String(ownProto.p) + "," + (Object.getPrototypeOf(ownProto) === Object.prototype));
const proxied = new Proxy({ a: 1, b: 2 }, { ownKeys(t) { log += "K"; return Reflect.ownKeys(t); }, getOwnPropertyDescriptor(t, k) { log += "D"; return Reflect.getOwnPropertyDescriptor(t, k); }, get(t, k) { log += "G"; return t[k]; } }); log = ""; report(show({ ...proxied }) + log);
const throwing = { get x() { throw new Error("from getter"); } }; try { ({ ...throwing }); report("no error"); } catch (error) { report(error.message); }
log = ""; const ordered = { get a() { log += "a"; return 1; }, get b() { log += "b"; return 2; } }; const evaluated = { first: (log += "1", 0), ...ordered, last: (log += "2", 0) }; report(log + show(evaluated));
const growing = { get a() { growing.late = 1; return 1; }, b: 2 }; report(show({ ...growing })); const shrinking = { get a() { delete shrinking.b; return 1; }, b: 2 }; report(show({ ...shrinking }));
const source = { inner: { v: 1 } }; const shallow = { ...source }; shallow.inner.v = 2; report(source.inner.v + "," + (shallow.inner === source.inner) + "," + (shallow === source));
{ const { a, ...rest } = { a: 1, b: 2, c: 3 }; report(a + show(rest)); }
{ const { ...all } = plain; report(show(all) + "," + (all === plain)); }
{ const { a, b, ...none } = plain; report(show(none)); }
{ const { missing, ...rest } = plain; report(String(missing) + show(rest)); }
{ const { a = 9, z = 8, ...rest } = { a: undefined, b: 2 }; report(a + "," + z + show(rest)); }
{ const name = "b"; const { [name]: picked, ...rest } = { a: 1, b: 2, c: 3 }; report(picked + show(rest)); }
{ const { [key]: picked, ...rest } = { [key]: 1, a: 2 }; report(picked + show(rest) + Object.getOwnPropertySymbols(rest).length); }
{ const { a, ...rest } = withSymbol; report(a + show(rest) + Object.getOwnPropertySymbols(rest).length); }
{ const { v, ...rest } = hidden; report(v + show(rest) + ("h" in rest)); }
{ const { own, ...rest } = child; report(own + show(rest) + ("inherited" in rest)); }
{ const { inherited, ...rest } = child; report(inherited + show(rest)); }
{ log = ""; const { y, ...rest } = withGetter; report(y + show(rest) + log); }
{ log = ""; const { x, ...rest } = withGetter; report(x + show(rest) + log); }
{ const { 1: one, ...rest } = numbered; report(one + show(rest)); }
{ const { length, ...rest } = [1, 2]; report(length + show(rest)); }
{ const { length, ...rest } = "ab"; report(length + show(rest)); }
{ const { ...rest } = 5; report(show(rest)); }
try { const { ...rest } = null; report("no error"); } catch (error) { report(error instanceof TypeError); }
try { const { a, ...rest } = undefined; report("no error"); } catch (error) { report(error instanceof TypeError); }
{ const { a: { b, ...inner }, ...outer } = { a: { b: 1, c: 2 }, d: 3 }; report(b + show(inner) + show(outer)); }
{ let a, rest; ({ a, ...rest } = { a: 1, b: 2 }); report(a + show(rest)); }
{ const holderOfRest = {}; ({ a: holderOfRest.a, ...holderOfRest.rest } = { a: 1, b: 2 }); report(show(holderOfRest)); }
function parameters({ a, ...rest }) { return a + show(rest); } report(parameters({ a: 1, b: 2 })); report(parameters({}));
function widen(state, c) { return { ...state, c }; } report(show(widen(plain, 3))); report(show(widen(null, 3))); report(show(widen({ c: 1, d: 2 }, 3))); report(show(widen(withGetter, 3))); report(show(widen([7], 3)));
function settle(options) { return { ...plain, ...options }; } report(show(settle({ b: 7 }))); report(show(settle())); report(show(settle({ z: 1, a: 2 })));
report(show(Object.assign({}, plain, { c: 3 }))); report(show(Object.assign({}, null, undefined, plain))); log = ""; report(show(Object.assign({ set a(v) { log += "A" + v; } }, plain)) + log); report(show(Object.assign({}, withSymbol)) + Object.getOwnPropertySymbols(Object.assign({}, withSymbol)).length); report(show(Object.assign({}, hidden, child)));
try { Object.assign(Object.freeze({ a: 0 }), plain); report("no error"); } catch (error) { report(error instanceof TypeError); }
for (let turn = 0; turn < 3; turn++) { const o = { a: turn, b: 1, c: 2 }; const { a, ...rest } = o; const wider = { ...o, d: turn }; report(a + show(rest) + show(wider) + show(widen(o, turn)) + show(settle({ b: turn }))); }
report("end");
