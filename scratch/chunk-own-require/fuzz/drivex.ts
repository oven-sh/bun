// bun-pr drivex.ts <first seed> <count> <configs,comma> [opts,comma] [target]
// Three-way differential: unbundled source, bundle built by main (bun-base), bundle built by the PR (bun-pr).
// A graph "differs" when the two bundles log different things. It is "worse" by the rule of
// test/bundler/splitting-fuzz.ts: main agrees with the unbundled program on a read (or an order of two effects),
// the PR does not. "better" is the same rule the other way round.
import { generateGraph, type Opts, type Tree } from "./genx.ts";
import { mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";

const [first = "1", count = "100", configsArg = "direct", optsArg = "", target = "bun"] = process.argv.slice(2);
const BASE = process.env.BASE_BIN ?? "/tmp/measure/bin/bun-main";
const PR = process.env.PR_BIN ?? "/tmp/measure/bin/bun-acc";
const root = process.env.WORK ?? "/tmp/gate/fuzz/work";
const env = {
  ...process.env,
  BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
  BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
  NO_COLOR: "1",
};
const opts: Opts = Object.fromEntries(optsArg.split(",").filter(Boolean).map(o => [o, true]));

type Config = {
  tree: Tree;
  staticStub?: boolean;
  dirs?: boolean;
  chunk?: string;
  entry?: string;
  fold?: boolean;
  splitRequire?: boolean;
  minChunkSize?: number;
};
const allConfigs: Record<string, Config> = {
  flat: { tree: "stub-flat" },
  "flat-nofold": { tree: "stub-flat", fold: false },
  direct: { tree: "direct" },
  "direct-nofold": { tree: "direct", fold: false },
  "direct-nosplit": { tree: "direct", splitRequire: false },
  "direct-chunks": { tree: "direct", chunk: "chunks/[name]-[hash].[ext]" },
  "direct-dir": { tree: "direct", dirs: true, chunk: "[dir]/[name]-[hash].[ext]" },
  "direct-dir-nofold": { tree: "direct", dirs: true, chunk: "[dir]/[name]-[hash].[ext]", fold: false },
  "direct-hashdir": { tree: "direct", chunk: "[hash]/[name].[ext]" },
  "direct-hashentry": { tree: "direct", entry: "[dir]/[name]-[hash].[ext]" },
  "direct-minchunk": { tree: "direct", minChunkSize: 100000 },
  stub2: { tree: "stub-2dirs" },
  "stub2-static": { tree: "stub-2dirs", staticStub: true },
  "stub2-dir": { tree: "stub-2dirs", dirs: true, chunk: "[dir]/[name]-[hash].[ext]" },
  "stub-chunks": { tree: "stub-flat", chunk: "chunks/[name]-[hash].[ext]" },
  "stub-dir": { tree: "stub-flat", dirs: true, chunk: "[dir]/[name]-[hash].[ext]" },
};
const configs = configsArg.split(",");
for (const c of configs) if (!allConfigs[c]) throw new Error("unknown config " + c);

async function sh(cmd: string[], cwd: string) {
  const proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe", timeout: Number(process.env.TIMEOUT ?? 20000), killSignal: "SIGKILL" });
  const [out, err, code] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { code, out, err, timedOut: proc.signalCode === "SIGKILL" };
}
function listFiles(dir: string, pre = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...listFiles(join(dir, e.name), pre + e.name + "/"));
    else out.push(pre + e.name);
  }
  return out.sort();
}
function facts(log: string) {
  const reads = new Map<string, string>();
  const effects: string[] = [];
  for (const line of log.split("\n")) {
    if (!line) continue;
    const eq = line.indexOf("=");
    if (eq === -1) effects.push(line);
    else {
      // A read made more than once keeps every value (the repo's `facts` keeps the last one only).
      const key = line.slice(0, eq);
      reads.set(key, reads.has(key) ? [reads.get(key)!, line.slice(eq + 1)].join(",").split(",").sort().join(",") : line.slice(eq + 1));
    }
  }
  return { reads, effects };
}
// test/bundler/splitting-fuzz.ts `worse`, with (reference, kept, changed).
function worse(reference: string, kept: string, changed: string): string[] {
  const [ref, off, on] = [facts(reference), facts(kept), facts(changed)];
  const problems: string[] = [];
  for (const what of new Set([...ref.reads.keys(), ...off.reads.keys(), ...on.reads.keys()])) {
    const [value, offValue, onValue] = [ref, off, on].map(log => log.reads.get(what) ?? "fine");
    if (offValue === value && onValue !== value) problems.push(`${what}: ${value} -> ${on.reads.get(what) ?? "missing"}`);
  }
  const position = (effects: string[]) => new Map(effects.map((effect, index) => [effect, index]));
  const [offAt, onAt] = [position(off.effects), position(on.effects)];
  for (let a = 0; a < ref.effects.length; a++) {
    for (let b = a + 1; b < ref.effects.length; b++) {
      const [x, y] = [ref.effects[a], ref.effects[b]];
      const agrees = (at: Map<string, number>) => at.has(x) && at.has(y) && at.get(x)! < at.get(y)!;
      if (agrees(offAt) && !agrees(onAt)) problems.push(`order ${x} < ${y} lost`);
    }
  }
  return problems;
}
const buildScript = `
const cfg = JSON.parse(process.argv[2]);
const o: any = {
  entrypoints: cfg.entries.map((e: string) => import.meta.dir + "/src/" + e),
  outdir: import.meta.dir + "/" + cfg.outdir,
  root: import.meta.dir + "/src",
  splitting: true, target: cfg.target, format: "esm", external: ["fuzz-hook"],
};
if (cfg.naming) o.naming = cfg.naming;
if (cfg.fold !== undefined) o.foldChunksForTesting = cfg.fold;
if (cfg.splitRequire !== undefined) o.splitRequire = cfg.splitRequire;
if (cfg.minChunkSize !== undefined) o.minChunkSize = cfg.minChunkSize;
const result = await Bun.build(o);
if (!result.success) { console.error(result.logs.join("\\n")); process.exit(1); }
console.log(JSON.stringify(result.outputs.map(x => ({ kind: x.kind, path: x.path.slice((import.meta.dir + "/" + cfg.outdir + "/").length) }))));
`;
const hook = `
exports.poke = function () {
  const ns = require(process.argv[1]);
  for (const key of Reflect.ownKeys(ns)) if (typeof key === "string" && /^req\\d+$/.test(key)) return ns[key]();
  return "none";
};
`;

