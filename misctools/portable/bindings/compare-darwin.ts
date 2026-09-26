// Compares what the portable image has of macOS with what the headers of macOS say.
//
//   bun compare-darwin.ts <image.jsonl> <headers.jsonl>
//
// <image.jsonl> is what `bun_fs_slice.img --layout-darwin` prints, <headers.jsonl> what the parts of
// darwin_layout.c print on a Mac (run-on-mac.sh keeps both in its logs, as layout-image.jsonl and
// layout-headers.jsonl, and compares them itself with sh, grep and sed: this is the same comparison
// for a machine that has bun). Each line is one fact: the size or the alignment of a type, the offset
// or the size of a field, the value of a constant. Prints every fact that differs with both values,
// and fails if there is one.
import { readFileSync } from "node:fs";

const [imagePath, headersPath] = process.argv.slice(2);
if (!imagePath || !headersPath) throw new Error("usage: bun compare-darwin.ts <image.jsonl> <headers.jsonl>");
type Fact = { fact: string; of: string; value: number | string };
const read = (path: string) => new Map(readFileSync(path, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line) as Fact).map(fact => [`${fact.fact} ${fact.of}`, fact.value]));
const image = read(imagePath);
const headers = read(headersPath);
let same = 0;
const differences: string[] = [];
const absent: string[] = [];
for (const [name, ours] of image) {
  const theirs = headers.get(name);
  if (theirs === undefined) absent.push(`${name}: the headers did not print it (its part did not compile)`);
  else if (typeof theirs === "string") absent.push(`${name}: ${theirs}`);
  else if (theirs === ours) same++;
  else differences.push(`${name}: ${ours} in the image, ${theirs} in the headers`);
}
for (const line of absent) console.log(`not compared  ${line}`);
for (const line of differences) console.log(`DIFFERENT     ${line}`);
console.log(`${same} facts are the same, ${differences.length} differ, ${absent.length} could not be compared`);
process.exit(differences.length ? 1 : 0);
