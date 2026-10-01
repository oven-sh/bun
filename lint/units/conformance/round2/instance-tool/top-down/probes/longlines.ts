import { readdirSync, readFileSync } from "node:fs";
const root = "/tmp/conf-it-1b/repo/test/cli/lint/conformance/corpus/baselines";
const dirs = [`${root}/typescript`, `${root}/typescript-go/compiler`, `${root}/typescript-go/conformance`];
let files = 0, filesWithLong = 0, lines = 0, long = 0, headLong = 0, headLines = 0, filesHeadLong = 0;
for (const d of dirs) for (const n of readdirSync(d)) {
  if (!n.endsWith(".errors.txt")) continue;
  files++;
  const ls = readFileSync(`${d}/${n}`, "utf8").split("\r\n");
  let any = false, inHead = true, anyHead = false;
  for (const l of ls) {
    lines++;
    if (inHead && l === "") inHead = false;
    if (inHead) headLines++;
    if (l.length > 500) { long++; any = true; if (inHead) { headLong++; anyHead = true; } }
  }
  if (any) filesWithLong++;
  if (anyHead) filesHeadLong++;
}
console.log({ files, filesWithLong, lines, long, headLines, headLong, filesHeadLong });
