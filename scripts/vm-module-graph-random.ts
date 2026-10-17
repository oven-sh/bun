// bun scripts/vm-module-graph-random.ts <bun> <graphs> [first seed]
// Runs test/js/node/vm/vm-module-graph-random-fixture.js over many seeds with <bun> and with the `node` on PATH, in
// each kind of context, and prints the seeds where the two print different lines (rerun a seed with the fixture
// to look at it). test/js/node/vm/vm-module-graph-evaluation.test.ts has the digests of some seeds.
import { resolve } from "node:path";

const [bun, count = "100", first = "0"] = process.argv.slice(2);
const node = Bun.which("node");
if (!bun || !node) {
  console.error("usage: bun scripts/vm-module-graph-random.ts <bun> <graphs> [first seed]   (needs `node` on PATH)");
  process.exit(1);
}
const fixture = resolve(import.meta.dir, "../test/js/node/vm/vm-module-graph-random-fixture.js");
const runtimes = {
  bun: [Bun.which(bun) ?? resolve(bun)],
  node: [node, "--experimental-vm-modules", "--no-warnings"],
};

// The line of each seed. A runtime can abort on a graph (V8 has a CHECK that evaluate() of a member of a failed
// cycle reaches): that seed gets "aborted" and the seeds after it run in a new process.
async function lines(command: string[], kind: string, seeds: number[]) {
  const bySeed = new Map<number, string>();
  while (seeds.length) {
    const proc = Bun.spawn({
      cmd: [...command, fixture, kind, ...seeds.map(String)],
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout] = await Promise.all([proc.stdout.text(), proc.exited]);
    const printed = stdout.split("\n").filter(line => line.startsWith("{"));
    for (const [i, line] of printed.entries()) bySeed.set(seeds[i], line);
    if (printed.length < seeds.length) bySeed.set(seeds[printed.length], "aborted");
    seeds = seeds.slice(printed.length + 1);
  }
  return bySeed;
}

const tally: Record<string, { same: number; different: number; aborted: number }> = {};
const chunk = 50;
const end = Number(first) + Number(count);
for (const kind of ["main", "context", "afterEvaluate"]) {
  tally[kind] = { same: 0, different: 0, aborted: 0 };
  for (let seed = Number(first); seed < end; seed += chunk) {
    const seeds = Array.from({ length: Math.min(chunk, end - seed) }, (_, i) => seed + i);
    const [ofBun, ofNode] = await Promise.all([lines(runtimes.bun, kind, seeds), lines(runtimes.node, kind, seeds)]);
    for (const s of seeds) {
      const [a, b] = [ofBun.get(s), ofNode.get(s)];
      if (a === "aborted" || b === "aborted") {
        tally[kind].aborted++;
        console.log(`${kind} seed ${s}: ${a === "aborted" ? "bun" : "node"} aborted`);
      } else if (a === b) {
        tally[kind].same++;
      } else {
        tally[kind].different++;
        console.log(`${kind} seed ${s}:\n  bun:  ${a}\n  node: ${b}`);
      }
    }
  }
}
console.log(JSON.stringify({ graphs: Number(count), firstSeed: Number(first), ...tally }));
