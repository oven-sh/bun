// The arithmetic inside hashing, big-number, encoding and random-number packages: 32-bit wrap-around, Math.imul, limbs and carries, shifts, doubles beyond 2^53. Each source once as JavaScript in a package and once as TypeScript.
import { js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "sha256",
    files: {
      ...pkg("k_sha256", {
        "index.js": `"use strict";
function sha256(bytes) {
  const k = []; const h = []; let n = 2;
  const frac = (x) => ((x - Math.floor(x)) * 4294967296) | 0;
  while (k.length < 64) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) { if (h.length < 8) h.push(frac(Math.pow(n, 1 / 2))); k.push(frac(Math.pow(n, 1 / 3))); } n++; }
  const m = bytes.slice(); const bits = bytes.length * 8; m.push(0x80); while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 255);
  const w = new Array(64).fill(0); const rotr = (x, r) => (x >>> r) | (x << (32 - r));
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + i * 4] << 24) | (m[o + i * 4 + 1] << 16) | (m[o + i * 4 + 2] << 8) | m[o + i * 4 + 3];
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0; }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) { const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i] + w[i]) | 0; const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
    h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0; h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
function run() { const b = (s) => Array.from(s, (c) => c.charCodeAt(0)); return [sha256([]), sha256(b("abc")), sha256(b("a".repeat(200)))]; }
exports.run = run;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "untyped.mjs": `import { run } from "k_sha256";
${js}for (const x of run()) console.log(show(x));
`,
      "typed.ts": `${ts}function sha256(bytes: number[]): string {
  const k: number[] = []; const h: number[] = []; let n = 2;
  const frac = (x: number): number => ((x - Math.floor(x)) * 4294967296) | 0;
  while (k.length < 64) { let p = true; for (let d = 2; d * d <= n; d++) if (n % d === 0) { p = false; break; } if (p) { if (h.length < 8) h.push(frac(Math.pow(n, 1 / 2))); k.push(frac(Math.pow(n, 1 / 3))); } n++; }
  const m = bytes.slice(); const bits = bytes.length * 8; m.push(0x80); while (m.length % 64 !== 56) m.push(0);
  for (let i = 7; i >= 0; i--) m.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 255);
  const w: number[] = new Array(64).fill(0); const rotr = (x: number, r: number): number => (x >>> r) | (x << (32 - r));
  for (let o = 0; o < m.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = (m[o + i * 4]! << 24) | (m[o + i * 4 + 1]! << 16) | (m[o + i * 4 + 2]! << 8) | m[o + i * 4 + 3]!;
    for (let i = 16; i < 64; i++) { const a = w[i - 15]!, b = w[i - 2]!; w[i] = (w[i - 16]! + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7]! + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) | 0; }
    let [a, b, c, d, e, f, g, hh] = h as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) { const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + k[i]! + w[i]!) | 0; const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
    h[0] = (h[0]! + a) | 0; h[1] = (h[1]! + b) | 0; h[2] = (h[2]! + c) | 0; h[3] = (h[3]! + d) | 0; h[4] = (h[4]! + e) | 0; h[5] = (h[5]! + f) | 0; h[6] = (h[6]! + g) | 0; h[7] = (h[7]! + hh) | 0;
  }
  return h.map((x) => (x >>> 0).toString(16).padStart(8, "0")).join("");
}
function run(): unknown { const b = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0)); return [sha256([]), sha256(b("abc")), sha256(b("a".repeat(200)))]; }
for (const x of run() as unknown[]) console.log(show(x));
`,
    },
  },
  {
    name: "crc-adler-fnv",
    files: {
      ...pkg("k_crc_adler_fnv", {
        "index.js": `"use strict";
