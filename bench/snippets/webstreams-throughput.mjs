// Streaming throughput (MB/s) for Web Streams: 64 KiB chunks, 32 MiB per pass.
// Not mitata: each scenario is timed end-to-end over the whole payload so the
// number is directly comparable across runtimes (best of RUNS passes).
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

const scenarios = {
  "reader.read() loop": () => drain(byteSource()),
  "for await": async () => {
    let n = 0;
    for await (const c of byteSource()) n += c.length;
    return n;
  },
  "pipeTo(WritableStream)": async () => {
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
  "pipeThrough(TransformStream)": () => drain(byteSource().pipeThrough(new TransformStream())),
  "tee + drain both": async () => {
    const [a, b] = byteSource().tee();
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
  const mbps = BYTES / 1024 / 1024 / (best / 1000);
  console.log(`${name.padEnd(42)} ${mbps.toFixed(0).padStart(6)} MB/s  (${best.toFixed(1)} ms)`);
}
