// STATISTIC: KnownPatternsMatchedIntoFrame >= 4
// Matches are taken apart in loops that grow a string.
const subjects = ["alpha-12", "bat", "ba", "", "2026-11-10", "a-bc", "xx", "āb-1-ba", "abcdefghijklmnopqrstuvwxyz", "x".repeat(70) + "-7"];
const PAIR = /(\w+)-(\d+)/, AB = /(a)(b)?|(x)/, EACH = /([a-z])(\d)?/g, HEAD = /^(ba)(t)?$/;
function Exec(re, string) { let sum = 0; re.lastIndex = 0; const m = re.exec(string); if (m) { for (let i = 0; i < m.length; i++) { const part = m[i]; if (part) sum += part.length * (i + 1); } } return sum; }
function Parts(re, string) { let t = ""; const m = re.exec(string); if (m) { for (let i = 0; i < m.length; i++) t += m[i] + ","; t += m.index; } return t; }
function sums(list) { let o = ""; for (let i = 0; i < list.length; i++) { o += Exec(PAIR, list[i]) + "|"; o += Exec(AB, list[i]); o += ";"; } return o; }
function texts(list) { let o = "", p = ""; for (let i = 0; i < list.length; i++) { o += Parts(AB, list[i]) + "|"; p = Parts(HEAD, list[i]) + p; if (o.length > 60) o = o.slice(1); } return o + p; }
function own(list) { let o = ""; for (let i = 0; i < list.length; i++) { const s = list[i]; const m = PAIR.exec(s); if (m) { o += m[1]; for (let j = 0; j < m.length; j++) o += m[j] + "."; } else o += "-"; const n = AB.exec(s); if (!n) continue; o += n.index; if (n[0] === "x") break; } return o; }
function each(s) { let o = "<"; EACH.lastIndex = 0; let m; while ((m = EACH.exec(s))) { o += m[0]; if (m[2]) { o += "(" + m[2] + ")"; } else if (o.length > 20) return o + "!"; } return o + ">"; }
function nested(list) { let o = ""; for (const s of list) { let inner = ""; for (let k = 0; k < 3; k++) { const m = AB.exec(s.slice(k)); if (m) inner += m[0] + m.index; else { inner += "_"; if (k) break; } } o += inner + "/"; } return o; }
function thrown(list) { let o = ""; for (let i = 0; i < list.length; i++) { try { const m = AB.exec(list[i]); if (m) { o += m[0]; if (m[2]) throw m[2]; } o += "."; } catch (e) { o += "E" + e; } } return o; }
console.log(sums(subjects)); console.log(texts(subjects)); console.log(own(subjects)); console.log(subjects.map(each).join()); console.log(nested(subjects)); console.log(thrown(subjects));