function crc32(bytes) { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } let crc = 0xffffffff; for (const b of bytes) crc = t[(crc ^ b) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function adler32(bytes) { let a = 1, b = 0; for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }
function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function fnvByShifts(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); } return h >>> 0; }
function djb2(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i); return h >>> 0; }
function java(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (31 * h + s.charCodeAt(i)) | 0; return h; }
function unbounded(s) { let h = 7; for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i); return h; }
function run() { const s = "The quick brown fox jumps over the lazy dog".repeat(3); const b = Array.from(s, (c) => c.charCodeAt(0)); return [crc32(b), adler32(b), fnv1a(s), fnvByShifts(s), djb2(s), java(s), unbounded(s), unbounded(s) % 1000003]; }
exports.run = run;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "untyped.mjs": `import { run } from "k_crc_adler_fnv";
${js}for (const x of run()) console.log(show(x));
`,
      "typed.ts": `${ts}function crc32(bytes: number[]): number { const t: number[] = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } let crc = 0xffffffff; for (const b of bytes) crc = t[(crc ^ b) & 255]! ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; }
function adler32(bytes: number[]): number { let a = 1, b = 0; for (const x of bytes) { a = (a + x) % 65521; b = (b + a) % 65521; } return ((b << 16) | a) >>> 0; }
function fnv1a(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function fnvByShifts(s: string): number { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); } return h >>> 0; }
function djb2(s: string): number { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i); return h >>> 0; }
function java(s: string): number { let h = 0; for (let i = 0; i < s.length; i++) h = (31 * h + s.charCodeAt(i)) | 0; return h; }
function unbounded(s: string): number { let h = 7; for (let i = 0; i < s.length; i++) h = h * 31 + s.charCodeAt(i); return h; }
function run(): unknown { const s = "The quick brown fox jumps over the lazy dog".repeat(3); const b = Array.from(s, (c) => c.charCodeAt(0)); return [crc32(b), adler32(b), fnv1a(s), fnvByShifts(s), djb2(s), java(s), unbounded(s), unbounded(s) % 1000003]; }
for (const x of run() as unknown[]) console.log(show(x));
`,
    },
  },
  {
    name: "murmur-xorshift",
    files: {
      ...pkg("k_murmur_xorshift", {
        "index.js": `"use strict";
function murmur3(key, seed) { let h = seed; const c1 = 0xcc9e2d51, c2 = 0x1b873593; const n = key.length & ~3; let i = 0;
  for (; i < n; i += 4) { let k = (key.charCodeAt(i) & 255) | ((key.charCodeAt(i + 1) & 255) << 8) | ((key.charCodeAt(i + 2) & 255) << 16) | ((key.charCodeAt(i + 3) & 255) << 24); k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2); h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0; }
  let k = 0; switch (key.length & 3) { case 3: k ^= (key.charCodeAt(i + 2) & 255) << 16; case 2: k ^= (key.charCodeAt(i + 1) & 255) << 8; case 1: k ^= key.charCodeAt(i) & 255; k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2); h ^= k; }
  h ^= key.length; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
function imulByHand(a, b) { const ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff; return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0; }
function xorshift32(seed, n) { let x = seed; const r = []; for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; r.push(x >>> 0); } return r; }
function mulberry(seed, n) { let a = seed; const r = []; for (let i = 0; i < n; i++) { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; r.push(((t ^ (t >>> 14)) >>> 0) / 4294967296); } return r; }
function lcg(seed, n) { let s = seed; const r = []; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; r.push(s); } return r; }
function park(seed, n) { let s = seed; const r = []; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; r.push(s); } return r; }
function run() { return [murmur3("hello, world", 0), murmur3("abc", 0x9747b28c), murmur3("", 1), imulByHand(0xffffffff, 5), imulByHand(0x7fffffff, 0x7fffffff), Math.imul(0xffffffff, 5), xorshift32(2463534242, 4), mulberry(1, 3), lcg(42, 4), park(1, 5)]; }
exports.run = run;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "untyped.mjs": `import { run } from "k_murmur_xorshift";
${js}for (const x of run()) console.log(show(x));
`,
      "typed.ts": `${ts}function murmur3(key: string, seed: number): number { let h = seed; const c1 = 0xcc9e2d51, c2 = 0x1b873593; const n = key.length & ~3; let i = 0;
  for (; i < n; i += 4) { let k = (key.charCodeAt(i) & 255) | ((key.charCodeAt(i + 1) & 255) << 8) | ((key.charCodeAt(i + 2) & 255) << 16) | ((key.charCodeAt(i + 3) & 255) << 24); k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2); h ^= k; h = (h << 13) | (h >>> 19); h = (Math.imul(h, 5) + 0xe6546b64) | 0; }
  let k = 0; switch (key.length & 3) { case 3: k ^= (key.charCodeAt(i + 2) & 255) << 16; case 2: k ^= (key.charCodeAt(i + 1) & 255) << 8; case 1: k ^= key.charCodeAt(i) & 255; k = Math.imul(k, c1); k = (k << 15) | (k >>> 17); k = Math.imul(k, c2); h ^= k; }
  h ^= key.length; h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16; return h >>> 0; }
function imulByHand(a: number, b: number): number { const ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff; return (al * bl + (((ah * bl + al * bh) << 16) >>> 0)) | 0; }
function xorshift32(seed: number, n: number): number[] { let x = seed; const r: number[] = []; for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; r.push(x >>> 0); } return r; }
function mulberry(seed: number, n: number): number[] { let a = seed; const r: number[] = []; for (let i = 0; i < n; i++) { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; r.push(((t ^ (t >>> 14)) >>> 0) / 4294967296); } return r; }
function lcg(seed: number, n: number): number[] { let s = seed; const r: number[] = []; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) % 2147483648; r.push(s); } return r; }
function park(seed: number, n: number): number[] { let s = seed; const r: number[] = []; for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; r.push(s); } return r; }
function run(): unknown { return [murmur3("hello, world", 0), murmur3("abc", 0x9747b28c), murmur3("", 1), imulByHand(0xffffffff, 5), imulByHand(0x7fffffff, 0x7fffffff), Math.imul(0xffffffff, 5), xorshift32(2463534242, 4), mulberry(1, 3), lcg(42, 4), park(1, 5)]; }
for (const x of run() as unknown[]) console.log(show(x));
`,
    },
  },
  {
    name: "limbs",
    files: {
      ...pkg("k_limbs", {
        "index.js": `"use strict";
