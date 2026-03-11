#!/usr/bin/env bun
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
 * TTY UI (zig's spinner, lld's progress). Ninja defers its own [N/M] while
 * the console job owns the terminal.
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
 *   command = bun /path/to/stream.ts $name --console $zig build obj ...
 *   pool = console
 *
 * --cwd=DIR / --env=K=V / --console / --zig-progress go between <name> and
 * <command>. They exist so the rule doesn't need `sh -c '...'` (which would
 * conflict with shell-quoted ninja vars like $args).
 *
 * --zig-progress (prefix mode, posix only): sets ZIG_PROGRESS=3, decodes
 * zig's binary progress protocol into `[zig] Stage [N/M]` lines. Without it,
 * zig sees piped stderr → spinner disabled → silence during compile.
 */

import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, writeSync } from "node:fs";
import { createInterface } from "node:readline";

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
  // Override: zig brand orange (hash would give yellow-green).
  const overrides: Record<string, number> = { zig: 214 };
  const palette = [220, 184, 154, 120, 114, 86, 87, 81, 111, 147, 141, 183];
  // fnv-1a — tiny, good-enough distribution for short strings.
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const color = overrides[name] ?? palette[(h >>> 0) % palette.length];
  // 38;5;N = set foreground to 256-color N. 39 = default foreground.
  return `\x1b[38;5;${color}m[${name}]\x1b[39m `;
}

// ───────────────────────────────────────────────────────────────────────────
// CLI — guarded so `import { STREAM_FD } from "./stream.ts"` doesn't run it.
// ───────────────────────────────────────────────────────────────────────────

if (import.meta.main) {
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
  let zigProgress = false;
  let consoleMode = false;
  const envOverrides: Record<string, string> = {};
  while (argv[0]?.startsWith("--")) {
    const opt = argv.shift()!;
    if (opt.startsWith("--cwd=")) {
      cwd = opt.slice(6);
    } else if (opt.startsWith("--env=")) {
      const kv = opt.slice(6);
      const eq = kv.indexOf("=");
      if (eq > 0) envOverrides[kv.slice(0, eq)] = kv.slice(eq + 1);
    } else if (opt === "--zig-progress") {
      zigProgress = true;
    } else if (opt === "--console") {
      consoleMode = true;
    } else {
      process.stderr.write(`stream.ts: unknown option ${opt}\n`);
      process.exit(2);
    }
  }

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
    process.exit(result.status ?? (result.signal ? 1 : 0));
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
  // cases we want the quiet treatment: no colors, no zig progress,
  // ninja buffers per-job.
  const interactive = outFd === STREAM_FD;
  const useColor = interactive && !process.env.NO_COLOR && process.env.TERM !== "dumb";

  // Color the prefix so interleaved parallel output is visually separable.
  // Hash-to-color: same dep always gets the same color across runs.
  const prefix = useColor ? coloredPrefix(name) : `[${name}] `;

  // ─── Zig progress IPC (interactive only) ───
  // zig's spinner is TTY-only — piped stderr = silence during compile.
  // ZIG_PROGRESS=<fd> makes it write a binary protocol to that fd
  // instead. We open a pipe at child fd 3, set ZIG_PROGRESS=3, decode
  // packets into `[zig] Stage [N/M]` lines.
  //
  // Needs oven-sh/zig's fix for ziglang/zig#24722 — upstream `zig build`
  // strips ZIG_PROGRESS from the build runner's env; the fork forwards
  // it through.
  //
  // Gated on `interactive`: when piped, progress lines are log noise
  // (~35 Code Gen lines that clutter failure logs / LLM context). No
  // FD 3 setup → zig sees no ZIG_PROGRESS → just start + summary.
  const stdio: import("node:child_process").StdioOptions = ["inherit", "pipe", "pipe"];
  if (zigProgress && interactive) {
    envOverrides.ZIG_PROGRESS = "3";
    stdio.push("pipe"); // index 3 = zig's IPC write end
  }

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

  // stdio[3] only exists if we pushed it above (zigProgress && interactive).
  if (child.stdio[3]) {
    decodeZigProgress(child.stdio[3] as NodeJS.ReadableStream, text => write(prefix + text + "\n"));
  }

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
    process.exit(code ?? 1);
  });
}

// ───────────────────────────────────────────────────────────────────────────
// ZIG_PROGRESS protocol decoder
//
// Wire format (vendor/zig/lib/std/Progress.zig writeIpc, all LE):
//   1 byte:  N (node count, u8)
//   N * 48:  Storage[] — per node: u32 completed, u32 total, [40]u8 name
//   N * 1:   Parent[] — per node: u8 (254=unused 255=root else=index)
//
// Packets arrive ~60ms apart. We pick the most-active counted stage from
// each, throttle to 1/sec, dedupe identical lines. Silence during
// uncounted phases (LLVM Emit Object) matches zig's own non-TTY behavior.
// ───────────────────────────────────────────────────────────────────────────

