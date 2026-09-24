// RFC 6455 echo or pub/sub throughput over HTTP/1.1 and RFC 8441 Extended CONNECT.
//
//   BUN=build/release/bun node bench/websocket-server/protocol-run.mjs
//
// Optional comparison:
//   BUN=path/to/candidate BUN_BASELINE=path/to/baseline node protocol-run.mjs
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const BUN = process.env.BUN ?? process.execPath;
const BUN_BASELINE = process.env.BUN_BASELINE;
const BASELINE_SUPPORTS_H2 = process.env.BASELINE_SUPPORTS_H2 === "1";
const CLIENT_RUNTIME = process.env.CLIENT_RUNTIME ?? process.execPath;
const WORKLOAD = process.env.WORKLOAD ?? "echo";
const PROCESSES = Number(process.env.PROCESSES ?? 4);
const STREAMS = Number(process.env.STREAMS ?? 32);
const H2_MUX_SESSIONS = Number(process.env.H2_MUX_SESSIONS ?? PROCESSES);
const PAYLOAD_SIZES = (process.env.PAYLOAD_SIZES ?? "16,1024,65536").split(",").map(Number);
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 2_000);
const DURATION_MS = Number(process.env.DURATION_MS ?? 5_000);
const H2_STREAM_WINDOW_SIZE = Number(process.env.H2_STREAM_WINDOW_SIZE ?? 16 * 1024 * 1024);
const H2_CONNECTION_WINDOW_SIZE = Number(process.env.H2_CONNECTION_WINDOW_SIZE ?? 64 * 1024 * 1024);
const RUNS = Number(process.env.RUNS ?? 3);
const CYCLES = Number(process.env.CYCLES ?? 1);
const CASES = (process.env.CASES ?? "h1,h2-single,h2-mux").split(",");
const here = fileURLToPath(new URL(".", import.meta.url));
const children = new Set();

function track(proc) {
  children.add(proc);
  proc.once("close", () => children.delete(proc));
  return proc;
}

