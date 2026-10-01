// Runs of two or more comment lines, by the rule of .github/workflows/comment-cop.yml, and the forbidden words of the unit rules.
// usage: bun comment_runs.ts <file>...      prints file:first-last and the words; exit code 1 when something is found
import { readFileSync } from "node:fs";

function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  if (t.startsWith("//")) return true;
  if (t.startsWith("/*")) return true;
  if (t === "*" || t === "*/" || t.startsWith("* ")) return true;
  return false;
}

const words = /\b(TODO|FIXME|XXX|HACK)\b/;
let found = 0;
const perFile: string[] = [];
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, "utf8").split("\n");
  const runs: string[] = [];
  let start = -1;
  const flush = (end: number) => {
    if (start >= 0 && end - start >= 2 && !/SAFETY:/.test(lines.slice(start, end).join("\n"))) runs.push(`${start + 1}-${end}`);
    start = -1;
  };
  for (let i = 0; i < lines.length; i++) {
    if (isCommentLine(lines[i])) {
      if (start < 0) start = i;
    } else flush(i);
  }
  flush(lines.length);
  const bad = lines.map((l, i) => (isCommentLine(l) && words.test(l) ? i + 1 : 0)).filter(Boolean);
  const research = lines.map((l, i) => (isCommentLine(l) && /\b(research prototype|prototype (port )?of|research probe|first wave|second wave)\b/i.test(l) ? i + 1 : 0)).filter(Boolean);
  if (runs.length > 0 || bad.length > 0 || research.length > 0) {
    found += runs.length + bad.length;
    perFile.push(`${file}: ${runs.length} runs ${runs.join(" ")}${bad.length ? "; forbidden word at " + bad.join(" ") : ""}${research.length ? "; words of the research at " + research.join(" ") : ""}`);
  }
}
for (const p of perFile) console.log(p);
console.log(`${perFile.length} of ${process.argv.length - 2} files; ${found} runs or forbidden words`);
process.exit(found === 0 ? 0 : 1);
