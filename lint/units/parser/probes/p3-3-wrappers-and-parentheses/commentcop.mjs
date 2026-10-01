// Emulates the comment group scan of .github/workflows/comment-cop.yml on a unified diff read from stdin.
const patch = await Bun.stdin.text();
const isCommentLine = line => { const t = line.trimStart(); return t.startsWith("//") || t.startsWith("/*") || t === "*" || t === "*/" || t.startsWith("* "); };
let cur = null, file = "", out = [], newLine = 0;
const flush = () => { if (cur && cur.lines.length >= 2 && !/SAFETY:/.test(cur.lines.join("\n"))) out.push({ file, ...cur }); cur = null; };
for (const raw of patch.split("\n")) {
  if (raw.startsWith("+++ ")) { flush(); file = raw.slice(4); continue; }
  if (raw.startsWith("--- ") || raw.startsWith("diff ") || raw.startsWith("index ")) { flush(); continue; }
  if (raw.startsWith("@@")) { flush(); const m = /\+(\d+)/.exec(raw); newLine = m ? +m[1] : 1; }
  else if (raw.startsWith("+")) { const c = raw.slice(1); if (isCommentLine(c)) { if (cur) { cur.end = newLine; cur.lines.push(c); } else cur = { start: newLine, end: newLine, lines: [c] }; } else flush(); newLine++; }
  else if (raw.startsWith("-")) flush();
  else if (raw.startsWith("\\")) {}
  else { flush(); newLine++; }
}
flush();
console.log(out.length ? JSON.stringify(out, null, 1) : "no comment groups");
