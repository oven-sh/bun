// Strings become numbers: digits with and without a point, signs, exponents, spaces, letters, other digits, ropes, slices, strings of two bytes a character.
const source = "0123456789.0123456789x";
const written = ["", " ", ".", "..", "5.", ".5", "1.2.3", "1.", "00.50", "007", "0", "-0", "+5", "-5", "1e5", "1e", "0x10", "0b11", "12 ", " 12", "1 2", "123456789", "1234567890", "12345678.9", "1.23456789", "99999999", "999999999", "9999999999", "0.1", "0.2", "0.3", "4.35", "1.005", "2.675", "8.41", "0.000001", "1234.567", "100.0", "0.0", "1_000", "1,000", "$5", "NaN", "Infinity", "-Infinity", "infinity", "i1", "١", "１", "1 ", "﻿7", "7\n", "1n", "true", "null"];
const texts = [...written, ...written.map(s => "\u{1F600}" + s).map(s => s.slice(2)), ...written.map((s, i) => s + (i % 3 ? "" : String(i))), ...Array.from({ length: 200 }, (_, i) => source.slice(i % 22, i % 22 + i % 11))];
for (let i = 0; i < 400; i++) texts.push(String(i * 7919 % 100000), String(i / 8), String(i / 100), (i * 37 % 1000) + "." + (i * 91 % 1000), "0".repeat(i % 9) + i);
const show = x => Object.is(x, -0) ? "-0" : String(x);
function plus(list) { const out = []; for (const s of list) out.push(show(+s)); return out; }
function times(list) { const out = []; for (const s of list) out.push(show(s * 1)); return out; }
function minus(list) { const out = []; for (const s of list) out.push(show(s - 0)); return out; }
function called(list) { const out = []; for (const s of list) out.push(show(Number(s))); return out; }
function less(list) { const out = []; for (const s of list) out.push(s < 5 ? "<" : s >= 5 ? ">" : "?"); return out; }
function equal(list) { const out = []; for (let i = 0; i < list.length; i++) out.push(list[i] == i ? "=" : "!"); return out; }
function sum(list, a, b, c) { let s = 0, t = 1.5; for (const x of list) { const n = +x; if (n === n && n < 1e9) { s += n * a; t = t * b + c; } } return s + t; }
console.log(plus(texts).join()); console.log(called(texts).join()); console.log(less(texts).join(""));
console.log(plus(texts).join() === times(texts).join(), plus(texts).join() === minus(texts).join(), plus(texts).join() === called(texts).join(), equal(texts).join("").length);
console.log(sum(texts, 1, 0.5, 0.25), sum(texts, 0.5, 0.25, 0.125));
const mixed = [...texts.slice(60, 90), 5, 2.5, null, undefined, true, { valueOf: () => "12" }, ["7"], [], new Date(5), { toString: () => "3.5" }];
console.log(plus(mixed).join(), called(mixed).join());
for (const bad of [Symbol("s"), 1n]) { try { console.log(show(+bad)); } catch (error) { console.log(error.name); } }
