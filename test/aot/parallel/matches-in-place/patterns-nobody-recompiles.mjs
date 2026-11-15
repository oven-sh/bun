// STATISTIC: RegExpMatchAllocationsElided >= 1
// Nothing names compile(): the groups of a constant pattern are known, though its prototype is looked through and RegExp is found by its species.
const pick = (x) => [x][JSON.parse("0")];
const TOKEN = /(?<word>[a-z]+)|(?<number>\d+)|(?<space>\s+)|(?<other>.)/iy, DATE = /(?<y>\d{4})-(?<m>\d\d)(?:-(?<d>\d\d))?/, LAST = /(\w)(\d)?$/g;
const subjects = pick(["alpha-12", "x = 1042;", "2026-11-10", "", "é9", "  a  b ", "2026-11", "Zeta_9"]);
function lex(s) { let n = ""; TOKEN.lastIndex = 0; for (let m; (m = TOKEN.exec(s));) { if (m.groups.word !== undefined) n += "w" + m.groups.word.length; else if (m.groups.number !== undefined) n += "n" + m.groups.number; else if (m.groups.space !== undefined) n += "s"; else n += m.groups.other; } return n; }
function dates(list) { let n = ""; for (let i = 0; i < list.length; i++) { const m = DATE.exec(list[i]); if (m) n += m.groups.y + "/" + m.groups.m + "/" + m.groups.d + m.length + m.index + ";"; } return n; }
function last(list) { let n = ""; for (let i = 0; i < list.length; i++) { LAST.lastIndex = 0; const m = LAST.exec(list[i]); if (m) n += m[1] + m[2] + m.length + LAST.lastIndex + ";"; } return n; }
console.log(subjects.map(lex).join("|")); console.log(dates(subjects)); console.log(last(subjects));
console.log(pick({ input: 5 }).input + pick({ multiline: 6 }).multiline, pick(DATE).source.length, "a1b2".split(pick(/\d/)).join());
