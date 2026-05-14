#!/usr/bin/env bun
// Compute crate DAG, intended tiers, and back-edges for Phase B-0.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dirs = readdirSync("src").filter(d => {
  try {
    return statSync(join("src", d)).isDirectory();
  } catch {
    return false;
  }
});

// crate-ref → src dir (PORTING.md §Crate map; default bun_X → X)
const special: Record<string, string> = {
  str: "string",
  output: "bun_core",
  core: "bun_core",
  alloc: "bun_alloc",
};
const name2dir: Record<string, string> = {};
for (const d of dirs) name2dir[d.replace(/^bun_/, "")] = d;
Object.assign(name2dir, special);

// Intended tier (from restructure plan). Anything *_sys = 0. *_jsc = 6.
const TIER: Record<string, number> = {
  // T0: zero-dep primitives + FFI sys
  bun_core: 0,
  bun_alloc: 0,
  wyhash: 0,
  highway: 0,
  meta: 0,
  safety: 0,
  errno: 0,
  ptr: 0,
  // T1: foundational data
  string: 1,
  collections: 1,
  paths: 1,
  sys: 1,
  unicode: 1,
  base64: 1,
  platform: 1,
  // T2: io / concurrency / utils
  io: 2,
  threading: 2,
  perf: 2,
  logger: 2,
  url: 2,
  semver: 2,
  glob: 2,
  which: 2,
  zlib: 2,
  brotli: 2,
  zstd: 2,
  sha_hmac: 2,
  csrf: 2,
  picohttp: 2,
  boringssl: 2,
  libarchive: 2,
  exe_format: 2,
  watcher: 2,
  clap: 2,
  dotenv: 2,
  // T3: types-only / mid
  http_types: 3,
  options_types: 3,
  install_types: 3,
  dns: 3,
  crash_handler: 3,
  patch: 3,
  ini: 3,
  uws: 3,
  aio: 3,
  event_loop: 3,
  analytics: 3,
  // T4: parsers / ASTs
  js_parser: 4,
  js_printer: 4,
  css: 4,
  interchange: 4,
  sourcemap: 4,
  shell_parser: 4,
  md: 4,
  router: 4,
  codegen: 4,
  // T5: subsystems
  resolver: 5,
  bundler: 5,
  http: 5,
  install: 5,
  sql: 5,
  valkey: 5,
  s3_signing: 5,
  standalone_graph: 5,
  resolve_builtins: 5,
  // T6: runtime / JS-facing
  jsc: 6,
  runtime: 6,
  bake: 6,
  test_runner: 6,
  cli: 6,
  napi: 6,
  shell: 6,
};
function tierOf(d: string): number {
  if (d.endsWith("_sys")) return 0;
  if (d.endsWith("_jsc")) return 6;
  return TIER[d] ?? 5;
}

function walk(d: string, out: string[] = []): string[] {
  for (const e of readdirSync(d)) {
    const p = join(d, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e.endsWith(".rs")) out.push(p);
  }
  return out;
}

type Edge = {
  from: string;
  to: string;
  from_tier: number;
  to_tier: number;
  refs: { file: string; symbols: string[] }[];
};
const deps: Record<string, Set<string>> = {};
const edges: Edge[] = [];

for (const dir of dirs) {
  const files = walk(join("src", dir));
  const byTarget: Record<string, Record<string, Set<string>>> = {};
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    for (const m of t.matchAll(/\bbun_([a-z_][a-z0-9_]*)::([A-Za-z_][A-Za-z0-9_:]*)/g)) {
      const tgt = name2dir[m[1]];
      if (!tgt || tgt === dir) continue;
      ((byTarget[tgt] ??= {})[f] ??= new Set()).add(m[2].split("::")[0]);
    }
  }
  deps[dir] = new Set(Object.keys(byTarget));
  for (const [tgt, files] of Object.entries(byTarget)) {
    edges.push({
      from: dir,
      to: tgt,
      from_tier: tierOf(dir),
      to_tier: tierOf(tgt),
      refs: Object.entries(files).map(([file, syms]) => ({ file, symbols: [...syms] })),
    });
  }
}

const back = edges.filter(e => e.from_tier < e.to_tier);
const flat = edges.filter(e => e.from_tier === e.to_tier && e.from < e.to && deps[e.to]?.has(e.from));

writeFileSync(
  "/tmp/crate-dag.json",
  JSON.stringify(
    { dirs, tier: Object.fromEntries(dirs.map(d => [d, tierOf(d)])), back, same_tier_cycles: flat },
    null,
    2,
  ),
);

console.error(`crates: ${dirs.length}`);
console.error(`back-edges (low-tier → high-tier): ${back.length}`);
console.error(`same-tier mutual pairs: ${flat.length}`);
console.error("\n── back-edges by source crate ──");
const bySrc: Record<string, string[]> = {};
for (const e of back) (bySrc[e.from] ??= []).push(`${e.to}(T${e.to_tier})`);
for (const [s, ts] of Object.entries(bySrc).sort((a, b) => tierOf(a[0]) - tierOf(b[0])))
  console.error(`  T${tierOf(s)} ${s} → ${ts.join(", ")}`);

if (process.argv[2] === "json") console.log(JSON.stringify({ back, same_tier_cycles: flat }));
