"use strict";
// `c + w[i & 7] * x[i & 7] + a[i & 7] * 0.5`: the second key is written behind the first read, so the first read did not know what stands beside it in the product and kept its hole apart from NaN;
// and whether the view is longer than the mask, which no turn can change, was asked in every turn. Whatever is handed, the answer is plain's.
var key = JSON.parse('"go"'), lines = [];
var three = { go(a, w, x) { let c = 0; for (let i = 0; i < a.length; i++) c = c + w[i & 7] * x[i & 7] + a[i & 7] * 0.5; return c; } };
var minus = { go(a, w, x) { let c = 0; for (let i = 0; i < a.length; i++) c = c + (w[i & 7] - x[i & 7]) / a[i & 3]; return c; } };
var plus = { go(a, w, x) { let c = ""; for (let i = 0; i < a.length; i++) c = c + (w[i & 7] + x[i & 7]); return c; } };
var kept = { go(a, w, x) { let c = 0, seen = []; for (let i = 0; i < a.length; i++) { const e = w[i & 7]; c = c + e * x[i & 7]; if (e === undefined) seen.push(i); } return c + ":" + seen; } };
var other = { go(a, w, x, m) { let c = 0; for (let i = 0; i < a.length; i++) c = c + w[i & 7] * x[i & m]; return c; } };
var halves = () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5], wholes = () => [1, 2, 3, 4, 5, 6, 7, 8];
var holed = (list, at) => { delete list[at]; return list; };
var lists = [halves, wholes, () => holed(halves(), 0), () => holed(halves(), 7), () => holed(wholes(), 3), () => halves().slice(0, 7), () => halves().slice(0, 1), () => [], () => halves().concat(9.5), () => [1, "2", 3, 4, 5, 6, 7, 8], () => [1n, 2n, 3n, 4n, 5n, 6n, 7n, 8n], () => [NaN, Infinity, -0, 0, 1, 2, 3, 4], () => [{ valueOf() { lines.push("asked"); return 2; } }, 2, 3, 4, 5, 6, 7, 8]];
var views = [Float64Array.from(halves()), Float64Array.from(halves()).subarray(0, 7), new Float64Array(9).fill(2), new Float64Array(16).fill(0.25), new Float64Array(0), new Float64Array(1), new Float32Array(8).fill(1.5), new Int16Array(8).fill(-3), new Uint8Array(24).fill(9), halves(), holed(halves(), 2)];
for (var deed of [three, minus, plus, kept]) {
  for (var a of views) {
    var said = [];
    for (var w of lists) for (var x of [lists[0], lists[2], lists[5], lists[9], lists[10]]) { try { said.push(deed[key](a, w(), x())); } catch (error) { said.push(error.name); } }
    lines.push(a.constructor.name + a.length + ": " + said.join());
  }
}
for (var m of [7, 3, 15, 0, -1, 7.5, "7", undefined]) lines.push("mask " + String(m) + ": " + other[key](views[0], holed(halves(), 1), holed(halves(), 6), m) + " " + other[key](views[0], halves(), wholes(), m) + " " + other[key](views[3], halves(), halves().slice(0, 4), m));
var buffer = new ArrayBuffer(64, { maxByteLength: 128 }), tracking = new Float64Array(buffer).fill(1.5);
var shrinks = { go(a, w, x, b) { let c = 0; for (let i = 0; i < 12; i++) { c = c + w[i & 7] * x[i & 7] + a[i & 7] * 0.5; if (i === 5) b.resize(24); } return c; } };
lines.push("resized in the turn: " + shrinks[key](tracking, halves(), halves(), buffer) + " " + tracking.length);
console.log(lines.join("\n"));
