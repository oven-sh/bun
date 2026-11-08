#!/usr/bin/env bun
/**
 * Writes a hint list for `generate.ts --hints`: the functions of bun that an
 * application built on it enters, in first-entry order.
 *
 * The order file's own workloads stand in for applications in general. An
 * application that ships its own build of bun can do better than a stand-in:
 * trace a real session of itself, and hand the list to the generator, which
 * places those functions first. The list is symbol names, so it survives from
 * one build of bun to the next (generate.ts `resolveHints`), and is small
 * enough to commit next to whatever builds the application.
 *
 *   bun scripts/orderfile/hints.ts --build-dir=build/release --exe=./my-app --out=my-app.hints \
 *       -- ./drive-a-session.sh {}
 *
 * `--exe` is the application: an executable made by `bun build --compile` with
 * the bun in `--build-dir`, whose `bun-profile` supplies the symbols (a
 * compiled executable has bun's code at bun's addresses). The command after
 * `--` is whatever drives a session; each `{}` in it is replaced by the path of
 * a launcher that starts the application under the tracer. The application may
 * re-execute itself: every process running that same executable is traced
 * (functrace.c, BUN_FUNCTRACE_CHILDREN), the busiest one listed first. On macOS
 * that is best-effort: the loader drops injected libraries when a protected
 * binary (/bin/sh, /usr/bin/env) runs, so an application that restarts itself
 * through a shell is not followed past it.
 *
 * Linux and macOS. The Windows tracer is a debugger of one process
 * (functrace-windows.c) and does not follow it into children.
 */
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { quote } from "../build/shell.ts";
import {
  appendNames,
  buildTracerLibrary,
  flagValue,
  hostObjectFormat,
  KILL_GRACE_MS,
  readTextSymbols,
  readTrace,
  sameCode,
  withScratch,
  writeStarts,
} from "./generate.ts";

export interface HintOptions {
  /** The unstripped bun the application was compiled with: what maps addresses to names. */
  profile: string;
  /** The application. */
  exe: string;
  /** The command that drives a session; `{}` stands for the launcher. */
  command: string[];
  outPath: string;
  /** Working directory for the command. */
  cwd?: string;
  /** Called once the command has exited 0, before anything is written: throw if the session it drove was not a complete one. */
  verify?: () => void;
}

const sh = (text: string) => quote(text, false);

/**
 * Which of `pids` are running the file `exe`, by device and inode as in
 * functrace.c: through /proc on linux, and elsewhere through the paths one ps
 * gives for all of them (-ww: unclipped), which leaves out a process started
 * by a relative path. Left out is the safe answer.
 */
export function runningExecutable(pids: number[], exe: string): number[] {
  const paths = new Map<number, string>();
  if (process.platform === "linux") {
    for (const pid of pids) paths.set(pid, `/proc/${pid}/exe`);
  } else if (pids.length) {
    const ps = spawnSync("ps", ["-ww", "-o", "pid=,comm=", "-p", pids.join(",")], { encoding: "utf8" });
    for (const line of (ps.stdout ?? "").split("\n")) {
      const listed = /^\s*(\d+)\s+(\/.*)$/.exec(line);
      if (listed) paths.set(Number(listed[1]), listed[2]!.trimEnd());
    }
  }
  const ours = statSync(exe);
  return pids.filter(pid => {
    try {
      const theirs = statSync(paths.get(pid) ?? "");
      return ours.dev === theirs.dev && ours.ino === theirs.ino;
    } catch {
      return false; // no such process, or not ours to look at
    }
  });
}

/**
 * The traces in the order their functions are listed: the process that entered
 * the most is the application proper, and the helpers it spawned of itself add
 * what only they reach. Two that entered as many are ordered by what they
 * entered, so that the list does not depend on the order a directory happens to
 * be read in.
 */
export function busiestFirst(traces: number[][]): number[][] {
  return [...traces].sort((a, b) => {
    if (a.length !== b.length) return b.length - a.length;
    const differs = a.findIndex((address, i) => address !== b[i]);
    return differs < 0 ? 0 : a[differs]! - b[differs]!;
  });
}

