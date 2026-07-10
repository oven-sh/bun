// dns-fs-interference.mjs
//
// CLAIM: On Windows, hostname resolution — and therefore net.connect / tls.connect /
// http.request to ANY hostname — stalls behind unrelated fs.promises I/O, because
// dns.lookup and async fs share libuv's default 4-thread pool. Measured today:
// under 16 concurrent fs.open/read(4MB)/close loops, dns.lookup('localhost') median
// goes ~0.23ms -> ~2.3ms (p90 ~5ms, 10-25x), and net.connect('localhost') inherits
// the stall while the no-DNS control net.connect('127.0.0.1') stays flat. Removing
// libuv puts DNS (GetAddrInfoW, plan the removal) and async fs (plan the removal) on Bun's
// cores-sized WorkPool — approximated today by UV_THREADPOOL_SIZE=<cores>, which
// recovers DNS-under-load to ~0.5ms.
//
// MECHANISM (removable libuv-layer overhead):
//   - dns.lookup on Windows = uv_getaddrinfo on the libuv threadpool
//     (src/runtime/dns_jsc/dns.rs:5227-5243 -> :462), SLOW_IO class capped at 2
//     in-flight (libuv src/threadpool.c:45-47; src/win/getaddrinfo.c:341-343).
//   - Async fs open/read/write/close ride the SAME pool via UVFSRequest
//     (the libuv-removal work.3 "Truly-async fs: 7 ops ... on libuv's
//     threadpool"). 4 threads total on a 24-core machine; DNS queues FIFO behind
//     fs work AND is then subject to the slow-IO cap.
//   - net.connect(host) calls dns.lookup first (src/js/node/net.ts:2488,2508), so
//     connection latency to hostnames inherits the stall. The 127.0.0.1 control
//     skips dns.lookup (net.ts:2463) and isolates the threadpool as the cause.
//   - After the removal plan: DNS via GetAddrInfoW on WorkPool (this removal), fs via
//     WorkPool (this removal) — pool sized to cores (bun_core/util.rs get_thread_count).
//     Kernel costs are unchanged; only queueing behind a 4-slot pool is removed.
//
// HERMETIC: resolves only 'localhost' (hosts/local, no network query); connects only
// to a loopback server in-process; fs load is a temp file. family:4 is forced on the
// hostname connect so happy-eyeballs (::1-first) doesn't add unrelated noise.
//
// RUN (before = today's libuv build / after = post-Phase-1+2 build):
//   bun bench/libuv-removal/dns-fs-interference.mjs
//   node bench/libuv-removal/dns-fs-interference.mjs   (reference: same design, same stall)
// The script spawns itself twice (default pool vs UV_THREADPOOL_SIZE=<cores>) and
// prints idle vs under-load latencies side by side. Post-removal, the default
// column's "under load" rows should match today's pool=<cores> column or better.

import dns from "node:dns";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const LOAD_LOOPS = 16;
const FILE_SIZE = 4 * 1024 * 1024;
const SAMPLES = 30;

const lookup = (n, o = {}) =>
  new Promise((res, rej) => dns.lookup(n, o, (e, a) => (e ? rej(e) : res(a))));

function median(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function p90(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length * 0.9)];
}