function stopChildren(signal = "SIGTERM") {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    stopChildren();
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

for (const [name, value] of [
  ["PROCESSES", PROCESSES],
  ["STREAMS", STREAMS],
  ["RUNS", RUNS],
  ["CYCLES", CYCLES],
]) {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer: ${value}`);
}
for (const [name, value] of [
  ["WARMUP_MS", WARMUP_MS],
  ["DURATION_MS", DURATION_MS],
]) {
  if (!Number.isFinite(value) || value < 1) throw new Error(`${name} must be positive: ${value}`);
}
for (const [name, value] of [
  ["H2_STREAM_WINDOW_SIZE", H2_STREAM_WINDOW_SIZE],
  ["H2_CONNECTION_WINDOW_SIZE", H2_CONNECTION_WINDOW_SIZE],
]) {
  if (!Number.isInteger(value) || value < 65_535 || value > 0x7fffffff) {
    throw new Error(`${name} must be an integer between 65535 and 2147483647: ${value}`);
  }
}
if (STREAMS % PROCESSES !== 0) throw new Error("STREAMS must be divisible by PROCESSES");
if (H2_MUX_SESSIONS < PROCESSES || H2_MUX_SESSIONS % PROCESSES !== 0) {
  throw new Error("H2_MUX_SESSIONS must be divisible by and at least PROCESSES");
}
for (const binary of [BUN, BUN_BASELINE, CLIENT_RUNTIME]) {
  if (binary?.includes("/") && !existsSync(binary)) throw new Error(`binary does not exist: ${binary}`);
}
if (WORKLOAD !== "echo" && WORKLOAD !== "pubsub-self") throw new Error(`invalid WORKLOAD: ${WORKLOAD}`);

async function startServer(binary) {
  const proc = track(
    spawn(binary, [here + "protocol-server.bun.js"], {
      env: { ...process.env, BUN_DEBUG_QUIET_LOGS: process.env.BUN_DEBUG_QUIET_LOGS ?? "1", PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  let stderr = "";
  proc.stderr.setEncoding("utf8");
  proc.stderr.on("data", chunk => (stderr += chunk));
  const rl = createInterface({ input: proc.stdout });
  const result = await new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      proc.off("error", onError);
      proc.off("exit", onExit);
      rl.off("line", onLine);
    };
    const fail = error => {
      cleanup();
      proc.kill("SIGKILL");
      reject(error);
    };
    const onError = error => fail(error);
    const onExit = (code, signal) => fail(new Error(`server exited before ready: ${code}/${signal}\n${stderr}`));
    const onLine = line => {
      let event;
      try {
        event = JSON.parse(line);
      } catch (error) {
        fail(new Error(`invalid server readiness output: ${JSON.stringify(line)}\n${error.message}`));
        return;
      }
      if (event.event !== "ready" || !Number.isInteger(event.port) || event.port < 1) {
        fail(new Error(`unexpected server readiness event: ${line}`));
        return;
      }
      cleanup();
      resolve({ port: event.port });
    };
    // A broken build must not leave the benchmark waiting for readiness.
    const timeout = setTimeout(() => {
      fail(new Error(`server did not become ready within 30 seconds\n${stderr}`));
    }, 30_000);
    proc.once("error", onError);
    proc.once("exit", onExit);
    rl.on("line", onLine);
  });
  rl.close();
  return { proc, stderr: () => stderr, ...result };
}

function clientConfig(testCase) {
  const streams = STREAMS / PROCESSES;
  switch (testCase) {
    case "h1":
      return { protocol: "h1", streams, sessions: streams };
    case "h2-single":
      return { protocol: "h2", streams, sessions: streams };
    case "h2-mux":
      return { protocol: "h2", streams, sessions: H2_MUX_SESSIONS / PROCESSES };
    default:
      throw new Error(`unknown CASES entry: ${testCase}`);
  }
}

async function runClient(port, config, payloadSize, signal) {
  const proc = track(
    spawn(CLIENT_RUNTIME, [here + "protocol-client.mjs"], {
      env: {
        ...process.env,
        PORT: String(port),
        PROTOCOL: config.protocol,
        WORKLOAD,
        STREAMS: String(config.streams),
        SESSIONS: String(config.sessions),
        PAYLOAD_SIZE: String(payloadSize),
        WARMUP_MS: String(WARMUP_MS),
        DURATION_MS: String(DURATION_MS),
        H2_STREAM_WINDOW_SIZE: String(H2_STREAM_WINDOW_SIZE),
        H2_CONNECTION_WINDOW_SIZE: String(H2_CONNECTION_WINDOW_SIZE),
      },
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  const abort = () => proc.kill("SIGKILL");
  signal.addEventListener("abort", abort, { once: true });
  // This bounds both protocol failure and client-runtime failure.
  const deadline = setTimeout(() => proc.kill("SIGKILL"), WARMUP_MS + DURATION_MS + 15_000);
  let stdout;
  let stderr;
  let exit;
  try {
    [stdout, stderr, exit] = await Promise.all([
      new Promise(resolve => {
        let output = "";
        proc.stdout.setEncoding("utf8");
        proc.stdout.on("data", chunk => (output += chunk));
        proc.stdout.on("end", () => resolve(output));
      }),
      new Promise(resolve => {
        let output = "";
        proc.stderr.setEncoding("utf8");
        proc.stderr.on("data", chunk => (output += chunk));
        proc.stderr.on("end", () => resolve(output));
      }),
      new Promise((resolve, reject) => {
        proc.once("error", reject);
        proc.once("close", (code, signal) => resolve({ code, signal }));
      }),
    ]);
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  }
  if (exit.code !== 0) throw new Error(`client failed: ${exit.code}/${exit.signal}\n${stderr}\n${stdout}`);
  const line = stdout.trim().split(/\r?\n/).findLast(Boolean);
  if (!line) throw new Error("client produced no result");
  const result = JSON.parse(line);
  for (const field of ["messages", "messagesPerSecond", "payloadMiBPerSecond"]) {
    if (!Number.isFinite(result[field]) || result[field] < 0) {
      throw new Error(`client returned invalid ${field}: ${line}`);
    }
  }
  if (result.messages === 0) throw new Error(`client measured no messages: ${line}`);
  return result;
}

async function stopServer(server) {
  if (server.proc.exitCode !== null) return;
  await new Promise(resolve => {
    const done = () => {
      clearTimeout(deadline);
      resolve();
    };
    const deadline = setTimeout(() => server.proc.kill("SIGKILL"), 2_000);
    server.proc.once("exit", done);
    server.proc.kill("SIGTERM");
  });
}

async function readServerMetrics(port) {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/__websocket_benchmark_metrics__`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`metrics request returned ${response.status}`);
    const metrics = await response.json();
    for (const field of ["rss", "maxRss", "openWebSockets"]) {
      if (!Number.isFinite(metrics[field]) || metrics[field] < 0) {
        throw new Error(`invalid ${field} in server metrics: ${JSON.stringify(metrics)}`);
      }
    }
    return metrics;
  } finally {
    clearTimeout(deadline);
  }
}

