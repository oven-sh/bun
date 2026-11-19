// Linux only. Needs wrk, cc and taskset; --syscalls also needs perf and passwordless sudo.
//
//   bun run.ts --out results.json [--reps 9] [--seconds 5] [--only hello,ws] [--spin] [--syscalls] \
//     level=/path/to/bun edge=/path/to/bun:BUN_USOCKETS_TRIGGER=edge
//
// Each rep starts a fresh server per variant and rotates their order, so drift on the machine hits all of them alike.
// The first variant is the one the others are compared against.
//
// On a VM, where the host puts the vCPUs moves req/s by tens of percent. Sharing one CPU takes that out, and leaves
// cpuUsPerRequest as the number to read: --server-cpus 2 --upstream-cpus 2 --client-cpus 2 --threads 1
//
// With the client on other CPUs, pass --spin. Over loopback the server's send() pays for waking a client thread, and how
// often those sleep depends on the order the server answers in, which is not the same for level and edge.
//
// The churn scenarios fill up nf_conntrack where it is loaded. A network namespace (unshare -n) has none.
// wrk does not time the TLS handshake, where connections can wait for seconds, so tls churn's p50 and p99 say little.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string" },
    reps: { type: "string", default: "9" },
    seconds: { type: "string", default: "5" },
    warmup: { type: "string", default: "2" },
    only: { type: "string" },
    threads: { type: "string" },
    spin: { type: "boolean", default: false },
    syscalls: { type: "boolean", default: false },
    perf: { type: "string", default: "perf" },
    "server-cpus": { type: "string", default: "2-3" },
    "upstream-cpus": { type: "string", default: "5-6" },
    "client-cpus": { type: "string", default: "8-11" },
  },
});

const variants = positionals.map(spec => {
  const [, name, exe, env] = spec.match(/^([^=]+)=([^:]+)(?::(.*))?$/)!;
  return { name, exe, env: Object.fromEntries((env?.split(",") ?? []).map(pair => pair.split("="))) };
});

type Scenario = {
  name: string;
  server?: "http" | "https" | "node";
  connections: number;
  threads?: number;
  path?: string;
  close?: boolean;
  body?: number;
  pipeline?: number;
  rate?: number;
  ws?: boolean;
  idle?: number;
  upstream?: boolean;
  /** Unmeasured load on the same server. The per-request numbers include what it costs. */
  background?: Scenario;
};

const MB = 1024 * 1024;
const scenarios: Scenario[] = [
  { name: "hello c=1", path: "/hello", connections: 1 },
  { name: "hello c=16", path: "/hello", connections: 16 },
  { name: "hello c=256", path: "/hello", connections: 256 },
  { name: "hello c=4096", path: "/hello", connections: 4096 },
  { name: "idle 10k + hello c=256", path: "/hello", connections: 256, idle: 10_000 },
  { name: "static c=256", path: "/static", connections: 256 },
  { name: "json c=256", path: "/json", connections: 256 },
  { name: "async c=256", path: "/async", connections: 256 },
  { name: "pipeline x16 c=64", path: "/static", connections: 64, pipeline: 16 },
  { name: "rate 5k/s", connections: 64, rate: 5_000 },
  { name: "rate 30k/s", connections: 64, rate: 30_000 },
  { name: "churn c=64", path: "/hello", connections: 64, threads: 4, close: true },
  { name: "tls hello c=256", server: "https", path: "/hello", connections: 256 },
  { name: "tls churn c=64", server: "https", path: "/hello", connections: 64, threads: 4, close: true },
  { name: "tls 8m c=16", server: "https", path: "/8m", connections: 16, threads: 4 },
  { name: "down 64k c=64", path: "/64k", connections: 64, threads: 4 },
  { name: "down 1m c=64", path: "/1m", connections: 64, threads: 4 },
  { name: "down 8m c=16", path: "/8m", connections: 16, threads: 4 },
  { name: "sendfile 8m c=16", path: "/file", connections: 16, threads: 4 },
  { name: "stream 4m c=16", path: "/stream", connections: 16, threads: 4 },
  { name: "upload 1m c=64", path: "/upload", connections: 64, threads: 4, body: MB },
  { name: "upload-slow 8m c=16", path: "/upload-slow", connections: 16, threads: 4, body: 8 * MB },
  {
    name: "mixed 200/s + uploads",
    connections: 64,
    rate: 200,
    background: { name: "", path: "/upload", connections: 64, body: MB },
  },
  {
    name: "mixed 200/s + big uploads",
    connections: 64,
    rate: 200,
    background: { name: "", path: "/discard", connections: 64, body: 16 * MB },
  },
  { name: "ws echo c=256", ws: true, connections: 256 },
  { name: "proxy fetch c=64", path: "/proxy", connections: 64, upstream: true },
  { name: "node:http c=256", server: "node", path: "/", connections: 256 },
].filter(
  scenario =>
    !options.only ||
    options.only.split(",").some(name => scenario.name === name || scenario.name.startsWith(name + " ")),
) as Scenario[];

