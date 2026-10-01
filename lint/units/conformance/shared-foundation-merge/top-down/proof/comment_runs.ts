// Runs of two or more comment lines, by the rule of .github/workflows/comment-cop.yml; a run with SAFETY: is let through.
// usage: bun comment_runs.ts <file> ...
import { readFileSync } from "node:fs";

function isCommentLine(line: string): boolean {
  const t = line.trimStart();
  if (t.startsWith("//")) return true;
  if (t.startsWith("/*")) return true;
  if (t === "*" || t === "*/" || t.startsWith("* ")) return true;
  return false;
}

let total = 0;
let filesWithRuns = 0;
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, "utf8").split("\n");
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= lines.length; i++) {
    const comment = i < lines.length && isCommentLine(lines[i]);
    if (comment && start < 0) start = i;
    if (!comment && start >= 0) {
      if (i - start >= 2 && !/SAFETY:/.test(lines.slice(start, i).join("\n"))) runs.push([start + 1, i]);
      start = -1;
    }
  }
  if (runs.length > 0) filesWithRuns++;
  total += runs.length;
  console.log(`${file}: ${runs.length}${runs.length > 0 ? "  lines " + runs.map(r => `${r[0]}-${r[1]}`).join(", ") : ""}`);
}
console.log(`files ${process.argv.length - 2}, with a run ${filesWithRuns}, runs ${total}`);
