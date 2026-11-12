"use strict";
// What `new utils.Buf16(n)` makes: the program stores Uint16Array and Array under the name.
const out = [];
const attempt = (f, ...a) => { try { return f(...a); } catch (e) { return e.constructor.name + ": " + e.message; } };
globalThis.__unknown = new Map(); const get = k => globalThis.__unknown.get(k);
const utils = { assign(o, s) { for (const k in s) if (Object.prototype.hasOwnProperty.call(s, k)) o[k] = s[k]; return o; } };
utils.setTyped = function (on) { if (on) { utils.Buf8 = Uint8Array; utils.Buf16 = Uint16Array; utils.Buf32 = Int32Array; utils.assign(utils, { name: "typed" }); } else { utils.Buf8 = Array; utils.Buf16 = Array; utils.Buf32 = Array; utils.assign(utils, { name: "lists" }); } };
globalThis.__unknown.set("utils", utils);
function zero(buf) { let len = buf.length; while (--len >= 0) buf[len] = 0; }
function smaller(tree, n, m, depth) { const n2 = n * 2, m2 = m * 2; return tree[n2] < tree[m2] || (tree[n2] === tree[m2] && depth[n] <= depth[m]); }
function State(n) { this.heap = new utils.Buf16(n); this.tree = new utils.Buf16(2 * n); this.depth = new utils.Buf16(n); this.bytes = new utils.Buf8(n); this.words = new utils.Buf32(n); this.length = n; this.made = utils.name; zero(this.heap); zero(this.tree); zero(this.depth); zero(this.bytes); zero(this.words); }
function down(s, k) { const v = s.heap[k]; let j = k << 1; while (j < s.length) { if (j < s.length - 1 && smaller(s.tree, s.heap[j + 1], s.heap[j], s.depth)) j++; if (smaller(s.tree, v, s.heap[j], s.depth)) break; s.heap[k] = s.heap[j]; k = j; j <<= 1; } s.heap[k] = v; }
function fill(s, seed) { for (let n = 0; n < s.length; n++) { s.heap[n] = (n * 7 + seed) % s.length; s.tree[n * 2] = (n * 31 + seed) % 61; s.tree[n * 2 + 1] = n; s.depth[n] = n % 5; s.bytes[n] = n * 99; s.words[n] = n * 1e8; } }
function sum(s) { let t = 0; for (let n = 0; n < s.length; n++) t = (t * 31 + s.heap[n] + s.tree[n * 2] * 3 + s.depth[n] + s.bytes[n] + s.words[n]) % 1000003; return t; }
function bump(s) { for (let n = 0; n < s.length; n++) { s.tree[n * 2]++; s.heap[n] += 60000; s.words[n] -= 2e9; s.bytes[n] = s.heap[n]; } }
class Klass { constructor(n) { this.heap = new utils.Buf16(n); this.tree = new utils.Buf16(2 * n); this.depth = new utils.Buf16(n); this.bytes = new utils.Buf8(n); this.words = new utils.Buf32(n); this.length = n; this.made = utils.name; } }
class Below extends Klass { constructor(n) { super(n); this.depth = new utils.Buf32(n); this.extra = 1; } }
function Later(n) { this.heap = null; this.tree = null; this.depth = null; this.bytes = null; this.words = null; this.length = n; this.made = utils.name; }
function later(n) { const s = new Later(n); s.heap = new utils.Buf16(n); s.tree = new utils.Buf16(2 * n); s.depth = new utils.Buf16(n); s.bytes = new utils.Buf8(n); s.words = new utils.Buf32(n); return s; }
const makers = [n => new State(n), n => new Klass(n), n => new Below(n), later]; let turns = 0;
for (const [k, f] of Object.entries({ make: n => makers[turns++ & 3](n), down, fill, sum, bump, zero })) globalThis.__unknown.set(k, f);
function turn(seed, n) { const s = get("make")(n); get("fill")(s, seed); const a = get("sum")(s); for (let k = n >> 1; k >= 1; k--) get("down")(s, k); const b = get("sum")(s); get("bump")(s); return [s.made, s.heap.constructor.name, a, b, get("sum")(s), s.heap[3], s.words[5], s.bytes[7]].join(" "); }
get("utils").setTyped(true); for (let i = 0; i < 24; i++) out.push(turn(i, 23 + i));
get("utils").setTyped(false); for (let i = 0; i < 8; i++) out.push(turn(i, 23 + i));
get("utils").Buf16 = Float64Array; for (let i = 0; i < 4; i++) out.push(turn(3, 30));
get("utils").Buf16 = class Mine extends Uint16Array { }; for (let i = 0; i < 4; i++) out.push(turn(4, 30));
get("utils").Buf16 = function (n) { const l = []; for (let i = 0; i < n; i++) l[i] = "0"; return l; }; for (let i = 0; i < 4; i++) out.push(attempt(turn, 5, 30));
get("utils").Buf16 = function Plain(n) { this.length = n; }; for (let i = 0; i < 4; i++) out.push(attempt(turn, 6, 30));
get("utils").Buf16 = undefined; for (let i = 0; i < 4; i++) out.push(attempt(turn, 7, 30));
get("utils").Buf16 = BigUint64Array; for (let i = 0; i < 4; i++) out.push(attempt(turn, 8, 30));
get("utils").setTyped(true); { const s = get("make")(20); get("fill")(s, 1); s.heap = [1, 2, 3, "4", { valueOf() { return 2; } }]; out.push(attempt(get("sum"), s)); s.heap = null; out.push(attempt(get("down"), s, 2)); delete s.heap; out.push(attempt(get("sum"), s)); Object.defineProperty(s, "heap", { get() { return s.depth; } }); out.push(attempt(get("sum"), s)); s.tree = new Proxy(s.tree, { get(t, k) { return Reflect.get(t, k); } }); out.push(attempt(get("sum"), s)); s.depth = new Uint16Array(new ArrayBuffer(40, { maxByteLength: 80 })); out.push(attempt(get("sum"), s)); s.depth.buffer.resize(8); out.push(attempt(get("sum"), s)); structuredClone(s.words.buffer, { transfer: [s.words.buffer] }); out.push(attempt(get("sum"), s)); get("zero")(s.tree); out.push(attempt(get("zero"), null)); }
console.log(out.join("\n"));
