// Not a mitata benchmark: measures retained memory per live stream object graph.
// Run with any JS runtime; extra per-type heap counts are reported under Bun.
const N = 100_000;
const gc = globalThis.Bun?.gc ?? globalThis.gc ?? (() => {});
const rss = () => process.memoryUsage.rss();

function measure(label, make) {
  gc(true);
  const before = rss();
  const held = new Array(N);
  for (let i = 0; i < N; i++) held[i] = make();
  gc(true);
  const perObject = (rss() - before) / N;
  console.log(`${label}: ${perObject.toFixed(0)} bytes RSS per instance (n=${N})`);
  return held; // keep alive until after the measurement
}

const keep = [];
keep.push(measure("new ReadableStream({pull(){}})", () => new ReadableStream({ pull() {} })));
keep.push(measure("new ReadableStream() + getReader()", () => new ReadableStream({ pull() {} }).getReader()));
keep.push(measure("new WritableStream({write(){}})", () => new WritableStream({ write() {} })));
keep.push(measure("new TransformStream()", () => new TransformStream()));

if (typeof Bun !== "undefined") {
  const { heapStats } = await import("bun:jsc");
  gc(true);
  const counts = heapStats().objectTypeCounts;
  const interesting = Object.entries(counts)
    .filter(([k]) => /Stream|Reader|Writer|Controller|Request|Promise|Function/i.test(k))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24);
  console.log("\nheapStats().objectTypeCounts (top stream-related):");
  for (const [k, v] of interesting) console.log(`  ${k}: ${v}`);
}
console.log("held", keep.length * N, "objects");
