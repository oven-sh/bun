// A getter may be a bound function. What it throws goes to whoever reads the property, also where the language itself reads it: Symbol.species, Symbol.toPrimitive, Symbol.iterator, then, toJSON, constructor.
let calls = 0;
const thrower = function () { calls++; throw new RangeError("getter ran"); }.bind();
const counter = function () { calls++; return 7; }.bind();
function tryIt(name, run) { try { console.log(name, run(), calls); } catch (e) { console.log(name, e.name, calls); } }
const a = {}; Object.defineProperty(a, "x", { get: thrower });
tryIt("named read", () => a.x);
tryIt("keyed read", () => a["x".trim()]);
const b = {}; Object.defineProperty(b, "x", { get: counter });
tryIt("named read of a counter", () => b.x);
const c = {}; Object.defineProperty(c, Symbol.toPrimitive, { get: thrower });
tryIt("toPrimitive", () => `${c}`);
const d = {}; Object.defineProperty(d, Symbol.iterator, { get: thrower });
tryIt("iterator", () => [...d]);
const e = {}; Object.defineProperty(e, "then", { get: thrower });
tryIt("then, by resolve", () => (Promise.resolve(e).catch(() => {}), "resolved"));
try { console.log("then, awaited", await e, calls); } catch (x) { console.log("then, awaited", x.name, calls); }
const f = []; f.constructor = {}; Object.defineProperty(f.constructor, Symbol.species, { get: thrower });
tryIt("array species, map", () => f.map(x => x).length);
const g = Promise.resolve(1); g.constructor = {}; Object.defineProperty(g.constructor, Symbol.species, { get: thrower });
tryIt("promise species, then", () => typeof g.then());
const h = Promise.resolve(1); h.constructor = {}; Object.defineProperty(h.constructor, Symbol.species, { get: counter });
tryIt("promise species, a counter", () => typeof h.then());
const i = /a/; i.constructor = {}; Object.defineProperty(i.constructor, Symbol.species, { get: thrower });
tryIt("regexp species, split", () => "bab".split(i).length);
const j = {}; Object.defineProperty(j, "toJSON", { get: thrower });
tryIt("toJSON", () => JSON.stringify(j));
const k = {}; Object.defineProperty(k, "constructor", { get: thrower }); Object.setPrototypeOf(k, Promise.prototype);
tryIt("constructor getter on a promise-like", () => { try { return Promise.prototype.then.call(k); } catch (x) { return x.name; } });
const l = Promise.resolve(1); Object.defineProperty(l, "constructor", { get: thrower });
tryIt("promise constructor getter, then", () => typeof l.then());
try { console.log("promise constructor getter, awaited", await l, calls); } catch (x) { console.log("promise constructor getter, awaited", x.name, calls); }
