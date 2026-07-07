/**
 * Subprocess output wrapper for ninja builds. Two modes:
 *
 * ## Default: prefix mode (for pooled rules)
 *
 * Ninja's non-console pools buffer subprocess output until completion.
 * Console pool gives live output but forces serial execution. Prefix mode
 * threads the needle: runs the real command, prefixes each output line with
 * `[name]`, and writes to an inherited FD that bypasses ninja's pipe entirely.
 *
 * build.ts dups stderr → FD 3 before spawning ninja. Ninja's subprocess
 * spawn only touches FDs 0-2; FD 3 is inherited unchanged. Writes to FD 3
 * land directly on the terminal. If FD 3 isn't open (direct ninja invocation),
 * fall back to stdout — ninja buffers it, build still works.
 *
 * ## --console mode (for pool=console rules)
 *
 * stdio inherit — child gets direct TTY. For commands that have their own
 * TTY UI (cargo's progress bar, lld's progress). Ninja defers its own
 * [N/M] while the console job owns the terminal.
 *
 * On Windows, applies a compensation for ninja's stdio buffering bug:
 * ninja's \n before console-pool jobs goes through fwrite without fflush
 * (line_printer.cc PrintOrBuffer); MSVCRT has no line-buffering, so the \n
 * stays in ninja's stdio buffer. Subprocess output (via raw HANDLE) glues
 * onto the [N/M] status, and the deferred \n lands as a blank line later.
 * Fix: \n before (clean line), \x1b[1A after (absorb the deferred \n).
 * Windows+TTY only — posix line-buffers, doesn't need it.
 *
 * ## Usage (from ninja rule)
 *
 *   # prefix mode, pooled
 *   command = bun /path/to/stream.ts $name cmake --build $builddir ...
 *   pool = dep  # any depth — output streams live regardless
 *
 *   # console mode
 *   command = bun /path/to/stream.ts $name --console $cargo build ...
 *   pool = console
 *
 * --cwd=DIR / --env=K=V / --console / --stamp=PATH go between <name> and
 * <command>. They exist so the rule doesn't need `sh -c '...'` (which
 * would conflict with shell-quoted ninja vars like $args). --stamp=PATH
 * writes an empty file at PATH when the child exits 0 — used for rules
 * whose command doesn't naturally produce an output file (e.g. a typecheck
 * pass) so ninja can still chain on it.
 */

import { spawn, spawnSync } from "node:child_process";
import { closeSync, createWriteStream, openSync, writeSync } from "node:fs";
import { createInterface } from "node:readline";
import { nameColor } from "./tty.ts";

export const streamPath: string = import.meta.filename;

/**
 * File descriptor for bypassing ninja's output buffering. build.ts dups
 * its stderr into this FD before spawning ninja; stream.ts writes prefixed
 * lines here. Ninja's subprocess spawn only touches FDs 0-2, so this
 * flows through unchanged.
 *
 * Exported so build.ts uses the same number (keep them in sync).
 */
export const STREAM_FD = 3;

/**
 * Produce a colored `[name] ` prefix. Color derived from a hash of the
 * name — deterministic, so zstd is always the same shade across runs.
 *
 * Palette: 12 ANSI 256-color codes from gold → green → cyan → blue →
 * purple. No reds/pinks (error connotation), no dark blues (illegible
 * on black), no white/grey (no contrast). With ~18 deps a few collide —
 * the name disambiguates.
 */
function coloredPrefix(name: string): string {
  // Caller already gated on useColor (FD3-based); tty.ts's default check
  // (FD2-based) would wrongly disable since FD2 is a ninja pipe here.
  return nameColor(name, `[${name}]`, true) + " ";
}

// ───────────────────────────────────────────────────────────────────────────
// CLI — guarded so `import { STREAM_FD } from "./stream.ts"` doesn't run it.
// ───────────────────────────────────────────────────────────────────────────

if (process.argv[1] === import.meta.filename) {
  main();
}

