// bun run.ts <bun under test> [bun of main] [--aot] [--only=spans,memory,server,inflight]
// Linux. Needs `wrk` and `taskset`. Prints markdown tables of medians. RSS is RssAnon.
// This process is the collector: start it on a processor of its own, `taskset -c 20 bun run.ts ..`.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const flags = process.argv.slice(2).filter(a => a.startsWith("--"));
const [bun, main] = process.argv.slice(2).filter(a => !a.startsWith("--"));
const only = flags
  .find(f => f.startsWith("--only="))
  ?.slice(7)
  .split(",") ?? ["spans", "memory", "server", "inflight"];
const REPS = Number(process.env.REPS ?? 5);
const CPUS = process.env.CPUS ?? "2-5";
const LOAD_CPUS = process.env.LOAD_CPUS ?? "8-15";

let exportedSpans = 0;
const collector = Bun.serve({
  port: 0,
  async fetch(request) {
    // Each span has one `start_time_unix_nano`; the field that holds it is what is counted.
    exportedSpans += countSpans(await request.bytes());
    return new Response();
  },
});
function countSpans(bytes: Uint8Array, depth = 0): number {
  let count = 0;
  for (let at = 0; at < bytes.length;) {
    const field = bytes[at++] >> 3;
    let length = 0;
    for (let shift = 0, byte = 128; byte & 128; shift += 7) length |= ((byte = bytes[at++]) & 127) << shift;
    if (depth === 2) count += +(field === 2);
    else if (field === (depth === 0 ? 1 : 2)) count += countSpans(bytes.subarray(at, at + length), depth + 1);
    at += length;
  }
  return count;
}

const out = mkdtempSync(join(tmpdir(), "bench-telemetry-"));
function command(binary: string, file: string) {
  if (!flags.includes("--aot")) return [binary, join(import.meta.dir, file)];
  const executable = join(out, `${Bun.hash(binary)}-${file}`);
  if (!Bun.file(executable).size) {
    const built = Bun.spawnSync([binary, "compile", file, "--outfile", executable], { cwd: import.meta.dir });
    if (!built.success) throw new Error(built.stderr.toString());
  }
  return [executable];
}
function spawn(binary: string, file: string, env: Record<string, string>) {
  return Bun.spawn(["taskset", "-c", CPUS, ...command(binary, file)], {
    env: { ...process.env, OTEL_EXPORTER_OTLP_ENDPOINT: collector.url.origin, ...env },
    stderr: "inherit",
  });
}
const json = async (file: string, env: Record<string, string>) => JSON.parse(await spawn(bun, file, env).stdout.text());
const median = (rows: any[], key: string) => rows.map(row => row[key]).sort((a, b) => a - b)[rows.length >> 1];
const table = (head: string[], rows: string[][]) =>
  console.log([head, head.map(() => "---"), ...rows].map(row => `| ${row.join(" | ")} |`).join("\n") + "\n");
const mb = (bytes: number) => (bytes / 1048576).toFixed(1) + " MB";

/** Interleaved, so that a busy neighbour hits every column alike. */
async function compare<T>(columns: T[], once: (column: T) => Promise<object>) {
  const rows: object[][] = columns.map(() => []);
  for (let rep = 0; rep < REPS; rep++) for (const [i, column] of columns.entries()) rows[i].push(await once(column));
  return rows;
}

if (only.includes("spans")) {
  const rows = [];
  for (const CASE of await json("spans.ts", {})) {
    const [off, native, sdk] = await compare(["off", "native", "sdk"], MODE => json("spans.ts", { MODE, CASE }));
    const [a, b] = [median(native, "ns"), median(sdk, "ns")];
    rows.push([
      CASE,
      a.toFixed(0) + " ns",
      b.toFixed(0) + " ns",
      (b / a).toFixed(1) + "x",
      [off, native, sdk].map(r => mb(median(r, "peakRss"))).join(" / "),
    ]);
  }
  table(["CPU per operation, export included", "native", "SDK", "SDK / native", "peak RSS off / native / SDK"], rows);
}

