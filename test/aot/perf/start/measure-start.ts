import { dlopen, FFIType, ptr } from "bun:ffi";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { withSteadyCollections } from "../../harness/counted-run";

export type Start = {
  thousandInstructions?: number;
  pageFaults?: number;
  systemCalls?: number;
  privateKilobytes?: number;
};
export type Until = { prints: string } | { route: string; answers: string };

const killAfterMilliseconds = 60_000;
const strace = Bun.which("strace");

export const startEnvironment = {
  PATH: "/usr/bin:/bin",
  HOME: "/",
  TZ: "UTC",
  LANG: "C.UTF-8",
  NODE_ENV: "production",
  NO_COLOR: "1",
  DO_NOT_TRACK: "1",
  BUN_ENABLE_CRASH_REPORTING: "0",
  WTF_numberOfProcessorCores: "4",
  PORT: "0",
  ...withSteadyCollections,
};

function openLibc() {
  return dlopen("libc.so.6", {
    syscall: { args: [FFIType.i64, FFIType.ptr, FFIType.i64, FFIType.i64, FFIType.i64, FFIType.u64], returns: FFIType.i64 },
    read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
  }).symbols;
}
type Libc = ReturnType<typeof openLibc>;

const hardware = 0,
  software = 1,
  instructions = 1n,
  pageFaults = 2n;

function openCounter({ syscall }: Libc, pid: number, type: number, config: bigint, threads: "first" | "all") {
  const SYS_perf_event_open = process.arch === "arm64" ? 241 : 298,
    sizeofAttr = 128;
  const disabled = 1n << 0n,
    inherit = 1n << 1n,
    exclude_kernel = 1n << 5n,
    exclude_hv = 1n << 6n,
    enable_on_exec = 1n << 12n;
  const attr = new BigUint64Array(sizeofAttr / 8);
  new Uint32Array(attr.buffer).set([type, sizeofAttr]);
  attr[1] = config;
  attr[5] = disabled | exclude_kernel | exclude_hv | enable_on_exec | (threads === "all" ? inherit : 0n);
  return Number(syscall(SYS_perf_event_open, ptr(attr), pid, -1, -1, 0));
}

function readAndClose({ read, close }: Libc, counter: number) {
  if (counter < 0) return undefined;
  const value = new BigUint64Array(1);
  const bytesRead = Number(read(counter, ptr(value), 8));
  close(counter);
  return bytesRead === 8 ? Number(value[0]) : undefined;
}

function readMemory(pid: number) {
  let privateKilobytes = 0;
  for (const line of readFileSync(`/proc/${pid}/smaps`, "utf8").split("\n")) {
    if (line.startsWith("Anonymous:")) privateKilobytes += parseInt(line.slice(10));
  }
  return { privateKilobytes };
}

async function untilReached(child: Bun.Subprocess<"pipe" | "ignore", "pipe", "pipe">, command: string[], until: Until) {
  let output = "";
  const failed = async (what: string) => new Error(`${command.join(" ")}: ${what}\n${output}${await child.stderr.text()}`);
  for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
    output += chunk;
    if ("prints" in until) continue;
    const port = /^listening (\d+)$/m.exec(output)?.[1];
    if (!port) continue;
    const response = await fetch(`http://127.0.0.1:${port}${until.route}`);
    const answer = await response.text();
    if (response.status !== 200 || answer !== until.answers) throw await failed(`answered ${response.status} ${JSON.stringify(answer)}`);
    return;
  }
  const exitCode = await child.exited;
  if (!("prints" in until)) throw await failed(`exited with code ${exitCode} before it listened`);
  if (exitCode !== 0 || output !== until.prints) throw await failed(`exit code ${exitCode}, signal ${child.signalCode}`);
}

async function countedStart(libc: Libc, command: string[], until: Until): Promise<Start> {
  const child = Bun.spawn({
    cmd: ["/bin/sh", "-c", 'read line; exec "$0" "$@"', ...command],
    cwd: "/",
    env: startEnvironment,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    timeout: killAfterMilliseconds,
    killSignal: "SIGKILL",
  });
  const counters = [openCounter(libc, child.pid, hardware, instructions, "first"), openCounter(libc, child.pid, software, pageFaults, "all")];
  try {
    child.stdin.write("\n");
    child.stdin.end();
    await untilReached(child, command, until);
    if ("route" in until) child.kill("SIGSTOP");
    const [counted, faults] = counters.splice(0).map(counter => readAndClose(libc, counter));
    return {
      thousandInstructions: counted === undefined ? undefined : Math.round(counted / 1000),
      pageFaults: faults,
      ...("route" in until ? readMemory(child.pid) : {}),
    };
  } finally {
    for (const counter of counters) readAndClose(libc, counter);
    child.kill("SIGKILL");
    await child.exited;
  }
}

function killTracedProcess(log: string) {
  const pid = existsSync(log) ? /^\d+/.exec(readFileSync(log, "utf8"))?.[0] : undefined;
  if (!pid) return;
  try {
    process.kill(Number(pid), "SIGKILL");
  } catch {}
}

async function countSystemCalls(command: string[], until: Until, log: string) {
  if (!strace) return undefined;
  const child = Bun.spawn({
    cmd: [strace, "-f", "-qq", "-o", log, ...command],
    cwd: "/",
    env: startEnvironment,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: killAfterMilliseconds,
    killSignal: "SIGKILL",
  });
  const timer = setTimeout(killTracedProcess, killAfterMilliseconds - 1000, log);
  try {
    await untilReached(child, command, until);
    const lines = readFileSync(log, "utf8").split("\n");
    const firstThread = /^\d+/.exec(lines[0])?.[0];
    const calls = lines.filter(line => /^\d+\s+[a-z_0-9]+\(/.test(line) && line.startsWith(`${firstThread} `));
    return calls.length - 1;
  } finally {
    clearTimeout(timer);
    if ("route" in until) killTracedProcess(log);
    child.kill("SIGKILL");
    await child.exited;
    rmSync(log, { force: true });
  }
}

export async function measureStart(command: string[], until: Until, runs: number): Promise<Start> {
  const libc = openLibc();
  const least: Start = {};
  for (let run = 0; run < runs; run++) {
    const start = await countedStart(libc, command, until);
    for (const [name, value] of Object.entries(start) as [keyof Start, number | undefined][]) {
      if (value !== undefined) least[name] = Math.min(value, least[name] ?? Infinity);
    }
  }
  for (let run = 0; run < 3; run++) {
    const systemCalls = await countSystemCalls(command, until, `${command[0]}.strace`);
    if (systemCalls !== undefined) least.systemCalls = Math.min(systemCalls, least.systemCalls ?? Infinity);
  }
  return least;
}
