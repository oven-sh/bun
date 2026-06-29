// Literal content search: Bun.FileIndex.grep (parallel reads on the thread
// pool) vs `rg`, `grep -r`, and a sequential pure-JS readFile + indexOf loop,
// over a generated corpus with a known hit count.
//
//   FILE_INDEX_BENCH_FILES=2000    number of files
//   FILE_INDEX_BENCH_KB=30         size of each file in KiB
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bench, group, run } from "../runner.mjs";
import { assertEqual, hasBinary, hasFileIndex, tempRoot, writeTree } from "./lib.mjs";

const fileCount = parseInt(process.env.FILE_INDEX_BENCH_FILES || "2000", 10);
const fileKB = parseInt(process.env.FILE_INDEX_BENCH_KB || "30", 10);

// The needle never appears by accident in the filler text (letters only).
const NEEDLE = "NEEDLE_7f3a91";
// Every 17th file contains the needle on exactly HITS_PER_FILE distinct lines.
const HIT_STRIDE = 17;
const HITS_PER_FILE = 3;

const LINE = "const veryRealisticLookingIdentifier = computeSomething(alpha, beta, gamma);\n";
const linesPerFile = Math.max(32, Math.ceil((fileKB * 1024) / LINE.length));

const { root, cleanup } = tempRoot("file-index-grep");
const relPaths = [];
{
  for (let i = 0; i < fileCount; i++) relPaths.push(`src/dir${i % 32}/file_${i}.ts`);
  writeTree(root, relPaths, rel => {
    const i = parseInt(rel.slice(rel.lastIndexOf("_") + 1), 10);
    const lines = new Array(linesPerFile).fill(LINE);
    if (i % HIT_STRIDE === 0) {
      // HITS_PER_FILE deterministic, distinct line numbers (all < 32); one
      // occurrence per line so a line count (`rg -n`) equals the hit count.
      for (let k = 0; k < HITS_PER_FILE; k++) {
        lines[k * 7 + (i % 5)] = `let needle_${k} = "${NEEDLE}";\n`;
      }
    }
    return lines.join("");
  });
}
const expectedHits = Math.ceil(fileCount / HIT_STRIDE) * HITS_PER_FILE;
console.log(
  `corpus: ${fileCount} files x ${linesPerFile} lines (~${fileKB} KiB), ${expectedHits} expected hits for "${NEEDLE}"`,
);

const haveRg = hasBinary("rg");
const haveGrep = hasBinary("grep");
if (!haveRg) console.log("ripgrep (rg) is not on PATH; skipping it.");
if (!haveGrep) console.log("grep is not on PATH; skipping it.");

function countLines(buf) {
  let n = 0;
  for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, i + 1)) n++;
  return n;
}
function runRg() {
  // -uu: don't let ignore files / hidden rules change what is searched.
  const r = spawnSync("rg", ["-n", "--no-heading", "--fixed-strings", "-uu", NEEDLE, "."], { cwd: root });
  if (r.status !== 0) throw new Error(`rg exited with ${r.status}`);
  return countLines(r.stdout);
}
function runGrep() {
  const r = spawnSync("grep", ["-rnF", NEEDLE, "."], { cwd: root });
  if (r.status !== 0) throw new Error(`grep exited with ${r.status}`);
  return countLines(r.stdout);
}
function jsGrep() {
  let hits = 0;
  for (const rel of relPaths) {
    const text = readFileSync(join(root, rel), "utf8");
    let at = text.indexOf(NEEDLE);
    while (at !== -1) {
      hits++;
      at = text.indexOf(NEEDLE, at + NEEDLE.length);
    }
  }
  return hits;
}
async function indexGrep(index) {
  let hits = 0;
  for await (const _ of index.grep(NEEDLE)) hits++;
  return hits;
}

// ---- correctness: every competitor must find exactly `expectedHits` --------
let index;
if (hasFileIndex) {
  index = new Bun.FileIndex(root);
  await index.ready;
  assertEqual(await indexGrep(index), expectedHits, "Bun.FileIndex.grep hit count");
}
assertEqual(jsGrep(), expectedHits, "JS readFileSync + indexOf hit count");
if (haveRg) assertEqual(runRg(), expectedHits, "rg hit count");
if (haveGrep) assertEqual(runGrep(), expectedHits, "grep -rn hit count");

group(`literal grep over ${fileCount} files (~${fileKB} KiB each)`, () => {
  if (index)
    bench("Bun.FileIndex.grep", async () => {
      await indexGrep(index);
    });
  if (haveRg)
    bench("spawnSync rg -n --fixed-strings", () => {
      runRg();
    });
  if (haveGrep)
    bench("spawnSync grep -rnF", () => {
      runGrep();
    });
  bench("JS readFileSync + indexOf (sequential)", () => {
    jsGrep();
  });
});

await run({ avg: true, min_max: true, percentiles: true });
index?.close();
cleanup();
