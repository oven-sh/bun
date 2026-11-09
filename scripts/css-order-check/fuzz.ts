// bun scripts/css-order-check/fuzz.ts <bun> <graphs> [first seed] [baseline bun] [--flags]
// Prints the seeds where the bundle does not have the cascade of its sources, by kind of problem.
// `<graphs>` = 1 prints the files and the bundle of that seed too.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { generateGraph, type GraphOptions } from "./generate.ts";
import { compare, conditionKeys, evaluate, type Problem } from "./model.ts";

const flagNames: Record<string, keyof GraphOptions> = {
  "--cycles": "cycles",
  "--anonymous": "anonymous",
  "--empty-blocks": "emptyBlocks",
  "--conditions": "conditions",
  "--import-conditions": "importConditions",
  "--external": "external",
  "--external-rules": "externalRules",
  "--assets": "assets",
  "--anon-blocks": "anonBlocks",
  "--empty-files": "emptyFiles",
};
const flags = process.argv.slice(2).filter(arg => arg.startsWith("--"));
const [bun, count = "100", first = "1", baseline] = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
const verbose = flags.includes("--verbose");
const known = [...Object.keys(flagNames), "--no-leading-statements", "--verbose", "--all"];
if (!bun || flags.some(flag => !known.includes(flag))) {
  console.error(`usage: bun fuzz.ts <bun> <graphs> [first seed] [baseline bun] [${known.join("] [")}]`);
  process.exit(1);
}
const options: GraphOptions = { leadingStatements: !flags.includes("--no-leading-statements") };
for (const [flag, key] of Object.entries(flagNames)) if (flags.includes(flag) || flags.includes("--all")) options[key] = true;
if (flags.includes("--all") && !flags.includes("--external-rules")) options.externalRules = false;

const locate = (binary: string) => Bun.which(binary) ?? resolve(binary);

export type GraphResult = { seed: number; status: "ok" | "wrong" | "failed"; problems: Problem[]; bundle: string; stderr: string };

async function checkGraph(binary: string, seed: number): Promise<GraphResult> {
  const { files, entry, externals } = generateGraph(seed, options);
  const dir = mkdtempSync(join(tmpdir(), "css-fuzz-"));
  try {
    for (const [name, css] of Object.entries(files)) writeFileSync(join(dir, name), css);
    const proc = Bun.spawn({
      cmd: [binary, "build", "./" + entry, "--minify"],
      cwd: dir,
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: "1", NO_COLOR: "1" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    if (exitCode !== 0) {
      return { seed, status: "failed", problems: [], bundle: stdout, stderr: `exit ${exitCode}: ${stderr.slice(0, 300)}` };
    }
    const external = (url: string) => {
      const name = /\/(e\d+)\.css$/.exec(url)?.[1];
      if (!name) return undefined;
      return options.externalRules ? `.t { --k: ${name} }` : "";
    };
    const isExternal = (id: string) => /^e\d+$/.test(id);
    const keys = [...new Set(Object.values(files).flatMap(conditionKeys))].sort();
    const problems: Problem[] = [];
    const seen = new Set<string>();
    for (let bits = 0; bits < 1 << keys.length; bits++) {
      const state = new Set(keys.filter((_, i) => bits & (1 << i)));
      const where = keys.length ? ` (conditions that hold: ${[...state].join(" ") || "none"})` : "";
      const expected = evaluate(files, entry, state, external);
      const actual = evaluate({ "bundle.css": stdout }, "bundle.css", state, external);
      for (const problem of compare(expected, actual, isExternal)) {
        if (seen.has(problem.kind + problem.text)) continue;
        seen.add(problem.kind + problem.text);
        problems.push({ kind: problem.kind, text: problem.text + where });
      }
    }
    return { seed, status: problems.length ? "wrong" : "ok", problems, bundle: stdout, stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const target = locate(bun);
const before = baseline && locate(baseline);
if (Number(count) === 1) {
  const graph = generateGraph(Number(first), options);
  for (const [name, css] of Object.entries(graph.files)) console.log(`/* ${name} */\n${css}`);
}
const kinds = ["pair", "important", "layers", "invalid", "pair-hoist"] as const;
const tally: Record<string, number> = { ok: 0, wrong: 0, failed: 0, onlyHoist: 0 };
for (const kind of kinds) tally[kind] = 0;
// "bad": a problem other than the order of an external rule and a rule in its own layer, which no hoist can keep.
const bad = (r: GraphResult) => r.status === "failed" || r.problems.some(p => p.kind !== "pair-hoist");
const regressed: number[] = [];
let repaired = 0;
const parallel = Number(process.env.FUZZ_PARALLEL ?? 10);
const end = Number(first) + Number(count);
for (let seed = Number(first); seed < end; seed += parallel) {
  const batch: Promise<[GraphResult, GraphResult | undefined]>[] = [];
  for (let s = seed; s < Math.min(end, seed + parallel); s++) {
    batch.push(Promise.all([checkGraph(target, s), before ? checkGraph(before, s) : undefined]));
  }
  for (const [result, old] of await Promise.all(batch)) {
    tally[result.status]++;
    const has = new Set(result.problems.map(p => p.kind));
    for (const kind of has) tally[kind]++;
    if (result.status === "wrong" && !bad(result)) tally.onlyHoist++;
    if (Number(count) === 1) console.log(`/* bundle */\n${result.bundle}`);
    if (result.status === "failed") console.log(`seed ${result.seed} failed: ${result.stderr}`);
    else if (bad(result) || verbose) {
      if (result.problems.length)
        console.log(
          `seed ${result.seed} [${[...has].join(",")}]:\n  ` +
            result.problems
              .filter(p => verbose || p.kind !== "pair-hoist")
              .slice(0, Number(count) === 1 ? 40 : 4)
              .map(p => p.text)
              .join("\n  "),
        );
    }
    if (!old) continue;
    if (!bad(old) && bad(result)) regressed.push(result.seed);
    if (bad(old) && !bad(result)) repaired++;
  }
}
if (before) {
  console.log(`right with the baseline, wrong with <bun>: ${regressed.length} graphs` + (regressed.length ? ` (seeds ${regressed.join(", ")})` : ""));
  console.log(`wrong with the baseline, right with <bun>: ${repaired} graphs`);
}
console.log(JSON.stringify({ graphs: Number(count), firstSeed: Number(first), options, ...tally }));
