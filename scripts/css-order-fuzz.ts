// <bun> scripts/css-order-fuzz.ts <graphs> [first seed] [--flags] [--older-browser] [--write=<file>] [--against=<file>]
// Bundles random graphs of CSS files with the <bun> that runs this script, and prints the seeds where the bundle does
// not have the cascade of its sources (test/bundler/css-order-fuzz.ts). `<graphs>` = 1 also prints the files and the
// bundle of that seed. The flags turn on shapes of the graphs: see `flagNames`.
// `--older-browser` applies the bundle as a browser that drops an `@import` with `supports()`.
// `--write` saves what is wrong for each seed. `--against` reads such a file of another <bun> and prints what this
// <bun> makes wrong that the other has right: whole graphs, and pairs of sibling layers.
import { cascadeProblems, generateGraph, type GraphOptions } from "../test/bundler/css-order-fuzz";

const flagNames: Record<string, keyof GraphOptions> = {
  "--cycles": "cycles",
  "--anonymous": "anonymous",
  "--empty-blocks": "emptyBlocks",
  "--conditions": "conditions",
  "--import-conditions": "importConditions",
  "--external": "external",
  "--external-rules": "externalRules",
  "--external-layers": "externalLayers",
  "--anon-blocks": "anonBlocks",
  "--empty-files": "emptyFiles",
};
const flags = process.argv.slice(2).filter(arg => arg.startsWith("--"));
const [count, first = "1"] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
const valueOf = (name: string) => flags.find(flag => flag.startsWith(name + "="))?.slice(name.length + 1);
const [writeTo, against] = [valueOf("--write"), valueOf("--against")];
const olderBrowser = flags.includes("--older-browser");
const shapes = flags.filter(flag => flag !== "--older-browser" && !flag.includes("="));
if (!count || shapes.some(flag => !(flag in flagNames))) {
  console.error(`usage: <bun> scripts/css-order-fuzz.ts <graphs> [first seed] [${Object.keys(flagNames).join("] [")}]`);
  process.exit(1);
}
const options: GraphOptions = {};
for (const flag of shapes) options[flagNames[flag]] = true;

// The pairs of sibling layers that a "layers" problem has in the wrong order, as "<state>|<parent>|<first><<second>".
function wrongLayerPairs(problems: string[]): string[] {
  const pairs: string[] = [];
  for (const text of problems) {
    const m = /^layers of (.*): \[(.*)\] in the sources, \[(.*)\] in the bundle(.*)$/.exec(text);
    if (!m) continue;
    const [sources, bundle] = [m[2], m[3]].map(list => (list ? list.split(", ") : []));
    for (let a = 0; a < sources.length; a++) {
      for (let b = a + 1; b < sources.length; b++) {
        const [i, j] = [bundle.indexOf(sources[a]), bundle.indexOf(sources[b])];
        if (i < 0 || j < 0 || i > j) pairs.push(`${m[4]}|${m[1]}|${sources[a]}<${sources[b]}`);
      }
    }
  }
  return pairs;
}
const baseline: Record<string, string[]> | undefined = against ? await Bun.file(against).json() : undefined;
const written: Record<string, string[]> = {};
const regressed: number[] = [];
let newWrongLayerPairs = 0;

const tally: Record<string, number> = { ok: 0, wrong: 0, failed: 0, onlyHoist: 0 };
for (let seed = Number(first); seed < Number(first) + Number(count); seed++) {
  const { files, entry, externalSheets } = generateGraph(seed, options);
  if (count === "1") for (const [name, css] of Object.entries(files)) console.log(`/* ${name} */\n${css}`);
  const result = await Bun.build({ entrypoints: [entry], files, minify: true, throw: false });
  if (!result.success) {
    tally.failed++;
    console.log(`seed ${seed} failed: ${result.logs.join("; ").slice(0, 300)}`);
    continue;
  }
  const bundle = await result.outputs[0].text();
  if (count === "1") console.log(`/* bundle */\n${bundle}`);
  const problems = cascadeProblems(files, entry, bundle, externalSheets, olderBrowser);
  // A pair that only the hoist of an external import changes cannot be kept, so it does not make a graph wrong.
  const wrong = problems.filter(problem => problem.kind !== "pair-hoist");
  written[seed] = wrong.map(problem => problem.text);
  const before = baseline?.[seed];
  if (before) {
    if (before.length === 0 && wrong.length !== 0) regressed.push(seed);
    const had = new Set(wrongLayerPairs(before));
    newWrongLayerPairs += wrongLayerPairs(written[seed]).filter(pair => !had.has(pair)).length;
  }
  if (wrong.length === 0) {
    tally.ok++;
    if (problems.length) tally.onlyHoist++;
    continue;
  }
  tally.wrong++;
  for (const kind of new Set(wrong.map(problem => problem.kind))) tally[kind] = (tally[kind] ?? 0) + 1;
  const shown = wrong.slice(0, count === "1" ? 40 : 3).map(problem => problem.text);
  console.log(`seed ${seed}:\n  ` + shown.join("\n  "));
}
if (writeTo) await Bun.write(writeTo, JSON.stringify(written));
if (baseline) console.log(JSON.stringify({ rightOnlyWithTheOther: regressed, newWrongLayerPairs }));
console.log(JSON.stringify({ graphs: Number(count), firstSeed: Number(first), options, olderBrowser, ...tally }));
