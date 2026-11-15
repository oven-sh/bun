"use strict";
// STATISTIC: PackedCodeUnitsAppended >= 6
// Strings of two to four code units: alone, appended, read while they grow, behind a handler, of numbers that wrap and of other values.
const string16 = value => String.fromCharCode((value >> 8) & 0xff, value & 0xff);
const string32 = value => String.fromCharCode((value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff);
function appended(list) { let text = ""; for (let i = 0; i < list.length; i++) text += string16(list[i]); return text; }
function four(list) { let text = "\0"; for (let i = 0; i < list.length; i++) text += string32(list[i]) + i; return text; }
function wide(list) { let text = ""; for (let i = 0; i < list.length; i++) text += String.fromCharCode(list[i], 0x4e2d, list[i] + 1); return text; }
function read(list) { let text = "", sum = 0; for (let i = 0; i < list.length; i++) { text += String.fromCharCode(list[i], i); sum = (sum * 31 + text.charCodeAt(text.length - 2) + text.length) | 0; } return sum + text; }
function handled(list) { let text = ""; for (let i = 0; i < list.length; i++) try { text += String.fromCharCode(list[i], list[i] >> 4); if (i % 3 === 2) throw text.length; } catch (error) { text += error; } return text; }
function kept(list) { let text = ""; const all = []; for (let i = 0; i < list.length; i++) { const made = String.fromCharCode(list[i], 66, 67); text += made; all.push(made, made === "ABC", made.length); } return text + all.join(); }
function unknown(list) { let text = ""; for (const value of list) text += String.fromCharCode(value, value); return text; }
function pieces(list) { let text = ""; for (let i = 0; i < list.length; i++) { const made = String.fromCharCode(list[i], list[i] + 1); text += made[1] + made.slice(0, 1) + made.at(-1); } return text; }
function long(list) { let text = ""; for (let round = 0; round < 60; round++) for (let i = 0; i < list.length; i++) text += String.fromCharCode(list[i] & 0x7f, round); return text; }
const numbers = [0, 1, 65, 0x7f, 0x80, 255, 256, 0x3b1, 0xd83d, 0xde00, 65535, 65536, 65601, -1, -65, 2147483647, -2147483648];
const others = [65.9, -0.5, -0, NaN, Infinity, 1e300, 4294967361, undefined, null, true, "66", { valueOf: () => 67 }];
const hex = text => Array.from({ length: text.length }, (_, i) => text.charCodeAt(i).toString(16)).join(" ");
for (let pass = 0; pass < 3; pass++) {
  for (const work of [appended, four, wide, read, handled, kept, pieces, long]) console.log(work.name, hex(work(numbers)).slice(0, 2000));
  console.log(hex(unknown(numbers)), hex(unknown(others)));
}
try { console.log(unknown([1n])); } catch (error) { console.log(error.name); }
