// bun scripts/css-layer-fuzz.ts <bun> <graphs> [first seed] [baseline bun]
//   [--cycles] [--anonymous] [--no-leading-statements] [--empty-blocks]
// Runs test/bundler/css-layer-order.ts over many seeds against <bun> and prints the seeds where the bundle does not
// have the cascade layers of its sources. `<graphs>` = 1 prints the files of that seed too. With a baseline binary it
// also prints the seeds the baseline gets right and <bun> gets wrong, and how many are the other way round. It does
// that twice: for the whole check, and for the rule that `.t` gets alone, which is what a page shows.
import { resolve } from "node:path";
import {
  checkGraph,
  generateGraph,
  isWinnerProblem,
  type GraphOptions,
  type GraphResult,
} from "../test/bundler/css-layer-order";

const known = ["--cycles", "--anonymous", "--no-leading-statements", "--empty-blocks"];
const flags = process.argv.slice(2).filter(arg => arg.startsWith("--"));
const [bun, count = "100", first = "1", baseline] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
if (!bun || flags.some(flag => !known.includes(flag))) {
  console.error(
    `usage: bun scripts/css-layer-fuzz.ts <bun> <graphs> [first seed] [baseline bun] [${known.join("] [")}]`,
  );
  process.exit(1);
}
const options: GraphOptions = {
  cycles: flags.includes("--cycles"),
  anonymous: flags.includes("--anonymous"),
  leadingStatements: !flags.includes("--no-leading-statements"),
  emptyBlocks: flags.includes("--empty-blocks"),
};
const locate = (binary: string) => Bun.which(binary) ?? resolve(binary);
const [target, before] = [locate(bun), baseline && locate(baseline)];
if (Number(count) === 1) {
  for (const [name, css] of Object.entries(generateGraph(Number(first), options).files))
    console.log(`/* ${name} */\n${css}`);
}
const tally = { ok: 0, wrong: 0, skipped: 0, wrongWinner: 0 };
const wrongWinner = (result: GraphResult) => result.status === "wrong" && result.problems.some(isWinnerProblem);
const regressed = { whole: [] as number[], winner: [] as number[] };
const repaired = { whole: 0, winner: 0 };
const parallel = 8;
const end = Number(first) + Number(count);
for (let seed = Number(first); seed < end; seed += parallel) {
  const batch: Promise<[GraphResult, GraphResult | undefined]>[] = [];
  for (let s = seed; s < Math.min(end, seed + parallel); s++) {
    batch.push(Promise.all([checkGraph(target, s, options), before ? checkGraph(before, s, options) : undefined]));
  }
  for (const [result, old] of await Promise.all(batch)) {
    tally[result.status]++;
    if (wrongWinner(result)) tally.wrongWinner++;
    if (result.status !== "ok")
      console.log(`seed ${result.seed} ${result.status}:\n  ` + result.problems.slice(0, 6).join("\n  "));
    if (!old || old.status === "skipped" || result.status === "skipped") continue;
    if (old.status === "ok" && result.status === "wrong") regressed.whole.push(result.seed);
    if (old.status === "wrong" && result.status === "ok") repaired.whole++;
    if (!wrongWinner(old) && wrongWinner(result)) regressed.winner.push(result.seed);
    if (wrongWinner(old) && !wrongWinner(result)) repaired.winner++;
  }
}
if (before) {
  const seeds = (list: number[]) => `${list.length} graphs` + (list.length ? ` (seeds ${list.join(", ")})` : "");
  console.log(`right with the baseline, wrong with <bun>: ${seeds(regressed.whole)}`);
  console.log(`wrong with the baseline, right with <bun>: ${repaired.whole} graphs`);
  console.log(`.t gets the right rule with the baseline and another with <bun>: ${seeds(regressed.winner)}`);
  console.log(`.t gets another rule with the baseline and the right one with <bun>: ${repaired.winner} graphs`);
}
console.log(JSON.stringify({ graphs: Number(count), firstSeed: Number(first), ...tally }));
