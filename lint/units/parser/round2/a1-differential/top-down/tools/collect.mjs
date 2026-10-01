// usage: node collect.mjs <out file> <class regex> <api> <probe.out>...   the sources of the probes in one class, one per line
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const [outPath, classPattern, api, ...probes] = process.argv.slice(2);
const re = new RegExp(classPattern);
const seen = new Set();
const lines = [];
for (const probe of probes) {
  const text = execFileSync("node", ["summarize.mjs", probe, api], { encoding: "utf8", maxBuffer: 1 << 26 });
  let cur = "";
  for (const line of text.split("\n")) {
    const h = /^## (.*?) \(\d+\)$/.exec(line);
    if (h) { cur = h[1]; continue; }
    const m = /^  ("(?:[^"\\]|\\.)*")/.exec(line);
    if (!m || !re.test(cur)) continue;
    const src = JSON.parse(m[1]);
    if (seen.has(src)) continue;
    seen.add(src);
    lines.push(src.replaceAll("\n", "\u23ce"));
  }
}
writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`${outPath}: ${lines.length} sources`);