function main(): void {
  const argv = process.argv.slice(2);
  const name = argv.shift();
  if (!name) {
    process.stderr.write("usage: stream.ts <name> [--cwd=DIR] [--env=K=V ...] <command...>\n");
    process.exit(2);
  }

  // Parse options (stop at first non-flag).
  let cwd: string | undefined;
  let consoleMode = false;
  let stampPath: string | undefined;
  const envOverrides: Record<string, string> = {};

  // Bun's bundled BoringSSL doesn't consult the system trust store, so
  // fetch-cli.ts can't download deps behind a TLS-intercepting proxy whose
  // root is installed into the OS bundle (curl works; bun's fetch() doesn't).
  // Point child Bun processes at the system bundle via NODE_EXTRA_CA_CERTS
  // so dep downloads trust the same roots curl does. Mirror it to
  // CARGO_HTTP_CAINFO so cargo (libcurl) sees the same roots. Each var is
  // only defaulted if the user hasn't set it; no-op if the bundle doesn't
  // exist. Has to be in the child's env (not ours) because Bun snapshots
  // NODE_EXTRA_CA_CERTS at process start.
  {
    let systemCA: string | undefined;
    for (const p of [
      "/etc/ssl/certs/ca-certificates.crt", // Debian/Ubuntu/Alpine
      "/etc/pki/tls/certs/ca-bundle.crt", // Fedora/RHEL
      "/etc/ssl/cert.pem", // macOS/BSD
    ]) {
      try {
        closeSync(openSync(p, "r"));
        systemCA = p;
        break;
      } catch {}
    }
    if (systemCA !== undefined) {
      if (process.env.NODE_EXTRA_CA_CERTS === undefined) envOverrides.NODE_EXTRA_CA_CERTS = systemCA;
      if (process.env.CARGO_HTTP_CAINFO === undefined) envOverrides.CARGO_HTTP_CAINFO = systemCA;
    }
  }

  while (argv[0]?.startsWith("--")) {
    const opt = argv.shift()!;
    if (opt.startsWith("--cwd=")) {
      cwd = opt.slice(6);
    } else if (opt.startsWith("--env=")) {
      const kv = opt.slice(6);
      const eq = kv.indexOf("=");
      if (eq > 0) envOverrides[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (opt === "--console") {
      consoleMode = true;
    } else if (opt.startsWith("--stamp=")) {
      stampPath = opt.slice(8);
    } else {
      process.stderr.write(`stream.ts: unknown option ${opt}\n`);
      process.exit(2);
    }
  }

  // Create an empty stamp file after the child exits 0. Lets ninja chain
  // dependents on commands that don't naturally produce an output file
  // (e.g. typecheck runs) — cross-platform, no shell tricks. If the child
  // fails, skip the stamp so ninja will retry.
  const writeStamp = (): void => {
    if (stampPath !== undefined) {
      closeSync(openSync(stampPath, "w"));
    }
  };

  const cmd = argv;
  if (cmd.length === 0) {
    process.stderr.write("stream.ts: no command given\n");
    process.exit(2);
  }

  // ─── Console mode: passthrough with Windows compensation ───
  if (consoleMode) {
    const compensate = process.platform === "win32" && process.stderr.isTTY;
    if (compensate) process.stderr.write("\n");
    const result = spawnSync(cmd[0]!, cmd.slice(1), {
      stdio: "inherit",
      cwd,
      env: Object.keys(envOverrides).length > 0 ? { ...process.env, ...envOverrides } : undefined,
    });
    if (compensate) process.stderr.write("\x1b[1A");
    if (result.error) {
      process.stderr.write(`[${name}] spawn failed: ${result.error.message}\n`);
      process.exit(127);
    }
    const exitCode = result.status ?? (result.signal ? 1 : 0);
    if (exitCode === 0) writeStamp();
    process.exit(exitCode);
  }

  // Probe STREAM_FD. If build.ts set it up, it's a dup of the terminal.
  // If not (direct ninja invocation, CI without build.ts, etc.), fall
  // back to stdout which ninja will buffer — less nice but functional.
  //
  // TODO(windows): a numeric fd won't work on Windows. Need to inherit
  // a HANDLE and open it via `CONOUT$` or CreateFile. The fallback path
  // (stdout) works, just buffered. When porting, test stdio[STREAM_FD]
  // in build.ts's spawnSync actually inherits on Windows (CreateProcessA
  // has bInheritHandles=TRUE in ninja — see subprocess-win32.cc).
  let out: NodeJS.WritableStream;
  let outFd: number;
  try {
    writeSync(STREAM_FD, ""); // 0-byte write: throws EBADF if fd isn't open
    // autoClose false: the fd is shared across parallel stream.ts procs.
    out = createWriteStream("", { fd: STREAM_FD, autoClose: false });
    outFd = STREAM_FD;
  } catch {
    out = process.stdout;
    outFd = 1;
  }

  // "Interactive" = we're on the FD 3 bypass. build.ts only opens FD 3
  // when its stderr is a TTY, so this check alone tells us a human is
  // watching. Fallback mode (outFd=1, FD 3 not set up) means piped —
  // either scripts/bd logging, CI, or direct `ninja` — and in all those
  // cases we want the quiet treatment: no colors, ninja buffers per-job.
  const interactive = outFd === STREAM_FD;
  const useColor = interactive && !process.env.NO_COLOR && process.env.TERM !== "dumb";

  // Color the prefix so interleaved parallel output is visually separable.
  // Hash-to-color: same dep always gets the same color across runs.
  const prefix = useColor ? coloredPrefix(name) : `[${name}] `;

  const stdio: import("node:child_process").StdioOptions = ["inherit", "pipe", "pipe"];

  const child = spawn(cmd[0]!, cmd.slice(1), {
    stdio,
    cwd,
    env: Object.keys(envOverrides).length > 0 ? { ...process.env, ...envOverrides } : undefined,
  });

  // Ninja's smart-terminal mode ends each `[N/M] description` status line
  // with \r (not \n) so the next status overwrites in place. We write to
  // the same terminal via FD 3, so ninja's status can appear BETWEEN any
  // two of our lines. `\r\x1b[K` (return-to-col-0 + clear-to-eol) before
  // every line guarantees a clean row: if ninja's status is sitting
  // there, it's wiped; if the cursor is already at col 0 on an empty
  // row (after our own \n), the clear is a no-op. A single leading \n
  // (the old approach) only protected the first write — subsequent lines
  // could still glue onto a mid-update ninja status.
  //
  // Only in interactive mode — piped output has no status-line race.
  const lead = interactive ? "\r\x1b[K" : "";
  const write = (text: string): void => {
    out.write(lead + text);
  };

  // Line-split + prefix + forward. readline handles partial lines at EOF
  // correctly (emits the trailing fragment without a newline).
  const pump = (stream: NodeJS.ReadableStream): void => {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", line => write(prefix + line + "\n"));
  };
  pump(child.stdout!);
  pump(child.stderr!);

  // writeSync for final messages: out.write() is async; process.exit()
  // terminates before the WriteStream buffer flushes. Sync write ensures
  // the last line actually reaches the terminal on error paths.
  const writeFinal = (text: string): void => {
    writeSync(outFd, lead + prefix + text);
  };

  child.on("error", err => {
    writeFinal(`spawn failed: ${err.message}\n`);
    process.exit(127);
  });

  child.on("close", (code, signal) => {
    if (signal) {
      writeFinal(`killed by ${signal}\n`);
      process.exit(1);
    }
    if (code === 0) writeStamp();
    process.exit(code ?? 1);
  });
}
