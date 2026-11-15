// The patterns of constants of a module are compiled anew, get own members and are frozen by other names.
const subjects = ["alpha-12", "bat", "ba", "", "2026-11-10", "a-bc", "xx", "āb-1-ba", "aab", "cab"];
function Exec(re, string) { let sum = 0; re.lastIndex = 0; const array = re.exec(string); if (array) { for (let i = 0; i < array.length; i++) { const part = array[i]; if (part) sum += part.length * (i + 1); } } return sum; }
const compiled = /^ba(t)?/, owned = /(\d)(\d)?/, fixed = /(\d)/g, placed = /[a-c](\w)?/y;
const table = { compiled, owned, fixed, placed };
function change(name, how) { const re = table[name]; if (how === 0) re.compile("(a)(b)(c)?", "i"); if (how === 1) re.exec = s => s.length > 3 ? ["own", "two"] : null; if (how === 2) Object.defineProperty(re, "lastIndex", { writable: false }); if (how === 3) re.lastIndex = 2; }
function walk(list) { const out = []; for (let i = 0; i < list.length; i++) { const s = list[i]; if (i === 3) change("compiled", 0); if (i === 5) change("owned", 1); out.push(Exec(compiled, s), Exec(owned, s), compiled.test(s) ? 1 : 0, owned.test(s) ? 1 : 0); const m = placed.exec(s); out.push(m ? m[0] + m.index : "-", placed.lastIndex); if (i === 7) change("placed", 3); } return out.join(); }
console.log(walk(subjects)); console.log(walk(subjects));
change("fixed", 2);
function last(list) { const out = []; for (let i = 0; i < list.length; i++) { try { out.push(Exec(fixed, list[i])); } catch (e) { out.push(e.constructor.name); } try { out.push(fixed.test(list[i])); } catch (e) { out.push("T" + e.constructor.name); } } return out.join(); }
console.log(last(subjects));
