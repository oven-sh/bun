// node:quic (HTTP/3) benchmark: bun vs node.
//
// Two benchmarks, because either side can be the bottleneck:
//
//   server bench — one client runtime drives both servers
//   client bench — one server runtime answers both clients
//
// Pinning the other side is what makes each number attributable. node:quic is
// the same API on both runtimes, so server.mjs/client.mjs run unmodified on
// each; only the runtime that executes them changes.
//
// Requires a node built with --experimental-quic (stock builds report
// process.features.quic === false):
//   ./configure --experimental-quic && make -j
//
//   BUN=path/to/bun NODE=path/to/node bun run.mjs
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";

const BUN = process.env.BUN ?? "bun";
const NODE = process.env.NODE ?? "node";
const COUNT = process.env.COUNT ?? "2000";
const CONCURRENCY = process.env.CONCURRENCY ?? "50";
const BODY_SIZE = process.env.BODY_SIZE ?? "0";
const ROUNDS = Number(process.env.ROUNDS ?? 3);

const here = new URL(".", import.meta.url).pathname;
const argv = runtime => (runtime === "node" ? ["--experimental-quic", "--no-warnings"] : []);
const bin = runtime => (runtime === "node" ? NODE : BUN);

async function startServer(runtime) {
  const proc = spawn(bin(runtime), [...argv(runtime), `${here}server.mjs`], {
    env: { ...process.env, BODY_SIZE },
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

async function runClient(runtime, port) {
  const proc = spawn(bin(runtime), [...argv(runtime), `${here}client.mjs`], {
    env: { ...process.env, PORT: port, COUNT, CONCURRENCY },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let out = "";
  proc.stdout.on("data", d => (out += d));
  // Bounded: a pairing that wedges (e.g. the peer tears the session down
  // mid-run) must report, not hang the whole matrix.
  const timer = setTimeout(() => proc.kill("SIGKILL"), Number(process.env.CLIENT_TIMEOUT_MS ?? 60000));
  const [code] = await once(proc, "exit");
  clearTimeout(timer);
  const line = out.trim().split("\n").at(-1);
  if (code !== 0 || !line?.startsWith("{")) {
    throw new Error(`${runtime} client exited ${code}${code === null ? " (timed out)" : ""}`);
  }
  return JSON.parse(line);
}

// Best of N rounds: QUIC throughput is noisy, and the fastest round is the one
// least perturbed by an unrelated scheduler hiccup.
async function measure(serverRuntime, clientRuntime) {
  const { proc, port } = await startServer(serverRuntime);
  try {
    let best = null;
    for (let i = 0; i < ROUNDS; i++) {
      let r;
      try {
        r = await runClient(clientRuntime, port);
      } catch (err) {
        return { failed: err.message };
      }
      if (!best || r.rps > best.rps) best = r;
    }
    return best;
  } finally {
    proc.kill("SIGKILL");
    await once(proc, "exit").catch(() => {});
  }
}

function table(title, pinned, rows) {
  console.log(`\n${title}  (${pinned})`);
  const ok = rows.filter(r => !r.res.failed);
  const fastest = ok.length ? Math.max(...ok.map(r => r.res.rps)) : 0;
  for (const { label, res } of rows) {
    if (res.failed) {
      console.log(`  ${label.padEnd(6)} FAILED: ${res.failed}`);
      continue;
    }
    const rel = res.rps === fastest ? "" : `  (${(fastest / res.rps).toFixed(2)}x slower)`;
    console.log(`  ${label.padEnd(6)} ${String(res.rps).padStart(7)} req/s   ${String(res.usPerReq).padStart(7)} us/req${rel}`);
  }
}

console.log(`node:quic HTTP/3 — ${COUNT} requests, concurrency ${CONCURRENCY}, body ${BODY_SIZE}B, best of ${ROUNDS}`);

// server bench: vary the server, pin the client.
table("server bench", "client: bun", [
  { label: "bun", res: await measure("bun", "bun") },
  { label: "node", res: await measure("node", "bun") },
]);

// client bench: vary the client, pin the server.
table("client bench", "server: bun", [
  { label: "bun", res: await measure("bun", "bun") },
  { label: "node", res: await measure("bun", "node") },
]);
