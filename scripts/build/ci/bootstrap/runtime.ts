// Bootstrap runtime: the logging/execution engine every bootstrap step uses.
//
// The bake log is the only artifact left when an image build fails an hour
// in, so this module is loud on purpose:
//   - every step is numbered, named, and timed;
//   - every command is echoed exactly as run (with cwd/env when set), and
//     its output is streamed live;
//   - every download logs the URL, the byte size, and whether the checksum
//     verified (or that there was no checksum to verify);
//   - every failure reports which step, which command, the exit code, and
//     the tail of the output before aborting.
//
// `--dry-run` prints the same plan without changing anything: commands are
// echoed as "would run", downloads as "would fetch", file writes as diffs.
// Read-only probes (which(), existsSync) still run for real.
//
// Node built-ins only — this runs under a bare `node` (>= 25, type
// stripping) on a fresh machine, before anything else is installed.

import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { Download } from "../artifacts.ts";

// ---------------------------------------------------------------------------
// Global options
// ---------------------------------------------------------------------------

export type RunMode = {
  /** Print the plan, execute nothing that mutates the system. */
  dryRun: boolean;
};

export const mode: RunMode = { dryRun: false };

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const startedAt = Date.now();

function stamp(): string {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1).padStart(7, " ");
  return `[${elapsed}s]`;
}

export function log(...parts: unknown[]): void {
  console.log(stamp(), ...parts);
}

export function warn(...parts: unknown[]): void {
  console.warn(stamp(), "WARNING:", ...parts);
}