function mul(a, b) { const r = new Array(a.length + b.length).fill(0); for (let i = 0; i < a.length; i++) { let carry = 0; for (let j = 0; j < b.length; j++) { const lo = Math.imul(a[i] & 0x1fff, b[j] & 0x1fff), mid = Math.imul(a[i] & 0x1fff, b[j] >>> 13) + Math.imul(a[i] >>> 13, b[j] & 0x1fff), hi = Math.imul(a[i] >>> 13, b[j] >>> 13); const w = r[i + j] + lo + ((mid & 0x1fff) << 13) + carry; r[i + j] = w & 0x3ffffff; carry = hi + (mid >>> 13) + Math.floor(w / 0x4000000); } r[i + b.length] = r[i + b.length] + carry; } return r; }
function mulDouble(a, b) { const r = new Array(a.length + b.length).fill(0); for (let i = 0; i < a.length; i++) { let carry = 0; for (let j = 0; j < b.length; j++) { const w = a[i] * b[j] + r[i + j] + carry; carry = Math.floor(w / 65536); r[i + j] = w - carry * 65536; } r[i + b.length] = carry; } return r; }
function toBig(a, bits) { let r = 0n; for (let i = a.length - 1; i >= 0; i--) r = (r << BigInt(bits)) + BigInt(a[i]); return r.toString(16); }
function carry25519(o) { let c = 1; for (let i = 0; i < 16; i++) { const v = o[i] + c + 65535; c = Math.floor(v / 65536); o[i] = v - c * 65536; } o[0] = o[0] + c - 1 + 37 * (c - 1); return o; }
function run() { const a = [0x3ffffff, 0x3fffffe, 0x1234567, 0x2abcdef], b = [0x3ffffff, 0x0000001, 0x3ffffff]; const c = [65535, 65535, 1, 65534], d = [65535, 65535, 65535]; return [toBig(mul(a, b), 26), (BigInt("0x" + toBig(a, 26)) * BigInt("0x" + toBig(b, 26))).toString(16), toBig(mulDouble(c, d), 16), (BigInt("0x" + toBig(c, 16)) * BigInt("0x" + toBig(d, 16))).toString(16), carry25519([70000, -5, 65536, 1e9, -1e9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 131072])]; }
exports.run = run;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "untyped.mjs": `import { run } from "k_limbs";
${js}for (const x of run()) console.log(show(x));
`,
      "typed.ts": `${ts}function mul(a: number[], b: number[]): number[] { const r: number[] = new Array(a.length + b.length).fill(0); for (let i = 0; i < a.length; i++) { let carry = 0; for (let j = 0; j < b.length; j++) { const lo = Math.imul(a[i]! & 0x1fff, b[j]! & 0x1fff), mid = Math.imul(a[i]! & 0x1fff, b[j]! >>> 13) + Math.imul(a[i]! >>> 13, b[j]! & 0x1fff), hi = Math.imul(a[i]! >>> 13, b[j]! >>> 13); const w = r[i + j]! + lo + ((mid & 0x1fff) << 13) + carry; r[i + j] = w & 0x3ffffff; carry = hi + (mid >>> 13) + Math.floor(w / 0x4000000); } r[i + b.length] = r[i + b.length]! + carry; } return r; }
function mulDouble(a: number[], b: number[]): number[] { const r: number[] = new Array(a.length + b.length).fill(0); for (let i = 0; i < a.length; i++) { let carry = 0; for (let j = 0; j < b.length; j++) { const w = a[i]! * b[j]! + r[i + j]! + carry; carry = Math.floor(w / 65536); r[i + j] = w - carry * 65536; } r[i + b.length] = carry; } return r; }
function toBig(a: number[], bits: number): string { let r = 0n; for (let i = a.length - 1; i >= 0; i--) r = (r << BigInt(bits)) + BigInt(a[i]!); return r.toString(16); }
function carry25519(o: number[]): number[] { let c = 1; for (let i = 0; i < 16; i++) { const v = o[i]! + c + 65535; c = Math.floor(v / 65536); o[i] = v - c * 65536; } o[0] = o[0]! + c - 1 + 37 * (c - 1); return o; }
function run(): unknown { const a = [0x3ffffff, 0x3fffffe, 0x1234567, 0x2abcdef], b = [0x3ffffff, 0x0000001, 0x3ffffff]; const c = [65535, 65535, 1, 65534], d = [65535, 65535, 65535]; return [toBig(mul(a, b), 26), (BigInt("0x" + toBig(a, 26)) * BigInt("0x" + toBig(b, 26))).toString(16), toBig(mulDouble(c, d), 16), (BigInt("0x" + toBig(c, 16)) * BigInt("0x" + toBig(d, 16))).toString(16), carry25519([70000, -5, 65536, 1e9, -1e9, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 131072])]; }
for (const x of run() as unknown[]) console.log(show(x));
`,
    },
  },
  {
    name: "conversions",
    files: {
      ...pkg("k_conversions", {
        "index.js": `"use strict";
function run() { const xs = [0, -0, 1, -1, 0.5, -0.5, 1.5, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967297, 9007199254740991, 9007199254740992, 1e21, -1e21, NaN, Infinity, -Infinity, 1e-7, 123456789.987];
  const f = { or0: (x) => x | 0, ushr0: (x) => x >>> 0, notnot: (x) => ~~x, shl31: (x) => x << 31, shl32: (x) => x << 32, shl33: (x) => x << 33, shrNeg: (x) => x >> -1, trunc: (x) => Math.trunc(x), floor: (x) => Math.floor(x), round: (x) => Math.round(x), ceil: (x) => Math.ceil(x), sign: (x) => Math.sign(x), mod3: (x) => x % 3, modNeg: (x) => x % -3, div: (x) => x / 3, idiv: (x) => (x / 3) | 0, fdiv: (x) => Math.floor(x / 3), neg: (x) => -x, inc: (x) => x + 1, dec: (x) => x - 1, dbl: (x) => x * 2, sq: (x) => x * x, abs: (x) => Math.abs(x), fround: (x) => Math.fround(x), clz: (x) => Math.clz32(x), isInt: (x) => Number.isInteger(x), isSafe: (x) => Number.isSafeInteger(x), str: (x) => String(x), hex: (x) => x.toString(16), fixed: (x) => x.toFixed(2), is0: (x) => Object.is(x, 0), isNeg0: (x) => Object.is(x | 0, -0) || Object.is(x * 0, -0), min: (x) => Math.min(x, 0), max: (x) => Math.max(x, -0), u8: (x) => new Uint8Array([x])[0], i16: (x) => new Int16Array([x])[0], u8c: (x) => new Uint8ClampedArray([x])[0], f32: (x) => new Float32Array([x])[0] };
  return Object.entries(f).map(([n, g]) => n + ": " + xs.map((x) => { const v = g(x); return Object.is(v, -0) ? "-0" : String(v); }).join(" ")); }
exports.run = run;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "untyped.mjs": `import { run } from "k_conversions";
${js}for (const x of run()) console.log(show(x));
`,
      "typed.ts": `${ts}function run(): unknown { const xs: number[] = [0, -0, 1, -1, 0.5, -0.5, 1.5, 2147483647, 2147483648, -2147483648, -2147483649, 4294967295, 4294967296, 4294967297, 9007199254740991, 9007199254740992, 1e21, -1e21, NaN, Infinity, -Infinity, 1e-7, 123456789.987];
  const f: Record<string, (x: number) => number | string | boolean> = { or0: (x) => x | 0, ushr0: (x) => x >>> 0, notnot: (x) => ~~x, shl31: (x) => x << 31, shl32: (x) => x << 32, shl33: (x) => x << 33, shrNeg: (x) => x >> -1, trunc: (x) => Math.trunc(x), floor: (x) => Math.floor(x), round: (x) => Math.round(x), ceil: (x) => Math.ceil(x), sign: (x) => Math.sign(x), mod3: (x) => x % 3, modNeg: (x) => x % -3, div: (x) => x / 3, idiv: (x) => (x / 3) | 0, fdiv: (x) => Math.floor(x / 3), neg: (x) => -x, inc: (x) => x + 1, dec: (x) => x - 1, dbl: (x) => x * 2, sq: (x) => x * x, abs: (x) => Math.abs(x), fround: (x) => Math.fround(x), clz: (x) => Math.clz32(x), isInt: (x) => Number.isInteger(x), isSafe: (x) => Number.isSafeInteger(x), str: (x) => String(x), hex: (x) => x.toString(16), fixed: (x) => x.toFixed(2), is0: (x) => Object.is(x, 0), isNeg0: (x) => Object.is(x | 0, -0) || Object.is(x * 0, -0), min: (x) => Math.min(x, 0), max: (x) => Math.max(x, -0), u8: (x) => new Uint8Array([x])[0]!, i16: (x) => new Int16Array([x])[0]!, u8c: (x) => new Uint8ClampedArray([x])[0]!, f32: (x) => new Float32Array([x])[0]! };
  return Object.entries(f).map(([n, g]) => n + ": " + xs.map((x) => { const v = g(x); return Object.is(v, -0) ? "-0" : String(v); }).join(" ")); }
for (const x of run() as unknown[]) console.log(show(x));
`,
    },
  },
  {
    name: "counters",
    files: {
      ...pkg("k_counters", {
        "index.js": `"use strict";
function sumTo(n) { let s = 0; for (let i = 0; i <= n; i++) s += i; return s; }
function sumSquares(n) { let s = 0; for (let i = 0; i < n; i++) s += i * i; return s; }
function past31() { const r = []; for (let i = 2147483645; i < 2147483651; i++) r.push(i); return r; }
function down() { const r = []; for (let i = -2147483646; i > -2147483651; i--) r.push(i); return r; }
function step() { const r = []; for (let i = 0; i < 5e9; i += 1e9) r.push(i); return r; }
function doubling() { const r = []; for (let i = 1; i < 1e20; i *= 1000) r.push(i); return r; }
function halves() { const r = []; for (let i = 10; i > 0.5; i /= 2) r.push(i); return r; }
function wrap() { let x = 2147483647; const r = []; x++; r.push(x); x = 2147483647; x = (x + 1) | 0; r.push(x); let y = -2147483648; y--; r.push(y); let z = 65536; z *= z; r.push(z); z *= z; r.push(z); let u = 0; u -= 1; r.push(u >>> 0); return r; }
function product(n) { let p = 1; for (let i = 1; i <= n; i++) p *= i; return p; }
function index(a) { const r = []; for (let i = a.length - 1; i >= -1; i--) r.push(a[i]); return r; }
function lengths() { const a = []; a[4294967294] = 1; const b = [1, 2, 3]; b.length = 1; return [a.length, b.length, b[1]]; }
function run() { return [sumTo(100000), sumSquares(3000), sumSquares(100000), past31(), down(), step(), doubling(), halves(), wrap(), product(12), product(13), product(25), index([1, 2]), lengths()]; }
exports.run = run;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "untyped.mjs": `import { run } from "k_counters";
${js}for (const x of run()) console.log(show(x));
`,
      "typed.ts": `${ts}function sumTo(n: number): number { let s = 0; for (let i = 0; i <= n; i++) s += i; return s; }
function sumSquares(n: number): number { let s = 0; for (let i = 0; i < n; i++) s += i * i; return s; }
function past31(): number[] { const r: number[] = []; for (let i = 2147483645; i < 2147483651; i++) r.push(i); return r; }
function down(): number[] { const r: number[] = []; for (let i = -2147483646; i > -2147483651; i--) r.push(i); return r; }
function step(): number[] { const r: number[] = []; for (let i = 0; i < 5e9; i += 1e9) r.push(i); return r; }
function doubling(): number[] { const r: number[] = []; for (let i = 1; i < 1e20; i *= 1000) r.push(i); return r; }
function halves(): number[] { const r: number[] = []; for (let i = 10; i > 0.5; i /= 2) r.push(i); return r; }
function wrap(): number[] { let x = 2147483647; const r: number[] = []; x++; r.push(x); x = 2147483647; x = (x + 1) | 0; r.push(x); let y = -2147483648; y--; r.push(y); let z = 65536; z *= z; r.push(z); z *= z; r.push(z); let u = 0; u -= 1; r.push(u >>> 0); return r; }
function product(n: number): number { let p = 1; for (let i = 1; i <= n; i++) p *= i; return p; }
function index(a: number[]): number[] { const r: number[] = []; for (let i = a.length - 1; i >= -1; i--) r.push(a[i] as number); return r; }
function lengths(): number[] { const a: number[] = []; a[4294967294] = 1; const b: number[] = [1, 2, 3]; b.length = 1; return [a.length, b.length, b[1] as number]; }
function run(): unknown { return [sumTo(100000), sumSquares(3000), sumSquares(100000), past31(), down(), step(), doubling(), halves(), wrap(), product(12), product(13), product(25), index([1, 2]), lengths()]; }
for (const x of run() as unknown[]) console.log(show(x));
`,
    },
  },
  {
    name: "encodings",
    files: {
      ...pkg("k_encodings", {
        "index.js": `"use strict";
function b64(bytes) { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; let s = ""; for (let i = 0; i < bytes.length; i += 3) { const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0); s += A[(n >> 18) & 63] + A[(n >> 12) & 63] + (i + 1 < bytes.length ? A[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? A[n & 63] : "="); } return s; }
function utf8(s) { const r = []; for (let i = 0; i < s.length; i++) { let c = s.charCodeAt(i); if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00); if (c < 0x80) r.push(c); else if (c < 0x800) r.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) r.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else r.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); } return r; }
function varint(n) { const r = []; while (n >= 0x80) { r.push((n % 128) | 0x80); n = Math.floor(n / 128); } r.push(n); return r; }
function unvarint(b) { let r = 0, m = 1; for (const x of b) { r += (x & 127) * m; m *= 128; } return r; }
function varint32(n) { const r = []; n >>>= 0; while (n > 127) { r.push((n & 127) | 128); n >>>= 7; } r.push(n); return r; }
function zigzag(n) { return ((n << 1) ^ (n >> 31)) >>> 0; }
function view() { const d = new DataView(new ArrayBuffer(16)); d.setFloat64(0, Math.PI); d.setInt32(8, -2, true); d.setUint16(12, 65535); d.setInt8(14, 200); return [d.getUint32(0), d.getUint32(4), d.getUint32(8), d.getInt32(8, true), d.getInt16(12), d.getInt8(14), d.getUint8(14), d.getFloat32(0), d.getBigInt64(0).toString()]; }
function hex(bytes) { let s = ""; for (const b of bytes) s += (b < 16 ? "0" : "") + b.toString(16); return s; }
function run() { const s = "h\\u00e9llo \\u20ac \\ud83d\\ude00"; return [b64(utf8(s)), hex(utf8(s)), b64([255]), b64([255, 254]), varint(300), varint(4294967296), varint(9007199254740991), unvarint(varint(9007199254740991)), varint32(-1), varint32(2147483648), [0, -1, 1, -2, 2147483647, -2147483648].map(zigzag), view()]; }
exports.run = run;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "untyped.mjs": `import { run } from "k_encodings";
${js}for (const x of run()) console.log(show(x));
`,
      "typed.ts": `${ts}function b64(bytes: number[]): string { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"; let s = ""; for (let i = 0; i < bytes.length; i += 3) { const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0); s += A[(n >> 18) & 63]! + A[(n >> 12) & 63]! + (i + 1 < bytes.length ? A[(n >> 6) & 63]! : "=") + (i + 2 < bytes.length ? A[n & 63]! : "="); } return s; }
function utf8(s: string): number[] { const r: number[] = []; for (let i = 0; i < s.length; i++) { let c = s.charCodeAt(i); if (c >= 0xd800 && c < 0xdc00 && i + 1 < s.length) c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00); if (c < 0x80) r.push(c); else if (c < 0x800) r.push(0xc0 | (c >> 6), 0x80 | (c & 63)); else if (c < 0x10000) r.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); else r.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); } return r; }
function varint(n: number): number[] { const r: number[] = []; while (n >= 0x80) { r.push((n % 128) | 0x80); n = Math.floor(n / 128); } r.push(n); return r; }
function unvarint(b: number[]): number { let r = 0, m = 1; for (const x of b) { r += (x & 127) * m; m *= 128; } return r; }
function varint32(n: number): number[] { const r: number[] = []; n >>>= 0; while (n > 127) { r.push((n & 127) | 128); n >>>= 7; } r.push(n); return r; }
function zigzag(n: number): number { return ((n << 1) ^ (n >> 31)) >>> 0; }
function view(): unknown { const d = new DataView(new ArrayBuffer(16)); d.setFloat64(0, Math.PI); d.setInt32(8, -2, true); d.setUint16(12, 65535); d.setInt8(14, 200); return [d.getUint32(0), d.getUint32(4), d.getUint32(8), d.getInt32(8, true), d.getInt16(12), d.getInt8(14), d.getUint8(14), d.getFloat32(0), d.getBigInt64(0).toString()]; }
function hex(bytes: number[]): string { let s = ""; for (const b of bytes) s += (b < 16 ? "0" : "") + b.toString(16); return s; }
function run(): unknown { const s = "h\\u00e9llo \\u20ac \\ud83d\\ude00"; return [b64(utf8(s)), hex(utf8(s)), b64([255]), b64([255, 254]), varint(300), varint(4294967296), varint(9007199254740991), unvarint(varint(9007199254740991)), varint32(-1), varint32(2147483648), [0, -1, 1, -2, 2147483647, -2147483648].map(zigzag), view()]; }
for (const x of run() as unknown[]) console.log(show(x));
`,
    },
  },
  {
    name: "dates-and-strings",
    files: {
      ...pkg("k_dates_and_strings", {
        "index.js": `"use strict";
function days(y, m, d) { const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3; return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045; }
function pad(n, w) { let s = String(Math.abs(n)); while (s.length < w) s = "0" + s; return (n < 0 ? "-" : "") + s; }
function human(ms) { const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24); return d + "d " + (h % 24) + "h " + (m % 60) + "m " + (s % 60) + "s " + (ms % 1000) + "ms"; }
function bytes(n) { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + u[i]; }
function cmpVersions(a, b) { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d < 0 ? -1 : 1; } return 0; }
function levenshtein(a, b) { let prev = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { const cur = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[b.length]; }
function run() { return [days(2000, 1, 1), days(1970, 1, 1), days(2026, 10, 14) - days(1970, 1, 1), new Date(Date.UTC(2026, 9, 14)).getTime() / 86400000, pad(-5, 3), pad(123456, 3), human(1e10 + 1), human(2147483648), bytes(0), bytes(1023), bytes(1536), bytes(5e12), bytes(1e18), cmpVersions("1.10.0", "1.9.9"), cmpVersions("1.0", "1.0.0"), levenshtein("kitten", "sitting"), new Date(8.64e15).getTime(), new Date(8.64e15 + 1).getTime(), new Date(2026, 0, 31, 12).getMonth(), Date.UTC(1969, 11, 31, 23, 59, 59, 999)]; }
exports.run = run;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      "untyped.mjs": `import { run } from "k_dates_and_strings";
${js}for (const x of run()) console.log(show(x));
`,
      "typed.ts": `${ts}function days(y: number, m: number, d: number): number { const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3; return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045; }
function pad(n: number, w: number): string { let s = String(Math.abs(n)); while (s.length < w) s = "0" + s; return (n < 0 ? "-" : "") + s; }
function human(ms: number): string { const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24); return d + "d " + (h % 24) + "h " + (m % 60) + "m " + (s % 60) + "s " + (ms % 1000) + "ms"; }
function bytes(n: number): string { const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; } return n.toFixed(i ? 1 : 0) + u[i]!; }
function cmpVersions(a: string, b: string): number { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] ?? 0) - (y[i] ?? 0); if (d) return d < 0 ? -1 : 1; } return 0; }
function levenshtein(a: string, b: string): number { let prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i); for (let i = 1; i <= a.length; i++) { const cur: number[] = [i]; for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; } return prev[b.length]!; }
function run(): unknown { return [days(2000, 1, 1), days(1970, 1, 1), days(2026, 10, 14) - days(1970, 1, 1), new Date(Date.UTC(2026, 9, 14)).getTime() / 86400000, pad(-5, 3), pad(123456, 3), human(1e10 + 1), human(2147483648), bytes(0), bytes(1023), bytes(1536), bytes(5e12), bytes(1e18), cmpVersions("1.10.0", "1.9.9"), cmpVersions("1.0", "1.0.0"), levenshtein("kitten", "sitting"), new Date(8.64e15).getTime(), new Date(8.64e15 + 1).getTime(), new Date(2026, 0, 31, 12).getMonth(), Date.UTC(1969, 11, 31, 23, 59, 59, 999)]; }
for (const x of run() as unknown[]) console.log(show(x));
`,
    },
  },
];
