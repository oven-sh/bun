const fs = require("fs");
const diff = fs.readFileSync("/tmp/probe1/src.diff", "utf8");
const isComment = l => { const t = l.trimStart(); return t.startsWith("//") || t.startsWith("/*") || t === "*" || t === "*/" || t.startsWith("* "); };
let file = "", cur = null, groups = [], singles = [];
const flush = () => { if (cur) { if (cur.lines.length >= 2 && !/SAFETY:/.test(cur.lines.join("\n"))) groups.push(cur); else if (cur.lines.length === 1) singles.push(cur); } cur = null; };
for (const raw of diff.split("\n")) {
  if (raw.startsWith("+++ ")) { flush(); file = raw.slice(6); continue; }
  if (raw.startsWith("--- ") || raw.startsWith("diff ") || raw.startsWith("index ")) { flush(); continue; }
  if (raw.startsWith("+")) { const c = raw.slice(1); if (isComment(c)) { (cur ??= { file, lines: [] }).lines.push(c); } else flush(); }
  else flush();
}
flush();
console.log("multi-line groups comment-cop would flag:", groups.length);
for (const g of groups) console.log("  ", g.file, g.lines.length, "lines:", g.lines[0].trim().slice(0, 70));
const long = singles.filter(s => s.lines[0].trim().length > 200);
console.log("single-line comments:", singles.length, "| longer than 200 chars:", long.length, "| longer than 300:", singles.filter(s => s.lines[0].trim().length > 300).length, "| longest:", Math.max(...singles.map(s => s.lines[0].trim().length)));
for (const s of long.sort((a, b) => b.lines[0].length - a.lines[0].length).slice(0, 6)) console.log("  ", s.file, s.lines[0].trim().length, "chars:", s.lines[0].trim().slice(0, 80));
