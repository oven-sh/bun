// dns-lookup-concurrency.mjs
//
// CLAIM: On Windows, concurrent `dns.lookup()` calls (and everything riding them:
// net.connect/tls.connect/http.request to distinct hostnames) are capped at TWO
// in-flight resolutions, no matter how many cores the machine has. Removing libuv
// (GetAddrInfoW on Bun's WorkPool, plan Phase 1) lifts the cap to thread-pool size
// (= cores). Measured today via the UV_THREADPOOL_SIZE knob: 32 parallel lookups
// run ~3.5x faster with a 24-thread pool than with the default — and the WorkPool
// has no slow-IO subdivision at all, so the migrated path is >= that.
//
// MECHANISM (removable libuv-layer overhead):
//   - dns.lookup on Windows = uv_getaddrinfo submitted with UV__WORK_SLOW_IO
//     (libuv src/win/getaddrinfo.c:341-343).
//   - The SLOW_IO class is capped at (nthreads+1)/2 concurrent (libuv
//     src/threadpool.c:45-47,70-79). Default pool = 4 threads => cap = 2.
//   - Bun routes node:dns + Bun.dns lookup() through this on Windows:
//     src/runtime/dns_jsc/dns.rs:5227-5243 -> lib_uv_backend::lookup -> uv_getaddrinfo
//     (dns.rs:462). node:net connect(host) calls dns.lookup (src/js/node/net.ts:2488,2508).
//   - After LIBUV_WINDOWS_REMOVAL_PLAN.md Phase 1 ("getaddrinfo: GetAddrInfoW on
//     WorkPool"), resolution uses bun_threading WorkPool — sized to cores
//     (bun_core/util.rs get_thread_count), no slow-IO class. The kernel cost
//     (GetAddrInfoW itself) is unchanged and demonstrably parallel: serial latency
//     is identical across pool sizes; only the concurrency ceiling moves.
//
// HERMETIC: resolves only names from C:\Windows\System32\drivers\etc\hosts plus
// 'localhost' (hosts-file/local resolution — no network DNS query), multiplied by
// {family:0, family:4} variants for distinct request keys. Needs >=4 usable
// hosts-file names to show the effect at N=16/32; prints what it found.
// NOTE: distinct names matter — Bun coalesces concurrent identical (name,options)
// lookups into one request (pending cache), which this benchmark must not hit.
//
// RUN (before = today's libuv build / after = post-Phase-1 build):
//   bun bench/libuv-removal/dns-lookup-concurrency.mjs
//   node bench/libuv-removal/dns-lookup-concurrency.mjs   (reference: same libuv design)
// The script spawns itself twice — default pool vs UV_THREADPOOL_SIZE=<cores> — and
// prints the side-by-side. On the post-removal build the two columns should match
// (the knob becomes a no-op for DNS) and both should equal today's "pool=cores"
// column or better.

import dns from "node:dns";
import fs from "node:fs";
import os from "node:os";
import { spawnSync } from "node:child_process";

const REPS = 9;
const WAVES = [4, 8, 16, 32];

function collectNames() {
  const names = new Set(["localhost"]);
  try {
    const txt = fs.readFileSync("C:/Windows/System32/drivers/etc/hosts", "utf8");
    for (const line of txt.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      for (const tok of t.split(/\s+/).slice(1)) {
        if (tok && !tok.startsWith("#")) names.add(tok.replace(/\.$/, ""));
      }
    }
  } catch {}
  return [...names];
}

const lookup = (name, opts) =>
  new Promise((res, rej) => dns.lookup(name, opts, (e, a) => (e ? rej(e) : res(a))));

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function runChild() {
  // distinct (name, family) pairs = distinct resolver request keys
  const variants = [];
  for (const n of collectNames()) for (const family of [0, 4]) variants.push([n, { family }]);

  // warmup + drop names that don't resolve locally
  const usable = [];
  await Promise.all(
    variants.map(([n, o]) =>
      lookup(n, o).then(
        () => usable.push([n, o]),
        () => {},
      ),
    ),
  );

  // serial per-op latency (control: must be ~equal across pool sizes)
  const serial = [];
  for (let i = 0; i < 40; i++) {
    const [n, o] = usable[i % usable.length];
    const t = process.hrtime.bigint();
    await lookup(n, o);
    serial.push(Number(process.hrtime.bigint() - t) / 1e6);
  }

  const out = { pool: process.env.UV_THREADPOOL_SIZE ?? "default(4)", usable: usable.length, serialMed: median(serial), waves: {} };
  for (const N of WAVES) {
    if (N > usable.length) break;
    const reps = [];
    for (let r = 0; r < REPS; r++) {
      const slice = usable.slice(0, N);
      const t = process.hrtime.bigint();
      await Promise.all(slice.map(([n, o]) => lookup(n, o)));
      reps.push(Number(process.hrtime.bigint() - t) / 1e6);
    }
    out.waves[N] = { med: median(reps), min: Math.min(...reps), max: Math.max(...reps) };
  }
  console.log(JSON.stringify(out));
}

function runParent() {
  const self = process.argv[1];
  const cores = os.availableParallelism?.() ?? os.cpus().length;
  const results = [];
  for (const [label, env] of [
    ["default(4)", { ...process.env, UVBENCH_CHILD: "1", UV_THREADPOOL_SIZE: "" }],
    [`pool=${cores}`, { ...process.env, UVBENCH_CHILD: "1", UV_THREADPOOL_SIZE: String(cores) }],
  ]) {
    if (env.UV_THREADPOOL_SIZE === "") delete env.UV_THREADPOOL_SIZE;
    const r = spawnSync(process.execPath, [self], { env, encoding: "utf8", timeout: 60_000 });
    if (r.status !== 0) {
      console.error(`child (${label}) failed:`, r.stderr || r.stdout);
      process.exit(1);
    }
    const lastLine = r.stdout.trim().split("\n").at(-1);
    results.push([label, JSON.parse(lastLine)]);
  }

  const rt = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
  console.log(`\ndns.lookup concurrency on Windows — ${rt} — ${cores} cores`);
  console.log(`distinct local request keys: ${results[0][1].usable} (hosts file + localhost, x{family:0,4})\n`);
  console.log("  serial per-lookup (control, should match):");
  for (const [label, d] of results) console.log(`    ${label.padEnd(12)} ${d.serialMed.toFixed(3)} ms`);
  console.log("\n  N parallel distinct lookups, total wall time (median of " + REPS + "):");
  const header = ["N", ...results.map(([l]) => l), "speedup"].map((s) => String(s).padStart(12)).join("");
  console.log("  " + header);
  for (const N of WAVES) {
    const cells = results.map(([, d]) => d.waves[N]?.med);
    if (cells.some((c) => c == null)) continue;
    const speedup = cells[0] / cells[1];
    console.log(
      "  " +
        [N, ...cells.map((c) => c.toFixed(2) + "ms"), speedup.toFixed(2) + "x"]
          .map((s) => String(s).padStart(12))
          .join(""),
    );
  }
  console.log(
    "\n  libuv SLOW_IO caps in-flight getaddrinfo at (pool+1)/2 => 2 today, " +
      ((cores + 1) >> 1) +
      ` with pool=${cores}.\n  Post-removal (WorkPool, no slow-IO class) the default column should match pool=${cores} or better.`,
  );
}

if (process.env.UVBENCH_CHILD) await runChild();
else runParent();