async function finalServerMetrics(port) {
  const deadline = performance.now() + 2_000;
  let metrics;
  do {
    metrics = await readServerMetrics(port);
    if (metrics.openWebSockets === 0) return metrics;
    await new Promise(resolve => setTimeout(resolve, 25));
  } while (performance.now() < deadline);
  throw new Error(`${metrics.openWebSockets} WebSocket(s) remained open after the clients exited`);
}

async function runOne(binary, binaryName, testCase, payloadSize, repetition) {
  const config = clientConfig(testCase);
  const server = await startServer(binary);
  try {
    const initialMetrics = await readServerMetrics(server.port);
    const clientsByCycle = [];
    const metricsByCycle = [];
    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      const clientsAbort = new AbortController();
      const clientPromises = Array.from({ length: PROCESSES }, () =>
        runClient(server.port, config, payloadSize, clientsAbort.signal),
      );
      try {
        clientsByCycle.push(await Promise.all(clientPromises));
      } catch (error) {
        clientsAbort.abort();
        await Promise.allSettled(clientPromises);
        throw error;
      }
      metricsByCycle.push(await finalServerMetrics(server.port));
    }
    const clients = clientsByCycle.flat();
    const finalMetrics = metricsByCycle.at(-1);
    const firstCycleRss = metricsByCycle[0].rss;
    const row = {
      binary: binaryName,
      workload: WORKLOAD,
      case: testCase,
      repetition,
      payloadSize,
      streams: STREAMS,
      sessions: config.sessions * PROCESSES,
      cycles: CYCLES,
      h2StreamWindowSize: config.protocol === "h2" ? H2_STREAM_WINDOW_SIZE : undefined,
      h2ConnectionWindowSize: config.protocol === "h2" ? H2_CONNECTION_WINDOW_SIZE : undefined,
      messagesPerSecond: Math.round(clients.reduce((sum, item) => sum + item.messagesPerSecond, 0) / CYCLES),
      payloadMiBPerSecond: Number(
        (clients.reduce((sum, item) => sum + item.payloadMiBPerSecond, 0) / CYCLES).toFixed(2),
      ),
      messages: clients.reduce((sum, item) => sum + item.messages, 0),
      rssStartMiB: Number((initialMetrics.rss / (1024 * 1024)).toFixed(2)),
      rssEndMiB: Number((finalMetrics.rss / (1024 * 1024)).toFixed(2)),
      maxRssMiB: Number((finalMetrics.maxRss / (1024 * 1024)).toFixed(2)),
      rssCycleDeltaMiB: Number(((finalMetrics.rss - firstCycleRss) / (1024 * 1024)).toFixed(2)),
      rssByCycleMiB: metricsByCycle.map(metrics => Number((metrics.rss / (1024 * 1024)).toFixed(2))),
      h1Client: config.protocol === "h1" ? clients[0].h1Client : undefined,
      pipelineDepth: config.protocol === "h1" ? clients[0].pipelineDepth : undefined,
      maxInflightPayloadBytesPerSocket:
        config.protocol === "h1" ? clients[0].maxInflightPayloadBytesPerSocket : undefined,
      clientMessagesPerSecond: clients.map(client => Math.round(client.messagesPerSecond)),
      clientDurationMs: clients.map(client => client.durationMs),
      clientRateSkew:
        Math.max(...clients.map(client => client.messagesPerSecond)) /
        Math.min(...clients.map(client => client.messagesPerSecond)),
    };
    console.log(JSON.stringify(row));
    return row;
  } catch (error) {
    throw new Error(`${binaryName}/${testCase}/${payloadSize}: ${error.message}\nserver stderr:\n${server.stderr()}`);
  } finally {
    await stopServer(server);
  }
}