const STORAGE_SIZE = 48; // u32 + u32 + [40]u8, aligned to 8
const NAME_OFFSET = 8;
const NAME_LEN = 40;

function decodeZigProgress(stream: NodeJS.ReadableStream, emit: (text: string) => void): void {
  let buf = Buffer.alloc(0);
  let lastText = "";
  let lastEmit = 0;

  stream.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);

    // Parse complete packets. Packet = 1 + N*48 + N bytes; N is byte 0.
    while (buf.length >= 1) {
      const n = buf[0]!;
      const packetLen = 1 + n * STORAGE_SIZE + n;
      if (buf.length < packetLen) break;

      const packet = buf.subarray(0, packetLen);
      buf = buf.subarray(packetLen);

      const text = renderPacket(packet, n);
      if (text === null || text === lastText) continue;

      // Throttle: counters tick every packet, and `total` GROWS during
      // the build (Code Generation: ~130 → ~120k as zig discovers more
      // work), so count-based bucketing fails. Time-throttle is stable.
      const now = Date.now();
      if (now - lastEmit < 1000) continue;
      lastText = text;
      lastEmit = now;

      emit(text);
    }
  });
}

/**
 * Pick a one-line status from the progress tree.
 *
 * Tree during bun compile (forwarded through the fork's #24722 fix):
 *   root ""                               ← frontend, name cleared
 *   └─ steps [2/5]                        ← build runner's step counter
 *      └─ compile obj bun-debug
 *         ├─ Semantic Analysis [14233]    ← completed-only counter
 *         │  └─ Io.Writer.print__anon_*   ← per-symbol noise, c=0 t=0
 *         ├─ Code Generation [3714/4174]  ← active bounded counter
 *         │  └─ fs.Dir.Walker.next        ← per-symbol noise
 *         └─ Linking [1/11599]            ← barely started
 *
 * Stages run IN PARALLEL and zig reuses node slots — index order is NOT
 * tree depth. The distinguisher is counters: stages have them (c and/or
 * t > 0), per-symbol noise doesn't (c=0 t=0). Strategy: highest-index
 * node with an ACTIVE counter (0 < c < t). Highest index ≈ most recently
 * allocated ≈ most relevant. Fall back to completed-only, then
 * just-started.
 *
 * Returns null when no counted node exists (LLVM phase — 60+ seconds
 * with no counter). Silence matches zig's own non-TTY behavior.
 */
function renderPacket(packet: Buffer, n: number): string | null {
  if (n === 0) return null;

  const read = (idx: number) => {
    const off = 1 + idx * STORAGE_SIZE;
    return {
      name: readName(packet, off + NAME_OFFSET),
      completed: packet.readUInt32LE(off),
      total: packet.readUInt32LE(off + 4),
    };
  };

  const fmt = (name: string, c: number, t: number): string =>
    t > 0 ? `${name} [${c}/${t}]` : c > 0 ? `${name} [${c}]` : name;

  // total === u32::MAX: node holds an IPC fd (parent's reference to a
  // child pipe), not a counter. Never render those.
  const isIpc = (t: number) => t === 0xffffffff;

  // Pass 1: active bounded counter (0 < c < t). Skips finished stages
  // sitting at [976/976] while real work continues elsewhere.
  for (let i = n - 1; i >= 0; i--) {
    const { name, completed, total } = read(i);
    if (isIpc(total) || name.length === 0) continue;
    if (total > 0 && completed > 0 && completed < total) {
      return fmt(name, completed, total);
    }
  }

  // Pass 2: completed-only counter (Semantic Analysis goes to ~250k
  // with no total).
  for (let i = n - 1; i >= 0; i--) {
    const { name, completed, total } = read(i);
    if (isIpc(total) || name.length === 0) continue;
    if (completed > 0 && total === 0) {
      return fmt(name, completed, total);
    }
  }

  // Pass 3: bounded but not started (c=0, t>0).
  for (let i = n - 1; i >= 0; i--) {
    const { name, completed, total } = read(i);
    if (isIpc(total) || name.length === 0) continue;
    if (total > 0) {
      return fmt(name, completed, total);
    }
  }

  return null;
}

/** Read a NUL-padded fixed-width name field. */
function readName(buf: Buffer, offset: number): string {
  const end = offset + NAME_LEN;
  let nul = offset;
  while (nul < end && buf[nul]! !== 0) nul++;
  return buf.toString("utf8", offset, nul);
}
