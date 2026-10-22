// An object literal that an untyped function returns comes back in registers where the caller only reads its own fields.
// IR= 0 readsEitherArm PropGet| = New(Plain)?Object 
// IR= 0 readsFromBranches PropGet| = New(Plain)?Object 
// IR= 0 readsTagged PropGet| = New(Plain)?Object 
// IR= 0 readsThroughForwarder PropGet| = New(Plain)?Object 
// IR= 1 readsWhatIsNotThere ResultAt
// IR= 0 readsOne PropGet| = New(Plain)?Object 
let noise = 0;
function pad(k) { for (let i = 0; i < 3; i++) noise = (noise * 31 + k + i) % 1000003; }
function pads() { pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); pad(7); pad(8); pad(9); pad(10); pad(11); pad(12); }
function names(e) { return (e.stack ?? "").split("\n").map(line => line.trim().replace(/^at /, "").split(/[ @(]/)[0]).filter(name => /^(make|other|forwards|throwsInside|stacks)$/.test(name)).join(">"); }
function make(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i + noise, y: "y" + i }; }
function other(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i - noise, y: i * 3 }; }
function forwards(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return make(i + 1); }
function branches(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); if (i & 1) return { x: i, y: null }; if (i % 3 === 0) return { x: "three", y: undefined }; return { x: 1.5, y: [i] }; }
function tagged(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); if (i & 1) return { tag: "odd", value: i }; return { tag: "even", value: -i }; }
function otherOrder(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); if (i & 1) return { x: i, y: 1 }; return { y: 2, x: i }; }
function twice(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i, x: i + 1, y: 0 }; }
function indexed(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { b: 1, 1: i, a: 2, 0: -i }; }
function computed(i, key) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i, [key]: i + 1 }; }
function spreads(i, from) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i, ...from }; }
function withoutPrototype(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { __proto__: null, x: i }; }
function withPrototype(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { __proto__: { inherited: "from above" }, x: i }; }
function ownProto(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); const __proto__ = i; return { __proto__, x: i }; }
function withMethod(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i, twice() { return this.x * 2; } }; }
function withGetter(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i, get y() { noise = (noise + 1) % 1000003; return this.x + 1; } }; }
function refersToItself(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); const o = { x: i, y: 0 }; o.self = o; return o; }
function throwsInside(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i, y: i === 3 ? (() => { throw new Error("inside"); })() : i }; }
function ordered(log, i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: (log.push("x"), i), y: (log.push("y"), i + 1), z: (log.push("z"), i + 2) }; }
function sloppyThis(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { x: i, mine: this === undefined ? "none" : typeof this }; }
function manyFields(i) { pads(); pad(1); pad(2); pad(3); pad(4); pad(5); pad(6); return { a: i, b: i + 1, c: i + 2, d: i + 3, e: i + 4, f: i + 5, g: i + 6, h: i + 7, j: i + 8, k: i + 9, l: i + 10, m: i + 11, n: i + 12, o: i + 13, p: i + 14, q: i + 15 }; }
const kept = [];

function readsBoth(n) { let t = ""; for (let i = 0; i < n; i++) { const { x, y } = make(i); t = (x % 97) + y + t.length; } return t; }
function readsOne(n) { let t = 0; for (let i = 0; i < n; i++) t = (t + make(i).x) | 0; return t; }
function readsThroughForwarder(n) { let t = 0; for (let i = 0; i < n; i++) { const p = forwards(i); t = (t + p.x + p.y.length) | 0; } return t; }
function readsEitherArm(n) { let t = 0; for (let i = 0; i < n; i++) { const p = i & 1 ? make(i) : other(i); t = (t + p.x + String(p.y).length) | 0; } return t; }
function readsFromBranches(n) { let out = ""; for (let i = 0; i < n; i++) { const { x, y } = branches(i); out += x + ":" + y + ";"; } return out; }
function readsTagged(n) { let t = 0; for (let i = 0; i < n; i++) { const r = tagged(i); if (r.tag === "odd") t += r.value; else t -= r.value * 2; } return t; }

function readsWhatIsNotThere() { const a = make(1); const { z = "default", x } = make(2); return [a.z, z, typeof x, typeof a.toString, a.constructor === Object, a.hasOwnProperty("x")].join(); }
function identity() { const a = make(1), b = make(1), c = a; return [a === b, a === c, a == b, Object.is(a, c), new Set([a, b, c]).size].join(); }
function keeps(n) { const before = kept.length; for (let i = 0; i < n; i++) kept.push(forwards(i)); let t = 0; for (let i = before; i < kept.length; i++) t = (t + kept[i].x) | 0; kept.length = before; return t; }
function enumerates() { const out = []; for (const key in otherOrder(1)) out.push(key); for (const key in otherOrder(2)) out.push(key); return out.join() + JSON.stringify(twice(1)) + JSON.stringify(indexed(5)) + Object.keys(manyFields(0)).length + Object.entries(make(0)).length; }
function changes() { const a = make(1); a.x = 5; a.extra = 6; delete a.y; const b = Object.freeze(other(2)); let threw = "no"; try { "use strict"; b.x = 1; } catch { threw = "yes"; } return [a.x, a.extra, "y" in a, Object.isFrozen(b), typeof b.x].join(); }
function oddLiterals() { return [twice(1).x, indexed(7)[1], indexed(7)[0], indexed(7).a, computed(1, "x").x, computed(1, "k").k, spreads(1, { x: 9, w: 8 }).x, spreads(1, { w: 8 }).w, withoutPrototype(3).x, withoutPrototype(3).toString, Object.getPrototypeOf(withoutPrototype(1)), withPrototype(4).inherited, withPrototype(4).x, ownProto(5).x, Object.getPrototypeOf(ownProto(5)) === Object.prototype, withMethod(6).twice(), withGetter(7).y, refersToItself(8).self.self.x].join(); }
function order() { const log = []; const { z, x } = ordered(log, 1); return log.join("") + z + x; }
function stacks() { try { return "" + throwsInside(3).x; } catch (e) { return e.message + ":" + names(e); } }
function otherWaysToCall() { const f = make; return [new make(1).y, make.call(null, 2).y, make.apply(undefined, [3]).y, make.bind(null, 4)().y, f(5).y, [6].map(make)[0].y, Reflect.apply(make, null, [7]).y, make(8, "more", "arguments").y, typeof make().x, sloppyThis(1).mine, sloppyThis.call({}, 1).mine, new sloppyThis(1).mine, make.name, make.length, forwards.name].join(); }
function many() { const { a, q, h } = manyFields(1); return a + q + h; }
function* yields(n) { for (let i = 0; i < n; i++) { const p = i & 1 ? make(i) : other(i); const sent = yield p.x; yield String(p.y).length + sent; } }
async function awaits(n) { let t = 0; for (let i = 0; i < n; i++) { const p = forwards(i); await null; t = (t + p.x + p.y.length) | 0; } return t; }

console.log(readsBoth(20), readsOne(20), readsThroughForwarder(20), readsEitherArm(20), readsTagged(20));
console.log(readsFromBranches(8));
console.log(readsWhatIsNotThere());
console.log(identity(), keeps(6), enumerates());
console.log(changes());
console.log(oddLiterals());
console.log(order(), stacks(), many());
console.log(otherWaysToCall());
let sum = 0; const steps = yields(4); for (let step = steps.next(); !step.done; step = steps.next(sum & 3)) sum = (sum + step.value) | 0; console.log(sum);
awaits(5).then(value => console.log(value));
