// bun scripts/splitting-fuzz.ts <bun> <graphs> [first seed] [--unsplit [--baseline=<bun>]]
// Runs test/bundler/splitting-fuzz.ts over many seeds against <bun> and prints the seeds where chunk folding made a
// bundle worse than the unfolded one (rerun a seed with `<graphs>` = 1 to look at it). With --unsplit it builds each
// graph without code splitting and prints the seeds where the bundle differs from the unbundled program. With a
// baseline binary it prints the seeds where the bundle is worse than the one that the baseline builds.
import { resolve } from "node:path";
import { checkGraph, checkUnsplit } from "../test/bundler/splitting-fuzz";

const flags = process.argv.slice(2).filter(arg => arg.startsWith("--"));
const [bun, count = "100", first = "1"] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
const unsplit = flags.includes("--unsplit");
const baselineFlag = flags.find(flag => flag.startsWith("--baseline="));
if (!bun || (baselineFlag && !unsplit)) {
  console.error("usage: bun scripts/splitting-fuzz.ts <bun> <graphs> [first seed] [--unsplit [--baseline=<bun>]]");
  process.exit(1);
}
const binary = (name: string) => Bun.which(name) ?? resolve(name);
const target = binary(bun);
const baseline = baselineFlag ? binary(baselineFlag.slice("--baseline=".length)) : undefined;
const tally = { ok: 0, skipped: 0, worse: 0, different: 0, folded: 0, unjudged: 0 };
const parallel = 8;
const end = Number(first) + Number(count);
for (let seed = Number(first); seed < end; seed += parallel) {
  const batch = [];
  for (let s = seed; s < Math.min(end, seed + parallel); s++) {
    batch.push(unsplit ? checkUnsplit(target, s, baseline) : checkGraph(target, s));
  }
  for (const result of await Promise.all(batch)) {
    tally[result.status]++;
    if ("folded" in result && result.folded) tally.folded++;
    const unjudged = "unjudged" in result ? result.unjudged.map(why => "no verdict: " + why) : [];
    if (unjudged.length) tally.unjudged++;
    if (result.status !== "ok" || unjudged.length) {
      console.log(
        `seed ${result.seed} ${result.status}:\n  ` + [...result.problems.slice(0, 6), ...unjudged].join("\n  "),
      );
    }
  }
}
console.log(JSON.stringify({ graphs: Number(count), firstSeed: Number(first), ...tally }));
// Folding changes about one graph in sixteen.
if (!unsplit && tally.folded === 0 && Number(count) >= 200 && tally.skipped < Number(count)) {
  console.error("folding changed no bundle: does <bun> read foldChunksForTesting (--expose-internals gate)?");
  process.exit(1);
}
