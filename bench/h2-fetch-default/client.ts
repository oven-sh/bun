// Fetch client for the h2-default bench. Fires N concurrent GETs to one
// HTTPS origin and reports timing + resource stats as JSON on stdout.
//
// Usage:
//   [BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT=1] bun client.ts <url> <N> [warmup]
//
// Output (stdout, one JSON line):
//   { n, h2, wallMs, ttfbP50, ttfbP99, ttlbP50, ttlbP99, rssMb,
//     sockets, h2Sessions, maxLive, alpn }

import { tls } from "./tls.ts";

const url = process.argv[2];
const N = Number(process.argv[3]);
const warmup = process.argv[4] === "warmup";

if (!url || !Number.isFinite(N)) {
  console.error("usage: client.ts <url> <N> [warmup]");
  process.exit(1);
}

const ca = tls.cert;
const tlsOpts = { ca, rejectUnauthorized: true } as const;

async function statsReset() {
  await fetch(`${url}/reset`, { tls: tlsOpts } as any).then(r => r.text());
}
async function stats() {
  const r = await fetch(`${url}/stats`, { tls: tlsOpts } as any);
  return r.json() as Promise<{
    tcpConnections: number;
    h2Sessions: number;
    maxLiveSockets: number;
    requests: number;
    alpn: string | false;
  }>;
}

function pct(sorted: number[], p: number) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function oneRequest(ttfb: number[], ttlb: number[]) {
  const t0 = performance.now();
  const res = await fetch(url, { tls: tlsOpts } as any);
  const t1 = performance.now();
  await res.arrayBuffer();
  const t2 = performance.now();
  ttfb.push(t1 - t0);
  ttlb.push(t2 - t0);
  if (!res.ok) throw new Error(`status ${res.status}`);
}

// Optional warmup: one request to establish a session so subsequent runs can
// observe warm-pool behavior (the brief's "warm h1 pool stays h1" concern).
if (warmup) {
  await fetch(url, { tls: tlsOpts } as any).then(r => r.arrayBuffer());
}

await statsReset();

const ttfb: number[] = [];
const ttlb: number[] = [];
const wall0 = performance.now();
await Promise.all(Array.from({ length: N }, () => oneRequest(ttfb, ttlb)));
const wallMs = performance.now() - wall0;

ttfb.sort((a, b) => a - b);
ttlb.sort((a, b) => a - b);

const s = await stats();
const rssMb = process.memoryUsage.rss() / 1024 / 1024;

console.log(
  JSON.stringify({
    n: N,
    h2: process.env.BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT === "1",
    wallMs: +wallMs.toFixed(2),
    ttfbP50: +pct(ttfb, 50).toFixed(2),
    ttfbP99: +pct(ttfb, 99).toFixed(2),
    ttlbP50: +pct(ttlb, 50).toFixed(2),
    ttlbP99: +pct(ttlb, 99).toFixed(2),
    rssMb: +rssMb.toFixed(1),
    sockets: s.tcpConnections,
    h2Sessions: s.h2Sessions,
    maxLive: s.maxLiveSockets,
    alpn: s.alpn,
  }),
);
