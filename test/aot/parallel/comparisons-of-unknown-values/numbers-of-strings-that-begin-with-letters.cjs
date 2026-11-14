// A string that begins with a letter is no number, but for Infinity.
"use strict";
const first = ["", "a", "z", "A", "Z", "I", "i", "Infinity", "infinity", "Infinity ", "Infinityx", "-Infinity", "+Infinity", "NaN", "nan", "e5", "E5", "x10", "b1", "o7", "length", "push", "@", "[", "`", "{", "_", "$", " ", " a", " 12 ", "\n7", "0x1f", "0b11", "0o17", "1e3", ".5", "5.", "5a", "é", "É", "İ", "  5", "﻿9", "aa ", "undefined", "null", "true"];
const rope = t => { let s = ""; for (const c of t) s += c; return s + (Math.random() > 2 ? "x" : ""); };
const values = [...first, ...first.map(rope), ...first.map(t => ("12" + t).slice(2)), undefined, null, true, false, 5, -0, 1.5, NaN, [], ["a"], ["7"], {}, new String("a"), new String("8"), new Date(4), { valueOf() { return "b"; } }, { toString() { return "9"; } }, Symbol("s"), 10n];
const attempt = f => { try { return f(); } catch (e) { return e.name; } };
const forms = [v => isNaN(v), v => Number(v), v => +v, v => -v, v => v - 1, v => v * 2, v => Math.floor(v), v => isFinite(v), v => Number.isNaN(+v), v => Math.max(v, 3), v => typeof v !== "string" || isNaN(v) ? "name" : "index", v => v >>> 0, v => v / 2, v => v % 7, v => Math.abs(v) > 1];
for (const form of forms) console.log(values.map(v => { const n = attempt(() => form(v)); return Object.is(n, -0) ? "-0" : String(n); }).join(" "));
const p = new Proxy([10, 20, 30], { get(t, k) { return typeof k !== "string" || isNaN(k) ? t[k] : t[k] + 1; } });
console.log(p[0], p[1], p.length, p.push(5), p[3], p.map(x => x * 2).join(), p.Infinity, p.infinite, p["1"], p[" 2"]);
