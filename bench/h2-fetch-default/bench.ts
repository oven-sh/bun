// Driver for the h2-default bench. Starts server.ts, runs client.ts across
// {N} x {h2 on/off} x {repeat}, aggregates medians, prints a table.
//
// Usage: bun bench.ts [--bun /path/to/bun] [--payload 4096] [--reps 5]
//                     [--label tag] [--cdn https://...]

import { spawn } from "node:child_process";
import { once } from "node:events";

const args = process.argv.slice(2);
function flag(name: string, def?: string) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}

const BUN = flag("--bun", process.execPath)!;
const PAYLOAD = flag("--payload", "4096")!;
const REPS = Number(flag("--reps", "5"));
const LABEL = flag("--label", "local");
const CDN = flag("--cdn"); // optional: also bench this public URL (no /stats)
const LOSSY = args.includes("--lossy"); // route via lossy-proxy.ts
const LOSS = flag("--loss", "0.01")!;
const DELAY = flag("--delay", "30")!;
const RTO = flag("--rto", "200")!;
const Ns = [4, 16, 100, 500];

type Row = {
  n: number;
  h2: boolean;
  wallMs: number;
  ttfbP50: number;
  ttfbP99: number;
  ttlbP50: number;
  ttlbP99: number;
  rssMb: number;
  sockets: number;
  h2Sessions: number;
  maxLive: number;
  alpn: string | boolean;
};

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function startServer(): Promise<{ port: number; kill: () => void }> {
  const proc = spawn(BUN, ["server.ts", PAYLOAD], {
    cwd: import.meta.dir,
    stdio: ["ignore", "pipe", "inherit"],
  });
  let port = 0;
  for await (const chunk of proc.stdout!) {
    const m = /PORT (\d+)/.exec(String(chunk));
    if (m) {
      port = Number(m[1]);
      break;
    }
  }
  if (!port) throw new Error("server did not report port");
  return { port, kill: () => proc.kill("SIGKILL") };
}

async function startProxy(upstream: number): Promise<{ port: number; kill: () => void }> {
  const proc = spawn(
    BUN,
    ["lossy-proxy.ts", "--upstream", String(upstream), "--delay", DELAY, "--loss", LOSS, "--rto", RTO],
    { cwd: import.meta.dir, stdio: ["ignore", "pipe", "inherit"] },
  );
  let port = 0;
  for await (const chunk of proc.stdout!) {
    const m = /PROXY (\d+)/.exec(String(chunk));
    if (m) {
      port = Number(m[1]);
      break;
    }
  }
  if (!port) throw new Error("proxy did not report port");
  return { port, kill: () => proc.kill("SIGKILL") };
}

