// Literals, records and instances are asked by name for what they do not have, again and again, while in every way that there is the answer stops being "nothing".
const lines = [];
function say(what, value) { lines.push(what + " " + value); }
// Many layouts arrive at each of these, so they go by name.
function read(o) { return o.late; }
function readTwo(o) { return o.late + "," + o.later; }
function readChain(o) { return o.inner.late; }
function test(o) { return o.late ? "truthy" : "falsy"; }
function ask(o) { return "late" in o; }
function own(o) { return Object.hasOwn(o, "late"); }
function inherited(o) { return typeof o.toString + " " + typeof o.hasOwnProperty + " " + typeof o.valueOf + " " + typeof o.constructor + " " + typeof o.isPrototypeOf + " " + typeof o.__proto__ + " " + typeof o.toLocaleString + " " + typeof o.propertyIsEnumerable + " " + typeof o.__defineGetter__ + " " + typeof o.__lookupSetter__; }
function askInherited(o) { return ("toString" in o) + " " + ("constructor" in o) + " " + ("__proto__" in o) + " " + Object.hasOwn(o, "toString"); }
function all(o) { return read(o) + " " + readTwo(o) + " " + test(o) + " " + ask(o) + " " + own(o); }
const makers = [
    () => ({ a: 1 }), () => ({ b: 2, c: 3 }), () => ({ d: "x", e: 1.5, f: true }), () => ({ g: null }), () => ({ h: undefined, i: [] }),
    () => ({ j: {}, k: 1, l: 2, m: 3 }), () => ({}), () => ({ n: () => 1 }), () => ({ get o() { return 1; } }), () => ({ p: 1n, q: Symbol.iterator }),
];
function warm(work) { const seen = new Set(); for (let round = 0; round < 80; round++) seen.add(work(makers[round % makers.length]())); return [...seen].join(" | "); }
say("nothing there", warm(all));
say("what Object.prototype has", warm(inherited));
say("asked of Object.prototype", warm(askInherited));

const stored = makers[1](); stored.late = "stored"; say("stored", all(stored));
const storedByKey = makers[2](); storedByKey["la" + "te"] = "by key"; say("stored by key", all(storedByKey));
const defined = makers[3](); Object.defineProperty(defined, "late", { value: "defined" }); say("defined", all(defined));
const withGetter = makers[4](); Object.defineProperty(withGetter, "late", { get() { return "got " + Object.keys(this).length; } }); say("a getter", all(withGetter));
const assigned = Object.assign(makers[5](), { late: "assigned", later: 2 }); say("assigned", all(assigned));
const deleted = makers[0](); deleted.late = 1; delete deleted.late; say("stored and deleted", all(deleted));
const holdsUndefined = makers[0](); holdsUndefined.late = undefined; say("holds undefined", all(holdsUndefined));
const below = makers[6](); Object.setPrototypeOf(below, { late: "from above" }); say("another prototype", all(below));
const belowLiteral = makers[7](); const above = makers[1](); Object.setPrototypeOf(belowLiteral, above); say("a literal above, without", all(belowLiteral));
above.late = "the literal above got it"; say("a literal above, with", all(belowLiteral));
const noPrototype = makers[1](); Object.setPrototypeOf(noPrototype, null); say("no prototype", read(noPrototype) + " " + ask(noPrototype) + " " + typeof noPrototype.toString + " " + ("toString" in noPrototype));
const backAgain = makers[1](); Object.setPrototypeOf(backAgain, { late: 1 }); Object.setPrototypeOf(backAgain, Object.prototype); say("and back under Object.prototype", all(backAgain) + " " + inherited(backAgain));
const underProxy = makers[2](); Object.setPrototypeOf(underProxy, new Proxy({}, { get: (t, key) => "trap " + String(key), has: () => true })); say("a proxy above", all(underProxy));
const created = Object.create(makers[1]()); say("created from a literal", all(created));
const frozen = Object.freeze(makers[5]()); say("frozen", all(frozen));
const sealed = Object.seal(makers[5]()); say("sealed", all(sealed));
say("a chain", readChain({ inner: makers[1]() }) + " " + readChain({ inner: stored }));
try { readChain({ inner: undefined }); } catch (error) { say("a chain through nothing", error.constructor.name); }
try { readChain(makers[1]()); } catch (error) { say("a chain through what is absent", error.constructor.name); }

class Base { late = "field of the class"; }
class Empty {}
class WithMethod { late() { return 1; } }
class WithGetter { get late() { return "getter of the class"; } }
class WithStatic { static late = "static"; }
class Below extends WithGetter {}
say("classes", [new Base(), new Empty(), new WithMethod(), new WithGetter(), new WithStatic(), new Below(), WithStatic, Empty].map(o => typeof read(o) + ":" + ask(o) + ":" + own(o)).join(" "));
Empty.prototype.late = "the prototype got it";
say("a class whose prototype gets it", all(new Empty()));
delete Empty.prototype.late;
say("and loses it", all(new Empty()));

say("other receivers", [[], [1], "text", 5, true, 5n, Symbol.iterator, () => 1, function () {}, new Map(), new Date(0), /x/, new Error("e"), JSON.parse('{"a":1}'), JSON.parse('{"late":2}'), { ...stored }, Object.fromEntries([["late", 3]])].map(o => String(read(o))).join(" "));
for (const nothing of [undefined, null]) { try { read(nothing); } catch (error) { say("of " + nothing, error.constructor.name); } }

// Whether a compiled executable lets Object.prototype change or refuses: what is read afterwards agrees with what is there.
const name = ["la", "te"].join("");
const top = Object.prototype;
let changed = false;
try { top[name] = "from the top"; changed = Object.hasOwn(top, name); } catch {}
say("Object.prototype stored to", makers.every(make => read(make()) === (changed ? "from the top" : undefined) && ask(make()) === changed && !own(make())));
try { delete top[name]; } catch {}
try { Object.defineProperty(top, name, { get() { return "got at the top"; }, configurable: true }); changed = Object.hasOwn(top, name); } catch { changed = false; }
say("Object.prototype defined on", makers.every(make => read(make()) === (changed ? "got at the top" : undefined) && ask(make()) === changed));
try { delete top[name]; } catch {}
say("as at the start", warm(all));
console.log(lines.join("\n"));