/** A boxed header so the phases stand out in a multi-thousand-line log. */
export function banner(title: string): void {
  const line = "=".repeat(Math.max(20, Math.min(100, title.length + 8)));
  log("");
  log(line);
  log(`==  ${title}`);
  log(line);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export type Step = {
  name: string;
  /** Skip with a logged reason instead of running. */
  skip?: string | false | undefined;
  run: () => Promise<void> | void;
};

/** Where we are, for error context. */
const stepStack: string[] = [];

/**
 * Run a plan of steps in order. Each is announced with its index, timed, and
 * on failure the step name and every command context is printed before the
 * process exits non-zero.
 */
export async function runSteps(title: string, steps: Step[]): Promise<void> {
  const active = steps.filter(step => !step.skip);
  banner(`${title}: ${active.length} step(s)${mode.dryRun ? " [DRY RUN — nothing will be changed]" : ""}`);
  for (const step of steps) {
    if (step.skip) {
      log(`-- skipping "${step.name}": ${step.skip}`);
    }
  }
  let index = 0;
  for (const step of active) {
    index++;
    const started = Date.now();
    banner(`[${index}/${active.length}] ${step.name}`);
    stepStack.push(step.name);
    try {
      await step.run();
    } catch (error) {
      log("");
      log(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
      log(`!! BOOTSTRAP FAILED in step [${index}/${active.length}] "${step.name}"`);
      log(`!! after ${((Date.now() - started) / 1000).toFixed(1)}s`);
      log(`!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
      if (error instanceof CommandError) {
        error.print();
      } else {
        console.error(error);
      }
      process.exit(1);
    } finally {
      stepStack.pop();
    }
    log(`-- done "${step.name}" in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  banner(`${title}: all ${active.length} step(s) complete in ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Feed this to the command's stdin. */
  stdin?: string;
  /** Don't throw on non-zero exit; return the result instead. */
  allowFailure?: boolean;
  /** Don't stream output live (still captured, still shown on failure). */
  quiet?: boolean;
};

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

/** For a command whose output was already streamed live, the failure
 * report reprints just this many trailing lines as a recap (the complete
 * output is in the log above). Quiet (captured, unstreamed) commands print
 * their ENTIRE output in the report — it appears nowhere else. */
const STREAMED_RECAP_LINES = 100;

/** Thrown by run() so runSteps() can print full command context. */
export class CommandError extends Error {
  readonly command: string[];
  readonly options: RunOptions;
  readonly result: RunResult;

  constructor(command: string[], options: RunOptions, result: RunResult) {
    super(`Command failed (exit ${result.exitCode}): ${formatCommand(command)}`);
    this.command = command;
    this.options = options;
    this.result = result;
  }

  print(): void {
    log(`!! step: ${stepStack.join(" > ") || "(none)"}`);
    log(`!! command: ${formatCommand(this.command)}`);
    if (this.options.cwd) log(`!! cwd: ${this.options.cwd}`);
    if (this.options.env && Object.keys(this.options.env).length) {
      log(`!! env: ${JSON.stringify(this.options.env)}`);
    }
    log(`!! exit code: ${this.result.exitCode}`);
    const { stdout, stderr } = this.result;
    if (this.options.quiet) {
      // Nothing was streamed: this is the only place the output appears,
      // so print all of it, untruncated.
      if (stdout.trim()) {
        log(`!! --- complete stdout ---`);
        log(stdout.trimEnd());
      }
      if (stderr.trim()) {
        log(`!! --- complete stderr ---`);
        log(stderr.trimEnd());
      }
    } else {
      // The complete output was streamed live above; recap the end so
      // the error and its cause sit next to each other.
      log(`!! (complete output was streamed above; last ${STREAMED_RECAP_LINES} lines of each stream recapped here)`);
      const outTail = lastLines(stdout, STREAMED_RECAP_LINES);
      const errTail = lastLines(stderr, STREAMED_RECAP_LINES);
      if (outTail) {
        log(`!! --- end of stdout ---`);
        log(outTail);
      }
      if (errTail) {
        log(`!! --- end of stderr ---`);
        log(errTail);
      }
    }
    if (!stdout.trim() && !stderr.trim()) log(`!! (command produced no output)`);
  }
}

function lastLines(text: string, count: number): string {
  return text.trimEnd().split("\n").slice(-count).join("\n");
}

export function formatCommand(command: string[]): string {
  return command.map(arg => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : JSON.stringify(arg))).join(" ");
}

/**
 * Run a MUTATING command, streaming its output live and echoing exactly
 * what runs. Throws CommandError (with captured output) on non-zero exit
 * unless allowFailure. In dry-run mode nothing runs: the command is echoed
 * as "would run" and an empty success is returned. For read-only queries
 * whose answer the plan depends on, use runOutput() instead — those run
 * even in dry-run.
 */
export function run(command: string[], options: RunOptions = {}): Promise<RunResult> {
  const printable = formatCommand(command);
  if (mode.dryRun) {
    log(`[dry-run] would run: $ ${printable}${options.cwd ? `   (cwd: ${options.cwd})` : ""}`);
    return Promise.resolve({ exitCode: 0, stdout: "", stderr: "" });
  }
  return execute(command, options);
}

/**
 * The PATH children see. On Windows the bake installs tools (Scoop shims,
 * git, 7z, ...) by writing the Machine PATH in the registry; this node
 * process's own PATH was captured at bake start and never sees them. So
 * children get a PATH assembled from the registry — the equivalent of the
 * old bootstrap's Refresh-Path after each install. Elsewhere the inherited
 * PATH is authoritative.
 *
 * Cached: the registry read costs a powershell round-trip, and the value
 * only changes when an op writes the Machine PATH. Those ops call
 * invalidateChildPath(), so a read happens once per PATH change instead of
 * on every command.
 */
let childPathCache: string | undefined;
let childPathStale = true;

export function childPath(): string | undefined {
  if (process.platform !== "win32") return undefined;
  if (childPathStale) {
    const result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
      ],
      { encoding: "utf8" },
    );
    const registry = result.status === 0 ? result.stdout.trim() : "";
    childPathCache = [registry, process.env.Path ?? process.env.PATH ?? ""].filter(Boolean).join(";");
    childPathStale = false;
  }
  return childPathCache;
}

/** Mark the cached child PATH stale. Called by every op that writes the
 * Windows Machine PATH or installs onto it (addToMachinePath, Scoop). */
export function invalidateChildPath(): void {
  childPathStale = true;
}

/** Execute for real (shared by run() and the always-run probes). */
function execute(command: string[], options: RunOptions): Promise<RunResult> {
  const printable = formatCommand(command);
  log(`$ ${printable}${options.cwd ? `   (cwd: ${options.cwd})` : ""}`);
  return new Promise((resolve, reject) => {
    const env = { ...process.env, ...options.env };
    const path = childPath();
    if (path !== undefined) {
      env.Path = path;
      env.PATH = path;
    }
    const child = nodeSpawn(command[0]!, command.slice(1), {
      cwd: options.cwd,
      env,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", chunk => {
      const text = chunk.toString();
      stdout += text;
      if (!options.quiet) process.stdout.write(text);
    });
    child.stderr!.on("data", chunk => {
      const text = chunk.toString();
      stderr += text;
      if (!options.quiet) process.stderr.write(text);
    });
    if (options.stdin !== undefined) {
      child.stdin!.end(options.stdin);
    }
    child.on("error", error => {
      // The command could not start at all (ENOENT: binary missing, EACCES).
      // A best-effort step (allowFailure) treats that like any other
      // failure — a warn-and-continue, not a thrown exception.
      const result = { exitCode: -1, stdout, stderr: `${stderr}\n${error}` };
      if (options.allowFailure) {
        log(`command could not start (${error.message}); allowFailure — continuing`);
        resolve(result);
      } else {
        reject(new CommandError(command, options, result));
      }
    });
    child.on("close", exitCode => {
      const result = { exitCode: exitCode ?? -1, stdout, stderr };
      if (result.exitCode !== 0 && !options.allowFailure) {
        reject(new CommandError(command, options, result));
      } else {
        resolve(result);
      }
    });
  });
}

/**
 * Run a READ-ONLY probe and return its trimmed stdout. Executes for real
 * even in dry-run mode, because it changes nothing and the plan depends on
 * its answer (home dir, `uname -m`, whether a sysroot already exists, ...).
 * Output is captured, not streamed; on failure the whole output is in the
 * error report.
 */
export async function runOutput(command: string[], options: RunOptions = {}): Promise<string> {
  const { stdout } = await execute(command, { ...options, quiet: true });
  return stdout.trim();
}

/**
 * A post-condition check on something a previous command installed or
 * created ("node --version prints v26.3.0", "the sysroot now has libc.so").
 * Enforced in a real run; in dry-run it can't be true (nothing was
 * installed), so it is logged as "would verify" and skipped. Announcing
 * each verification by name makes the bake log show what was proven.
 */
export async function verify(description: string, check: () => Promise<void> | void): Promise<void> {
  if (mode.dryRun) {
    log(`[dry-run] would verify: ${description}`);
    return;
  }
  log(`verifying: ${description}`);
  await check();
  log(`verified: ${description}`);
}

/** Run a shell string via sh -c (linux/darwin only). */
export function sh(script: string, options: RunOptions = {}): Promise<RunResult> {
  return run(["sh", "-c", script], options);
}

// ---------------------------------------------------------------------------
// Privilege
// ---------------------------------------------------------------------------

/** True when running as root (POSIX). Always true on Windows (the bake and
 * the packer provisioner run elevated). */
export function isRoot(): boolean {
  if (process.platform === "win32") return true;
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/**
 * Prefix a command so it runs as root: itself when already root, else via
 * `sudo -n` (non-interactive; a password prompt would hang the bake).
 *
 * Any environment the caller sets is threaded through `env NAME=value ...`
 * INSIDE the sudo, because Debian/Ubuntu sudoers default to `env_reset`:
 * variables placed on the sudo process itself (RUSTUP_HOME, CARGO_HOME,
 * DEBIAN_FRONTEND, ...) are silently stripped before the target runs.
 */
export function asRoot(command: string[], env: Record<string, string | undefined> = {}): string[] {
  if (isRoot()) return command;
  const assignments = Object.entries(env)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${value}`);
  return ["sudo", "-n", "--", "env", ...assignments, ...command];
}

export function sudo(command: string[], options: RunOptions = {}): Promise<RunResult> {
  return run(asRoot(command, options.env ?? {}), options);
}

// ---------------------------------------------------------------------------
// Probes (read-only; run for real even in dry-run)
// ---------------------------------------------------------------------------

/** Resolve an executable on PATH, or undefined. */
export function which(name: string): string | undefined {
  const finder = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(finder, [name], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const [first] = result.stdout.trim().split(/\r?\n/);
  return first || undefined;
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

function readTextIfExists(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

/**
 * Write a file (creating parent directories). Logs the path and a preview
 * of the content so the bake log records exactly what was written. Runs
 * as root when the destination isn't writable by us.
 */
export async function writeText(path: string, content: string, options: { mode?: number } = {}): Promise<void> {
  const preview = content.length > 2000 ? `${content.slice(0, 2000)}\n... (${content.length} bytes total)` : content;
  if (mode.dryRun) {
    log(`[dry-run] would write ${path} (${content.length} bytes):`);
    log(indent(preview));
    return;
  }
  log(`writing ${path} (${content.length} bytes):`);
  log(indent(preview));
  if (isRoot() || process.platform === "win32") {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, options.mode ? { mode: options.mode } : undefined);
  } else {
    // Not root and the path may be root-owned: write via a root shell so
    // one code path handles /etc, /opt, and $HOME alike.
    const dir = join(path, "..");
    await sudo(["mkdir", "-p", dir]);
    await run(asRoot(["tee", path]), { stdin: content, quiet: true });
    if (options.mode) await sudo(["chmod", options.mode.toString(8), path]);
  }
}

/**
 * Append lines to a file, only the ones not already present (so re-running
 * bootstrap is idempotent). Logs which lines were added vs already there.
 */
export async function ensureLines(path: string, lines: string[]): Promise<void> {
  const existing = readTextIfExists(path) ?? "";
  const present = new Set(existing.split(/\r?\n/));
  const missing = lines.filter(line => !present.has(line));
  if (!missing.length) {
    log(`${path}: all ${lines.length} line(s) already present`);
    return;
  }
  log(`${path}: appending ${missing.length} line(s) (${lines.length - missing.length} already present)`);
  const needsNewline = existing.length > 0 && !existing.endsWith("\n");
  await writeText(path, `${existing}${needsNewline ? "\n" : ""}${missing.join("\n")}\n`);
}

function indent(text: string): string {
  return text
    .split("\n")
    .map(line => `    | ${line}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

/** A private scratch directory for this bootstrap run. */
export const scratchDir = (() => {
  const dir = join(tmpdir(), `bun-bootstrap-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  return dir;
})();

/**
 * Fetch a Download into scratch and return its path. Logs the URL, the
 * downloaded size, and the checksum outcome: verified against the pinned
 * sha256, or explicitly noted as unpinned (FLOATING). A checksum mismatch
 * is fatal and reports both digests.
 *
 * Uses global fetch (node's undici) so it works before curl is installed.
 */
export async function download(what: Download, options: { name?: string } = {}): Promise<string> {
  const name = options.name ?? decodeURIComponent(basename(new URL(what.url).pathname)) ?? "download";
  const path = join(scratchDir, name);
  if (mode.dryRun) {
    log(`[dry-run] would download ${what.url}`);
    log(
      `[dry-run]        -> ${path} (${what.sha256 ? `sha256 must be ${what.sha256}` : "no pinned checksum: FLOATING"})`,
    );
    return path;
  }
  log(`downloading ${what.url}`);
  log(`         -> ${path}`);
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(what.url, { redirect: "follow" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${what.url}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      writeFileSync(path, bytes);
      const digest = createHash("sha256").update(bytes).digest("hex");
      log(`         got ${bytes.length.toLocaleString()} bytes, sha256=${digest}`);
      if (what.sha256) {
        if (digest.toLowerCase() !== what.sha256.toLowerCase()) {
          throw new ChecksumError(what.url, what.sha256, digest);
        }
        log(`         checksum OK (matches pinned sha256)`);
      } else {
        log(`         checksum NOT verified (no pinned sha256 for this URL — FLOATING input)`);
      }
      return path;
    } catch (error) {
      if (error instanceof ChecksumError) throw error;
      lastError = error;
      warn(`download attempt ${attempt}/4 failed for ${what.url}: ${error}`);
      await sleep(1000 * attempt * attempt);
    }
  }
  throw new Error(`Download failed after 4 attempts: ${what.url}\n  last error: ${lastError}`);
}

export class ChecksumError extends Error {
  constructor(url: string, expected: string, actual: string) {
    super(
      `Checksum mismatch for ${url}\n` +
        `  expected sha256: ${expected}\n` +
        `  actual   sha256: ${actual}\n` +
        `The pinned checksum in scripts/build/ci/spec.ts does not match what was served. ` +
        `Either the artifact changed upstream (verify and update the pin) or the download is corrupt/tampered.`,
    );
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
