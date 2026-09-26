/**
 * Runs the tests of one architecture, each of them several times.
 *
 * Prints one line for each test, "<name>: <passes> of <runs>". A test passes with its exit code (42 where
 * nothing else is said) and the expected line of output. An image of another architecture than this machine
 * runs under the emulator, and so does its host.
 *
 * The aarch64 tests also run copies of the image and of the host in which instructions are replaced
 * (test/rewrite_insn.ts):
 *   - traps in place of the instructions that the mode under test must not run
 *   - "must fail" runs, which show that those traps and the x18 reload are real
 * The x86_64 host ends the process when code outside of the host issues a syscall (seccomp), so every hosted
 * x86_64 run that passes issued none. The "must fail" run of raw_syscall.img shows that the filter is real.
 * The hosted x86_64 tests run three times: as they are, with the memory model of the Windows host
 * (BUN_HOST_TEST=winmem) and with MADV_DONTNEED done the way of the macOS branch (BUN_HOST_TEST=overlay).
 */

import { chmodSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";
import { TREE } from "../flags.ts";
import { rewrite } from "../test/rewrite_insn.ts";
import { check } from "./check.ts";
import { type Context, inOut } from "./context.ts";
import { hostName } from "./images.ts";
import { BuildError } from "./run.ts";

const THREADS =
  /^m2: threads=8 total=204263652 thread_locals_ok=8\/8 main_tls=unset file_roundtrip=1 wall_year_ok=1 pid_ok=1 /m;
const PATHS = "vfork=1 signal=1 cancel=1 main_tls=7 stack=1 mask=1 thread_signal=1 fault=1 maperr=1 tls_align=1";
const linuxPaths = (mode: string) => new RegExp(`^linux_paths: mode=${mode} ${PATHS}`, "m");
const requests = (mode: string) => new RegExp(`^requests: mode=${mode} checks=[0-9]* failures=0`, "m");
const RAW_SYSCALL = /^raw_syscall: the kernel answered/m;

/** A run that no test needs longer than. One that hangs is a failure, not the end of the tests. */
const TIME_LIMIT_MS = 600_000;

export interface Tally {
  name: string;
  runs: number;
  passes: number;
}

/** The exit code the way a shell reports it: 128 + the number of the signal that ended the process. */
function statusOf(exitCode: number | null, signal: NodeJS.Signals | number | null): number {
  if (exitCode !== null) return exitCode;
  if (typeof signal === "number") return 128 + signal;
  return 128 + (signal !== null ? (constants.signals[signal] ?? 0) : 0);
}

export async function test(ctx: Context, runs: number): Promise<boolean> {
  if (ctx.emulator !== undefined && Bun.which(ctx.emulator) === null) {
    throw new BuildError(
      `the images are for ${ctx.arch}, this machine runs them under ${ctx.emulator}, which is not in PATH`,
    );
  }
  const tallies: Tally[] = [];
  const emulator = ctx.emulator !== undefined ? [ctx.emulator] : [];
  const host = inOut(ctx, hostName());
  const image = (name: string) => inOut(ctx, `${name}.img`);
  const probe = inOut(ctx, "probe.tmp");
  const requestsFile = inOut(ctx, "requests.tmp");
  // Where the tests run. What a crash leaves behind (the emulator writes a core file) goes away with it.
  const scratch = inOut(ctx, "test-runs");
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });

  /** Runs `cmd` `runs` times. A run passes with the exit code `want` and output that `pattern` matches. */
  const expect = async (
    want: number,
    pattern: RegExp,
    name: string,
    cmd: string[],
    env: Record<string, string> = {},
  ) => {
    let passes = 0;
    for (let i = 1; i <= runs; i++) {
      const proc = Bun.spawn(cmd, {
        cwd: scratch,
        env: { ...process.env, ...env },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      const timer = setTimeout(() => proc.kill("SIGKILL"), TIME_LIMIT_MS);
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      clearTimeout(timer);
      const status = statusOf(proc.exitCode, proc.signalCode);
      const output = stdout + stderr;
      if (status === want && pattern.test(output)) {
        passes++;
      } else {
        console.log(`  ${name}: run ${i}: exit code ${status}, wanted ${want}. Output:`);
        for (const line of output.trimEnd().split("\n")) console.log(`    ${line}`);
      }
    }
    console.log(`${name}: ${passes} of ${runs}`);
    tallies.push({ name, runs, passes });
  };

  const arch = ctx.arch;
  await expect(42, /^memory_model: .* 0 failures/m, "memory model (host/memory.h) against a page by page description", [
    inOut(ctx, "memory_model"),
    "100000",
    String(process.pid),
  ]);
  await expect(42, THREADS, `${arch} threads direct`, [...emulator, image("threads"), probe]);
  await expect(42, THREADS, `${arch} threads hosted`, [...emulator, host, image("threads"), probe]);
  await expect(42, linuxPaths("direct"), `${arch} linux_paths direct`, [...emulator, image("linux_paths"), "direct"]);
  await expect(42, requests("direct"), `${arch} requests direct`, [
    ...emulator,
    image("requests"),
    "direct",
    requestsFile,
  ]);

  let checked = await check(ctx, false);

  if (arch === "x86_64") {
    const hosted = [...emulator, host];
    await expect(42, linuxPaths("hosted-signals"), "x86_64 linux_paths hosted", [
      ...hosted,
      image("linux_paths"),
      "hosted-signals",
    ]);
    await expect(42, requests("hosted"), "x86_64 requests hosted", [
      ...hosted,
      image("requests"),
      "hosted",
      requestsFile,
    ]);
    for (const way of ["winmem", "overlay"]) {
      const env = { BUN_HOST_TEST: way };
      await expect(
        42,
        requests("hosted"),
        `x86_64 requests hosted, ${way}`,
        [...hosted, image("requests"), "hosted", requestsFile],
        env,
      );
      await expect(42, THREADS, `x86_64 threads hosted, ${way}`, [...hosted, image("threads"), probe], env);
      await expect(
        42,
        linuxPaths("hosted-signals"),
        `x86_64 linux_paths hosted, ${way}`,
        [...hosted, image("linux_paths"), "hosted-signals"],
        env,
      );
    }
    await expect(42, RAW_SYSCALL, "x86_64 raw_syscall direct", [...emulator, image("raw_syscall")]);
    await expect(
      99,
      /^host: the image issued syscall 39 itself, at image offset/m,
      "x86_64 must fail: hosted, image that issues a syscall itself",
      [...hosted, image("raw_syscall")],
    );
    await expect(
      42,
      RAW_SYSCALL,
      "x86_64 control: the same without the filter of the host",
      [...hosted, image("raw_syscall")],
      {
        BUN_HOST_SECCOMP: "0",
      },
    );
  }

  if (arch === "aarch64") {
    const hosted = [...emulator, host];
    await expect(42, requests("hosted-quiet"), "aarch64 requests hosted", [
      ...hosted,
      image("requests"),
      "hosted-quiet",
      requestsFile,
    ]);

    const variants = inOut(ctx, "variants");
    mkdirSync(variants, { recursive: true });
    const variant = (from: string, name: string, rules: string[]) => {
      const to = join(variants, name);
      rewrite(from, to, rules);
      chmodSync(to, 0o755);
      return to;
    };
    const threadsLinuxOnly = variant(image("threads"), "threads.linux-only.img", ["no-x18", "no-tpidrro"]);
    const threadsX18Only = variant(image("threads"), "threads.x18-only.img", ["no-svc", "no-tpidr", "no-tpidrro"]);
    const pathsLinuxOnly = variant(image("linux_paths"), "linux_paths.linux-only.img", ["no-x18", "no-tpidrro"]);
    const pathsX18Only = variant(image("linux_paths"), "linux_paths.x18-only.img", [
      "no-svc",
      "no-tpidr",
      "no-tpidrro",
    ]);
    const pathsTpidrroOnly = variant(image("linux_paths"), "linux_paths.tpidrro-only.img", [
      "no-svc",
      "no-tpidr",
      "no-x18",
    ]);
    const hostNoReload = variant(host, "host-linux.no-x18-reload", ["no-x18-reload"]);
    const macos = { BUN_HOST_TEST: "macos-tp" };

    await expect(42, THREADS, "aarch64 threads direct, traps on the x18 and tpidrro_el0 paths", [
      ...emulator,
      threadsLinuxOnly,
      probe,
    ]);
    await expect(42, THREADS, "aarch64 threads hosted (x18), traps on svc, tpidr_el0, tpidrro_el0", [
      ...hosted,
      threadsX18Only,
      probe,
    ]);
    await expect(42, linuxPaths("direct"), "aarch64 linux_paths direct, traps on the x18 and tpidrro_el0 paths", [
      ...emulator,
      pathsLinuxOnly,
      "direct",
    ]);
    await expect(42, linuxPaths("hosted"), "aarch64 linux_paths hosted (x18), traps on svc, tpidr_el0, tpidrro_el0", [
      ...hosted,
      pathsX18Only,
      "hosted",
    ]);
    await expect(
      42,
      linuxPaths("hosted"),
      "aarch64 linux_paths hosted (tpidrro_el0, one thread), traps on svc, tpidr_el0, x18",
      [...hosted, pathsTpidrroOnly, "hosted"],
      macos,
    );

    // 132 is SIGILL, 139 is SIGSEGV
    await expect(139, /Segmentation fault/, "aarch64 must fail: hosted, host does not reload x18", [
      ...emulator,
      hostNoReload,
      image("threads"),
      probe,
    ]);
    await expect(132, /Illegal instruction/, "aarch64 must fail: direct, image with traps on svc", [
      ...emulator,
      threadsX18Only,
      probe,
    ]);
    await expect(132, /Illegal instruction/, "aarch64 must fail: hosted (x18), image with traps on x18", [
      ...hosted,
      threadsLinuxOnly,
      probe,
    ]);
    await expect(
      132,
      /Illegal instruction/,
      "aarch64 must fail: hosted (tpidrro_el0), image with traps on tpidrro_el0",
      [...hosted, pathsX18Only, "hosted"],
      macos,
    );
  }

  // The scenarios of JavaScriptCore's shell, when `jsc` has built the image.
  if (existsSync(inOut(ctx, "jsc.img")) && ctx.emulator === undefined) {
    const scenarios = Bun.spawn(
      [
        process.execPath,
        join(TREE, "test", "jsc_scenarios.ts"),
        "--runs",
        String(runs),
        "--image",
        inOut(ctx, "jsc.img"),
        "--host",
        host,
        "--out",
        inOut(ctx, "scenarios.json"),
        "--modes",
        "direct,hosted,winmem,overlay",
      ],
      { stdin: "ignore", stdout: "inherit", stderr: "inherit" },
    );
    const code = await scenarios.exited;
    console.log(`scenarios of jsc.img (direct, hosted, winmem, overlay): ${code === 0 ? "passed" : "FAILED"}`);
    checked = code === 0 && checked;
  } else if (existsSync(inOut(ctx, "jsc.img"))) {
    console.log(`scenarios of jsc.img: not run, the runner of the scenarios does not start ${ctx.emulator}`);
  } else {
    console.log("scenarios of jsc.img: not run, the image is not built (command: jsc)");
  }

  rmSync(scratch, { recursive: true, force: true });
  const failed = tallies.filter(tally => tally.passes !== tally.runs);
  console.log(
    `${tallies.length} tests, ${runs} runs each: ${tallies.length - failed.length} passed, ${failed.length} failed` +
      (checked ? "" : ". A static check or a scenario failed, see above"),
  );
  return failed.length === 0 && checked;
}
