// Loops count what is truthy without a branch: values of every kind, elements with holes, names that objects hold, inherit, lack or compute, and sums of two unknown values that are added to a number.
"use strict";
const unknown = (list) => JSON.parse("[0]").concat(list).slice(1);
function elements(list) { let n = 0; for (let i = 0; i < list.length; i++) if (list[i]) n++; return n; }
function negated(list) { let n = 0; for (let i = 0; i < list.length; i++) if (!list[i]) n += 1; return n; }
function names(list) { let n = 0; for (let i = 0; i < list.length; i++) { if (list[i].flag) n++; if (list[i].nowhere) n++; } return n; }
function both(list) { let n = 0; for (let i = 0; i < list.length; i++) { const a = list[i].flag, b = list[i].late; if (a) n++; if (b) n++; if (a && b) n += 10; } return n; }
function sums(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].x + list[i].y; return s; }
function texts(list) { let s = ""; for (let i = 0; i < list.length; i++) s += list[i].x + list[i].y; return s; }
function turns(list) { let s = 0; for (let i = 0; i < list.length; i++) { s += list[i].x + list[i].y; if (s > 2e9) s = -2e9; } return s; }
globalThis.kept = [elements, negated, names, both, sums, texts, turns];
const kinds = [0, 1, -1, 0.5, -0, NaN, Infinity, "", "0", "text", null, undefined, true, false, {}, [], () => 1, 0n, 5n, Symbol.iterator, new Boolean(false), new Map(), /x/, new Proxy({}, {}), "a".repeat(3).slice(3), "ab" + kindsLength(), new Date(NaN), 2147483648, -2147483649];
function kindsLength() { return 3; }
const show = (run) => { try { return String(run()); } catch (error) { return error.constructor.name; } };
const out = [];
for (let round = 0; round < 4; round++) {
  out.push(elements(unknown(kinds)), negated(unknown(kinds)));
  for (const value of kinds) out.push(elements(unknown(Array.from({ length: 30 }, (_, i) => i % 3 ? value : kinds[(i + round) % kinds.length]))));
  const holes = unknown([1, 2, 3]); holes.length = 9; holes[7] = "x"; out.push(elements(holes), negated(holes));
  for (const value of kinds) {
    const list = unknown(Array.from({ length: 12 }, (_, i) => i % 4 === 0 ? { flag: value } : i % 4 === 1 ? Object.create({ flag: value }) : i % 4 === 2 ? { get flag() { return value; }, late: value } : { other: 1 }));
    out.push(show(() => names(list)), show(() => both(list)), show(() => names(unknown([value, ...list]))));
  }
  for (let k = 0; k < kinds.length; k++) {
    const list = unknown(Array.from({ length: 10 }, (_, i) => ({ x: i % 3 ? i * 1e9 : kinds[(k + i) % kinds.length], y: i % 4 ? kinds[k] : i })));
    out.push(show(() => sums(list)), show(() => texts(list)), show(() => turns(list)));
  }
  out.push(sums(unknown(Array.from({ length: 100 }, (_, i) => ({ x: i * 21474836, y: i & 1 ? -i : 0.25 * i })))));
}
let hash = 0;
for (const line of out) { const text = String(line); for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0; }
console.log(out.length, hash);
for (let i = 0; i < out.length; i += 37) console.log(String(out[i]).slice(0, 80));
