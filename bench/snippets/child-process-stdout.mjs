// child.stdout read with a plain 'data' listener, timed from the first chunk to 'end', best of RUNS passes.
//
// - "lockstep" rows: the child writes its next block when the parent has read the whole of the one before. A block
//   is shorter than the buffer that the stream reads into, and arrives as one chunk unless the pipe splits it. They
//   report microseconds per chunk. The buffer is 64 KiB: 4 KiB and 16 KiB divide it, 4000 B and 15000 B do not.
// - "bulk" rows: the child writes without a wait for the parent. They report MB/s.
//
//   bun bench/snippets/child-process-stdout.mjs
//   node bench/snippets/child-process-stdout.mjs
//
// PRODUCER=<path> sets the runtime of the child (default: the runtime of the parent). Set it to compare two parents
// over the same child. `--scenario=<name>` runs one scenario.
import { spawn } from "node:child_process";

const RUNS = 5;
const producer = process.env.PRODUCER || process.execPath;

function read(script, stdin, onChunk) {
  return new Promise((resolve, reject) => {
    const child = spawn(producer, ["-e", script], { stdio: [stdin, "pipe", "inherit"] });
    // The last line can reach a child that already exited.
    child.stdin?.on("error", () => {});
    child.on("error", reject);
    let bytes = 0;
    let chunks = 0;
    let start = 0;
    child.stdout.on("data", chunk => {
      if (chunks++ === 0) start = performance.now();
      bytes += chunk.length;
      onChunk?.(child, chunk);
    });
    child.stdout.on("end", () => resolve({ bytes, chunks, ms: performance.now() - start }));
  });
}

// The child writes one block for each line on its stdin, and gets a line for each block that the parent has read whole.
const lockstep = (size, count) => ({
  bytes: size * count,
  run: () => {
    let unanswered = 0;
    return read(
      `const b=Buffer.alloc(${size},97);let i=0;const next=()=>{if(i++<${count})process.stdout.write(b);else process.exit(0)};process.stdin.on("data",next);next()`,
      "pipe",
      (child, chunk) => {
        for (unanswered += chunk.length; unanswered >= size; unanswered -= size) child.stdin.write("\n");
      },
    );
  },
});
const bulk = (size, count) => ({
  bytes: size * count,
  run: () => read(`const b=Buffer.alloc(${size},97);for(let i=0;i<${count};i++)require("fs").writeSync(1,b)`, "ignore"),
});

const scenarios = {
  "lockstep, 64 B blocks": lockstep(64, 20_000),
  "lockstep, 1000 B blocks": lockstep(1000, 20_000),
  "lockstep, 4000 B blocks": lockstep(4000, 20_000),
  "lockstep, 4 KiB blocks": lockstep(4096, 20_000),
  "lockstep, 15000 B blocks": lockstep(15000, 20_000),
  "lockstep, 16 KiB blocks": lockstep(16384, 20_000),
  "lockstep, 32 KiB blocks": lockstep(32768, 20_000),
  "bulk, 100 B writes": bulk(100, 200_000),
  "bulk, 4 KiB writes": bulk(4096, 65_536),
  "bulk, 64 KiB writes": bulk(65536, 8192),
};

const version = typeof Bun !== "undefined" ? `bun ${Bun.revision.slice(0, 9)}` : `node ${process.version}`;
console.log(`# child.stdout with a 'data' listener: ${version}, child ${producer}, best of ${RUNS}`);
const only = process.argv.find(arg => arg.startsWith("--scenario="))?.slice("--scenario=".length);
for (const [name, { bytes, run }] of Object.entries(scenarios)) {
  if (only && name !== only) continue;
  let best;
  for (let i = 0; i < RUNS; i++) {
    const result = await run();
    if (result.bytes !== bytes) throw new Error(`${name}: ${result.bytes} bytes of ${bytes}`);
    if (best === undefined || result.ms < best.ms) best = result;
  }
  const rate = name.startsWith("lockstep")
    ? `${((best.ms * 1000) / best.chunks).toFixed(1).padStart(7)} us/chunk`
    : `${(bytes / 1024 / 1024 / (best.ms / 1000)).toFixed(0).padStart(7)} MB/s`;
  console.log(`${name.padEnd(26)} ${rate}  (${best.chunks} chunks, ${best.ms.toFixed(1)} ms)`);
}
