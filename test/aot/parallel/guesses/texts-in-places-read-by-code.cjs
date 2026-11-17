// Texts, lists, objects with readers of their own, getters and nothing lie in a name of the file, a field, a member and a private field, read by their codes and replaced between.
"use strict";
const out = [], values = ["abc", "", "\u00e9x", "\ud83d\ude00z", new String("so"), ["a", "b"], { length: 2, charCodeAt(i) { return i + 7; } }, { get length() { out.push("l"); return 1; }, charCodeAt() { out.push("c"); return 3; } }, null, undefined, 5, new Uint8Array([65]), "a".repeat(3) + "b"];
let file = "x"; const box = { src: "x" };
class L { #own = "x"; constructor() { this.src = "x"; } set(x) { this.src = x; this.#own = x; } sum() { let s = 0; for (let i = 0; i < this.src.length; i++) s += this.src.charCodeAt(i); return s; } own() { let s = 0; for (let i = 0; i < this.#own.length; i++) s += this.#own.charCodeAt(i); return s; } }
const l = new L();
function say(f) { try { out.push(String(f())); } catch (e) { out.push(e.name); } }
const ways = [() => { let s = 0; for (let i = 0; i < file.length; i++) s += file.charCodeAt(i); return s; }, () => { let s = 0; for (let i = 0; i < box.src.length; i++) s += box.src.charCodeAt(i); return s; }, () => { let s = ""; for (let i = 0; i < file.length; i++) s += file.charAt(i) + "|"; return s; }, () => { let s = 0; for (let i = 0; i < file.length; i++) s += file.codePointAt(i); return s; }, () => l.sum(), () => l.own(), () => { let s = 0; for (let i = 0; i < file.length && i < 9; i++) { s += file.charCodeAt(i); if (i === 1) file = "other"; } return s; }];
for (let r = 0; r < 60; r++) { out.length = 0; for (const x of values) { file = x; box.src = x; l.set(x); for (const w of ways) { file = x; say(w); } } }
console.log(out.join());
