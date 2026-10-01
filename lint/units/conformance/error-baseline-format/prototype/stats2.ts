// Lines of the sections that are neither content, squiggle, message nor header; and top sections with odd lines.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
const TS = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference";
const GO = "/workspace/ref/typescript-go/testdata/baselines/reference/submodule";
function list(dir: string): string[] {
  return readdirSync(dir).filter(f => f.endsWith(".errors.txt")).sort().map(f => join(dir, f));
}
const sets: Record<string, string[]> = { ts: list(TS), go: [...list(join(GO, "compiler")), ...list(join(GO, "conformance"))] };
const head = /^(?:(.*?)\((\d+|--),(\d+|--)\): )?(error|warning|suggestion|message) TS(-?\d+): /;
for (const [name, files] of Object.entries(sets)) {
  let odd = 0, topOdd = 0, topBlank = 0, nSplit = 0;
  for (const f of files) {
    const s = readFileSync(f).toString("latin1");
    if (s.startsWith("\x1b[")) continue;
    const m = /\r\n\r\n(?===== |!!! )/.exec(s);
    if (!m) { console.log("no split", f); nSplit++; continue; }
    const top = s.slice(0, m.index);
    const rest = s.slice(m.index + 4);
    if (!top.endsWith("\r\n")) console.log("top does not end with CRLF", f);
    const topLines = top.slice(0, -2).split("\r\n");
    for (const l of topLines) {
      if (l === "") { topBlank++; console.log(name, "blank line in top:", f.split("/").pop()); }
      else if (!head.test(l) && !l.startsWith("  ")) { topOdd++; console.log(name, "odd top line:", f.split("/").pop(), JSON.stringify(l.slice(0, 120))); }
    }
    const lines = rest.split("\r\n");
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.startsWith("    ") || l.startsWith("!!! ") || /^==== .* \(\d+ errors\) ====$/.test(l)) continue;
      odd++;
      console.log(name, "odd section line:", f.split("/").pop(), i, JSON.stringify(l.slice(0, 120)), "prev:", JSON.stringify((lines[i - 1] ?? "").slice(0, 80)));
    }
  }
  console.log(`== ${name}: odd section lines ${odd}, odd top lines ${topOdd}, blank top lines ${topBlank}, no split ${nSplit}`);
}
