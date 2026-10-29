// Strings grow piece by piece out of every kind of piece, are read while they grow, and reach the longest length there is.
function show(f) { try { const v = f(); return typeof v === "string" && v.length > 80 ? v.length + ":" + Bun.hash(v) : String(v); } catch (e) { return "threw " + e.constructor.name; } }
const pieces = ["", "a", "é", "Ā", "\u{1F600}", "\ud800", "x".repeat(20), "ÿ".repeat(300), "中".repeat(300), 1, -0, 1.5, 1e21, NaN, null, undefined, true, 10n, [1, [2]], { toString() { return "obj"; } }, Symbol.iterator.description, String(Symbol("s")), new String("boxed"), /r/g, () => 1];
const lines = [];
function plus(n, step) { let s = ""; for (let i = 0; i < n; i++) s += pieces[(i * step) % pieces.length]; return s; }
function front(n, step) { let s = ""; for (let i = 0; i < n; i++) s = pieces[(i * step) % pieces.length] + s; return s; }
function template(n, step) { let s = ""; for (let i = 0; i < n; i++) s = `${s}${pieces[(i * step) % pieces.length]}|${i}`; return s; }
function readWhile(n, step) { let s = "", t = 0; for (let i = 0; i < n; i++) { s += pieces[(i * step) % pieces.length]; if (i % 5 === 0) t += s.length + (s.charCodeAt(s.length - 1) | 0) + (s.at(-1) === "a" ? 1 : 0); } return s + t; }
function branches(n, step) { let s = "", other = ""; for (let i = 0; i < n; i++) { if (i % 3) s += pieces[(i * step) % pieces.length]; else { other = s; s += "!"; } if (i % 50 === 49) s = other + s; } return s + other; }
function escapes(n, step) { let s = ""; const kept = []; for (let i = 0; i < n; i++) { s += pieces[(i * step) % pieces.length]; if (i % 9 === 0) kept.push(s); } return kept.join("~"); }
function collects(n, step) { let s = ""; for (let i = 0; i < n; i++) { s += pieces[(i * step) % pieces.length]; if (i % 40 === 0) Bun.gc(true); } return s; }
function throwsInside(n) { let s = ""; try { for (let i = 0; i < n; i++) s += i === n - 2 ? Symbol("no") : "ab"; } catch (e) { return s + e.constructor.name; } return s; }
function sideEffects(n) { let s = ""; const o = { toString() { s += "<inner>"; return "outer"; } }; for (let i = 0; i < n; i++) s += o; return s; }
function joined(n, step) { const a = []; for (let i = 0; i < n; i++) a.push(pieces[(i * step) % pieces.length]); return a.join("") + a.join("Ā") + a.concat(a).join(); }
for (const f of [plus, front, template, readWhile, branches, escapes, collects, joined]) for (const n of [0, 1, 2, 7, 30, 300, 3000]) for (const step of [1, 3, 7]) lines.push(f.name + " " + n + " " + step + " " + show(() => f(n, step)));
for (const n of [2, 3, 50]) lines.push(show(() => throwsInside(n)), show(() => sideEffects(n)));
console.log(lines.join("\n"));
