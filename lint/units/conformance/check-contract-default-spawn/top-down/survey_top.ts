// Survey: first sections of all plain .errors.txt baselines, classify lines.
import { readdirSync, readFileSync } from "node:fs";
const dirs = [
  "/workspace/ref/typescript-go/_submodules/TypeScript/tests/baselines/reference",
  "/workspace/ref/typescript-go/testdata/baselines/reference/submodule/compiler",
  "/workspace/ref/typescript-go/testdata/baselines/reference/submodule/conformance",
];
const plainHead = /^(\S.*?)\((\d+|--),(\d+|--)\): (error|warning|suggestion|message) TS(-?\d+): (.*)$/s;
const globalHead = /^(error|warning|suggestion|message) TS(-?\d+): (.*)$/s;
let files = 0, heads = 0, globals = 0, chain = 0, odd = 0, pretty = 0;
const oddEx: string[] = [];
const levelJump: string[] = [];
const cats = new Map<string, number>();
let maxLevel = 0;
let crInLine = 0;
let nameWithParen = 0; const nameParenEx: string[] = [];
let nameWithSpace = 0;
let negCode = 0;
for (const d of dirs) {
  for (const f of readdirSync(d)) {
    if (!f.endsWith(".errors.txt")) continue;
    const text = readFileSync(d + "/" + f, "latin1");
    if (text.startsWith("\x1b[")) { pretty++; continue; }
    files++;
    const all = text.split("\r\n");
    let bodyStart = all.findIndex(l => l.startsWith("!!! ") || /^==== .* \(\d+ errors\) ====$/s.test(l));
    if (bodyStart < 0) bodyStart = all.length;
    let topEnd = bodyStart;
    while (topEnd > 0 && all[topEnd - 1] === "") topEnd--;
    let prev = -1;
    for (const line of all.slice(0, topEnd)) {
      if (line.includes("\n") || line.includes("\r")) crInLine++;
      let m = globalHead.exec(line);
      if (m) { globals++; prev = 0; cats.set(m[1], (cats.get(m[1]) ?? 0) + 1); if (m[2].startsWith("-")) negCode++; continue; }
      m = plainHead.exec(line);
      if (m) { heads++; prev = 0; cats.set(m[4], (cats.get(m[4]) ?? 0) + 1); if (m[5].startsWith("-")) negCode++;
        if (/[()]/.test(m[1])) { nameWithParen++; if (nameParenEx.length < 5) nameParenEx.push(f + ": " + line.slice(0, 100)); }
        if (/ /.test(m[1])) nameWithSpace++;
        continue; }
      const sp = /^( *)/.exec(line)![1].length;
      if (sp >= 2 && sp % 2 === 0 && line.length > sp) {
        const level = sp / 2;
        if (level > prev + 1) { if (levelJump.length < 10) levelJump.push(f + ": " + JSON.stringify(line.slice(0, 120)) + " prev=" + prev); }
        chain++; prev = Math.min(level, prev + 1); maxLevel = Math.max(maxLevel, level);
        continue;
      }
      odd++;
      if (oddEx.length < 20) oddEx.push(f + ": " + JSON.stringify(line.slice(0, 140)));
    }
  }
}
console.log({ files, pretty, heads, globals, chain, odd, maxLevel, crInLine, nameWithParen, nameWithSpace, negCode, cats: [...cats] });
console.log("odd examples:\n" + oddEx.join("\n"));
console.log("level jumps:\n" + levelJump.join("\n"));
console.log("paren names:\n" + nameParenEx.join("\n"));