// BUN_OPTIONS=--smol in the shell, say, would change what is measured.
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("BUN_")));

const work = mkdtempSync(join(tmpdir(), "event-loop-trigger-"));
const load = join(work, "load");
const spin = join(work, "spin.so");
const file = join(work, "8m.bin");
writeFileSync(file, Buffer.alloc(8 * MB, "x"));
await Bun.$`cc -O2 -pthread ${join(import.meta.dir, "load.c")} -o ${load}`;
await Bun.$`cc -O2 -shared -fPIC ${join(import.meta.dir, "spin.c")} -o ${spin}`;

async function firstLine(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  let text = "";
  while (!text.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) throw new Error("exited before printing a line");
    text += Buffer.from(value).toString();
  }
  reader.releaseLock();
  return text.trim();
}

async function startServer(exe: string, kind: string, cpus: string, env: Record<string, string>) {
  const proc = Bun.spawn({
    cmd: ["taskset", "-c", cpus, exe, join(import.meta.dir, "server.ts"), kind],
    env: { ...cleanEnv, BENCH_FILE: file, ...env },
    stdout: "pipe",
    stderr: "inherit",
  });
  return { proc, port: Number(await firstLine(proc.stdout)) };
}

function startClient(scenario: Scenario, port: number, seconds: string) {
  const threads = String(Math.min(scenario.connections, Number(options.threads ?? scenario.threads ?? 2)));
  const connections = String(scenario.connections);
  let cmd: string[];
  if (scenario.ws) {
    cmd = [load, "ws", String(port), connections, threads, seconds];
  } else if (scenario.rate) {
    cmd = [load, "rate", String(port), connections, threads, seconds, String(scenario.rate)];
  } else {
    cmd = ["wrk", "-t", threads, "-c", connections, "-d", `${seconds}s`, "--timeout", "10s"];
    cmd.push("-s", join(import.meta.dir, "report.lua"));
    if (scenario.close) cmd.push("-H", "Connection: close");
    cmd.push(`${scenario.server === "https" ? "https" : "http"}://127.0.0.1:${port}${scenario.path}`);
  }
  const env: Record<string, string | undefined> = { ...cleanEnv };
  if (options.spin) env.LD_PRELOAD = spin;
  if (scenario.body) env.BODY_BYTES = String(scenario.body);
  if (scenario.close) env.CLOSES = "1";
  if (scenario.pipeline) env.PIPELINE = String(scenario.pipeline);
  return Bun.spawn({ cmd: ["taskset", "-c", options["client-cpus"], ...cmd], env, stdout: "pipe" });
}

async function drive(scenario: Scenario, port: number, seconds: string) {
  const proc = startClient(scenario, port, seconds);
  const text = await proc.stdout.text();
  if ((await proc.exited) !== 0) throw new Error(`the client failed: ${text}`);
  return JSON.parse(text.trim().split("\n").at(-1)!) as Record<
    "requests" | "seconds" | "mean" | "p50" | "p99" | "errors",
    number
  >;
}

function sample(pid: number) {
  let cpuNs = 0;
  let switches = 0;
  for (const tid of readdirSync(`/proc/${pid}/task`)) {
    try {
      const [ns, , slices] = readFileSync(`/proc/${pid}/task/${tid}/schedstat`, "utf8").split(" ").map(Number);
      cpuNs += ns;
      switches += slices;
    } catch {} // the thread exited
  }
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].split(" ").map(Number);
  const status = readFileSync(`/proc/${pid}/status`, "utf8");
  const kb = (key: string) => Number(status.match(new RegExp(`${key}:\\s+(\\d+)`))![1]);
  return {
    at: performance.now(),
    cpuNs,
    switches,
    user: stat[11],
    system: stat[12],
    rss: kb("VmRSS") / 1024,
    anon: kb("RssAnon") / 1024,
    peak: kb("VmHWM") / 1024,
  };
}

const tracked = ["epoll_pwait2", "epoll_ctl", "recvfrom", "sendto", "sendmsg", "sendfile64", "accept4"];

async function countSyscalls(pid: number, seconds: string) {
  const events = [...tracked.map(name => `syscalls:sys_enter_${name}`), "raw_syscalls:sys_enter"].join(",");
  const { stderr } =
    await Bun.$`sudo ${options.perf} stat -x, -e ${events} -p ${pid} -- sleep ${Number(seconds) + 0.5}`.quiet();
  return Object.fromEntries(
    [...stderr.toString().matchAll(/^(\d+),,\w+:sys_enter_?(\w*)/gm)].map(([, count, name]) => [
      name || "total",
      Number(count),
    ]),
  );
}

