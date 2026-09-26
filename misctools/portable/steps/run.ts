/**
 * What every step of the build shares: running a command, the error that stops the build, fetching a pinned
 * source, applying a patch, and the stamp that tells whether the output of a step is current.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

// ───────────────────────────────────────────────────────────────────────────
// Errors
// ───────────────────────────────────────────────────────────────────────────

/** Stops the build. `format()` is what the entry point prints: the message, then the command's output. */
export class BuildError extends Error {
  readonly command: string | undefined;
  readonly output: string | undefined;
  readonly hint: string | undefined;

  constructor(
    message: string,
    context?: { command?: string | undefined; output?: string | undefined; hint?: string; cause?: unknown },
  ) {
    super(message, context?.cause !== undefined ? { cause: context.cause } : undefined);
    this.name = "BuildError";
    this.command = context?.command;
    this.output = context?.output;
    this.hint = context?.hint;
  }

  format(): string {
    let text = `error: ${this.message}\n`;
    if (this.command !== undefined) text += `  command: ${this.command}\n`;
    if (this.hint !== undefined) text += `  hint: ${this.hint}\n`;
    if (this.cause instanceof Error) text += `  cause: ${this.cause.message}\n`;
    if (this.output !== undefined && this.output.trim() !== "") {
      text += "  output:\n";
      for (const line of this.output.trimEnd().split("\n")) text += `    ${line}\n`;
    }
    return text;
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Commands
// ───────────────────────────────────────────────────────────────────────────

export interface RunOptions {
  cwd?: string;
  /** Added to the environment of this process. */
  env?: Record<string, string>;
  /** File that gets everything the command prints. Without it the output is kept in memory. */
  log?: string;
  /** Text for the command's standard input. */
  input?: string;
}

/** How a command is shown: arguments with a space or a quote in them are quoted for a shell. */
export function commandLine(cmd: string[]): string {
  return cmd.map(arg => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`)).join(" ");
}

/** The last lines of a log, which is where a failed build says why. */
const TAIL_LINES = 60;

function tail(text: string): string {
  const lines = text.trimEnd().split("\n");
  if (lines.length <= TAIL_LINES) return lines.join("\n");
  return [`(the last ${TAIL_LINES} of ${lines.length} lines)`, ...lines.slice(-TAIL_LINES)].join("\n");
}

/**
 * Runs a command to its end and returns what it printed (standard output, then standard error). With `log` the
 * output goes to that file as it comes, after a line with the command, and the result is empty. Any exit code
 * but 0 is a BuildError that carries the command and its output.
 */
export function run(cmd: string[], options: RunOptions = {}): string {
  const env = { ...process.env, ...options.env };
  const stdin = options.input !== undefined ? "pipe" : "ignore";
  const shown = commandLine(cmd) + (options.cwd !== undefined ? `   (in ${options.cwd})` : "");
  if (options.log !== undefined) {
    mkdirSync(dirname(options.log), { recursive: true });
    const fd = openSync(options.log, "w");
    let status: number | null;
    try {
      const variables = Object.entries(options.env ?? {}).map(([name, value]) => `${name}=${commandLine([value])}`);
      writeSync(fd, `+ ${[...variables, shown].join(" ")}\n`);
      const result = spawnSync(cmd[0]!, cmd.slice(1), {
        cwd: options.cwd,
        env,
        input: options.input,
        stdio: [stdin, fd, fd],
      });
      if (result.error) throw new BuildError(`cannot run ${cmd[0]}`, { command: shown, cause: result.error });
      status = result.status;
    } finally {
      closeSync(fd);
    }
    if (status !== 0) {
      throw new BuildError(`${basename(cmd[0]!)} failed with exit code ${status}`, {
        command: shown,
        output: tail(readFileSync(options.log, "utf8")),
        hint: `everything it printed is in ${options.log}`,
      });
    }
    return "";
  }
  const result = spawnSync(cmd[0]!, cmd.slice(1), {
    cwd: options.cwd,
    env,
    input: options.input,
    stdio: [stdin, "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 1 << 30,
  });
  if (result.error) throw new BuildError(`cannot run ${cmd[0]}`, { command: shown, cause: result.error });
  const output = result.stdout + result.stderr;
  if (result.status !== 0) {
    throw new BuildError(`${basename(cmd[0]!)} failed with exit code ${result.status ?? result.signal}`, {
      command: shown,
      output: tail(output),
    });
  }
  return output;
}

// ───────────────────────────────────────────────────────────────────────────
// Stamps
// ───────────────────────────────────────────────────────────────────────────

export function sha256(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/** sha256 of a file's bytes. */
export function sha256File(path: string): string {
  return sha256(readFileSync(path));
}

/**
 * What a step was built from, as one hash: every part that decides the output (the pinned commit, the text of
 * the patches, the flags, the compiler's version, the identities of the steps before it).
 */
export function identityOf(parts: unknown): string {
  return sha256(JSON.stringify(parts)).slice(0, 16);
}

/** True when the stamp records `identity` and every output is there: the step has nothing to do. */
export function isCurrent(stamp: string, identity: string, outputs: string[]): boolean {
  if (!existsSync(stamp) || readFileSync(stamp, "utf8").trim() !== identity) return false;
  return outputs.every(path => existsSync(path));
}

/** Written last by a step, through a rename: a step that failed half way leaves no stamp. */
export function writeStamp(stamp: string, identity: string): void {
  mkdirSync(dirname(stamp), { recursive: true });
  const tmp = `${stamp}.tmp.${process.pid}`;
  writeFileSync(tmp, identity + "\n");
  renameSync(tmp, stamp);
}

// ───────────────────────────────────────────────────────────────────────────
// Patches
// ───────────────────────────────────────────────────────────────────────────

/**
 * Applies a unified diff to the tree at `dir` with `git apply`. The paths of the diff start from `dir`.
 *
 * git must not find a repository above `dir`: the output directory is inside bun's repository by default,
 * and there `git apply` takes the paths from the top of that repository, finds none of them below the
 * directory it runs in, changes nothing and exits with 0. The second command is the proof that the first
 * one changed the files: the diff applies in reverse.
 */
export function applyPatch(dir: string, patch: string): void {
  const body = readFileSync(patch, "utf8").replace(/\r\n/g, "\n");
  const options = { cwd: dir, input: body, env: { GIT_CEILING_DIRECTORIES: dirname(resolve(dir)) } };
  try {
    run(["git", "apply", "-"], options);
    run(["git", "apply", "--check", "--reverse", "-"], options);
  } catch (cause) {
    if (!(cause instanceof BuildError)) throw cause;
    throw new BuildError(`${basename(patch)} does not apply to ${dir}`, {
      command: cause.command,
      output: cause.output,
      hint: "the patch may be out of date with the pinned source, or it is applied already",
    });
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Sources
// ───────────────────────────────────────────────────────────────────────────

/** A git repository at one commit. */
export interface GitSource {
  /** Where it is cloned from. */
  url: string;
  /** Environment variable that replaces `url`: a mirror, or a clone on this machine. */
  urlVariable: string;
  /**
   * The tag that names the commit, if it has one. The clone asks for it by this name and has it as a tag
   * of its own: a source can read its version from there (musl: `git describe`).
   */
  tag?: string;
  /** The commit. A clone that is at another one is an error (a tag that moved). */
  commit: string;
  /** Directories to check out, when the build needs a part of the repository only. */
  sparse?: string[];
}

/** A release archive. */
export interface ArchiveSource {
  url: string;
  /** Environment variable that replaces `url`. */
  urlVariable: string;
  /** The tag of the release. */
  tag: string;
  sha256: string;
}

function git(dir: string, args: string[], log?: string): string {
  return run(["git", "-c", "advice.detachedHead=false", "-C", dir, ...args], log !== undefined ? { log } : {});
}

/** The commit that the checkout at `dir` is at, or undefined when `dir` is no checkout of its own. */
function headOf(dir: string): string | undefined {
  if (!existsSync(join(dir, ".git"))) return undefined;
  const result = spawnSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

/**
 * Makes `dir` a checkout of the source at its pinned commit, with the patches applied, and returns the
 * identity of that (commit and text of the patches).
 *
 * A checkout that is at the commit already and has the directories of `sparse` is kept, whoever put it
 * there: its files are set back to the commit and patched again, unless its stamp says that exactly this
 * was done before. Anything else in `dir` is deleted and the source is cloned, shallow: the one commit,
 * and with `sparse` no file outside of those directories.
 */
export function fetchGit(
  name: string,
  source: GitSource,
  dir: string,
  patches: string[],
  logs: string,
  patchWith?: { identity: string; apply: (dir: string) => void },
): string {
  const identity = identityOf([
    source.commit,
    source.sparse ?? [],
    patches.map(patch => readFileSync(patch, "utf8").replace(/\r\n/g, "\n")),
    patchWith?.identity ?? "",
  ]);
  const stamp = join(dir, ".git", "bun-portable-source");
  const complete = (source.sparse ?? []).every(part => existsSync(join(dir, part)));
  const head = complete ? headOf(dir) : undefined;
  if (head === source.commit && isCurrent(stamp, identity, [])) return identity;

  if (head !== source.commit) {
    const url = process.env[source.urlVariable] ?? source.url;
    console.log(`[${name}] cloning ${url} at ${source.tag ?? source.commit}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const log = join(logs, `${name}-clone.log`);
    git(dir, ["init", "-q"], log);
    git(dir, ["remote", "add", "origin", url]);
    if (source.sparse !== undefined) {
      git(dir, ["config", "remote.origin.promisor", "true"]);
      git(dir, ["config", "remote.origin.partialclonefilter", "blob:none"]);
      git(dir, ["sparse-checkout", "set", "--cone", ...source.sparse]);
    }
    const filter = source.sparse !== undefined ? ["--filter=blob:none"] : [];
    const ref = source.tag !== undefined ? `refs/tags/${source.tag}:refs/tags/${source.tag}` : source.commit;
    git(dir, ["fetch", "-q", "--depth", "1", ...filter, "origin", ref], log);
    git(dir, ["checkout", "-q", "--detach", "FETCH_HEAD"], log);
    const cloned = headOf(dir);
    if (cloned !== source.commit) {
      const named = source.tag ?? source.commit;
      throw new BuildError(`${name}: ${url} has ${named} at ${cloned}, the build is pinned to ${source.commit}`, {
        hint: "the table of sources at the top of build.ts names the commit",
      });
    }
  } else {
    console.log(`[${name}] ${dir} is at ${source.commit.slice(0, 12)}: kept, files set back to the commit`);
    rmSync(stamp, { force: true });
    git(dir, ["reset", "-q", "--hard", source.commit]);
    git(dir, ["clean", "-q", "-fdx"]);
    if (source.tag !== undefined) git(dir, ["tag", "-f", source.tag, source.commit]);
  }
  for (const patch of patches) {
    console.log(`[${name}] applying ${basename(patch)}`);
    applyPatch(dir, patch);
  }
  patchWith?.apply(dir);
  writeStamp(stamp, identity);
  return identity;
}

/** Downloads a release archive to `file`, unless a file with the pinned sha256 is there. */
export async function fetchArchive(name: string, source: ArchiveSource, file: string): Promise<void> {
  if (existsSync(file) && sha256File(file) === source.sha256) return;
  const url = process.env[source.urlVariable] ?? source.url;
  console.log(`[${name}] downloading ${url}`);
  mkdirSync(dirname(file), { recursive: true });
  let response: Response;
  try {
    response = await fetch(url, { redirect: "follow" });
  } catch (cause) {
    throw new BuildError(`${name}: cannot download ${url}`, { cause });
  }
  if (!response.ok) throw new BuildError(`${name}: ${url} answered ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const got = sha256(bytes);
  if (got !== source.sha256) {
    throw new BuildError(`${name}: ${url} has sha256 ${got}, the build is pinned to ${source.sha256}`, {
      hint: "the table of sources at the top of build.ts names the sha256",
    });
  }
  const tmp = `${file}.tmp.${process.pid}`;
  writeFileSync(tmp, bytes);
  renameSync(tmp, file);
}
