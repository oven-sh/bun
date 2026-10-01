// Web Streams throughput: 64 KiB chunks, 32 MiB per pass, best of RUNS passes,
// timed end-to-end so numbers are directly comparable across runtimes.
//
// Two source families:
// - "shared chunk" scenarios enqueue the SAME Uint8Array object every time.
//   Default streams pass chunks by reference (no engine copies them), so these
//   rows measure per-chunk machinery overhead only; they are reported as
//   chunks/sec (with ns/chunk), NOT MB/s, because no payload bytes move.
// - "fresh buffers" scenarios allocate and fill a new chunk per enqueue (what a
//   socket or file source produces), so their MB/s is bounded by real memory
//   work and is meaningful as throughput.
// Consumer scenarios (arrayBuffer/text/readableStreamTo*) always materialize
// their output, so they report MB/s.
const CHUNK = 64 * 1024;
const CHUNKS = 512; // 32 MiB
const RUNS = 5;
const BYTES = CHUNK * CHUNKS;
const chunk = new Uint8Array(CHUNK).fill(120);
const textChunk = "x".repeat(CHUNK);

const byteSource = () => {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i++ < CHUNKS) c.enqueue(chunk);
      else c.close();
    },
  });
};
// A fresh, written-to buffer per chunk: the shape real byte sources (sockets,
// files) produce. Bounded by allocation + memory-touch bandwidth.
const freshSource = () => {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i++ < CHUNKS) c.enqueue(new Uint8Array(CHUNK).fill(i & 0xff));
      else c.close();
    },
  });
};
const textSource = () => {
  let i = 0;
  return new ReadableStream({
    pull(c) {
      if (i++ < CHUNKS) c.enqueue(textChunk);
      else c.close();
    },
  });
};
const byobSource = () => {
  let i = 0;
  return new ReadableStream({
    type: "bytes",
    autoAllocateChunkSize: CHUNK,
    pull(c) {
      if (i++ < CHUNKS) {
        const v = c.byobRequest.view;
        c.byobRequest.respond(v.byteLength);
      } else {
        c.close();
        c.byobRequest?.respond(0);
      }
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

// Scenario names listed here are reference-passing ("shared chunk") and are
// reported as chunks/sec instead of MB/s.
const SHARED_CHUNK_SCENARIOS = new Set([
  "reader.read() loop (shared chunk)",
  "for await (shared chunk)",
  "readMany loop (shared chunk)",
  "pipeTo(WritableStream) (shared chunk)",
  "pipeTo(WritableStream, HWM 16) (shared chunk)",
  "pipeThrough(TransformStream) (shared chunk)",
  "tee + drain both (shared chunk)",
]);

const scenarios = {
  "reader.read() loop (shared chunk)": () => drain(byteSource()),
  "reader.read() loop (fresh buffers)": () => drain(freshSource()),
  // readMany drains whatever is queued per call: the batching consumer's machinery cost.
  "readMany loop (shared chunk)": async () => {
    const reader = byteSource().getReader();
    let n = 0;
    while (true) {
      const r = await reader.readMany();
      if (r.done) return n;
      for (const v of r.value) n += v.byteLength;
    }
  },
  "for await (shared chunk)": async () => {
    let n = 0;
    for await (const c of byteSource()) n += c.length;
    return n;
  },
  "for await (fresh buffers)": async () => {
    let n = 0;
    for await (const c of freshSource()) n += c.length;
    return n;
  },
  "pipeTo(WritableStream) (shared chunk)": async () => {
    let n = 0;
    await byteSource().pipeTo(
      new WritableStream({
        write(c) {
          n += c.length;
        },
      }),
    );
    return n;
  },
  // A destination with capacity: the pipe can move already-queued chunks without
  // waiting out a writer-ready round trip per chunk.
  "pipeTo(WritableStream, HWM 16) (shared chunk)": async () => {
    let n = 0;
    await byteSource().pipeTo(
      new WritableStream(
        {
          write(c) {
            n += c.length;
          },
        },
        new CountQueuingStrategy({ highWaterMark: 16 }),
      ),
    );
    return n;
  },
  "pipeTo(WritableStream) (fresh buffers)": async () => {
    let n = 0;
    await freshSource().pipeTo(
      new WritableStream({
        write(c) {
          n += c.length;
        },
      }),
    );
    return n;
  },
  "pipeThrough(TransformStream) (shared chunk)": () => drain(byteSource().pipeThrough(new TransformStream())),
  "pipeThrough(TransformStream) (fresh buffers)": () => drain(freshSource().pipeThrough(new TransformStream())),
  "tee + drain both (shared chunk)": async () => {
    const [a, b] = byteSource().tee();
    const [x] = await Promise.all([drain(a), drain(b)]);
    return x;
  },
  "tee + drain both (fresh buffers)": async () => {
    const [a, b] = freshSource().tee();
    const [x] = await Promise.all([drain(a), drain(b)]);
    return x;
  },
  "new Response(stream).arrayBuffer()": async () => (await new Response(byteSource()).arrayBuffer()).byteLength,
  "byte source (byobRequest) default reader": () => drain(byobSource()),
  "byte source (byobRequest) BYOB reader": async () => {
    const r = byobSource().getReader({ mode: "byob" });
    let n = 0;
    let view = new Uint8Array(CHUNK);
    while (true) {
      const { done, value } = await r.read(view);
      if (done) return n;
      n += value.byteLength;
      view = new Uint8Array(value.buffer);
    }
  },
};

if (typeof Bun !== "undefined") {
  // Response bodies of string chunks are a Bun extension (the spec requires Uint8Array
  // chunks; Node and Deno reject them), so this scenario only runs on Bun.
  scenarios["text chunks -> Response.text()"] = async () => (await new Response(textSource()).text()).length;
  scenarios["direct stream -> readableStreamToBytes"] = async () => {
    const rs = new ReadableStream({
      type: "direct",
      pull(c) {
        for (let i = 0; i < CHUNKS; i++) c.write(chunk);
        c.end();
      },
    });
    return (await Bun.readableStreamToBytes(rs)).byteLength;
  };
  scenarios["Bun.readableStreamToBytes(stream)"] = async () =>
    (await Bun.readableStreamToBytes(byteSource())).byteLength;
}

const version =
  typeof Bun !== "undefined"
    ? `bun ${Bun.revision.slice(0, 9)}`
    : typeof Deno !== "undefined"
      ? `deno ${Deno.version.deno}`
      : `node ${process.version}`;
console.log(
  `# webstreams throughput — ${version} — ${CHUNKS} x ${CHUNK / 1024} KiB = ${BYTES / 1024 / 1024} MiB per pass, best of ${RUNS}`,
);
// `--scenario=<name>` runs one scenario in isolation (e.g. under `/usr/bin/time -v`
// so the process's peak RSS measures exactly one scenario).
const only = (globalThis.process?.argv ?? []).find(a => a.startsWith("--scenario="))?.slice("--scenario=".length);
for (const [name, fn] of Object.entries(scenarios)) {
  if (only && name !== only) continue;
  // Collect between scenarios so no scenario pays the previous one's GC debt.
  globalThis.Bun?.gc(true);
  // warmup
  if ((await fn()) !== BYTES) throw new Error(`${name}: wrong byte count`);
  let best = Infinity;
  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now();
    await fn();
    best = Math.min(best, performance.now() - t0);
  }
  if (SHARED_CHUNK_SCENARIOS.has(name)) {
    // Reference-passing: no payload bytes move, so MB/s would be misleading.
    const chunksPerSec = CHUNKS / (best / 1000);
    const nsPerChunk = (best * 1e6) / CHUNKS;
    console.log(
      `${name.padEnd(46)} ${(chunksPerSec / 1e6).toFixed(2).padStart(6)} M chunks/s  (${nsPerChunk.toFixed(0)} ns/chunk, ${best.toFixed(1)} ms)`,
    );
  } else {
    const mbps = BYTES / 1024 / 1024 / (best / 1000);
    console.log(`${name.padEnd(46)} ${mbps.toFixed(0).padStart(6)} MB/s  (${best.toFixed(1)} ms)`);
  }
}
