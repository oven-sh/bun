/**
 * What a command of build.ts hands to its steps, and how a step runs: skipped when its output is current,
 * made from nothing otherwise.
 */

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Arch, type Sysroot, hostArch, llvmBin, sysrootAt } from "../flags.ts";
import { type ArchiveSource, type GitSource, identityOf, isCurrent, run, writeStamp } from "./run.ts";

/** The table of pinned sources. It is written down once, at the top of build.ts. */
export interface Sources {
  musl: GitSource;
  llvm: GitSource;
  icu: ArchiveSource;
}

export interface Context {
  arch: Arch;
  /** The output directory. Everything that is downloaded or built is inside of it. */
  out: string;
  sysroot: Sysroot;
  sources: Sources;
  /** Directory of clang, ld.lld and the llvm tools. */
  llvm: string;
  /** Parallel compile jobs of one make or ninja. */
  jobs: number;
  /** `clang --version`, first line. Part of what every step was built from. */
  compiler: string;
  /** Set when the image is for another architecture than this machine: the emulator that runs it. */
  emulator: string | undefined;
}

export function createContext(arch: Arch, out: string, sources: Sources): Context {
  const llvm = llvmBin();
  const compiler = run([join(llvm, "clang"), "--version"])
    .split("\n")[0]!
    .trim();
  const jobs = Number(process.env.JOBS ?? "8");
  if (!Number.isInteger(jobs) || jobs < 1) throw new Error(`JOBS=${process.env.JOBS}: not a number of jobs`);
  return {
    arch,
    out,
    sysroot: sysrootAt(join(out, "sysroot"), arch),
    sources,
    llvm,
    jobs,
    compiler,
    emulator: arch === hostArch() ? undefined : `qemu-${arch}`,
  };
}

/** A path below the output directory. */
export function inOut(ctx: Context, ...parts: string[]): string {
  return join(ctx.out, ...parts);
}

/** The file that gets the output of one command of a step. */
export function logOf(ctx: Context, name: string): string {
  return join(ctx.out, "logs", `${name}.log`);
}

export interface Step {
  name: string;
  /** Everything that decides the output, the identities of the steps that it builds on included. */
  inputs: unknown;
  /** Files that are there when the step is done. */
  outputs: string[];
  make: () => void | Promise<void>;
}

/**
 * Runs a step unless its output is current: the stamp of the last run records the same inputs and every
 * output exists. Returns the identity of the step, for the inputs of the steps after it.
 */
export async function runStep(ctx: Context, step: Step): Promise<string> {
  const identity = identityOf([ctx.compiler, step.inputs]);
  const stamp = inOut(ctx, "stamps", step.name);
  if (isCurrent(stamp, identity, step.outputs)) {
    console.log(`[${step.name}] up to date`);
    return identity;
  }
  console.log(`[${step.name}] building`);
  const started = performance.now();
  // A step that fails half way must not look current to the next run.
  rmSync(stamp, { force: true });
  await step.make();
  const missing = step.outputs.filter(path => !existsSync(path));
  if (missing.length > 0) throw new Error(`[${step.name}] ran, but did not make ${missing.join(", ")}`);
  writeStamp(stamp, identity);
  console.log(`[${step.name}] done in ${Math.round((performance.now() - started) / 1000)} s`);
  return identity;
}
