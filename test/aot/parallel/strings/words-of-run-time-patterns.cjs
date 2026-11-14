// Patterns created at run time that are one of some words from start to end, on every kind of subject.
"use strict";
const make = (words, flags = "") => new RegExp("^(?:" + words.replace(/ /g, "|") + ")$", flags);
const lists = ["break case catch continue debugger default do else finally for function if return switch throw try var while with null true false instanceof typeof void delete new in this const class extends export import super", "a", "ab ba aa bb", "await", "x xx xxx xxxx", "été ÿ", "Āb ab", "aa aba abba acba"];
const subjects = [];
for (const l of lists) for (const w of l.split(" ")) subjects.push(w, w + "s", "x" + w, w.slice(1), w.toUpperCase(), w + "\n", "\n" + w, w[0] + "q" + w.slice(1), w.slice(0, -1) + "~");
subjects.push("", "breakcase", "break|case", "constructor", "identifier", "a".repeat(40), "Ā", "Ābreak", "breakĀ", "ab".repeat(9), "dq", "dqd", "ido", "odi");
const text = subjects.join(""), out = [];
let at = 0; const parts = subjects.map(s => text.slice(at, at += s.length)), wide = subjects.map(s => (s + "Ā").slice(0, s.length)), ropes = subjects.map((s, i) => s.slice(0, i % 3) + s.slice(i % 3));
function count(re, all) { let n = 0, h = 0; for (let i = 0; i < all.length; i++) if (re.test(all[i])) { n++; h = (h * 31 + i) % 1000003; } return n + ":" + h; }
function execs(re, all) { let h = ""; for (const s of all) { const m = re.exec(s); if (m) h += m[0].length + "," + m.index + "," + (m.input === s) + ";"; } return h.length + h.slice(0, 40); }
function legacy(re, all) { let h = 0; for (const s of all) { /z(.)?/.exec("qzy"); re.test(s); h = (h * 7 + RegExp.lastMatch.length * 3 + RegExp.$1.length + RegExp.leftContext.length) % 1000003; } return h; }
for (const flags of ["", "i", "m", "g", "y", "u", "s", "v", "d"]) for (const l of lists) { const re = make(l, flags); out.push(flags + " " + [subjects, parts, wide, ropes].map(a => count(re, a)).join(" ") + " " + execs(re, parts) + " " + legacy(re, ropes) + " " + subjects.filter(s => s.match(re)).length + " " + subjects.map(s => s.search(re)).join("").length + " " + parts.map(s => s.replace(re, "<$&>")).join("").length + " " + parts.map(s => s.split(re).length).join("").length); }
const re = make(lists[0]); re.lastIndex = 5; out.push(re.test("break"), re.lastIndex, re.test("brek"), re.lastIndex, re.test({ toString: () => "case" }), re.test(undefined), re.test(null), make("null undefined true 5").test(undefined), make("null undefined true 5").test(5));
re.compile("^(?:other|words)$"); out.push(re.test("break"), re.test("words"), re.test("other"), re.test("wirds"));
console.log(out.join("\n"));
