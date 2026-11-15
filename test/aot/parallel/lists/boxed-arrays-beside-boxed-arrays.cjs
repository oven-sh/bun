// Loops over two arrays of numbers about which nothing is known: boxed, int32s, doubles and others beside each other.
"use strict";
const n = 16, log = [], hidden = JSON.parse("[0]");
function hide(x) { hidden[0] = x; return hidden[0]; }
function list(f) { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }
const ints = list(i => i * 7 % n);
function boxed(a) { const b = ["x"]; for (let i = 1; i < a.length; i++) b.push(a[i]); b[0] = a[0]; return b; }
function changed(a, at, v) { const b = a.slice(); b[at] = v; return b; }
const makers = { ints: () => ints.slice(), halves: () => ints.map(x => x + .5), boxed: () => boxed(ints), boxedHalves: () => boxed(ints.map(x => x + .5)), boxedHole: () => { const a = boxed(ints); delete a[6]; return a; }, text: () => changed(ints, 6, "7"), nothing: () => changed(ints, 6, undefined), none: () => changed(ints, 6, null), flag: () => changed(ints, 6, true), object: () => changed(ints, 6, { valueOf() { log.push("value"); return 6; } }), symbol: () => changed(ints, 6, Symbol.iterator), big: () => changed(ints, 6, 5n), nan: () => changed(boxed(ints), 6, NaN), minusZero: () => changed(boxed(ints), 6, -0), large: () => changed(boxed(ints), 6, 2 ** 40 + 1), frozen: () => Object.freeze(boxed(ints)), short: () => [1, "x", 2], empty: () => [], view: () => new Float64Array(ints), like: () => ({ 3: 1, length: 4 }) };
const loops = {
  dot(a, b) { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; },
  under(a, b) { let x = 0; for (let i = 0; i < n; i++) x = x ^ a[b[i] & 15]; return x; },
  add(a, b) { for (let i = 0; i < n; i++) b[i] = a[i] + b[i] & 1023; return b[4]; },
  differ(a, b) { let s = 0; for (let i = 0; i < n; i++) s += a[i] - b[n - 1 - i]; return s; },
  bits(a, b) { let x = 1; for (let i = 0; i < n; i++) x = x << 1 ^ a[i] ^ b[i] >>> 1; return x; },
  most(a, b) { let m = 0; for (let i = 0; i < n; i++) if (a[i] > b[i]) m += i; return m; },
  scaled(a, b) { for (let i = 0; i < n; i++) a[i] = b[i] * 2; return a[4]; },
  inner(a, b) { let s = 0; for (let o = 0; o < 2; o++) for (let i = 0; i < n; i++) s += a[i] * b[o]; return s; },
  turned(a, b) { let s = 0; for (let i = 0; i < n; i++) { s += a[i] * b[i]; if (i === 4) { a[9] = "5"; b[11] = 2.5; } } return s; },
  shortened(a, b) { let s = 0; for (let i = 0; i < n; i++) { s += a[i] * b[i]; if (i === 4) b.length = 8; } return s; },
};
function show(v) { return v === null || typeof v !== "object" ? Object.is(v, -0) ? "-0" : typeof v + String(v) : "["; }
function dump(b) { if (b === null || typeof b !== "object") return String(b); let t = b.length + ":"; for (let i = 0; i < n + 1; i++) t += (i in b ? show(b[i]) : "_") + ","; return t; }
function sumOf(text) { let s = 0; for (let i = 0; i < text.length; i++) s = Math.imul(s, 31) + text.charCodeAt(i) | 0; return s; }
for (const name in loops) {
  const loop = hide(loops[name]);
  for (const first in makers) {
    const line = [];
    for (const second of [...Object.keys(makers), "same"]) {
      const a = hide(makers[first]()), b = second === "same" ? a : hide(makers[second]());
      let answer;
      try { answer = show(loop(a, b)); } catch (error) { answer = "threw " + error.name; }
      line.push(answer + " " + sumOf(dump(a) + dump(b) + log.splice(0).join()));
    }
    console.log(name, first, line.join("|"));
  }
}