async function runClient(url: string, n: number, h2: boolean): Promise<Row> {
  const env = { ...process.env };
  if (h2) env.BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT = "1";
  else delete env.BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT;
  env.NODE_TLS_REJECT_UNAUTHORIZED = "0"; // for CDN path; local uses ca
  const proc = spawn(BUN, ["client.ts", url, String(n)], {
    cwd: import.meta.dir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  proc.stdout!.on("data", c => (out += c));
  proc.stderr!.on("data", c => (err += c));
  const [code] = await once(proc, "exit");
  if (code !== 0) {
    throw new Error(`client exit ${code} (n=${n} h2=${h2}):\n${err || out}`);
  }
  return JSON.parse(out.trim());
}

async function runClientCdn(url: string, n: number, h2: boolean): Promise<Row> {
  // CDN has no /stats or /reset, so spawn an inline script.
  const env = { ...process.env };
  if (h2) env.BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT = "1";
  else delete env.BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT;
  const script = `
    const url = ${JSON.stringify(url)}; const N = ${n};
    const ttfb = [], ttlb = [];
    const t0 = performance.now();
    await Promise.all(Array.from({length:N}, async () => {
      const a = performance.now();
      const r = await fetch(url);
      const b = performance.now();
      await r.arrayBuffer();
      const c = performance.now();
      ttfb.push(b-a); ttlb.push(c-a);
    }));
    const wall = performance.now()-t0;
    ttfb.sort((a,b)=>a-b); ttlb.sort((a,b)=>a-b);
    const p = (s,q)=>s[Math.min(s.length-1,Math.floor(q/100*s.length))];
    console.log(JSON.stringify({
      n:N, h2:${h2}, wallMs:+wall.toFixed(2),
      ttfbP50:+p(ttfb,50).toFixed(2), ttfbP99:+p(ttfb,99).toFixed(2),
      ttlbP50:+p(ttlb,50).toFixed(2), ttlbP99:+p(ttlb,99).toFixed(2),
      rssMb:+(process.memoryUsage.rss()/1024/1024).toFixed(1),
      sockets:-1, h2Sessions:-1, maxLive:-1, alpn:"?"
    }));
  `;
  const proc = spawn(BUN, ["-e", script], { env, stdio: ["ignore", "pipe", "pipe"] });
  let out = "", err = "";
  proc.stdout!.on("data", c => (out += c));
  proc.stderr!.on("data", c => (err += c));
  const [code] = await once(proc, "exit");
  if (code !== 0) throw new Error(`cdn client exit ${code}:\n${err || out}`);
  return JSON.parse(out.trim());
}

function fmt(rows: Row[]) {
  const cols = ["n", "h2", "wallMs", "ttfbP50", "ttfbP99", "ttlbP50", "ttlbP99", "rssMb", "sockets", "h2Sessions", "maxLive", "alpn"] as const;
  const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String((r as any)[c]).length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padStart(widths[i])).join("  ");
  console.log(line(cols as any));
  for (const r of rows) console.log(line(cols.map(c => String((r as any)[c]))));
}

// ── run ──
console.error(`[bench] bun=${BUN} payload=${PAYLOAD} reps=${REPS} label=${LABEL} lossy=${LOSSY}`);
const { port: serverPort, kill: killServer } = await startServer();
let proxyKill = () => {};
let targetPort = serverPort;
if (LOSSY) {
  const p = await startProxy(serverPort);
  targetPort = p.port;
  proxyKill = p.kill;
}
const localUrl = `https://localhost:${targetPort}`;
const kill = () => {
  proxyKill();
  killServer();
};
try {
  const out: Row[] = [];
  for (const n of Ns) {
    for (const h2 of [false, true]) {
      const runs: Row[] = [];
      for (let i = 0; i < REPS; i++) runs.push(await runClient(localUrl, n, h2));
      out.push({
        ...runs[0],
        wallMs: +median(runs.map(r => r.wallMs)).toFixed(2),
        ttfbP50: +median(runs.map(r => r.ttfbP50)).toFixed(2),
        ttfbP99: +median(runs.map(r => r.ttfbP99)).toFixed(2),
        ttlbP50: +median(runs.map(r => r.ttlbP50)).toFixed(2),
        ttlbP99: +median(runs.map(r => r.ttlbP99)).toFixed(2),
        rssMb: +median(runs.map(r => r.rssMb)).toFixed(1),
        sockets: median(runs.map(r => r.sockets)),
        maxLive: median(runs.map(r => r.maxLive)),
      });
      console.error(`[bench] ${LABEL} n=${n} h2=${h2} wall=${out.at(-1)!.wallMs}ms sockets=${out.at(-1)!.sockets}`);
    }
  }
  console.log(`\n=== ${LABEL} (payload=${PAYLOAD}B, reps=${REPS}, bun=${BUN}) ===`);
  fmt(out);

  if (CDN) {
    console.error(`[bench] cdn=${CDN}`);
    const cdnOut: Row[] = [];
    for (const n of [4, 16, 100]) {
      for (const h2 of [false, true]) {
        const runs: Row[] = [];
        for (let i = 0; i < Math.min(REPS, 3); i++) runs.push(await runClientCdn(CDN, n, h2));
        cdnOut.push({
          ...runs[0],
          wallMs: +median(runs.map(r => r.wallMs)).toFixed(2),
          ttfbP50: +median(runs.map(r => r.ttfbP50)).toFixed(2),
          ttfbP99: +median(runs.map(r => r.ttfbP99)).toFixed(2),
          ttlbP50: +median(runs.map(r => r.ttlbP50)).toFixed(2),
          ttlbP99: +median(runs.map(r => r.ttlbP99)).toFixed(2),
          rssMb: +median(runs.map(r => r.rssMb)).toFixed(1),
        });
      }
    }
    console.log(`\n=== cdn ${CDN} (reps=${Math.min(REPS, 3)}) ===`);
    fmt(cdnOut);
  }
} finally {
  kill();
}
