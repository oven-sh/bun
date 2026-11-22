// concat of int32s with doubles, boxed doubles and others; literals of wide integers.
"use strict";
const log = [], hidden = JSON.parse("[0]");
function hide(x) { hidden[0] = x; return hidden[0]; }
function wide(bits, word) { return (word | 0) + 0x10000000000 * bits; }
function list(n, f) { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }
const makers = { none: () => [], one: () => [7], ints: () => list(9, i => i - 4), many: () => list(200, i => i), hole: () => { const a = list(9, i => i); delete a[3]; return a; }, holeFirst: () => [, 1, 2], allHoles: () => [, , ,], halves: () => list(9, i => i + .5), nan: () => [1.5, NaN, 2.5], holeInDoubles: () => { const a = list(9, i => i + .5); delete a[3]; return a; }, minusZero: () => [-0, .5], oneDouble: () => [2.5], oneWide: () => [wide(1, 5)], oneSmall: () => [wide(0, 5)], oneMinusZero: () => [hide(-0)], oneNaN: () => [hide(NaN)], oneBoxed: () => [hide(2.5)], oneInt: () => [hide(5)], oneText: () => [hide("w")], oneNothing: () => [hide(undefined)], oneObject: () => [hide({ toString() { return "o"; } })], oneBig: () => [hide(5n)], oneHole: () => { const a = [hide(2.5)]; delete a[0]; return a; }, two: () => [hide(2.5), hide(3)], twoTexts: () => [hide(2.5), "x"], literal: () => [1, 2, 3], literalHalves: () => [1.5, 2.5], frozen: () => Object.freeze([1, 2, 3]), frozenHalves: () => Object.freeze([1.5, 2.5]), heir: () => class extends Array {}.from([1, 2]), view: () => new Int32Array(3), accessor: () => Object.defineProperty([1, 2, 3], 1, { get() { log.push("get"); return 4; } }), spreadable: () => ({ [Symbol.isConcatSpreadable]: true, length: 2, 0: 1.5 }), notSpreadable: () => Object.assign([1.5], { [Symbol.isConcatSpreadable]: false }), number: () => 2.5, text: () => "t", sparse: () => { const a = [1.5]; a[1000] = 2; return a; }, proxy: () => new Proxy([1.5, 2], {}) };
function show(v) { return v === null || typeof v !== "object" ? Object.is(v, -0) ? "-0" : typeof v + String(v) : Array.isArray(v) ? "[" + dump(v) + "]" : "{" + Object.prototype.toString.call(v); }
function dump(a) { let t = a.length + ":"; for (let i = 0; i < Math.min(a.length, 220) + 1; i++) t += (i in a ? show(a[i]) : "_") + ","; return t; }
function join(a, b) { return a.concat(b); }
function used(a) { a.push(3); a.push(1.5); a[0] = 8; let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; a.push("end"); return s; }
for (const first in makers) for (const second in makers) {
  let answer;
  try {
    const a = makers[first](), b = makers[second]();
    if (!Array.isArray(a)) continue;
    const joined = join(a, b);
    answer = dump(joined);
    joined[0] = 9;
    answer += dump(a) + (Array.isArray(b) ? dump(b) : "");
    answer += show(used(join(makers[first](), makers[second]())));
  } catch (error) { answer = "threw " + error.name; }
  console.log(first, second, answer.length > 400 ? answer.length + answer.slice(0, 300) + answer.slice(-90) : answer, log.splice(0).join());
}
