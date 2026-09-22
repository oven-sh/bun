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
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { quote } from "../build/shell.ts";
import {
  appendNames,
  buildTracerLibrary,
  flagValue,
  readTextSymbols,
  readTrace,
  sameCode,
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

export function traceHints(options: HintOptions): { count: number; processes: number } {
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

  const scratch = mkdtempSync(join(tmpdir(), "bun-orderfile-hints-"));
  try {
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
        `exec ${sh(exe)} "$@"`,
        "",
      ].join("\n"),
    );
    chmodSync(launcher, 0o755);

    const [program, ...args] = options.command.map(arg => arg.replaceAll("{}", launcher));
    const run = spawnSync(program!, args, { cwd: options.cwd, stdio: "inherit" });
    if (run.error) throw new Error(`${program}: ${run.error.message}`);
    if (run.status !== 0) throw new Error(`${program} exited ${run.status ?? run.signal}`);
    options.verify?.();

    // One trace per traced process. The one that entered the most is the
    // application proper; helpers it spawned of itself add what only they reach.
    // A helper killed before its first entry leaves an empty record: skip it.
    const recorded: number[][] = [];
    for (const file of readdirSync(traces)) {
      try {
        recorded.push(readTrace(join(traces, file), file));
      } catch (error) {
        console.warn(`warning: ${(error as Error).message}`);
      }
    }
    recorded.sort((a, b) => b.length - a.length);
    if (!recorded.length) {
      throw new Error(`nothing was traced: did the command start ${basename(exe)} through {}?`);
    }

    const names: string[] = [];
    appendNames(names, new Set(), symbols, recorded.flat());

    const header = [
      `# Functions of bun entered by ${basename(exe)}, in first-entry order, from ${recorded.length} traced process(es).`,
      "# Generated by scripts/orderfile/hints.ts, for scripts/orderfile/generate.ts --hints.",
    ];
    writeFileSync(resolve(options.outPath), header.join("\n") + "\n" + names.join("\n") + "\n");
    return { count: names.length, processes: recorded.length };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
    const { count, processes } = traceHints({ profile: join(buildDir, "bun-profile"), exe, command, outPath: out });
    console.log(`wrote ${out} (${count} functions from ${processes} process(es))`);
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exit(1);
  }
}