export async function traceHints(options: HintOptions): Promise<{ count: number; processes: number }> {
  if (process.platform === "win32") throw new Error("hints.ts traces on linux and macOS only");
  const profile = resolve(options.profile);
  const exe = resolve(options.exe);
  for (const path of [profile, exe]) if (!existsSync(path)) throw new Error(`${path} not found`);
  if (!sameCode(profile, exe)) {
    throw new Error(`${basename(exe)} was not compiled with the bun that ${profile} is the profile of`);
  }
  if (!options.command.some(arg => arg.includes("{}"))) {
    throw new Error("the command never mentions {}, so nothing in it would start the application under the tracer");
  }

  return withScratch("bun-orderfile-hints-", async (scratch, interrupted) => {
    const tracer = buildTracerLibrary(scratch);
    const symbols = readTextSymbols(profile);
    const starts = join(scratch, "starts.bin");
    writeStarts(
      starts,
      [...symbols.keys()].sort((a, b) => a - b),
    );
    const traces = join(scratch, "traces");
    mkdirSync(traces);

    // The variables are set here rather than on the command: the command's own
    // processes (a shell, a test runner, another bun) are not the application,
    // and the starts would plant breakpoints in the middle of their code.
    const launcher = join(scratch, "launch");
    writeFileSync(
      launcher,
      [
        "#!/bin/sh",
        `export ${tracer.preloadVar}=${sh(tracer.library)}`,
        `export BUN_FUNCTRACE_STARTS=${sh(starts)}`,
        `export BUN_FUNCTRACE_OUT=${sh(join(traces, "%p.bin"))}`,
        "export BUN_FUNCTRACE_CHILDREN=1",
        `export BUN_FUNCTRACE_EXE=${sh(exe)}`,
        `exec ${sh(exe)} "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(launcher, 0o755);

    const [program, ...args] = options.command.map(arg => arg.replaceAll("{}", launcher));
    // Not spawnSync: a signal held for the scratch directory's sake has to be able to stop the session.
    const run = await new Promise<{ status: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      // In our process group, so that it keeps the terminal and a ^C there reaches it as it reaches us.
      const session = spawn(program!, args, { cwd: options.cwd, stdio: "inherit" });
      let escalation: ReturnType<typeof setTimeout> | undefined;
      const stop = () => {
        session.kill("SIGTERM");
        escalation = setTimeout(() => session.kill("SIGKILL"), KILL_GRACE_MS);
      };
      interrupted.addEventListener("abort", stop);
      session.on("error", error => reject(new Error(`${program}: ${error.message}`)));
      session.on("exit", (status, signal) => {
        clearTimeout(escalation);
        interrupted.removeEventListener("abort", stop);
        resolve({ status, signal });
      });
    });
    if (interrupted.aborted) {
      // The command may have been a wrapper that left the application running: its records are
      // named after its processes, which would go on writing them into a directory that is about
      // to go. Most of those processes exited long ago, and their ids may be someone else's by now.
      const recorded = new Set(readdirSync(traces).map(file => parseInt(file, 10)));
      for (const pid of runningExecutable([...recorded].filter(Number.isInteger), exe)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Gone since.
        }
      }
      throw interrupted.reason;
    }
    if (run.status !== 0) throw new Error(`${program} exited ${run.status ?? run.signal}`);
    options.verify?.();

    // One trace per traced process. A helper killed before its first entry
    // leaves an empty record: skip it.
    const recorded: number[][] = [];
    for (const file of readdirSync(traces)) {
      try {
        recorded.push(readTrace(join(traces, file), file));
      } catch (error) {
        console.warn(`warning: ${(error as Error).message}`);
      }
    }
    if (!recorded.length) {
      throw new Error(`nothing was traced: did the command start ${basename(exe)} through {}?`);
    }

    const names: string[] = [];
    appendNames(names, new Set(), symbols, busiestFirst(recorded).flat());

    const header = [
      `# Functions of bun entered by ${basename(exe)}, in first-entry order, from ${recorded.length} traced process(es).`,
      "# Generated by scripts/orderfile/hints.ts, for scripts/orderfile/generate.ts --hints.",
      // Read back by generate.ts readHintList: a list traced on one platform serves a link for another.
      `# format: ${hostObjectFormat}`,
    ];
    writeFileSync(resolve(options.outPath), header.join("\n") + "\n" + names.join("\n") + "\n");
    return { count: names.length, processes: recorded.length };
  });
}

if (import.meta.main) {
  const split = process.argv.indexOf("--");
  const flags = process.argv.slice(2, split < 0 ? undefined : split);
  const command = split < 0 ? [] : process.argv.slice(split + 1);
  const arg = (name: string) => flagValue(flags, name);
  // Repo-root-relative, as in generate.ts: this runs from wherever the application's session is driven.
  const buildDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", arg("build-dir") ?? "build/release");
  const exe = arg("exe");
  const out = arg("out");
  if (!exe || !out || !command.length) {
    console.error(
      "usage: bun scripts/orderfile/hints.ts [--build-dir=<dir>] --exe=<app> --out=<file> -- <command with {}>",
    );
    process.exit(1);
  }
  try {
    const { count, processes } = await traceHints({
      profile: join(buildDir, "bun-profile"),
      exe,
      command,
      outPath: out,
    });
    console.log(`wrote ${out} (${count} functions from ${processes} process(es))`);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exit(1);
  }
}
