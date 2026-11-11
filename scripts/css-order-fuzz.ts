// <bun> scripts/css-order-fuzz.ts <graphs> [first seed] [--flags]
// Bundles random graphs of CSS files with the <bun> that runs this script, and prints the seeds where the bundle does
// not have the cascade of its sources (test/bundler/css-order-fuzz.ts). `<graphs>` = 1 also prints the files and the
// bundle of that seed. The flags turn on shapes of the graphs: see `flagNames`.
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
if (!count || flags.some(flag => !(flag in flagNames))) {
  console.error(`usage: <bun> scripts/css-order-fuzz.ts <graphs> [first seed] [${Object.keys(flagNames).join("] [")}]`);
  process.exit(1);
}
const options: GraphOptions = {};
for (const flag of flags) options[flagNames[flag]] = true;

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
  const problems = cascadeProblems(files, entry, bundle, externalSheets);
  // A pair that only the hoist of an external import changes cannot be kept, so it does not make a graph wrong.
  const wrong = problems.filter(problem => problem.kind !== "pair-hoist");
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
console.log(JSON.stringify({ graphs: Number(count), firstSeed: Number(first), options, ...tally }));
