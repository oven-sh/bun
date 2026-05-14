#!/usr/bin/env bun
// Emit phase-b2-cycle args: only crates with >0 #[cfg(any())] gates,
// excluding keystone-owned (those need dedicated agents, not sweeps).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const KEYSTONE = new Set(["runtime", "js_parser", "jsc"]); // dedicated rounds own these
const TIER: Record<string, number> = {
  bun_core: 0,
  bun_alloc: 0,
  errno: 0,
  ptr: 0,
  safety: 0,
  wyhash: 0,
  highway: 0,
  meta: 0,
  string: 1,
  collections: 1,
  paths: 1,
  sys: 1,
  unicode: 1,
  base64: 1,
  platform: 1,
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
  js_parser: 4,
  js_printer: 4,
  css: 4,
  interchange: 4,
  sourcemap: 4,
  shell_parser: 4,
  md: 4,
  router: 4,
  codegen: 4,
  resolver: 5,
  bundler: 5,
  http: 5,
  install: 5,
  sql: 5,
  valkey: 5,
  s3_signing: 5,
  standalone_graph: 5,
  resolve_builtins: 5,
  jsc: 6,
  runtime: 6,
};
const tier = (c: string) => (c.endsWith("_sys") ? 0 : c.endsWith("_jsc") ? 6 : (TIER[c] ?? 5));

function gateCount(dir: string): number {
  let n = 0;
  function walk(d: string) {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".rs")) n += (readFileSync(p, "utf8").match(/#\[cfg\(any\(\)\)\]/g) || []).length;
    }
  }
  walk(dir);
  return n;
}

const crates: { c: string; n: number; t: number }[] = [];
for (const d of readdirSync("src")) {
  if (!statSync(join("src", d)).isDirectory()) continue;
  if (KEYSTONE.has(d)) continue;
  const n = gateCount(join("src", d));
  if (n > 0) crates.push({ c: d, n, t: tier(d) });
}

const tiers: Record<number, string[]> = {};
for (const { c, t } of crates) (tiers[t] ??= []).push(c);
const args = {
  tiers: Object.entries(tiers)
    .map(([n, cs]) => ({ n: +n, crates: cs }))
    .sort((a, b) => a.n - b.n),
};
process.stderr.write(
  `${crates.length} crates with gates (excl. keystone), ${crates.reduce((a, c) => a + c.n, 0)} total gates\n`,
);
console.log(JSON.stringify(args));
