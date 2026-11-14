// STATISTIC: Uint8ArraysSpeculatedFromIndexedStores >= 4
// Loops that store into holders nobody knows, beside reads off bytes: the holder is an array, bytes, another view, the read holder itself, or nothing that takes elements.
const log = [];
const shared = new Uint8Array(64).map((_, i) => i * 3);
class Heir extends Uint8Array {}
class Setter extends Array {
  static get [Symbol.species]() {
    return Array;
  }
}
const same = (x, y) => Object.is(x, y);
const makers = {
  ints: n => Array.from({ length: n }, (_, i) => (i * 7) & 255),
  doubles: n => Array.from({ length: n }, (_, i) => i * 0.75 - 3),
  mixed: n => Array.from({ length: n }, (_, i) => (i % 5 ? i : "s" + i)),
  empty: () => [],
  holes: n => {
    const a = [];
    for (let i = 0; i < n; i += 3) a[i] = i;
    a.length = n;
    return a;
  },
  frozen: () => Object.freeze([9, 8, 7, 6, 5, 4, 3, 2, 1]),
  buffer: n => Buffer.alloc(n).map((_, i) => i * 13),
  bytes: n => new Uint8Array(n).map((_, i) => i * 11),
  clamped: n => new Uint8ClampedArray(n).map((_, i) => i * 5),
  signed: n => new Int8Array(n).map((_, i) => i * 9),
  words: n => new Uint32Array(n).map((_, i) => i * 4000000000),
  f64: n => new Float64Array(n).map((_, i) => (i ? i / 7 : -0)),
  sub: n => shared.subarray(3, n + 3),
  later: n => shared.subarray(5, n + 1),
  grow: n => {
    const v = new Uint8Array(new ArrayBuffer(n, { maxByteLength: 64 }));
    for (let i = 0; i < n; i++) v[i] = i * 2;
    return v;
  },
  heir: n => new Heir(n).map((_, i) => i),
  setter: n => Setter.from({ length: n }, (_, i) => i),
  object: n => ({ 0: 1, 1: 2, 2: 3, length: n }),
  text: () => "abcdefghijklmnopqrstuvwxyz0123456789",
  proxy: n => new Proxy(new Uint8Array(n), {}),
  converted: n => Array.from({ length: n }, (_, i) => (i === 7 ? { valueOf() { log.push("v"); return 3; } } : i)),
  thrower: n => Array.from({ length: n }, (_, i) => (i === 9 ? { valueOf() { throw new RangeError("at 9"); } } : i)),
  nan: n => Array.from({ length: n }, (_, i) => (i % 3 ? NaN : -0)),
};
const table = {
  copied(a, b, n, pos, back) { for (let x = 0; x < n; x++) b[back + x] = a[pos + x]; return 0; },
  difference(a, b, n, pos, back) { for (let x = 0; x < n; x++) { const left = x >= back ? a[pos + x - back] : 0; b[pos + x] = a[pos + x] - left; } return 0; },
  above(a, b, n, pos, back) { for (let x = 0; x < n; x++) { const up = pos > 0 ? a[pos + x - back] : 0; b[back + x] = a[pos + x] - up; } return 0; },
  average(a, b, n, pos, back) { let sum = 0; for (let x = 0; x < n; x++) { const v = (a[x] + a[pos + x]) >> 1; b[pos + x] = v; sum += v; } return sum; },
  fractions(a, b, n, pos, back) { for (let x = 0; x < n; x++) b[pos + x] = a[x] * 0.5 + back; return 0; },
  updated(a, b, n, pos, back) { for (let x = 0; x < n; x++) b[pos + x] ^= a[x] + back; return 0; },
  stepped(a, b, n, pos, back) { let at = pos; for (let x = 0; x < n; x++) { b[at++] = a[x]; b[at++] = a[x + 1] + 1; } return at; },
  ended(a, b, n, pos, back) { for (let x = 0; x < n; x++) { b[pos + x] = a[x] | 0; if (x === 5) break; } return 0; },
  thrown(a, b, n, pos, back) { for (let x = 0; x < n; x++) { b[pos + x] = a[x] + 1; if (x === 6) throw new RangeError("middle"); } return 0; },
  resized(a, b, n, pos, back) { for (let x = 0; x < n; x++) { b[pos + x] = a[x] + 1; if (x === 6 && b.buffer && b.buffer.resizable) b.buffer.resize(8); } return 0; },
  colors(a, b, n, pos, back) { const o = { r: back, g: 2.5, b: -3, a: 300 }; let at = pos * 4; for (let x = 0; x < n; x++) { b[at++] = o.r; b[at++] = o.g; b[at++] = o.b; b[at++] = o.a; } return at; },
};
function show(h) {
  try {
    if (typeof h === "string") return h;
    let s = (h.constructor && h.constructor.name) + ":" + h.length + ":";
    for (let i = 0; i < Math.min(h.length >>> 0, 44); i++) s += (i in h ? (same(h[i], -0) ? "-0" : typeof h[i] === "object" ? "o" : String(h[i])) : "_") + ",";
    return s;
  } catch (e) {
    return "E" + e.message;
  }
}
function run(name, a, b, n, pos, back) {
  log.length = 0;
  let told;
  try {
    told = table[name](a, b, n, pos, back);
  } catch (e) {
    told = e.constructor.name + (e instanceof RangeError ? e.message : "");
  }
  return [name, String(told), log.join(""), show(a), show(b)].join("|");
}
const out = [];
for (const name in table) {
  for (let w = 0; w < 4; w++) out.push(run(name, makers.bytes(24), makers.buffer(40), 20, w & 1, 4));
  for (const from in makers) {
    for (const to in makers) out.push(run(name, makers[from](30), makers[to](36), 20, 2, 3));
    const one = makers[from](30);
    out.push(run(name, one, one, 20, 1, 2), run(name, makers.bytes(9), makers[from](30), 28, -2, 1), run(name, makers[from](30), makers.bytes(30), 20, 2.5, 1), run(name, makers[from](30), makers.bytes(30), 12, "1", 1), run(name, makers[from](30), makers.bytes(30), 12, undefined, 2 ** 31));
  }
}
let hash = 0;
for (const line of out) for (let i = 0; i < line.length; i++) hash = (hash * 31 + line.charCodeAt(i)) | 0;
for (let i = 0; i < out.length; i += 97) console.log(out[i].slice(0, 300));
console.log(out.length, hash);
