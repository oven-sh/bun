// One command for one machine and a stretch of time. One run of run.ts looks at one way to build; this starts several side by side, each with other options, shares the cores among them,
// and lists what they found in one file.
//
//   bun test/aot/fuzz/burst.ts --minutes 60 --out /tmp/burst
//
//   --minutes <n>   how long (default 60); a file STOP in --out ends it sooner
//   --out <folder>  <out>/<lane>/ is the --out of each run; <out>/NEW.tsv has a line for each find, the lane in front; <out>/as-tests/ has each find as a file of ../parallel
//   --cores <n>     how many cores to fill (default: all). A lane gets four or more; on a small machine the lanes further down the list are left out
//   --bun <path>    the Bun under test (default: the one that runs this script)
//   --lanes a,b     only these
//   what else stands on the command line goes to every run of run.ts: --sources a,b say
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

const runner = join(import.meta.dir, "run.ts");
const scenes = join(import.meta.dir, "fuzzilli", "lane.ts");
const damagedText = join(import.meta.dir, "damaged-text.ts");

/**
 * What each lane looks at stands in README.md, "Run it". `share`: its part of the cores. The ones that have found most come first.
 * `script`: what runs it in place of run.ts. It takes --minutes, --jobs, --out and --bun as run.ts does and leaves findings.tsv, as-tests/ and status.txt in its --out.
 */
const lanes: { name: string; options: string[]; share: number; script?: string }[] = [
  { name: "default", options: [], share: 3 },
  { name: "scenes-few-to-a-build", script: scenes, options: ["--kind", "few"], share: 3 },
  { name: "written-again", options: ["--written-again"], share: 2 },
  { name: "scenes-many-to-a-build", script: scenes, options: ["--kind", "many"], share: 2 },
  { name: "heats", options: ["--modes", "default,every-function-hot,every-function-cold"], share: 2 },
  { name: "validated", options: ["--validate"], share: 2 },
  {
    name: "collector-stress",
    options: ["--collector-stress", "1,2,3,5,7,11", "--compiled-run-seconds", "60"],
    share: 2,
  },
  { name: "very-large", options: ["--modes", "counts-as-very-large,cold-and-very-large"], share: 1 },
  { name: "checked", options: ["--modes", "moved-loads-checked,claims-checked"], share: 1 },
  { name: "failed-predictions", options: ["--fail-predictions", "1,2,7"], share: 1 },
  { name: "lowered-limits", options: ["--lowered-limits"], share: 1 },
  { name: "damaged-text", script: damagedText, options: [], share: 1 },
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
for (const { name } of wanted) {
  const list = join(out, name, "findings.tsv");
  const lines = existsSync(list) ? readFileSync(list, "utf8").split("\n").filter(Boolean) : [];
  found.push(...lines.map(line => `${name}\t${line}`));
  if (existsSync(join(out, name, "as-tests")))
    cpSync(join(out, name, "as-tests"), join(out, "as-tests"), { recursive: true });
  const status = existsSync(join(out, name, "status.txt"))
    ? readFileSync(join(out, name, "status.txt"), "utf8")
        .trimEnd()
        .split("\n")
        .at(-1)!
    : "";
  console.log(`${name}: ${status.match(/programs \d+/)?.[0] ?? "no program"}, ${lines.length} finds`);
}
writeFileSync(join(out, "NEW.tsv"), found.map(line => line + "\n").join(""));
console.log(`${found.length} finds: ${join(out, "NEW.tsv")}`);