async function runChild() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "uvbench-dnsfs-"));
  const file = path.join(dir, "data.bin");
  await fsp.writeFile(file, Buffer.alloc(FILE_SIZE, 7));

  const server = net.createServer((s) => s.end());
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;

  const connectOnce = (host) =>
    new Promise((res, rej) => {
      const t = process.hrtime.bigint();
      const sock = net.connect({ port, host, family: 4 }, () => {
        sock.destroy();
        res(Number(process.hrtime.bigint() - t) / 1e6);
      });
      sock.on("error", rej);
    });

  async function sampleAll() {
    const dl = [], ch = [], ci = [];
    for (let i = 0; i < SAMPLES; i++) {
      let t = process.hrtime.bigint();
      await lookup("localhost");
      dl.push(Number(process.hrtime.bigint() - t) / 1e6);
      ch.push(await connectOnce("localhost"));
      ci.push(await connectOnce("127.0.0.1"));
    }
    return {
      lookup: { med: median(dl), p90: p90(dl) },
      connectHost: { med: median(ch), p90: p90(ch) },
      connectIp: { med: median(ci), p90: p90(ci) },
    };
  }

  // warmup
  await lookup("localhost");
  await connectOnce("127.0.0.1");

  const idle = await sampleAll();

  let stop = false;
  let fsOps = 0;
  const loadLoops = Array.from({ length: LOAD_LOOPS }, async () => {
    const buf = Buffer.allocUnsafe(FILE_SIZE);
    while (!stop) {
      const fh = await fsp.open(file, "r");
      await fh.read(buf, 0, buf.length, 0);
      await fh.close();
      fsOps++;
    }
  });
  await new Promise((r) => setTimeout(r, 300)); // ramp

  const loaded = await sampleAll();

  stop = true;
  await Promise.all(loadLoops);
  server.close();
  await fsp.rm(dir, { recursive: true, force: true });

  console.log(
    JSON.stringify({ pool: process.env.UV_THREADPOOL_SIZE ?? "default(4)", idle, loaded, fsOps }),
  );
}

function fmt(s) {
  return `${s.med.toFixed(2)}ms (p90 ${s.p90.toFixed(2)})`;
}

function runParent() {
  const self = process.argv[1];
  const cores = os.availableParallelism?.() ?? os.cpus().length;
  const results = [];
  for (const [label, size] of [["default(4)", ""], [`pool=${cores}`, String(cores)]]) {
    const env = { ...process.env, UVBENCH_CHILD: "1" };
    if (size) env.UV_THREADPOOL_SIZE = size;
    else delete env.UV_THREADPOOL_SIZE;
    const r = spawnSync(process.execPath, [self], { env, encoding: "utf8", timeout: 120_000 });
    if (r.status !== 0) {
      console.error(`child (${label}) failed:`, r.stderr || r.stdout);
      process.exit(1);
    }
    results.push([label, JSON.parse(r.stdout.trim().split("\n").at(-1))]);
  }

  const rt = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
  console.log(`\nDNS vs fs threadpool interference on Windows — ${rt} — ${cores} cores`);
  console.log(`load: ${LOAD_LOOPS} concurrent fs.open/read(${FILE_SIZE >> 20}MB)/close loops (libuv threadpool ops)\n`);
  for (const [label, d] of results) {
    console.log(`  [${label}]  (${d.fsOps} fs ops completed during loaded run)`);
    console.log(`    dns.lookup('localhost')          idle ${fmt(d.idle.lookup)}   under load ${fmt(d.loaded.lookup)}`);
    console.log(`    net.connect('localhost')  [DNS]  idle ${fmt(d.idle.connectHost)}   under load ${fmt(d.loaded.connectHost)}`);
    console.log(`    net.connect('127.0.0.1') [no DNS] idle ${fmt(d.idle.connectIp)}   under load ${fmt(d.loaded.connectIp)}`);
  }
  const before = results[0][1], after = results[1][1];
  console.log(
    `\n  under-load dns.lookup median: ${before.loaded.lookup.med.toFixed(2)}ms -> ${after.loaded.lookup.med.toFixed(2)}ms ` +
      `(${(before.loaded.lookup.med / after.loaded.lookup.med).toFixed(1)}x) when the pool is cores-sized.` +
      `\n  The 127.0.0.1 row is the control: no DNS hop — it moves only with general CPU` +
      `\n  contention from the load, while the DNS rows additionally queue behind the pool.` +
      `\n  Post-removal (DNS the removal + fs the removal on WorkPool) the default column should match pool=${cores}.`,
  );
}

if (process.env.UVBENCH_CHILD) await runChild();
else runParent();
