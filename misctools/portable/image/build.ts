// Driver for the portable-image build of bun in /tmp/portable/bun-tree.
//
//   bun /tmp/portable/m4/build.ts <log-name> [args for scripts/build.ts...]
//
// Runs, confined to 8 CPUs of this container and with at most 8 ninja jobs:
//   bun scripts/build.ts --profile=portable -j8 <args>
// and writes everything the build prints to /tmp/portable/m4/logs/<log-name>.log (also to stdout).
// The exit code is the build's. `<log-name>.exit` holds it once the build has ended, so that a
// build started in the background can be waited for.
import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const tree = "/tmp/portable/bun-tree";
const m4 = "/tmp/portable/m4";
const logs = join(m4, "logs");

export const env: Record<string, string> = {
  // WebKit source for --webkit=local (oven-sh/WebKit at the commit scripts/build/deps/webkit.ts pins)
  BUN_WEBKIT_PATH: join(m4, "WebKit"),
  // tarballs, ccache and the pinned ninja of this build only
  BUN_BUILD_CACHE_DIR: join(m4, "cache"),
  // musl + libc++ + compiler-rt + ICU compiled with the image's ABI flags, plus usr/lib/portable-memfn
  BUN_PORTABLE_SYSROOT: join(m4, "sysroot"),
  // A release build bakes HEAD into bun_core; commits in the worktree would rebuild every crate.
  GIT_SHA: "f063852e52e6e391e4cb9f9e10053e2f09fa135b",
  // the nested cmake build of WebKit
  CMAKE_BUILD_PARALLEL_LEVEL: "8",
};

function allowedCpus(): string {
  // The first 8 CPUs this process may run on.
  const status = readFileSync("/proc/self/status", "utf8");
  const list = /^Cpus_allowed_list:\s*(\S+)/m.exec(status)?.[1] ?? "0-7";
  const cpus: number[] = [];
  for (const part of list.split(",")) {
    const [a, b] = part.split("-").map(Number);
    for (let c = a!; c <= (b ?? a!); c++) cpus.push(c);
  }
  return cpus.slice(0, 8).join(",");
}

if (import.meta.main) {
  const [name, ...args] = process.argv.slice(2);
  if (name === undefined || name.startsWith("-")) {
    console.error("usage: bun build.ts <log-name> [args for scripts/build.ts...]");
    process.exit(2);
  }
  mkdirSync(logs, { recursive: true });
  const logPath = join(logs, `${name}.log`);
  const exitPath = join(logs, `${name}.exit`);
  rmSync(exitPath, { force: true });
  const log = createWriteStream(logPath);
  const argv = ["-c", allowedCpus(), "bun", "scripts/build.ts", "--profile=portable", "-j8", ...args];
  const started = Date.now();
  log.write(`# cwd: ${tree}\n# env: ${JSON.stringify(env)}\n# taskset ${argv.join(" ")}\n`);
  const child = spawn("taskset", argv, {
    cwd: tree,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk: Buffer) => {
      log.write(chunk);
      process.stdout.write(chunk);
    });
  }
  child.on("exit", (code, signal) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    const line = `# exit ${code ?? signal} after ${seconds}s\n`;
    process.stdout.write(line);
    // The exit file is written after the log is complete on disk: whoever waits for it can read the whole log.
    log.end(line, () => {
      writeFileSync(exitPath, `${code ?? signal}\n`);
      process.exit(code ?? 1);
    });
  });
}
