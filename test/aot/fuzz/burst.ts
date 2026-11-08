// Runs many fuzzing runs side by side on one machine. One run of run.ts tests one way to build; this script starts
// several, each with different options, shares the cores among them, and lists what they found in one file.
//
//   bun test/aot/fuzz/burst.ts --minutes 60 --out /tmp/burst
//
//   --minutes <n>   how long to run (default 60). A file named STOP in --out ends it sooner
//   --out <folder>  each run writes to <out>/<lane>/. <out>/NEW.tsv has one line per finding, prefixed with the lane; <out>/as-tests/ has each finding in the format of ../parallel
//   --cores <n>     how many cores to use (default: all). A lane gets at least four; on a small machine the lanes at the end of the list are dropped
//   --bun <path>    the Bun under test (default: the one that runs this script)
//   --lanes a,b     only these lanes
//   Any other argument is passed to every run of run.ts, for example --sources a,b
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const runner = join(import.meta.dir, "run.ts");
const scenes = join(import.meta.dir, "fuzzilli", "lane.ts");
const malformedSource = join(import.meta.dir, "malformed-source.ts");

/**
 * README.md, "Options that find different bugs", explains the options. `share` is the lane's share of the cores. The
 * lanes that have found the most come first. `script` runs instead of run.ts. It must accept --minutes, --jobs, --out
 * and --bun like run.ts and write findings.tsv, as-tests/ and status.txt to its --out. A line of status.txt says
 * `programs <n>`.
 */
const lanes: { name: string; options: string[]; share: number; script?: string }[] = [
  { name: "default", options: [], share: 3 },
  { name: "scenes-few-to-a-build", script: scenes, options: ["--kind", "few"], share: 3 },
  { name: "rewritten", options: ["--rewritten"], share: 2 },
  { name: "never-taken", options: ["--never-taken"], share: 2 },
  { name: "another-call", options: ["--another-call"], share: 2 },
  { name: "scenes-many-to-a-build", script: scenes, options: ["--kind", "many"], share: 2 },
  {
    name: "gc-stress",
    options: ["--gc-stress", "1,2,3,5,7,11", "--compiled-run-seconds", "60"],
    share: 2,
  },
  { name: "no-facts", options: ["--modes", "no-flow-results"], share: 1 },
  { name: "malformed-source", script: malformedSource, options: [], share: 1 },
  { name: "scenes-in-packages", script: scenes, options: ["--kind", "packages"], share: 1 },
  { name: "scenes-beside-an-external", script: scenes, options: ["--kind", "external"], share: 1 },
];

const words = process.argv.slice(2);
function taken(name: string): string | undefined {
  const at = words.indexOf(`--${name}`);
  if (at >= 0) return words.splice(at, 2)[1];
}
const minutes = Number(taken("minutes") ?? 60);
const out = taken("out");
const cores = Number(taken("cores") ?? availableParallelism());
const bun = taken("bun");
const only = taken("lanes")?.split(",");
if (!out) {
  console.error(
    "usage: bun test/aot/fuzz/burst.ts --minutes <n> --out <folder> [--cores <n>] [--bun <path>] [--lanes a,b]",
  );
  process.exit(1);
}
const unknown = (only ?? []).filter(name => !lanes.some(lane => lane.name === name));
if (unknown.length) {
  console.error(`no lane is called ${unknown.join(" or ")}: the lanes are ${lanes.map(lane => lane.name).join(", ")}`);
  process.exit(1);
}

const wanted = lanes.filter(lane => !only || only.includes(lane.name)).slice(0, Math.max(1, Math.floor(cores / 4)));
const shares = wanted.reduce((sum, lane) => sum + lane.share, 0);
mkdirSync(out, { recursive: true });
const runs = wanted.map(lane => {
  const jobs = Math.max(1, Math.floor((cores * lane.share) / shares));
  console.log(`${lane.name}: ${jobs} jobs ${lane.options.join(" ")}`);
  return Bun.spawn({
    cmd: [process.execPath, lane.script ?? runner, "--minutes", String(minutes), "--jobs", String(jobs), "--out", join(out, lane.name), ...(bun ? ["--bun", bun] : []), ...lane.options, ...(lane.script ? [] : words)], // prettier-ignore
    stdio: ["ignore", "ignore", "inherit"],
  });
});
const stops = setInterval(() => {
  if (existsSync(join(out, "STOP"))) for (const lane of wanted) writeFileSync(join(out, lane.name, "STOP"), "");
}, 5000);
await Promise.all(runs.map(run => run.exited));
clearInterval(stops);

const found: string[] = [];
for (const [at, { name }] of wanted.entries()) {
  const list = join(out, name, "findings.tsv");
  const lines = existsSync(list) ? readFileSync(list, "utf8").split("\n").filter(Boolean) : [];
  found.push(...lines.map(line => `${name}\t${line}`));
  if (existsSync(join(out, name, "as-tests")))
    cpSync(join(out, name, "as-tests"), join(out, "as-tests"), { recursive: true });
  const status = existsSync(join(out, name, "status.txt")) ? readFileSync(join(out, name, "status.txt"), "utf8") : "";
  // The first count of the last line that has one: malformed-source.ts lists what it found behind that line.
  const programs = [...status.matchAll(/^.*?(programs \d+)/gm)].at(-1)?.[1];
  const { exitCode, signalCode } = runs[at];
  const failure = exitCode === 0 ? "" : `ended with ${signalCode ?? `exit code ${exitCode}`}, `;
  console.log(`${name}: ${failure}${programs ?? "no program"}, ${lines.length} finds`);
}
writeFileSync(join(out, "NEW.tsv"), found.map(line => line + "\n").join(""));
console.log(`${found.length} finds: ${join(out, "NEW.tsv")}`);
