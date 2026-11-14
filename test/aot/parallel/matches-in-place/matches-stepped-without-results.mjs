// STATISTIC: MatchIterationsStepped >= 2
// Loops and spreads over matchAll() of constants and of subjects that nobody proves: empty matches, surrogates, own exec, species, steps by hand between, breaks and throws.
const pick = (x) => [x][JSON.parse("0")]; let log = "";
const PAIR = /(\w)(\d)?/g, EMPTY = /(?:)/g, WIDE = /(?:)|./gu, SETS = /[^a]?/gv, STICKY = /[a-z]?/gy, NAMED = /(?<w>[a-z]+)-?(?<d>\d*)/g;
const subjects = ["alpha-12", "x = 1042;", "", "2026-11-10", "a\u{1F600}b", "\u{1F600}", "ab\ud83d", "\ude00x", "āb9", pick("q".repeat(70) + "7a")];
function every(re, s) { let t = ""; for (const m of s.matchAll(re)) t += m[0] + "@" + m.index + "/" + m.length + (m.groups ? m.groups.w + m.groups.d : "") + ";"; return t; }
function constants(s) { let t = ""; for (const m of s.matchAll(PAIR)) t += m[1] + m[2] + m.index; for (const [whole, a = "none"] of s.matchAll(NAMED)) t += whole + a; for (const { index, 0: whole } of pick(s).matchAll(STICKY)) t += index + whole; return t; }
function byHand(s) { const it = s.matchAll(PAIR); let t = ""; for (const m of it) { t += m[0]; const r = it.next(); t += r.done ? "-" : r.value.index; } for (const m of it) t += "again"; return t + JSON.stringify(it.next()); }
function left(s) { let t = ""; const it = pick(s).matchAll(PAIR); for (const m of it) { t += m[0]; break; } try { for (const m of it) { if (m.index > 1) throw new Error(m[0]); t += m.index; } } catch (e) { t += e.message; } return t + [...it].length; }
for (const s of subjects) { console.log([PAIR, EMPTY, WIDE, SETS, STICKY, NAMED].map(re => every(re, s)).join(" ")); console.log(constants(s), byHand(s), left(s)); console.log([...s.matchAll(PAIR)].map(m => m[0] + m.index).join(), Array.from(s.matchAll(WIDE)).length, Array.from(s.matchAll(NAMED), m => m[0]).join(), Math.max(0, ...pick(s).matchAll(EMPTY).map(m => m.index))); }
const own = /a(b)?/g; own.exec = function (s) { log += "x"; return RegExp.prototype.exec.call(this, s); };
console.log(every(own, "abab"), [...("abab").matchAll(own)].length, log);
const species = /a(b)?/g; species.constructor = { [Symbol.species]: function () { let n = 0; return { lastIndex: 0, exec() { return n++ < 3 ? { 0: n === 2 ? "" : "z", index: n, length: 1 } : null; } }; } };
console.log(every(species, "abab"), [..."abab".matchAll(species)].length);
const wrong = /a/g; wrong.constructor = { [Symbol.species]: function () { return { lastIndex: 0, exec() { return 5; } }; } };
for (const f of [() => every(wrong, "a"), () => [..."a".matchAll(wrong)], () => every(/a/, "a"), () => every(undefined, "undefined"), () => every("a", "aa")]) { try { console.log(f()); } catch (e) { console.log(e.constructor.name, e.message); } }
for (const o of [{ matchAll(x) { return [["own", 1]]; } }, { matchAll() { return "xy"; } }, { *matchAll() { yield ["gen"]; } }, { matchAll() { return new Map([["k", "v"]]); } }]) { let t = ""; for (const m of pick(o).matchAll(PAIR)) t += String(m) + ";"; console.log(t, [...pick(o).matchAll(PAIR)].length); }