const binaries = [{ name: "candidate", path: BUN }];
if (BUN_BASELINE) binaries.push({ name: "baseline", path: BUN_BASELINE });
const rows = [];
for (const payloadSize of PAYLOAD_SIZES) {
  for (const testCase of CASES) {
    for (let repetition = 1; repetition <= RUNS; repetition++) {
      // Balance warm-up, temperature, and background-load drift instead of
      // measuring every candidate repetition before every baseline repetition.
      const orderedBinaries = repetition % 2 === 1 ? binaries : binaries.toReversed();
      for (const binary of orderedBinaries) {
        if (binary.name === "baseline" && testCase !== "h1" && !BASELINE_SUPPORTS_H2) continue;
        rows.push(await runOne(binary.path, binary.name, testCase, payloadSize, repetition));
      }
    }
  }
}

const medians = [];
for (const binary of binaries) {
  for (const payloadSize of PAYLOAD_SIZES) {
    for (const testCase of CASES) {
      const samples = rows
        .filter(row => row.binary === binary.name && row.payloadSize === payloadSize && row.case === testCase)
        .sort((a, b) => a.messagesPerSecond - b.messagesPerSecond);
      if (samples.length === 0) continue;
      const median = samples[Math.floor(samples.length / 2)];
      medians.push({
        binary: binary.name,
        case: testCase,
        payload: payloadSize,
        streams: median.streams,
        sessions: median.sessions,
        cycles: median.cycles,
        "messages/s": median.messagesPerSecond,
        "payload MiB/s": median.payloadMiBPerSecond,
        "RSS start MiB": median.rssStartMiB,
        "RSS end MiB": median.rssEndMiB,
        "max RSS MiB": median.maxRssMiB,
        "RSS cycle Δ MiB": median.rssCycleDeltaMiB,
      });
    }
  }
}

console.table(medians);

if (BUN_BASELINE) {
  const paired = [];
  for (const payloadSize of PAYLOAD_SIZES) {
    for (const testCase of CASES) {
      const throughputDeltas = [];
      const rssEndDeltas = [];
      const maxRssDeltas = [];
      for (let repetition = 1; repetition <= RUNS; repetition++) {
        const candidate = rows.find(
          row =>
            row.binary === "candidate" &&
            row.payloadSize === payloadSize &&
            row.case === testCase &&
            row.repetition === repetition,
        );
        const baseline = rows.find(
          row =>
            row.binary === "baseline" &&
            row.payloadSize === payloadSize &&
            row.case === testCase &&
            row.repetition === repetition,
        );
        if (candidate && baseline) {
          throughputDeltas.push((candidate.messagesPerSecond / baseline.messagesPerSecond - 1) * 100);
          rssEndDeltas.push(candidate.rssEndMiB - baseline.rssEndMiB);
          maxRssDeltas.push(candidate.maxRssMiB - baseline.maxRssMiB);
        }
      }
      throughputDeltas.sort((a, b) => a - b);
      rssEndDeltas.sort((a, b) => a - b);
      maxRssDeltas.sort((a, b) => a - b);
      if (throughputDeltas.length === 0) continue;
      const middle = Math.floor(throughputDeltas.length / 2);
      paired.push({
        case: testCase,
        payload: payloadSize,
        pairs: throughputDeltas.length,
        "median speed Δ %": Number(throughputDeltas[middle].toFixed(2)),
        "min speed Δ %": Number(throughputDeltas[0].toFixed(2)),
        "max speed Δ %": Number(throughputDeltas.at(-1).toFixed(2)),
        "median RSS end Δ MiB": Number(rssEndDeltas[middle].toFixed(2)),
        "median max RSS Δ MiB": Number(maxRssDeltas[middle].toFixed(2)),
      });
    }
  }
  console.table(paired);
}
