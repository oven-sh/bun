// bun scripts/splitting-fuzz.ts <bun> <graphs> [first seed]
// Runs test/bundler/splitting-fuzz.ts over many seeds against <bun> and prints the seeds where chunk folding made a
// bundle worse than the unfolded one (rerun a seed with `<graphs>` = 1 to look at it).
import { resolve } from "node:path";
import { checkGraph } from "../test/bundler/splitting-fuzz";

const [bun, count = "100", first = "1"] = process.argv.slice(2);
if (!bun) {
  console.error("usage: bun scripts/splitting-fuzz.ts <bun> <graphs> [first seed]");
  process.exit(1);
}
const target = Bun.which(bun) ?? resolve(bun);
const tally = { ok: 0, skipped: 0, worse: 0, folded: 0 };
const parallel = 8;
const end = Number(first) + Number(count);
for (let seed = Number(first); seed < end; seed += parallel) {
  const batch = [];
  for (let s = seed; s < Math.min(end, seed + parallel); s++) batch.push(checkGraph(target, s));
  for (const result of await Promise.all(batch)) {
    tally[result.status]++;
    if (result.folded) tally.folded++;
    if (result.status !== "ok")
      console.log(`seed ${result.seed} ${result.status}:\n  ` + result.problems.slice(0, 6).join("\n  "));
  }
}
console.log(JSON.stringify({ graphs: Number(count), firstSeed: Number(first), ...tally }));
// Folding changes about one graph in sixteen.
if (tally.folded === 0 && Number(count) >= 200 && tally.skipped < Number(count)) {
  console.error("folding changed no bundle: does <bun> read foldChunksForTesting (--expose-internals gate)?");
  process.exit(1);
}
