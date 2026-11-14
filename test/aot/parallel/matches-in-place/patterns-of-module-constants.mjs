// STATISTIC: KnownPatternsMatchedIntoFrame >= 6
// A constant of a module that holds one literal is known where it is matched, also where it stands in a list, is passed on or exported.
const subjects = ["alpha-12", "bat", "ba", "", "2026-11-10", "a-bc", "xx", "āb-1-ba", "abcdefghijklmnopqrstuvwxyz", "x".repeat(70) + "-7"];
const ropes = subjects.map((s, i) => s + String(i));
const pieces = subjects.map(s => ("xy" + s + "zw").slice(2, 2 + s.length));
const all = [...subjects, ...ropes, ...pieces];
function Exec(re, string) { let sum = 0; re.lastIndex = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function early(list) { const out = []; for (let i = 0; i < list.length; i++) out.push(Exec(inList, list[i])); return out.join(); }
try { console.log(early(all)); } catch (e) { console.log(e.constructor.name); }
const inList = /^ba(t)?/, passed = /(\d)(\d)?/, everyDigit = /(\d)/g, atPlace = /[a-c](\w)?/y;
export const exported = /(\w)-(\w)?(\w)?/;
let changed = /a(b)?/; var assignedTwice = /(a)|(b)/; const either = process.argv.length > 90 ? /(x)/ : /(b)(c)?/; const made = new RegExp("(a)(b)?");
const table = [inList, passed, everyDigit, atPlace, exported, changed, assignedTwice, either, made];
function ofTable(list) { const out = []; for (const re of table) { for (let i = 0; i < list.length; i++) out.push(Exec(re, list[i])); } return out.join(); }
function ofConstants(list) { const out = []; for (let i = 0; i < list.length; i++) { const s = list[i]; out.push(Exec(inList, s), Exec(passed, s), Exec(everyDigit, s), Exec(atPlace, s), Exec(exported, s), everyDigit.lastIndex, atPlace.lastIndex); } return out.join(); }
function ofVariables(list) { const out = []; for (let i = 0; i < list.length; i++) { const s = list[i]; out.push(Exec(changed, s), Exec(assignedTwice, s), Exec(either, s), Exec(made, s)); if (i === 4) { changed = /b(a)?/; assignedTwice = /(c)|(b)/; } } return out.join(); }
function tests(list) { let n = 0; for (let i = 0; i < list.length; i++) { const s = list[i]; if (inList.test(s)) n += i; if (exported.test(s)) n += 100 * i; const m = passed.exec(s); if (m) n += m[0].length; } return n; }
console.log(early(all)); console.log(ofTable(all)); console.log(ofConstants(all)); console.log(ofVariables(all)); console.log(ofVariables(all)); console.log(tests(all), RegExp.lastMatch, RegExp.$1);
