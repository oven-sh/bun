// Arrays about which nothing is known hold int32s, doubles or others. Loops read and store them.
"use strict";
const n = 16, log = [], hidden = JSON.parse("[0]");
function hide(x) { hidden[0] = x; return hidden[0]; }
function list(f) { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }
const ints = list(i => Math.imul(i + 3, 0x9e3779b9) | 0);
function changed(a, at, v) { const b = a.slice(); b[at] = v; return b; }
const makers = { ints: () => ints.slice(), words: () => ints.map(x => x >>> 0), halves: () => ints.map(x => x * .5), large: () => changed(ints, 8, 0x10000000000 + 5), larger: () => changed(ints, 8, 2 ** 53), huge: () => changed(ints, 8, 1e300), nan: () => changed(list(i => i + .5), 8, NaN), infinite: () => changed(ints, 8, -Infinity), minusZero: () => changed(list(i => i + .5), 8, -0), hole: () => { const a = ints.slice(); delete a[8]; return a; }, holeInDoubles: () => { const a = list(i => i + .5); delete a[8]; return a; }, text: () => changed(ints, 8, "7"), texts: () => list(i => "w" + i), nothing: () => changed(ints, 8, undefined), object: () => changed(ints, 8, { valueOf() { log.push("value"); return 6; } }), big: () => changed(ints, 8, 5n), boxed: () => { const a = ["x"]; for (let i = 1; i < n; i++) a.push(ints[i]); a[0] = 3; return a; }, literal: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16], frozen: () => Object.freeze(ints.slice()), frozenDoubles: () => Object.freeze(list(i => i + .5)), sealed: () => Object.seal(list(i => i + .5)), short: () => [1, 2.5], empty: () => [], view: () => new Int32Array(ints), words32: () => new Uint32Array(ints), floats: () => new Float64Array(ints), bigs: () => new BigInt64Array(n), heir: () => class extends Array {}.from(ints), accessor: () => Object.defineProperty(ints.slice(), 5, { get() { log.push("get"); return 2; }, set(v) { log.push("set" + String(v)); } }), proxy: () => new Proxy(ints.slice(), { set(o, k, v) { if (k === "6") log.push("trap"); o[k] = v; return true; } }), string: () => "abcdefghijklmnop", like: () => ({ 0: 4, 1: 2, length: 16 }), none: () => null };
const loops = {
  rounds(b, g) { let h = 1, m = 2, d = 0, e = 0; for (let c = 0; c < 40; c++) { if (c < 16) d = b[c]; else { d = b[c + 1 & 15]; e = b[c + 14 & 15]; d = b[c & 15] = (d >>> 7 ^ d >>> 18 ^ d << 25) + (e >>> 17 ^ e >>> 10 ^ e << 15) + b[c & 15] + b[c + 9 & 15] | 0; } d = d + h + (m >>> 6 ^ m << 26) + g[c & 15]; h = m; m = d | 0; } return [h, m]; },
  step(b) { for (let i = 0; i < n; i++) b[i] = b[i] + 1 & 1023; return b.length; },
  ring(b) { let x = 0; for (let i = 0; i < 40; i++) x = b[i & 15] = b[i & 15] + b[i + 3 & 15] + b[i + 7 & 15] | 0; return x; },
  mix(b) { let x = 1; for (let i = 0; i < n; i++) x = b[i] = x ^ b[i] << 1; return x; },
  half(b) { for (let i = 0; i < n; i++) b[i] = b[i] >>> 1; return b[2]; },
  prefix(b) { for (let i = 1; i < n; i++) b[i] = b[i - 1] + b[i] & 65535; return b[3]; },
  sumAndStore(b) { let s = 0; for (let i = 0; i < n; i++) { s += b[i]; b[i] = s & 255; } return s; },
  both(b, g) { for (let i = 0; i < n; i++) { b[i] = g[i] + b[i] | 0; g[i] = b[i] ^ i; } return g[4]; },
  inner(b) { for (let o = 0; o < 3; o++) for (let i = 0; i < n; i++) b[i] = b[i] + o | 0; return b[1]; },
  turned(b, g) { let x = 0; for (let i = 0; i < n; i++) { x = b[i] = b[i] + x | 0; if (i === 5) b[9] = g[1]; } return x; },
};
function show(v) { return v === null || typeof v !== "object" ? Object.is(v, -0) ? "-0" : typeof v + String(v) : "["; }
function dump(b) { if (b === null || typeof b !== "object") return String(b); let t = b.length + ":"; for (let i = 0; i < n + 1; i++) t += (i in b ? show(b[i]) : "_") + ","; return t; }
function sumOf(text) { let s = 0; for (let i = 0; i < text.length; i++) s = Math.imul(s, 31) + text.charCodeAt(i) | 0; return s; }
for (const name in loops) {
  const loop = hide(loops[name]), lines = [];
  for (const first in makers) for (const second of ["ints", "words", "halves", "hole", "text", "view", first]) {
    const b = hide(makers[first]()), g = second === first ? b : hide(makers[second]());
    let answer;
    try { answer = String(loop(b, g)); } catch (error) { answer = "threw " + error.name; }
    lines.push(first + " " + second + " " + sumOf(answer + dump(b) + dump(g) + log.splice(0).join()));
  }
  console.log(name, lines.join("\n"));
}
