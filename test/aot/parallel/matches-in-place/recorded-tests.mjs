// STATISTIC: RegExpMatchers >= 8
// The last match that RegExp shows, behind tests in loops.
const flat = ["alpha-12", "beta", "https://a.b/c", "foo.test.ts", "  a b  ", "2026-11-10", "-1.5e+3", "#a0b1c2", "abc", "", "a", "ab", "aab", "é1", "Āb1", "x".repeat(70) + "7"];
const ropes = flat.map((s, i) => (s + String(i)));
const pieces = flat.map(s => ("xy" + s + "zw").slice(2, 2 + s.length));
const all = [...flat, ...ropes, ...pieces];
function last() { return [RegExp.lastMatch, RegExp.$1, RegExp.$2, RegExp.leftContext, RegExp.rightContext, RegExp.input, RegExp.lastParen].join("|"); }
const held = /(\d)(\d)?/;
let variable = /^[a-z]+$/;
function digits(list) { let out = ""; for (const s of list) out += (/\d/.test(s) ? "T" : "F") + last() + "\n"; return out; }
function pair(list) { let out = ""; for (const s of list) out += (/(\d)-(\d)/.test(s) ? "T" : "F") + last() + "\n"; return out; }
function word(list) { let out = ""; for (const s of list) out += (/\b(a)b?/.test(s) ? "T" : "F") + last() + "\n"; return out; }
function anchored(list) { let out = ""; for (const s of list) out += (/^(?:a|b)(.*)c?$/.test(s) ? "T" : "F") + last() + "\n"; return out; }
function ending(list) { let out = ""; for (const s of list) out += (/\.ts$/.test(s) ? "T" : "F") + last() + "\n"; return out; }
function empty(list) { let out = ""; for (const s of list) out += (/x*/.test(s) ? "T" : "F") + last() + "\n"; return out; }
function ofConst(list) { let out = ""; for (const s of list) out += (held.test(s) ? "T" : "F") + last() + "\n"; return out; }
function ofVariable(list) { let out = ""; for (const s of list) out += (variable.test(s) ? "T" : "F") + last() + "\n"; return out; }
function chain(list) { let out = ""; for (const s of list) { if (/^\d+/.test(s)) out += "1"; else if (/^[a-z]+-/.test(s)) out += "2"; else if (/[#:]/.test(s)) out += "3"; else out += "0"; out += last() + "\n"; } return out; }
for (const f of [digits, pair, word, anchored, ending, empty, ofConst, ofVariable, chain]) console.log(f.name, f(all));
held.compile("b"); for (const f of [ofConst, digits]) console.log(f.name, f(flat));
variable.lastIndex = "3"; console.log(ofVariable(flat)); variable.lastIndex = { valueOf() { console.log("seen"); return 0; } }; console.log(ofVariable(flat.slice(0, 2)));