async function measure(scenario: Scenario, variant: (typeof variants)[number]) {
  const children: Bun.Subprocess[] = [];
  try {
    const env = { ...variant.env };
    if (scenario.upstream) {
      const upstream = await startServer(variants[0].exe, "http", options["upstream-cpus"], variants[0].env);
      children.push(upstream.proc);
      env.BENCH_UPSTREAM = `http://127.0.0.1:${upstream.port}/static`;
    }
    const { proc, port } = await startServer(variant.exe, scenario.server ?? "http", options["server-cpus"], env);
    children.push(proc);
    if (scenario.idle) {
      const idle = Bun.spawn({ cmd: [load, "idle", String(port), String(scenario.idle)], stdout: "pipe" });
      children.push(idle);
      await firstLine(idle.stdout);
    }
    if (scenario.background) children.push(startClient(scenario.background, port, "3600"));
    await drive(scenario, port, options.warmup);

    const samples: ReturnType<typeof sample>[] = [];
    const sampler = setInterval(() => samples.push(sample(proc.pid)), 250);
    const syscalls = options.syscalls ? countSyscalls(proc.pid, options.seconds) : undefined;
    if (syscalls) await Bun.sleep(200); // perf has to attach first
    const before = sample(proc.pid);
    const result = await drive(scenario, port, options.seconds);
    const after = sample(proc.pid);
    clearInterval(sampler);

    const cpuSeconds = (after.cpuNs - before.cpuNs) / 1e9;
    const ticks = after.user + after.system - before.user - before.system;
    const row: Record<string, number> = {
      rps: result.requests / result.seconds,
      cpuPercent: (cpuSeconds / ((after.at - before.at) / 1000)) * 100,
      cpuUsPerRequest: (cpuSeconds * 1e6) / result.requests,
      systemShare: ((after.system - before.system) / ticks) * 100,
      rssAvg: samples.reduce((sum, { rss }) => sum + rss, 0) / samples.length,
      rssAnonAvg: samples.reduce((sum, { anon }) => sum + anon, 0) / samples.length,
      rssPeak: after.peak,
      p50: result.p50,
      p99: result.p99,
      switchesPerRequest: (after.switches - before.switches) / result.requests,
      // Little's law. A connection that hangs is no error to wrk, but it is missing from this.
      inFlight: (result.requests / result.seconds) * (result.mean / 1e6),
      errors: result.errors,
    };
    for (const [name, count] of Object.entries((await syscalls) ?? {})) row[`sys.${name}`] = count / result.requests;
    return row;
  } finally {
    for (const child of children) child.kill("SIGKILL");
    await Promise.all(children.map(child => child.exited));
  }
}

const median = (values: number[]) => {
  const sorted = values.toSorted((a, b) => a - b);
  return (sorted[(sorted.length - 1) >> 1] + sorted[sorted.length >> 1]) / 2;
};

/** Median of the per-rep change against the first variant and its bootstrapped 95% interval, in percent. */
function pairedChange(values: number[], base: number[]) {
  const changes = values.map((value, rep) => (value / base[rep] - 1) * 100);
  const medians = Array.from({ length: 5000 }, () =>
    median(changes.map(() => changes[Math.floor(Math.random() * changes.length)])),
  ).sort((a, b) => a - b);
  const signed = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
  return `${signed(median(changes))}% [${signed(medians[125])}, ${signed(medians[4874])}]`;
}

const results: Record<string, Record<string, Record<string, number>[]>> = {};
try {
  for (const scenario of scenarios) {
    const byVariant = (results[scenario.name] = Object.fromEntries(variants.map(({ name }) => [name, []])));
    for (let rep = 0; rep < Number(options.reps); rep++) {
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[(i + rep) % variants.length];
        byVariant[variant.name].push(await measure(scenario, variant));
      }
    }

    const column = (name: string, key: string) => byVariant[name].map(row => row[key]);
    console.log(`\n${scenario.name}`);
    console.table(
      Object.fromEntries(
        variants.map(({ name }, i) => {
          const row: Record<string, string | number> = {};
          for (const key of Object.keys(byVariant[name][0])) {
            const value = median(column(name, key));
            row[key] = Number(value.toFixed(value >= 1000 ? 0 : value >= 10 ? 1 : 3));
            if (key === "rps" || key === "cpuUsPerRequest") {
              row[`Δ${key}`] = i ? pairedChange(column(name, key), column(variants[0].name, key)) : "";
            }
          }
          return [name, row];
        }),
      ),
    );
    if (options.out) writeFileSync(options.out, JSON.stringify(results, null, 1));
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
