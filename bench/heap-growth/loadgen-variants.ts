// Measure per-request overhead variants at c=1.
const port = parseInt(process.argv[2], 10);
const n = parseInt(process.argv[3] ?? "20000", 10);
const url = `http://127.0.0.1:${port}/api/1?k=v`;

async function bench(name: string, fn: () => Promise<void>) {
  // warmup
  for (let i = 0; i < 500; i++) await fn();
  const t0 = Bun.nanoseconds();
  for (let i = 0; i < n; i++) await fn();
  const dt = (Bun.nanoseconds() - t0) / 1e3; // us
  console.error(JSON.stringify({ name, us_per_req: +(dt / n).toFixed(1), rps: Math.round(n / (dt / 1e6)) }));
}

await bench("fetch+arrayBuffer", async () => {
  const r = await fetch(url);
  await r.arrayBuffer();
});

await bench("fetch+text", async () => {
  const r = await fetch(url);
  await r.text();
});

await bench("fetch+bytes", async () => {
  const r = await fetch(url);
  await r.bytes();
});

await bench("fetch+drain-cancel", async () => {
  const r = await fetch(url);
  await r.body?.cancel();
});

// raw Bun.connect / node:net would be the floor; skip for now
