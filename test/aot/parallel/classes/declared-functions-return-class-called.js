// With declared functions: The call stands in a function. Some of these run once, some look as if they did.
const lines = [];
class Base { v = 1; }
const make = (tag) => { function Local(P) { return class extends P { static tag = tag; #p = tag; static has(o) { return #p in o; } static get(o) { return o.#p; } }; } class A extends Local(Base) { } return A; };
const one = make("one"); const table = [make]; const two = table[0]("two"); const three = make("three");
lines.push([one.tag, two.tag, three.tag, one.has(new one()), one.has(new two()), two.has(new one()), three.has(new three()), one.get(new one()), two.get(new two()), one === two].join());
function Outer(P) { return class extends P { #q = 1; static has(o) { return #q in o; } static count = 0; constructor() { super(); new.target.count++; } }; }
function setup() { class S extends Outer(Base) { } return S; }
const s1 = setup(); const again = { run: setup }; const s2 = again.run(); const s3 = Reflect.apply(setup, null, []);
lines.push([s1 === s2, s1.has(new s1()), s1.has(new s2()), s2.has(new s1()), s3.has(new s2()), s3.has(new s3()), Object.getPrototypeOf(s1) === Object.getPrototypeOf(s2)].join());
new s1(); new s1(); new s2(); lines.push([s1.count, s2.count, s3.count, Object.getPrototypeOf(s1).count].join());
(function once() { class T extends Outer(Base) { } lines.push("iife " + T.has(new T()) + T.has(new s1())); globalThis.kept = once; })();
globalThis.kept();
function* steps() { for (let i = 0; i < 2; i++) { yield Outer(Base); } class U extends Outer(Base) { } yield U; }
const got = [...steps(), ...steps()];
lines.push(got.map((X) => got.map((Y) => (X.has(new Y()) ? 1 : 0)).join("")).join(" "));
const recursive = (n) => { const K = Outer(Base); return n ? [K, ...recursive(n - 1)] : [K]; };
const rec = recursive(2); lines.push(rec.map((X) => rec.map((Y) => (X.has(new Y()) ? 1 : 0)).join("")).join(" "));
label: for (const x of [1, 2]) { const K = Outer(Base); lines.push("turn " + x + K.has(new K()) + K.has(new s1())); if (x === 2) break label; }
let W; do { const previous = W; W = Outer(Base); if (previous) lines.push("do " + previous.has(new W()) + W.has(new W())); } while (lines.length < 9);
try { throw 0; } catch { const K = Outer(Base); lines.push("catch " + K.has(new K())); } finally { const K = Outer(Base); lines.push("finally " + K.has(new K())); }
const later = []; for (const f of [() => Outer(Base), () => Outer(Base)]) later.push(f(), f());
lines.push(later.map((X) => later.map((Y) => (X.has(new Y()) ? 1 : 0)).join("")).join(" "));
console.log(lines.join("\n"));
