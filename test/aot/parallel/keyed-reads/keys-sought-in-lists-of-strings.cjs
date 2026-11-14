// A substring that was a key is sought in a list by the address of its atom, and stays a substring.
// COUNTER: operationAOTFlatten <= 600
"use strict";
const hide = v => [v][JSON.parse("0")];
const names = ["alpha", "bravo", "gamma", "delta", "omega", "sigma", "theta", "kappa", "zetas", "lamda", "upsil", "epsil", "iotas", "omicr", "xenon", "argon"];
const table = { alpha: 1, bravo: 2, gamma: 3, delta: 4, omega: 5, sigma: 6, theta: 7, kappa: 8, zetas: 9, lamda: 10, upsil: 11, epsil: 12, iotas: 13, omicr: 14, xenon: 15, argon: 16 };
const other = { __proto__: null, nulls: 1, seven: 2, joins: 3 };
const lists = [names, names.slice(0, 7), names.slice().reverse(), [...names, "alpha"], [1, , 2.5, null, ...names], [{}, ...names.map(n => n + "!"), "argon"], names.map(n => (n + "!").slice(0, 5)), [...names.slice(0, 9), hide("ar") + hide("gon"), "\u0100rgon", "argon"], [...names.slice(0, 9), "ar" + String.fromCharCode(0x101)], [1, 2, 3], [], new Array(12), Object.assign([], names), names.map(() => "")].map(hide);
let text = "";
for (let i = 0; i < 16; i++) text += (i ? " " : "") + names[i * 7 % 16];
text += " seven joins nulls nobody \u00e9tudes";
function seek(pieces, list) {
  let sum = 0;
  for (let i = 0; i < pieces.length; i++) sum = (sum * 33 + list.indexOf(pieces[i]) * 2 + (list.includes(pieces[i]) ? 1 : 0)) | 0;
  return sum;
}
function keys(pieces) { let sum = 0; for (let i = 0; i < pieces.length; i++) sum += (table[pieces[i]] | 0) + (other[pieces[i]] | 0); return sum; }
const seen = new Map;
for (let round = 0; round < 64; round++) {
  const pieces = (text + (round & 1 ? " " : "  ")).split(" ");
  const total = keys(pieces);
  for (const list of round < 60 ? lists.slice(0, 5) : lists) { const s = seek(pieces, list); const k = lists.indexOf(list) + ":" + pieces.length; if (!seen.has(k)) seen.set(k, [total, s]); else if (seen.get(k)[1] !== s || seen.get(k)[0] !== total) console.log("differs", k, seen.get(k), total, s); }
}
console.log([...seen].map(([k, v]) => k + "=" + v.join()).join(" "));
const wide = (text + " \u0100rgon").split(" ");
console.log(keys(wide), lists.map(l => seek(wide, l)).join());
console.log(seek(["alpha", "", "x", hide(undefined), hide(NaN), hide(3), hide({})], lists[4]), seek(wide, new (class extends Array {})(...names)));
