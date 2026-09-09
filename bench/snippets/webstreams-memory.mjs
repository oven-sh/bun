// Web Streams memory: (1) retained RSS per live instance, (2) peak/settled RSS for
// streaming workloads. Run with any JS runtime; extra heap counts print under Bun.
const N = 100_000;
const gc = globalThis.Bun?.gc ?? globalThis.gc;
if (!gc) throw new Error("This benchmark needs a GC hook: run with Bun, or node --expose-gc.");
const rss = () => process.memoryUsage.rss();
const MB = 1024 * 1024;
const fmt = n => (n / MB).toFixed(1).padStart(8) + " MB";

console.log(`# per-instance retained RSS (n=${N} live instances)`);
const keep = [];
function perInstance(label, make) {
  gc(true);
  const before = rss();
  const held = new Array(N);
  for (let i = 0; i < N; i++) held[i] = make();
  gc(true);
  const perObject = (rss() - before) / N;
  console.log(`${label.padEnd(40)} ${perObject.toFixed(0).padStart(6)} bytes/instance`);
  keep.push(held);
}
perInstance("new ReadableStream({pull(){}})", () => new ReadableStream({ pull() {} }));
perInstance("new ReadableStream() + getReader()", () => new ReadableStream({ pull() {} }).getReader());
perInstance("new WritableStream({write(){}})", () => new WritableStream({ write() {} }));
perInstance("new TransformStream()", () => new TransformStream());
keep.length = 0;
gc(true);

console.log(`\n# workload RSS (peak over baseline during the run, settled after gc)`);
const CHUNK = new Uint8Array(64 * 1024).fill(120);
async function workload(label, fn) {
  gc(true);
  const before = rss();
  let peak = before;
  const timer = setInterval(() => {
    peak = Math.max(peak, rss());
  }, 5);
  // Whatever `fn` returns is kept alive until after the settled measurement, so
  // "N live objects" workloads measure retention rather than post-return garbage.
  const keepAlive = await fn();
  clearInterval(timer);
  peak = Math.max(peak, rss());
  gc(true);
  const settled = rss();
  console.log(`${label.padEnd(46)} peak ${fmt(peak - before)}   settled ${fmt(settled - before)}`);
  return keepAlive;
}
const source = n => {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i++ < n) c.enqueue(CHUNK);
      else c.close();
    },
  });
};
await workload("pipeTo 512 MiB (64 KiB chunks)", async () => {
  let n = 0;
  await source(8192).pipeTo(
    new WritableStream({
      write(c) {
        n += c.length;
      },
    }),
  );
});
await workload("for await 512 MiB", async () => {
  let n = 0;
  for await (const c of source(8192)) n += c.length;
});
await workload("Response(stream 256 MiB).arrayBuffer()", async () => {
  (await new Response(source(4096)).arrayBuffer()).byteLength;
});
await workload("Response(stream 256 MiB of text).text()", async () => {
  let i = 0;
  const text = "x".repeat(64 * 1024);
  const rs = new ReadableStream({
    pull(c) {
      if (i++ < 4096) c.enqueue(text);
      else c.close();
    },
  });
  (await new Response(rs).text()).length;
});
{
  const held = await workload("10k live TransformStream chains (held)", async () => {
    const chains = new Array(10_000);
    for (let i = 0; i < chains.length; i++) {
      const ts = new TransformStream();
      chains[i] = [ts, ts.readable.getReader(), ts.writable.getWriter()];
    }
    gc(true);
    return chains;
  });
  held.length = 0;
}
await workload("2k concurrent pipeThrough pipes (1 MiB each)", async () => {
  const pipes = [];
  for (let i = 0; i < 2000; i++) {
    let k = 0;
    const rs = new ReadableStream({
      pull(c) {
        if (k++ < 16) c.enqueue(CHUNK);
        else c.close();
      },
    });
    pipes.push(rs.pipeThrough(new TransformStream()).pipeTo(new WritableStream({ write() {} })));
  }
  await Promise.all(pipes);
});

if (typeof Bun !== "undefined") {
  gc(true);
  const { heapStats } = await import("bun:jsc");
  const counts = heapStats().objectTypeCounts;
  const interesting = Object.entries(counts)
    .filter(([k]) => /Stream|Reader|Writer|Controller|Request|Promise|Function/i.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 16);
  console.log("\n# heapStats().objectTypeCounts after the workloads (top stream-related):");
  for (const [k, v] of interesting) console.log(`  ${k}: ${v}`);
}
