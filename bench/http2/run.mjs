// HTTP/2 vs HTTPS/1.1 server throughput: Bun.serve({ http2: true }) vs
// node:http2 createSecureServer({ allowHTTP1: true }). One TLS port per
// server; h2load drives it once with ALPN h2 and once with --h1.
//
//   BUN=path/to/bun NODE=path/to/node bun bench/http2/run.mjs
//
// Requires h2load (nghttp2). Knobs: REQUESTS, CLIENTS, STREAMS (h2 max
// concurrent streams per client), THREADS, BODY_SIZE.
import { spawn, spawnSync } from "node:child_process";
import { createInterface } from "node:readline";

const BUN = process.env.BUN ?? process.execPath;
const NODE = process.env.NODE ?? "node";
const REQUESTS = process.env.REQUESTS ?? "200000";
const CLIENTS = process.env.CLIENTS ?? "64";
const STREAMS = process.env.STREAMS ?? "16";
const THREADS = process.env.THREADS ?? "4";
const BODY_SIZE = process.env.BODY_SIZE ?? "13";

const here = new URL(".", import.meta.url).pathname;

if (spawnSync("h2load", ["--version"]).status !== 0) {
  console.error("h2load not found (install nghttp2)");
  process.exit(1);
}

async function startServer(runtime) {
  const [bin, file] = runtime === "bun" ? [BUN, "server.bun.js"] : [NODE, "server.node.mjs"];
  const proc = spawn(bin, [here + file], {
    env: { ...process.env, BODY_SIZE, PORT: "0" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const rl = createInterface({ input: proc.stdout });
  for await (const line of rl) {
    const m = /^READY (\d+)$/.exec(line);
    if (m) {
      rl.close();
      return { proc, port: m[1] };
    }
  }
  throw new Error(`${runtime} server exited before READY`);
}

function h2load(port, path, h1) {
  const args = [
    "-n",
    REQUESTS,
    "-c",
    CLIENTS,
    "-t",
    THREADS,
    ...(h1 ? ["--h1"] : ["-m", STREAMS]),
    `https://127.0.0.1:${port}${path}`,
  ];
  const { stdout, status } = spawnSync("h2load", args, { encoding: "utf8" });
  if (status !== 0) throw new Error("h2load failed: " + stdout);
  const rps = Number(/finished in .*?, ([\d.]+) req\/s/.exec(stdout)?.[1]);
  const ok = Number(/(\d+) succeeded/.exec(stdout)?.[1]);
  if (!(ok === Number(REQUESTS)) || !Number.isFinite(rps))
    throw new Error(`only ${ok}/${REQUESTS} succeeded:\n${stdout}`);
  return rps;
}

const rows = [];
for (const runtime of ["bun", "node"]) {
  const { proc, port } = await startServer(runtime);
  try {
    // warm up
    h2load(port, "/", false);
    rows.push({ server: runtime, protocol: "h2", "req/s": Math.round(h2load(port, "/", false)) });
    rows.push({ server: runtime, protocol: "http/1.1", "req/s": Math.round(h2load(port, "/", true)) });
    if (runtime === "bun") {
      rows.push({ server: "bun (static route)", protocol: "h2", "req/s": Math.round(h2load(port, "/static", false)) });
      rows.push({
        server: "bun (static route)",
        protocol: "http/1.1",
        "req/s": Math.round(h2load(port, "/static", true)),
      });
    }
  } finally {
    proc.kill();
  }
}

console.log(
  `h2load -n ${REQUESTS} -c ${CLIENTS} -t ${THREADS}; h2: -m ${STREAMS}; body ${BODY_SIZE} bytes; TLS on both`,
);
console.table(rows);
