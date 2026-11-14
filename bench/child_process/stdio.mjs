// What it costs to read a child's stdout through a Node stream. Runs under bun or node, on POSIX.
//
//   [MB=64] [BUSY_US=0] bun bench/child_process/stdio.mjs <consumer> [source]
//
// consumer: data | readable | iter | pipe | once
// source:   child (default)  child.stdout of node:child_process, the child writes MB mebibytes
//           web              Readable.fromWeb() over the stdout of Bun.spawn(), bun only
//           echo             a child that sends each message back: MB * 1000 round trips of 16 bytes
// BUSY_US > 0 holds the consumer that long on each chunk, so that the child is always ahead of it.
// Prints one JSON line. `bytes` below `total` means that the consumer lost chunks (`once` can, by design of the loop).
// Count instructions and system calls from outside: `perf stat -e instructions:u`, `strace -c -f`.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Readable, Writable } from "node:stream";

const [consumer = "data", source = "child"] = process.argv.slice(2);
const MB = Number(process.env.MB ?? 64);
const busy = Number(process.env.BUSY_US ?? 0) / 1000;
const runtime = typeof Bun !== "undefined" ? "bun " + Bun.version_with_sha : "node " + process.version;
const echo = source === "echo";
const message = Buffer.alloc(16, "m");
const total = echo ? MB * 1000 * message.length : MB * 1024 * 1024;
const producer = echo ? ["cat"] : ["head", "-c", String(total), "/dev/zero"];

let stream, stdin;
if (source === "web") {
  stream = Readable.fromWeb(Bun.spawn(producer, { stdin: "ignore", stdout: "pipe", stderr: "inherit" }).stdout);
} else {
  const child = spawn(producer[0], producer.slice(1), { stdio: [echo ? "pipe" : "ignore", "pipe", "inherit"] });
  stream = child.stdout;
  stdin = child.stdin;
}

const cell = new Int32Array(new SharedArrayBuffer(4));
const started = Date.now();
const cpu = process.cpuUsage();
let chunks = 0;
let bytes = 0;
function got(chunk) {
  chunks++;
  bytes += chunk.length;
  if (busy > 0) Atomics.wait(cell, 0, 0, busy);
  if (echo) bytes < total ? stdin.write(message) : stdin.end();
}
if (echo) stdin.write(message);

if (consumer === "data") {
  stream.on("data", got);
} else if (consumer === "readable") {
  stream.on("readable", () => {
    for (let chunk; (chunk = stream.read()) !== null;) got(chunk);
  });
} else if (consumer === "iter") {
  for await (const chunk of stream) got(chunk);
} else if (consumer === "pipe") {
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      got(chunk);
      callback();
    },
  });
  stream.pipe(sink);
} else if (consumer === "once") {
  const ended = once(stream, "end").then(() => null);
  for (let next; (next = await Promise.race([once(stream, "data"), ended])) !== null;) {
    got(next[0]);
    await new Promise(resolve => process.nextTick(resolve));
  }
} else {
  console.error("consumers: data readable iter pipe once");
  process.exit(2);
}
if (!stream.readableEnded) await once(stream, "end");

const used = process.cpuUsage(cpu);
console.log(
  JSON.stringify({
    consumer,
    source,
    MB,
    BUSY_US: busy * 1000,
    runtime,
    chunks,
    bytes,
    total,
    elapsedMs: Date.now() - started,
    cpuMs: Math.round((used.user + used.system) / 1000),
  }),
);
