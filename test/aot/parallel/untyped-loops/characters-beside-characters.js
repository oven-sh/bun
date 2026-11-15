// Characters beside characters, and sums with a value from outside.
const said = []; let digest = 0, cases = 0, calls = 0;
const tells = process.argv[2] === "all";
function keep(text) { cases++; if (tells) console.log(text.slice(0, 260)); for (let i = 0; i < text.length; i++) digest = (digest * 31 + text.charCodeAt(i)) | 0; if (cases % 211 === 1) said.push(text.slice(0, 170)); }
function show(x) { try { return typeof x === "number" ? Object.is(x, -0) ? "-0" : String(x) : typeof x === "string" ? JSON.stringify(x) : typeof x === "bigint" ? x + "n" : x === undefined ? "u" : x === null ? "n" : Array.isArray(x) || ArrayBuffer.isView(x) ? "[" + Array.from({ length: Math.min(x.length, 14) }, (_, i) => i in x ? show(x[i]) : "_").join() + "]" + x.length : typeof x === "object" ? "{" + Object.keys(x).slice(0, 4) + "}" : typeof x; } catch (e) { return "!" + e.constructor.name; } }
const counting = v => ({ valueOf() { calls++; return v; }, toString() { calls += 10; return String(v); }, length: 3 });
const fails = { valueOf() { throw new RangeError("no"); }, toString() { throw new TypeError("no"); } };
const texts = ["", "a", "aa", "aabbc", "abcabc", "ééx", "😀😀a", "a".repeat(9) + "b", "ab".concat("ba", "x".repeat(40)), ["a", "a", "b"], [1, 1, 2, undefined, undefined], [undefined, , 1], new String("aab"), { length: 3, 0: "a", 1: "a", 2: "b", "-1": "a" }, null, undefined, 5, new Uint8Array([1, 1, 2]), counting("aa"), Object.assign(["x", "x"], { "-1": "x" })];
function before(t) { let n = 0; for (let i = 0; i < t.length; i++) if (t[i] === t[i - 1]) n++; return n; }
function twoBefore(t) { let n = 0; for (let i = 0; i < t.length; i++) if (t[i] === t[i - 2]) n += i + 1; return n; }
function behind(t) { let n = 0; for (let i = 0; i < t.length; i++) if (t[i] !== t[i + 1]) n += i + 1; return n; }
function fromOne(t) { let n = 0; for (let i = 1; i < t.length; i++) if (t[i] === t[i - 1]) n++; return n; }
function starts(t) { let n = 0; for (let i = 0; i < t.length; i++) if (t[i - 1] === undefined) n++; return n; }
function edges(t) { let s = ""; for (let i = 0; i <= t.length; i++) if (t[i] !== t[i - 1]) s += i + (t[i] || "-") + (t[i - 1] || "+"); return s; }
function codes(t) { let s = 0; for (let i = 0; i < t.length; i++) s += t.charCodeAt(i) - (t.charCodeAt(i - 1) || 0); return s; }
function points(t) { let s = 0; for (let i = 0; i < t.length; i++) s += (t.codePointAt(i - 1) ?? -1); return s; }
function kinds(t) { let s = ""; for (let i = 0; i < t.length; i++) s += typeof t[i - 1]; return s; }
function chars(t) { let s = ""; for (let i = 0; i < t.length; i++) s += t.charAt(i - 1) + "."; return s; }
function around(t) { let n = 0; for (let i = 0; i < t.length; i++) if (t[i - 1] === t[i + 1]) n++; return n; }
function runs(t) { let best = 0, run = 0; for (let i = 0; i < t.length; i++) { run = t[i] === t[i - 1] ? run + 1 : 1; if (run > best) best = run; } return best; }
function inner(t) { let n = 0; for (let k = 0; k < 2; k++) for (let i = 0; i < t.length; i++) if (t[i] === t[i - 1 - k]) n++; return n; }
function ats(t) { let n = 0; for (let i = 0; i < t.length; i++) if (t.at(i - 1) === t[i]) n++; return n; }
for (const f of [before, twoBefore, behind, fromOne, starts, edges, codes, points, kinds, chars, around, runs, inner, ats]) for (const t of texts) { calls = 0; let answer; try { answer = show(f(t)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + calls); }
const values = [0, 1, -1, -0, 0.5, NaN, Infinity, 2147483647, 1e21, "", "a", "1", " px", "é", "x".repeat(50), undefined, null, true, 3n, Symbol.iterator, counting(2), fails, [], [1, 2], {}, new Date(0), () => 1];
function lengths(n, k) { let s = 0; for (let i = 0; i < n; i++) s += (i + k).length; return s; }
function lengthsLeft(n, k) { let s = 0; for (let i = 0; i < n; i++) s += (k + i).length; return s; }
function pushed(n, k) { const out = []; for (let i = 0; i < n; i++) out.push(k + i); return out; }
function pushedRight(n, k) { const out = []; for (let i = 0; i < n; i++) out.push(i + k); return out; }
function stored(n, k) { const out = []; for (let i = 0; i < n; i++) out[i] = k + i; return out; }
function storedInto(n, k) { const out = new Array(8).fill(0); for (let i = 0; i < n; i++) out[i] = i + k; return out; }
function added(n, k) { const m = new Set(); for (let i = 0; i < n; i++) m.add(k + i); return [...m]; }
function joined(n, k) { let s = ""; for (let i = 0; i < n; i++) s += k + i; return s; }
function joinedRight(n, k) { let s = ""; for (let i = 0; i < n; i++) s += i + k; return s; }
function keyed(n, k) { const m = {}; for (let i = 0; i < n; i++) m[k + i] = i; return Object.keys(m).join(); }
function mapped(n, k) { const m = new Map(); for (let i = 0; i < n; i++) m.set(k + i, i); return [...m.keys()]; }
function called(n, k) { let s = 0; const f = v => String(v).length; for (let i = 0; i < n; i++) s += f(i + k); return s; }
function counted(n, k) { let s = 0; for (let i = 0; i < n; i++) s += i + k; return s; }
function compared(n, k) { let s = 0; for (let i = 0; i < n; i++) if (i + k > 3) s++; return s; }
function indexed(n, k) { const a = [5, 6, 7, 8]; let s = 0; for (let i = 0; i < n; i++) s += a[i + k] | 0; return s; }
function halves(n, k) { const out = []; for (let i = 0; i < n; i++) out.push(i * 0.5 + k); return out; }
function methods(n, k) { let s = ""; for (let i = 0; i < n; i++) s += (k + i).padStart(4, "0"); return s; }
function changing(n, k) { let s = ""; for (let i = 0; i < n; i++) { s += (k + i).toString(); if (i === 2) k = "k"; } return s; }
for (const f of [lengths, lengthsLeft, pushed, pushedRight, stored, storedInto, added, joined, joinedRight, keyed, mapped, called, counted, compared, indexed, halves, methods, changing]) for (const k of values) for (const n of [0, 1, 6]) { calls = 0; let answer; try { answer = show(f(n, k)); } catch (e) { answer = e.constructor.name; } keep(f.name + " " + answer + calls); }
console.log(cases, digest); for (const x of said) console.log(x);
