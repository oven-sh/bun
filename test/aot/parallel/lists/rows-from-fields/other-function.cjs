"use strict";
const list = [7, 1, 5, 3];
function Box() { if (!(this instanceof Box)) throw Error("new"); this.s = 0; this.self = this; this.fill(); }
Box.prototype.fill = function () { this.k = []; this.j = []; for (let y = 0; y < 3; y++) { this.k.push([0, 0, 0, 0, 0]); this.j.push([9, 8, 7, 6, 5]); } for (let y = 0; y < 3; y++) for (let x = 0; x < 5; x++) this.k[y][x] = y * 5 + x; };
Box.prototype.run = function (a, n, r) { let s = 0; const o = this.self; for (let i = 0; i < n; i++) { if (i === 2) o.k = this.j; s += this.k[r][i]; a[i] = s; } return s; };
function Sub() { Box.call(this); }
Sub.prototype = Object.create(Box.prototype);
function show(x, depth = 0) { if (depth > 3) return "deep"; if (Array.isArray(x)) { let s = "["; for (let i = 0; i < x.length && i < 12; i++) s += (i ? "," : "") + (i in x ? show(x[i], depth + 1) : "hole"); return s + "]"; } return Object.is(x, -0) ? "-0" : typeof x === "object" && x ? "{}" : String(x); }
function tell(kind, f, o, a) { let said; try { said = f(); } catch (e) { said = e.name; } let k; try { k = show(o.k) + show(o.j); } catch (e) { k = e.name; } console.log(kind, show(said), k, show(a), o.s); }
const tests = [
  ["plain", () => { let o = new Box(), a = [3, 1, 2, 0, 4];  tell("plain", () => o.run(a, 5, 1), o, a); }],
  ["none", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; delete o.k; tell("none", () => o.run(a, 5, 1), o, a); }],
  ["missing", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.k = undefined; tell("missing", () => o.run(a, 5, 1), o, a); }],
  ["number", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.k = 5; tell("number", () => o.run(a, 5, 1), o, a); }],
  ["text", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.k = ['abcde', 'fghij', 'klmno']; tell("text", () => o.run(a, 5, 1), o, a); }],
  ["same", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; a = o.k; tell("same", () => o.run(a, 5, 1), o, a); }],
  ["row", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; a = o.k[1]; tell("row", () => o.run(a, 5, 1), o, a); }],
  ["cyclic", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.k[1] = o.k; tell("cyclic", () => o.run(a, 5, 1), o, a); }],
  ["getter", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; const held = o.k; let calls = 0; Object.defineProperty(o, 'k', { get() { calls++; return calls > 3 ? o.j : held; }, set(x) { calls += 100; }, configurable: true }); tell("getter", () => o.run(a, 5, 1), o, a); }],
  ["frozen", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; Object.freeze(o); tell("frozen", () => o.run(a, 5, 1), o, a); }],
  ["above", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; const held = o.k; delete o.k; Object.setPrototypeOf(o, Object.create(Box.prototype, { k: { get() { return held; } } })); tell("above", () => o.run(a, 5, 1), o, a); }],
  ["proxied", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o = new Proxy(o, {}); tell("proxied", () => o.run(a, 5, 1), o, a); }],
  ["holes", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; delete o.k[1]; tell("holes", () => o.run(a, 5, 1), o, a); }],
  ["doubles", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.k[1] = [0.5, 1.5, 2.5, 3.5, 4.5]; tell("doubles", () => o.run(a, 5, 1), o, a); }],
  ["boxed", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.k[1] = [1, '2', null, 4.5, undefined]; tell("boxed", () => o.run(a, 5, 1), o, a); }],
  ["views", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.k[1] = new Uint8Array([250, 251, 252, 253, 254]); tell("views", () => o.run(a, 5, 1), o, a); }],
  ["sub", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o = new Sub(); tell("sub", () => o.run(a, 5, 1), o, a); }],
  ["like", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o = { k: o.k, j: o.j, s: 0, self: null, run: Box.prototype.run }; o.self = o; tell("like", () => o.run(a, 5, 1), o, a); }],
  ["extra", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.z1 = 1; o.z2 = 2; o.z3 = 3; delete o.s; tell("extra", () => o.run(a, 5, 1), o, a); }],
  ["sealed", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; Object.preventExtensions(o); tell("sealed", () => o.run(a, 5, 1), o, a); }],
  ["twins", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.j = o.k; tell("twins", () => o.run(a, 5, 1), o, a); }],
  ["short", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.k[1] = [1, 2]; tell("short", () => o.run(a, 5, 1), o, a); }],
  ["listed", () => { let o = new Box(), a = [3, 1, 2, 0, 4]; o.k = Object.assign([], o.k, { extra: 1 }); tell("listed", () => o.run(a, 5, 1), o, a); }],
];
for (let round = 0; round < 3; round++) for (const [kind, test] of tests) { { const o = new Box(), a = [1, 2, 3, 4, 5]; tell("as made", () => o.run(a, 5, 1), o, a); } if (round || kind === "plain") test(); }
