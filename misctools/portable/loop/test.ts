// Runs the loop slice on this Linux machine, each way it can run here, and checks what it prints.
//
//   bun test.ts [--runs 3]      after build.ts. WORK as in build.ts.
//
//   direct        the kernel runs the image
//   hosted        the Linux test host (../host/host_posix.c) maps the image and serves its requests.
//                 The children of the program are the host with the image, started by the image.
//   as win32      BUN_PORTABLE_HOST_OS=win32 makes the image take its code for Windows, on Linux: its
//                 first call of Windows or of libuv has to stop it with a message
//   imports       the import table has the functions of libuv, of Winsock and of kernel32 that bun's
//                 event loop for Windows calls, from Rust and from C, and none of them resolves on Linux
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const tree = resolve(here, "..");
const work = resolve(process.env.WORK ?? "/tmp/portable/n2");
const runs = Number(process.argv.includes("--runs") ? process.argv[process.argv.indexOf("--runs") + 1] : 3);
const image = join(work, "out/bun_loop_slice.img");
const host = join(work, "out/host-linux");
const directory = join(work, "run");
mkdirSync(directory, { recursive: true });

const compiled = Bun.spawnSync(["cc", "-O2", "-Wall", "-Wextra", "-Wno-unused-parameter", "-o", host, join(tree, "host/host_posix.c"), "-lpthread"], { stderr: "inherit" });
if (compiled.exitCode !== 0 || !existsSync(image)) throw new Error("the host does not compile, or build.ts has not made the image");

const expected = readFileSync(join(here, "expected/linux.jsonl"), "utf8");
function run(command: string[], env: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, { cwd: directory, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe", timeout: 120_000 });
  return { code: result.exitCode, signal: result.signalCode, out: result.stdout.toString(), err: result.stderr.toString() };
}
const results: { test: string; passes: number; runs: number; note?: string }[] = [];
function check(test: string, once: () => string | undefined) {
  let passes = 0;
  let note: string | undefined;
  for (let i = 0; i < runs; i++) {
    const problem = once();
    if (problem === undefined) passes++;
    else note = problem;
  }
  results.push({ test, passes, runs, note });
}
const steps = (out: string) => out.split("\n").filter(Boolean).map(line => JSON.parse(line));
const asExpected = (r: ReturnType<typeof run>) => {
  if (r.code === 0 && r.out === expected) return undefined;
  const failed = steps(r.out).filter(step => step.ok !== true).map(step => step.step);
  return `exit code ${r.code}, signal ${r.signal}, ${steps(r.out).length} lines, not ok: ${JSON.stringify(failed)}, stderr: ${r.err.slice(0, 300)}`;
};

check("direct", () => asExpected(run([image])));
check("hosted", () => asExpected(run([host, image])));
check("as win32: takes the code for Windows and stops at its first call of Windows", () => {
  const r = run([image], { BUN_PORTABLE_HOST_OS: "win32" });
  const lines = steps(r.out);
  // bun_core takes the standard streams the way it does on Windows before the program prints anything.
  const tookWindows = lines.length === 0 || (lines.length === 1 && lines[0].os === "win32" && lines[0].code === "windows");
  return r.code !== 0 && tookWindows && / is a function of Windows, and this host is Linux/.test(r.err)
    ? undefined
    : `exit code ${r.code}: ${r.out} ${r.err.slice(0, 300)}`;
});
check("imports", () => {
  const r = run([host, image, "--imports"]);
  const lines = steps(r.out);
  const summary = lines.pop();
  const has = (library: string, symbol: string) => lines.some(line => line.library === library && line.symbol === symbol);
  const needed: [string, string][] = [
    ["libuv", "uv_run"], ["libuv", "uv_loop_new"], ["libuv", "uv_poll_init_socket"], ["libuv", "uv_poll_start"], ["libuv", "uv_timer_start"],
    ["libuv", "uv_async_send"], ["libuv", "uv_prepare_start"], ["libuv", "uv_check_start"], ["libuv", "uv_close"],
    ["libuv", "uv_spawn"], ["libuv", "uv_process_kill"], ["libuv", "uv_pipe_init"], ["libuv", "uv_read_start"], ["libuv", "uv_write"],
    ["ws2_32", "WSASocketW"], ["ws2_32", "bind"], ["ws2_32", "listen"], ["ws2_32", "accept"], ["ws2_32", "connect"], ["ws2_32", "recv"],
    ["ws2_32", "send"], ["ws2_32", "closesocket"], ["ws2_32", "WSAGetLastError"],
  ];
  const absent = needed.filter(([library, symbol]) => !has(library, symbol));
  return r.code === 1 && summary?.total === summary?.missing && summary.total > 100 && absent.length === 0 ? undefined : `exit code ${r.code}, ${JSON.stringify(summary)}, not in the table: ${JSON.stringify(absent)}`;
});

for (const result of results) console.log(JSON.stringify(result));
process.exit(results.every(result => result.passes === result.runs) ? 0 : 1);
