// Consumer x chunk-shape matrix for JS-sourced ReadableStreams (MB/s, best of RUNS).
// Every shape totals ~8 MiB so numbers are comparable across rows.
const RUNS = 5;
const MB = 1024 * 1024;
const TOTAL = 8 * MB;

const binary = size => {
  const chunk = new Uint8Array(size).fill(120);
  const count = TOTAL / size;
  return () => {
    let i = 0;
    return new ReadableStream({
      pull(c) {
        if (i++ < count) c.enqueue(chunk);
        else c.close();
      },
    });
  };
};
const text = size => {
  const chunk = "x".repeat(size);
  const count = TOTAL / size;
  return () => {
    let i = 0;
    return new ReadableStream({
      pull(c) {
        if (i++ < count) c.enqueue(chunk);
        else c.close();
      },
    });
  };
};
const mixed = size => {
  const textChunk = "y".repeat(size);
  const binaryChunk = new Uint8Array(size).fill(121);
  const count = TOTAL / size;
  return () => {
    let i = 0;
    return new ReadableStream({
      pull(c) {
        if (i < count) (c.enqueue(i % 2 ? textChunk : binaryChunk), i++);
        else c.close();
      },
    });
  };
};

const shapes = {
  "binary 64KiB x128": binary(64 * 1024),
  "binary 1KiB x8192": binary(1024),
  "text 64KiB x128": text(64 * 1024),
  "text 1KiB x8192": text(1024),
  "mixed text/bytes 64KiB x128": mixed(64 * 1024),
  "one 8MiB chunk": (() => {
    const chunk = new Uint8Array(TOTAL).fill(122);
    return () =>
      new ReadableStream({
        start(c) {
          c.enqueue(chunk);
          c.close();
        },
      });
  })(),
};

const consumers = {
  "toText": s => Bun.readableStreamToText(s),
  "toArrayBuffer": s => Bun.readableStreamToArrayBuffer(s),
  "toBytes": s => Bun.readableStreamToBytes(s),
  "toArray": s => Bun.readableStreamToArray(s),
  "toBlob": async s => (await Bun.readableStreamToBlob(s)).size,
  "Response.text": s => new Response(s).text(),
  "Response.arrayBuffer": s => new Response(s).arrayBuffer(),
  "for await": async s => {
    let n = 0;
    for await (const c of s) n += c.length;
    return n;
  },
};

const table = {};
for (const [shapeName, make] of Object.entries(shapes)) {
  const row = (table[shapeName] = {});
  for (const [consumerName, consume] of Object.entries(consumers)) {
    await consume(make()); // warmup + validity
    let best = Infinity;
    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      await consume(make());
      best = Math.min(best, performance.now() - t0);
    }
    row[consumerName] = Math.round(TOTAL / MB / (best / 1000));
  }
}
const consumerNames = Object.keys(consumers);
const version = typeof Bun !== "undefined" ? `bun ${Bun.revision.slice(0, 9)}` : `node ${process.version}`;
console.log(`# webstreams consumers (MB/s) — ${version} — ${TOTAL / MB} MiB per pass, best of ${RUNS}`);
console.log(["shape".padEnd(28), ...consumerNames.map(n => n.padStart(14))].join(""));
for (const [shapeName, row] of Object.entries(table))
  console.log([shapeName.padEnd(28), ...consumerNames.map(n => String(row[n]).padStart(14))].join(""));