if (only.includes("memory")) {
  const rows = [];
  const never = { QUEUE: "2000000", BATCH: "2000000", DELAY: "1000000" };
  for (const CASE of await json("memory.ts", {})) {
    const [off, native, sdk] = await compare(["off", "native", "sdk"], MODE =>
      json("memory.ts", { MODE, CASE, ...never }),
    );
    if (CASE.startsWith("nothing")) {
      table(
        ["RSS after startup", "off", "native", "SDK"],
        [["", ...[off, native, sdk].map(r => mb(median(r, "rss")))]],
      );
      continue;
    }
    // Without tracing the api hands out a NonRecordingSpan, which is no part of the program's own cost.
    const own = CASE.includes("suspended") ? median(off, "bytes") : 0;
    const [a, b] = [median(native, "bytes") - own, median(sdk, "bytes") - own];
    rows.push([CASE, a.toFixed(0) + " B", b.toFixed(0) + " B", (b / a).toFixed(1) + "x"]);
  }
  table(["Memory per span", "native", "SDK", "SDK / native"], rows);
}

const servers = [
  ...(main ? [{ name: "main", binary: main, MODE: "off" }] : []),
  { name: "tracing off", binary: bun, MODE: "off" },
  { name: "native", binary: bun, MODE: "native" },
  { name: "SDK", binary: bun, MODE: "sdk" },
];
async function withServer<T>(
  { binary, MODE }: (typeof servers)[number],
  env: object,
  f: (url: string, pid: number) => Promise<T>,
) {
  const server = spawn(binary, "server.ts", { MODE, ...env });
  const { value } = await server.stdout.getReader().read();
  try {
    return await f(`http://127.0.0.1:${new TextDecoder().decode(value).trim()}`, server.pid);
  } finally {
    server.kill("SIGKILL");
    await server.exited;
  }
}

if (only.includes("server")) {
  const ticks = (pid: number) => readFileSync(`/proc/${pid}/stat`, "utf8").split(" ").slice(13, 15).map(Number);
  const wrk = (url: string, seconds: number) =>
    Bun.spawn([
      "taskset",
      "-c",
      LOAD_CPUS,
      "wrk",
      "-t4",
      "-c64",
      `-d${seconds}s`,
      "-H",
      "User-Agent: wrk",
      url + "/users/1",
    ]).stdout.text();
  const rows = await compare(servers, server =>
    withServer(server, {}, async (url, pid) => {
      await wrk(url, 2);
      const [before, exported] = [ticks(pid), exportedSpans];
      const requests = Number(/(\d+) requests in/.exec(await wrk(url, 8))![1]);
      const after = ticks(pid);
      return {
        rps: requests / 8,
        user: ((after[0] - before[0]) * 1e4) / requests,
        cpu: ((after[0] + after[1] - before[0] - before[1]) * 1e4) / requests,
        peak: Number(/RssAnon:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))![1]) * 1024,
        exported: (exportedSpans - exported) / requests,
      };
    }),
  );
  table(
    ["Bun.serve, 64 connections", "req/s", "CPU/req", "user CPU/req", "RSS under load", "spans exported"],
    servers.map(({ name }, i) => [
      name,
      median(rows[i], "rps").toFixed(0),
      median(rows[i], "cpu").toFixed(2) + " µs",
      median(rows[i], "user").toFixed(2) + " µs",
      mb(median(rows[i], "peak")),
      (median(rows[i], "exported") * 100).toFixed(0) + "%",
    ]),
  );
}

if (only.includes("inflight")) {
  const N = 10_000;
  const rows = await compare(servers, server =>
    withServer(server, { HOLD: "1" }, async url => {
      const { hostname, port } = new URL(url);
      const measure = async () => (await fetch(url + "/rss")).json() as Promise<{ rss: number; arrived: number }>;
      const before = await measure();
      const sockets = [];
      for (let i = 0; i < N; i++) {
        const socket = await Bun.connect({ hostname, port: +port, socket: { data() {} } });
        socket.write(`GET /users/${i} HTTP/1.1\r\nHost: ${hostname}:${port}\r\nUser-Agent: bench/1.0\r\n\r\n`);
        sockets.push(socket);
      }
      let after;
      while ((after = await measure()).arrived < N);
      for (const socket of sockets) socket.terminate();
      return { bytes: (after.rss - before.rss) / N };
    }),
  );
  const off = median(rows[servers.findIndex(s => s.name === "tracing off")], "bytes");
  table(
    [`${N} requests in flight`, "RSS per request", "over tracing off"],
    servers.map(({ name }, i) => [
      name,
      median(rows[i], "bytes").toFixed(0) + " B",
      (median(rows[i], "bytes") - off).toFixed(0) + " B",
    ]),
  );
}
process.exit(0);
