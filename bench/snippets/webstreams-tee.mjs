// tee()/clone() throughput and memory: plain ReadableStream.tee, fetch Response.clone,
// and Bun.serve Request.clone. Reports MB/s over the total bytes moved plus peak/settled
// RSS growth for each scenario (best-of-RUNS for time; max for memory).
const RUNS = 3;
const MB = 1024 * 1024;
const CHUNK = new Uint8Array(64 * 1024).fill(120);
const gc = globalThis.Bun?.gc ?? globalThis.gc;
if (!gc) throw new Error("This benchmark needs a GC hook: run with Bun, or node --expose-gc.");
const rss = () => process.memoryUsage.rss();
const fmt = n => (n / MB).toFixed(1).padStart(7) + " MB";

const source = totalBytes => {
  const count = Math.ceil(totalBytes / CHUNK.length);
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i++ < count) c.enqueue(CHUNK);
      else c.close();
    },
  });
};
const drain = async rs => {
  const r = rs.getReader();
  let n = 0;
  while (true) {
    const { done, value } = await r.read();
    if (done) return n;
    n += value.length;
  }
};

async function bench(label, totalBytes, fn) {
  await fn(); // warmup
  let best = Infinity;
  let peak = 0;
  for (let i = 0; i < RUNS; i++) {
    gc(true);
    const before = rss();
    let localPeak = before;
    const timer = setInterval(() => {
      localPeak = Math.max(localPeak, rss());
    }, 5);
    const t0 = performance.now();
    await fn();
    const elapsed = performance.now() - t0;
    clearInterval(timer);
    localPeak = Math.max(localPeak, rss());
    best = Math.min(best, elapsed);
    peak = Math.max(peak, localPeak - before);
  }
  const mbps = totalBytes / MB / (best / 1000);
  console.log(`${label.padEnd(46)} ${mbps.toFixed(0).padStart(7)} MB/s   peak RSS +${fmt(peak)}`);
}

const TOTAL = 128 * MB;
await bench("tee(): both branches drained concurrently", TOTAL * 2, async () => {
  const [a, b] = source(TOTAL).tee();
  await Promise.all([drain(a), drain(b)]);
});
await bench("tee(): branch B read only after A finishes", TOTAL * 2, async () => {
  const [a, b] = source(TOTAL).tee();
  await drain(a);
  await drain(b);
});
await bench("tee(): read A, cancel B", TOTAL, async () => {
  const [a, b] = source(TOTAL).tee();
  const done = drain(a);
  await b.cancel();
  await done;
});

if (typeof Bun !== "undefined") {
  const BODY_BYTES = 64 * MB;
  await using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/stream") return new Response(source(BODY_BYTES));
      if (url.pathname === "/clone-echo") {
        // Request.clone(): consume the body twice server-side.
        const clone = req.clone();
        const [a, b] = await Promise.all([req.arrayBuffer(), clone.arrayBuffer()]);
        return new Response(String(a.byteLength + b.byteLength));
      }
      return new Response("nope", { status: 404 });
    },
  });
  const base = `http://localhost:${server.port}`;

  await bench("fetch(stream).clone(): read both bodies", BODY_BYTES * 2, async () => {
    const response = await fetch(`${base}/stream`);
    const clone = response.clone();
    await Promise.all([response.arrayBuffer(), clone.arrayBuffer()]);
  });
  await bench("fetch(stream).clone(): read one, cancel clone", BODY_BYTES, async () => {
    const response = await fetch(`${base}/stream`);
    const clone = response.clone();
    const read = response.arrayBuffer();
    await clone.body.cancel();
    await read;
  });
  const upload = new Uint8Array(32 * MB).fill(7);
  await bench("Bun.serve: req.clone(), read both bodies", upload.length * 2, async () => {
    const res = await fetch(`${base}/clone-echo`, { method: "POST", body: upload });
    if ((await res.text()) !== String(upload.length * 2)) throw new Error("bad echo");
  });
}
