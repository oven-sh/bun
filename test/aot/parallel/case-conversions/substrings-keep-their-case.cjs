// A substring without letters of the other case is its own conversion and is not looked through by native code.
// COUNTER: operationAOTStringToUpperCase <= 700
// COUNTER: operationAOTStringToLowerCase <= 700
"use strict";
const hide = v => [v][JSON.parse("0")];
let text = "", low = "";
for (let i = 0; i < 60; i++) { const w = String.fromCharCode(65 + i % 26, 66 + i % 20, 48 + i % 10) + (i % 3 ? "_|~@[`{" : "") + i * 7; text += (i ? " " : "") + w; low += (i ? "," : "") + w.toLowerCase() + "@[`{"; }
function up(list) { let n = 0; for (let i = 0; i < list.length; i++) { const s = list[i].toUpperCase(); n = (n * 31 + s.length + (s === list[i] ? 1 : 0) + (s.charCodeAt(s.length >> 1) | 0)) | 0; } return n; }
function down(list) { let n = 0; for (let i = 0; i < list.length; i++) { const s = list[i].toLowerCase(); n = (n * 31 + s.length + (s === list[i] ? 1 : 0) + (s.charCodeAt(s.length >> 1) | 0)) | 0; } return n; }
const seen = new Set;
for (let round = 0; round < 80; round++) seen.add(up((text + (round & 1 ? " " : "  ")).split(" ")) + "/" + down((low + (round & 1 ? "," : ",,")).split(",")));
console.log([...seen].join(" "));
const words = ["", "a", "Z", "z", "A", "\u00e9", "\u00c9", "\u00df", "\u00ff", "\u0130", "stra\u00dfe", "abcdefgh", "ABCDEFGH", "ABCDEFGHi", "aBCDEFGH", "ABCDEFGHIJKLMNOPQRSTUVWXYz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ[`", "0123456789", "\u0141\u00f3d\u017a", "ab\u0301"];
const log = [];
for (const base of ["..", "\u0100.", "\u00e9."]) {
  const all = hide(base + words.join("\n") + base);
  let at = base.length;
  for (const w of words) { const part = all.substring(at, at + w.length); at += w.length + 1; log.push(JSON.stringify([part.toUpperCase(), part.toLowerCase(), hide(part + part).toUpperCase(), hide(w).toUpperCase()])); }
}
console.log(log.join(" "));
