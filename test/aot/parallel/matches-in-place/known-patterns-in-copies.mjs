// STATISTIC: KnownPatternsMatchedIntoFrame >= 8
// A function that matches what it is handed by index is copied into loops where the literal is known.
const subjects = ["alpha-12", "bat", "ba", "", "2026-11-10", "a-bc", "xx", "āb-1-ba", "abcdefghijklmnopqrstuvwxyz", "x".repeat(70) + "-7"];
const ropes = subjects.map((s, i) => s + String(i));
const pieces = subjects.map(s => ("xy" + s + "zw").slice(2, 2 + s.length));
const all = [...subjects, ...ropes, ...pieces];
const ofModule = /^ba/, digits = /(\d)(\d)?/, everyDigit = /(\d)/g, atPlace = /[a-c](\w)?/y;
function Exec(re, string) { let sum = 0; re.lastIndex = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function Parts(re, string) { let out = ""; const m = re.exec(string); if (m) { for (let i = 0; i < m.length; i++) out += m[i] + ","; out += m.index; } return out; }
function ofConsts(list) { const out = []; for (let i = 0; i < list.length; i++) { const s = list[i]; out.push(Exec(ofModule, s), Exec(digits, s), Exec(everyDigit, s), Exec(atPlace, s), everyDigit.lastIndex, atPlace.lastIndex); } return out.join(); }
function ofLiterals(list) { const out = []; for (let i = 0; i < list.length; i++) { const s = list[i]; out.push(Exec(/c(\w)(\d)?/, s), Exec(/(?<y>\d{4})-(?<m>\d\d)/, s), Parts(/(b)(a)|(x)/i, s), Parts(/^[a-z]*$/, s)); } return out.join("|"); }
function Hoisted() { this.run = run; var re0 = /^ba/, re1 = /(\w)-(\w)?(\w)?/; function run(list) { let sum = 0; for (let i = 0; i < list.length; i++) sum += Exec(re0, list[i]) + 10 * Exec(re1, list[i]); return sum; } }
console.log(ofConsts(all)); console.log(ofLiterals(all)); console.log(new Hoisted().run(all), RegExp.lastMatch, RegExp.$1);
