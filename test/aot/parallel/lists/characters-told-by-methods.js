// Loops that call a text's methods on what they step through or read by index, over texts, lists and everything else.
// STATISTIC: ArrayIterationsWithStringFallback >= 12
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all"; function keep(text) { cases++; if (tells) console.log(text.slice(0, 200)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 97 === 1) said.push(text.slice(0, 170)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) ? "[" + Array.from({ length: Math.min(x.length, 12) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]#" + x.length : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const rope = (a, b) => a + b + (cases & 1 ? "q" : "w") + a;
const odd = { charCodeAt(i) { calls++; return 7 + (i | 0); }, codePointAt() { calls++; return 9; }, toLowerCase() { calls++; return "low"; }, toUpperCase() { calls++; return "UP"; }, length: 2 };
class Text extends String { charCodeAt(i) { calls++; return super.charCodeAt(i) + 1; } }
class List extends Array { }
const inputs = [
  () => "", () => "a", () => "Hello, World", () => "étÉ ß", () => "näive 你好", () => "a😀b😁", () => "\ud83dx\ude00", () => "İıǅ", () => rope("left", "right"), () => rope("你", "x").repeat(3), () => "x".repeat(70), () => "0123456789".slice(2, 9), () => "ab\0c",
  () => [], () => ["a"], () => ["abc", "DEF", "", "é"], () => ["a", , "c"], () => ["a", 1, "b"], () => [odd, "x", odd], () => ["x", null], () => [1, 2], () => [1.5, 2.5], () => ["a", undefined], () => new Array(3), () => List.from(["p", "Q"]), () => { const a = ["k", "L"]; a.extra = 1; return a; }, () => Object.freeze(["f", "G"]), () => { const a = ["s", "T"]; a[Symbol.iterator] = function* () { calls++; yield "own"; yield "X"; }; return a; },
  () => new Set(["a", "B"]), () => new Map([["a", "B"]]), () => new Map([["a", "B"]]).keys(), () => new Uint8Array([65, 66]), () => new String("Boxed"), () => new Text("own"), () => (function* () { yield "g"; yield "H"; })(), () => ({ length: 2, 0: "o", 1: "P" }), () => ({ [Symbol.iterator]() { let i = 0; return { next() { calls++; return { done: i++ > 2, value: "It" }; }, return() { calls += 10; return {}; } }; } }), () => odd, () => null, () => undefined, () => 5, () => true, () => 10n, () => Symbol("s"), () => ({}), () => (function () { return arguments; })("r", "S"),
];
function ofCode(t) { let w = 0; for (const c of t) w += c.charCodeAt(0); return w; }
function ofPoint(t) { let w = 0; for (const c of t) { const code = c.codePointAt(0); if (code <= 0x1f) continue; w += code > 0x2ff ? 2 : 1; } return w; }
function ofPointAt(t) { let w = 0; for (const c of t) w += c.codePointAt(1) || 3; return w; }
function ofCodeFar(t) { let w = 0; for (const c of t) w = (w * 3 + (c.charCodeAt(2) | 0)) | 0; return w; }
function ofLower(t) { let w = ""; for (const c of t) w += c.toLowerCase(); return w; }
function ofUpper(t) { let n = 0; for (const c of t) if (c.toUpperCase() === c) n++; return n; }
function ofKept(t) { const out = []; for (const c of t) out.push(c.toUpperCase(), c); return out; }
function ofBreak(t) { let w = 0; for (const c of t) { if (c.charCodeAt(0) > 100) break; w++; } return w; }
function ofContinue(t) { let w = 0; for (const c of t) { if (c.charCodeAt(0) & 1) continue; w += c.codePointAt(0); } return w; }
function ofReturn(t) { for (const c of t) if (c.charCodeAt(0) === 98) return c; return "none"; }
function ofCaught(t) { let w = 0; try { for (const c of t) w += c.charCodeAt(0); } catch (e) { w += "!" + e.constructor.name; } return w; }
function ofCaughtIn(t) { let w = 0; for (const c of t) { try { w += c.charCodeAt(0); } catch { w += 1000; } } return w; }
function ofCalled(t) { let w = 0; for (const c of t) { if (c.charCodeAt(0) > 0x2ff) w += odd.codePointAt(); else w += c.charCodeAt(0); } return w; }
function ofTwice(t) { let w = 0; for (const c of t) for (const d of t) w += c.charCodeAt(0) ^ d.charCodeAt(0); return w; }
function ofChanged(t) { let w = 0, k = 0; for (const c of t) { w += c.charCodeAt(0); if (Array.isArray(t) && k++ < 3) try { t.push("n"); } catch { } } return w; }
function ofReplaced(t) { let w = 0, k = 0; for (const c of t) { w += c.charCodeAt(0); if (Array.isArray(t) && !Object.isFrozen(t) && k++ === 0) t[1] = 3.5; } return w; }
function ofCounted(t) { const m = {}; for (const c of t) { const k = c.toLowerCase(); m[k] = (m[k] || 0) + 1; } return Object.keys(m).join() + Object.values(m).join(); }
function ofJoined(t) { let w = ""; for (const c of t) w = c.toUpperCase() + w; return w; }
function atCode(t) { let w = 0; for (let i = 0; i < t.length; i++) w += t[i].charCodeAt(0); return w; }
function atPoint(t) { let w = 0; for (let i = 0; i < t.length; i++) { const c = t[i]; const code = c.codePointAt(0); if (code <= 0x1f) continue; w += code > 0x2ff ? 2 : 1; } return w; }
function atLower(t) { let w = ""; for (let i = 0; i < t.length; i++) w += t[i].toLowerCase(); return w; }
function atDown(t) { let w = 0; for (let i = t.length - 1; i >= 0; i--) w = (w * 31 + t[i].charCodeAt(0)) | 0; return w; }
function atBeyond(t) { let w = 0; for (let i = 0; i <= t.length; i++) w += t[i].charCodeAt(0); return w; }
function atEnds(t) { let n = 0; for (let i = 0, j = t.length - 1; i < j; i++, j--) if (t[i].toLowerCase() !== t[j].toLowerCase()) n++; return n; }
function atFrom(t, k) { let w = 0; for (let i = k; i < t.length; i++) w += t[i].codePointAt(0); return w; }
function atStored(t) { let w = 0; for (let i = 0; i < t.length; i++) { w += t[i].charCodeAt(0); if (Array.isArray(t) && i === 0 && !Object.isFrozen(t)) t[0] = "stored"; } return w; }
function atCalled(t) { let w = 0; for (let i = 0; i < t.length; i++) { if (t[i].charCodeAt(0) > 0x2ff) w += odd.codePointAt(); else w += t[i].charCodeAt(0); } return w; }
function atBoth(t) { let w = 0; for (let i = 0; i < t.length; i++) if (t[i] === "a" || t[i].toUpperCase() === "B") w++; return w; }
function words(t) { let w = 0; for (const c of t) for (let i = 0; i < c.length; i++) w += c[i].charCodeAt(0); return w; }
function lines(t) { let w = 0; for (const c of t) for (const d of c) w += d.charCodeAt(0); return w; }
const forms = [ofCode, ofPoint, ofPointAt, ofCodeFar, ofLower, ofUpper, ofKept, ofBreak, ofContinue, ofReturn, ofCaught, ofCaughtIn, ofCalled, ofTwice, ofChanged, ofReplaced, ofCounted, ofJoined, atCode, atPoint, atLower, atDown, atBeyond, atEnds, atFrom, atStored, atCalled, atBoth, words, lines];
function tried(f, t, k) { calls = 0; let answer; try { answer = show(f(t, k)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + k + " " + answer + (Array.isArray(t) ? show(t) : "") + calls); }
for (let round = 0; round < 3; round++) {
  for (const f of forms) for (const t of inputs) for (const k of round === 1 ? [1, "0", undefined] : [0]) tried(f, t(), k);
}
console.log(cases, digest); for (const x of said) console.log(x);
