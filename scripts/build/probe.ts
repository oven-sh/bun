/**
 * The questions configure asks of a program: its version, a directory, the commit of the checkout.
 *
 * A program that runs and exits has answered. One that the machine will not run (no such file, not a program for
 * this machine) is a fact about the program too, and the caller decides what follows: the next candidate, an
 * optional tool left out. A program that ran out of time, or that a signal killed, has said nothing. Read as "no",
 * that makes a busy machine configure with another compiler or a default, and the new build.ninja recompiles every
 * C file and every Rust crate. So `ask()` has no return value for it: it throws.
 *
 * On Windows a program that is killed or that crashes comes back as an exit status, so there it counts as an answer.
 */

import { spawnSync } from "node:child_process";
import { BuildError } from "./error.ts";

export interface AskOptions {
  /** Milliseconds until the program is killed and the ask fails. `null`: no limit. */
  budgetMs: number | null;
  /** Set for the program, over this process's environment. */
  env?: Record<string, string>;
  cwd?: string;
  /** `inherit`: the program's stderr is the terminal's, and the answer's `stderr` is empty. */
  stderr?: "pipe" | "inherit";
}

/** The program ran and exited with `status`. */
export interface Exited {
  status: number;
  stdout: string;
  stderr: string;
}

/** How the program exited, or `cannotRun`: why the machine would not run it. */
export type Answer = Exited | { cannotRun: NodeJS.ErrnoException };

/** A program was asked and gave no answer. `cause` is the spawn error, when there is one. */
export class NoAnswer extends BuildError {}

/** What the program printed, if it ran and exited 0. */
export function printed(answer: Answer): string | undefined {
  return "cannotRun" in answer || answer.status !== 0 ? undefined : answer.stdout;
}

/**
 * The spawn errors that are about the file: nothing is at that path, or the machine does not run what is there as
 * a program. Windows says EFTYPE for a file that is no executable and EPERM for one it refuses, and macOS says
 * EBADARCH for a binary of another CPU. Every other error (ETIMEDOUT, ETXTBSY, EAGAIN, E2BIG, ...) is taken as no
 * answer, because nothing says it is about the file.
 */
const cannotRunCodes = new Set([
  "ENOENT",
  "ENOTDIR",
  "ELOOP",
  "ENAMETOOLONG",
  "EACCES",
  "EPERM",
  "ENOEXEC",
  "EFTYPE",
  "EBADARCH",
]);
/** EBADARCH on macOS. Node.js has no name for it and gives the code "Unknown system error -86". */
const darwinBadArch = -86;

function isAboutTheFile(error: NodeJS.ErrnoException): boolean {
  return (
    (error.code !== undefined && cannotRunCodes.has(error.code)) ||
    (process.platform === "darwin" && error.errno === darwinBadArch)
  );
}

const noAnswerHint =
  'That is not a "no", so configure stops here instead of going on with another tool or a default. ' +
  "On a busy machine, run the build again. If it happens every time, the program is broken: repair or remove it, " +
  "or name another toolchain with BUN_TOOLCHAIN_LLVM or BUN_TOOLCHAIN_RUST.";

/** A wait this long gets a line: nothing is printed while a program is being asked. */
const slowAnswerSeconds = 5;

/**
 * Throws `NoAnswer` when the program ran out of time, was killed by a signal, or could not be started for a reason
 * that is not about the file. It asks once: a machine that is out of memory kills a second ask the same way, and a
 * slow answer only has to be waited for.
 */
export function ask(exe: string, args: readonly string[], options: AskOptions): Answer {
  const command = `\`${[exe, ...args].join(" ")}\``;
  const started = performance.now();
  const result = spawnSync(exe, [...args], {
    encoding: "utf8",
    // stdin: on Windows CI the parent's can be a handle that blocks the child's CRT init, and no question reads it.
    stdio: ["ignore", "pipe", options.stderr ?? "pipe"],
    // SIGKILL: a program can ignore SIGTERM, and spawnSync then waits for it as long as it likes.
    ...(options.budgetMs !== null && { timeout: options.budgetMs, killSignal: "SIGKILL" as const }),
    ...(options.env !== undefined && { env: { ...process.env, ...options.env } }),
    ...(options.cwd !== undefined && { cwd: options.cwd }),
  });
  const error: NodeJS.ErrnoException | undefined = result.error;
  if (error !== undefined && isAboutTheFile(error)) return { cannotRun: error };
  if (error !== undefined || typeof result.status !== "number") {
    const what =
      error === undefined
        ? `was killed by ${result.signal}`
        : error.code === "ETIMEDOUT" && options.budgetMs !== null
          ? `did not answer in ${options.budgetMs / 1000}s`
          : "gave no answer";
    // What it printed before it stopped can be all there is on why: the loader's line about a missing library.
    const printedSoFar = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().slice(0, 200);
    throw new NoAnswer(`${command} ${what}${printedSoFar && `, after it printed: ${printedSoFar}`}`, {
      hint: noAnswerHint,
      cause: error,
    });
  }
  const seconds = (performance.now() - started) / 1000;
  if (seconds >= slowAnswerSeconds) process.stderr.write(`${command} took ${seconds.toFixed(0)}s to answer\n`);
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
