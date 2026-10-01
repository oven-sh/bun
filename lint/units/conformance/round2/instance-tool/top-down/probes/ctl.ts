import { readdirSync, readFileSync } from "node:fs";
const root = "/tmp/conf-it-1b/repo/test/cli/lint/conformance/corpus/baselines";
const dirs = [`${root}/typescript`, `${root}/typescript-go/compiler`, `${root}/typescript-go/conformance`];
const counts = new Map<string, { files: number; first: string; head: number }>();
let files = 0;
for (const d of dirs) for (const n of readdirSync(d)) {
  if (!n.endsWith(".errors.txt")) continue;
  files++;
  const text = readFileSync(`${d}/${n}`, "utf8");
  const lines = text.split("\r\n");
  const headEnd = lines.indexOf("");
  const seen = new Set<string>();
  const inHead = new Set<string>();
  lines.forEach((l, k) => {
    for (const m of l.matchAll(/[\x00-\x08\x0a-\x1f\x7f-\x9f\u2028\u2029\ufeff\ufffd]/g)) {
      const key = "U+" + m[0].charCodeAt(0).toString(16).padStart(4, "0");
      seen.add(key);
      if (k < headEnd) inHead.add(key);
    }
  });
  for (const key of seen) {
    const c = counts.get(key) ?? { files: 0, first: n, head: 0 };
    c.files++;
    if (inHead.has(key)) c.head++;
    counts.set(key, c);
  }
}
console.log("files", files);
for (const [k, c] of [...counts].sort()) console.log(k, "files", c.files, "in the first section of", c.head, "e.g.", c.first);