type Tally = {
  graphs: number;
  buildFailed: number;
  identical: number;
  declaring: number;
  differs: number;
  worse: number;
  better: number;
  prOnlyCrash: number;
  unjudged: number;
  differSeeds: number[];
  worseSeeds: number[];
  notes: string[];
};
const tally: Record<string, Tally> = {};
for (const c of configs)
  tally[c] = { graphs: 0, buildFailed: 0, identical: 0, declaring: 0, differs: 0, worse: 0, better: 0, prOnlyCrash: 0, unjudged: 0, differSeeds: [], worseSeeds: [], notes: [] };

async function checkSeed(seed: number) {
  const trees = new Map<string, { dir: string; entries: string[]; reference?: Promise<{ code: number; out: string }[]> }>();
  let keep = false;
  const seedDir = join(root, `s${seed}`);
  rmSync(seedDir, { recursive: true, force: true });
  for (const name of configs) {
    const cfg = allConfigs[name];
    const t = tally[name];
    const treeKey = cfg.tree + (cfg.staticStub ? "-static" : "") + (cfg.dirs ? "-dirs" : "");
    if (!trees.has(treeKey)) {
      const g = generateGraph(seed, cfg.tree, { ...opts, dirs: cfg.dirs }, cfg.staticStub);
      const dir = join(seedDir, treeKey);
      for (const [file, src] of Object.entries(g.files)) {
        const p = join(dir, "src", file);
        mkdirSync(dirname(p), { recursive: true });
        writeFileSync(p, src);
      }
      writeFileSync(join(dir, "build.ts"), buildScript);
      mkdirSync(join(dir, "node_modules/fuzz-hook"), { recursive: true });
      writeFileSync(join(dir, "node_modules/fuzz-hook/index.js"), hook);
      writeFileSync(join(dir, "node_modules/fuzz-hook/package.json"), `{"name":"fuzz-hook","main":"index.js"}`);
      trees.set(treeKey, { dir, entries: g.entries });
    }
    const tr = trees.get(treeKey)!;
    const naming: Record<string, string> = {};
    if (cfg.chunk) naming.chunk = cfg.chunk;
    if (cfg.entry) naming.entry = cfg.entry;
    const manifests: Record<string, { kind: string; path: string }[]> = {};
    let ok = true;
    for (const [v, bin] of [["base", BASE], ["pr", PR]] as const) {
      const b = await sh(
        [bin, "build.ts", JSON.stringify({ entries: tr.entries, outdir: `out-${name}-${v}`, target, naming: Object.keys(naming).length ? naming : undefined, fold: cfg.fold, splitRequire: cfg.splitRequire, minChunkSize: cfg.minChunkSize })],
        tr.dir,
      );
      if (b.code !== 0) {
        ok = false;
        if (t.notes.length < 5) t.notes.push(`seed ${seed}: ${v} build failed: ${b.err.slice(0, 200)}`);
        break;
      }
      manifests[v] = JSON.parse(b.out);
    }
    t.graphs++;
    if (!ok) {
      t.buildFailed++;
      continue;
    }
    const [ob, op] = [join(tr.dir, `out-${name}-base`), join(tr.dir, `out-${name}-pr`)];
    const [fb, fp] = [listFiles(ob), listFiles(op)];
    const same = fb.length === fp.length && fb.every((f, i) => f === fp[i] && readFileSync(join(ob, f)).equals(readFileSync(join(op, f))));
    if (same) {
      t.identical++;
      continue;
    }
    const declaring = fp.filter(f => /^function __requireHere\d*\(\)/m.test(readFileSync(join(op, f), "utf8"))).length;
    if (declaring) t.declaring++;
    const entryOut = (manifest: { kind: string; path: string }[], entry: string) => {
      const stem = entry.replace(/\.ts$/, "");
      const re = new RegExp("^(\\./)?" + stem.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&") + "(-[a-z0-9]+)?\\.js$");
      const found = manifest.filter(m => m.kind === "entry-point" && re.test(m.path));
      return found.length === 1 ? found[0].path : undefined;
    };
    const runner = target === "node" ? "node" : PR;
    tr.reference ??= Promise.all(
      tr.entries.map(async e => (target === "node" ? { code: -1, out: "" } : await sh([PR, join("src", e)], tr.dir))),
    );
    const reference = await tr.reference;
    let differs = false;
    const worseProblems: string[] = [];
    const betterProblems: string[] = [];
    let prOnlyCrash = false;
    let unjudged = false;
    for (let i = 0; i < tr.entries.length; i++) {
      const [eb, ep] = [entryOut(manifests.base, tr.entries[i]), entryOut(manifests.pr, tr.entries[i])];
      if (!eb || !ep) {
        if (t.notes.length < 5) t.notes.push(`seed ${seed}: entry output of ${tr.entries[i]} not found`);
        unjudged = true;
        continue;
      }
      const [rb, rp] = await Promise.all([sh([runner, join(`out-${name}-base`, eb)], tr.dir), sh([runner, join(`out-${name}-pr`, ep)], tr.dir)]);
      if (rb.code !== rp.code || rb.out !== rp.out) differs = true;
      else continue;
      if (rb.code === 0 && rp.code !== 0) {
        prOnlyCrash = true;
        worseProblems.push(`${tr.entries[i]}: only the PR bundle failed: ${rp.err.slice(0, 160)}`);
        continue;
      }
      const u = reference[i];
      if (u.code !== 0) {
        unjudged = true;
        continue;
      }
      worseProblems.push(...worse(u.out, rb.out, rp.out).map(p => `${tr.entries[i]}: ${p}`));
      betterProblems.push(...worse(u.out, rp.out, rb.out).map(p => `${tr.entries[i]}: ${p}`));
    }
    if (differs) {
      keep = true;
      t.differs++;
      t.differSeeds.push(seed);
      if (worseProblems.length) {
        t.worse++;
        t.worseSeeds.push(seed);
      }
      if (betterProblems.length) t.better++;
      if (prOnlyCrash) t.prOnlyCrash++;
      if (unjudged) t.unjudged++;
      writeFileSync(join(tr.dir, `verdict-${name}.json`), JSON.stringify({ seed, name, worse: worseProblems.slice(0, 20), better: betterProblems.slice(0, 20) }, null, 1));
    }
  }
  if (!keep) rmSync(seedDir, { recursive: true, force: true });
  else {
    // keep the sources and verdicts, drop the bundles of configs that did not differ
    for (const tr of trees.values()) {
      for (const e of readdirSync(tr.dir)) {
        const m = /^out-(.+)-(base|pr)$/.exec(e);
        if (m && !tally[m[1]].differSeeds.includes(seed)) rmSync(join(tr.dir, e), { recursive: true, force: true });
      }
    }
  }
}

const end = Number(first) + Number(count);
const parallel = Number(process.env.PAR ?? 5);
let next = Number(first);
await Promise.all(
  Array.from({ length: parallel }, async () => {
    while (next < end) await checkSeed(next++);
  }),
);
for (const c of configs) {
  tally[c].differSeeds.sort((a, b) => a - b);
  tally[c].worseSeeds.sort((a, b) => a - b);
}
console.log(JSON.stringify({ first: Number(first), count: Number(count), opts: optsArg, target, tally }, null, 1));
