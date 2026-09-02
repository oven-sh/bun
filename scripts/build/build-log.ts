/**
 * On-disk state of the TypeScript build executor (`executor.ts`). Two
 * append-only JSON-lines files in the build directory, the counterparts of
 * ninja's `.ninja_log` and `.ninja_deps`:
 *
 * - `.build_log`: per output, the hash of the command that produced it, the
 *   filesystem time the command started, and how long it took. The hash is
 *   what makes a flag change rebuild; the start time is what makes an input
 *   edited mid-compile rebuild; the duration feeds the scheduler's
 *   critical-path weights.
 * - `.build_deps`: per output, the headers the compiler reported (depfile or
 *   /showIncludes), with the output's mtime at the time of recording. A path
 *   table keeps the file small: a header is written once and referenced by
 *   index afterwards.
 *
 * Both files are rewritten compacted when dead entries outnumber live ones.
 * A truncated trailing line (crash mid-write) is ignored on load.
 */

import { closeSync, openSync, readFileSync, renameSync, writeFileSync, writeSync } from "node:fs";
import { resolve } from "node:path";

export interface LogEntry {
  /** Hash of the expanded command line (plus response file content). */
  commandHash: string;
  /** Filesystem time (ms) when the command started. See `Executor.fsNow()`. */
  startMtime: number;
  /** Wall-clock duration of the command in ms. Scheduler weight. */
  durationMs: number;
}

export const BUILD_LOG_FILE = ".build_log";
export const DEPS_LOG_FILE = ".build_deps";

const LOG_HEADER = "# bun build log v1";
const DEPS_HEADER = "# bun build deps v1";

export class BuildLog {
  private readonly path: string;
  private readonly entries = new Map<string, LogEntry>();
  private lineCount = 0;
  private fd: number | undefined;

  constructor(buildDir: string) {
    this.path = resolve(buildDir, BUILD_LOG_FILE);
  }

  load(): void {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return;
    }
    const lines = text.split("\n");
    if (lines[0] !== LOG_HEADER) return;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.length === 0) continue;
      let rec: unknown;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Array.isArray(rec) || rec.length !== 4) continue;
      const [output, commandHash, startMtime, durationMs] = rec as [string, string, number, number];
      this.entries.set(output, { commandHash, startMtime, durationMs });
      this.lineCount++;
    }
  }

  lookup(output: string): LogEntry | undefined {
    return this.entries.get(output);
  }

  /** Record one finished edge. One line per output, like ninja. */
  record(outputs: readonly string[], entry: LogEntry): void {
    if (this.fd === undefined) this.open();
    let text = "";
    for (const output of outputs) {
      this.entries.set(output, entry);
      text += JSON.stringify([output, entry.commandHash, entry.startMtime, entry.durationMs]) + "\n";
      this.lineCount++;
    }
    writeSync(this.fd!, text);
  }

  close(): void {
    if (this.fd !== undefined) {
      closeSync(this.fd);
      this.fd = undefined;
    }
    if (this.lineCount > 2 * this.entries.size + 1000) this.compact();
  }

  private open(): void {
    if (this.lineCount === 0) {
      writeFileSync(this.path, LOG_HEADER + "\n");
    }
    this.fd = openSync(this.path, "a");
  }

  private compact(): void {
    let text = LOG_HEADER + "\n";
    for (const [output, e] of this.entries) {
      text += JSON.stringify([output, e.commandHash, e.startMtime, e.durationMs]) + "\n";
    }
    writeFileSync(this.path + ".tmp", text);
    renameSync(this.path + ".tmp", this.path);
    this.lineCount = this.entries.size;
  }
}

export interface DepsEntry {
  /** mtime (ms) of the output when the deps were recorded. Older than the file now → stale. */
  mtime: number;
  deps: readonly string[];
}

export class DepsLog {
  private readonly path: string;
  private readonly entries = new Map<string, DepsEntry>();
  private readonly paths: string[] = [];
  private readonly pathIds = new Map<string, number>();
  private recordCount = 0;
  private fd: number | undefined;

  constructor(buildDir: string) {
    this.path = resolve(buildDir, DEPS_LOG_FILE);
  }

  load(): void {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch {
      return;
    }
    const lines = text.split("\n");
    if (lines[0] !== DEPS_HEADER) return;
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.length === 0) continue;
      let rec: unknown;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (!Array.isArray(rec)) continue;
      if (rec[0] === "p" && typeof rec[1] === "string") {
        this.intern(rec[1], false);
      } else if (rec[0] === "d" && typeof rec[1] === "number" && Array.isArray(rec[3])) {
        const output = this.paths[rec[1]];
        if (output === undefined) continue;
        const deps: string[] = [];
        for (const id of rec[3] as number[]) {
          const p = this.paths[id];
          if (p !== undefined) deps.push(p);
        }
        this.entries.set(output, { mtime: rec[2] as number, deps });
        this.recordCount++;
      }
    }
  }

  lookup(output: string): DepsEntry | undefined {
    return this.entries.get(output);
  }

  record(output: string, mtime: number, deps: readonly string[]): void {
    const existing = this.entries.get(output);
    if (
      existing !== undefined &&
      existing.mtime === mtime &&
      existing.deps.length === deps.length &&
      existing.deps.every((d, i) => d === deps[i])
    ) {
      return;
    }
    if (this.fd === undefined) this.open();
    let text = "";
    const ids: number[] = [];
    const outId = this.intern(output, true, s => (text += s));
    for (const d of deps) ids.push(this.intern(d, true, s => (text += s)));
    text += JSON.stringify(["d", outId, mtime, ids]) + "\n";
    writeSync(this.fd!, text);
    this.entries.set(output, { mtime, deps: [...deps] });
    this.recordCount++;
  }

  close(): void {
    if (this.fd !== undefined) {
      closeSync(this.fd);
      this.fd = undefined;
    }
    if (this.recordCount > 2 * this.entries.size + 100) this.compact();
  }

  private intern(path: string, write: boolean, emit?: (line: string) => void): number {
    let id = this.pathIds.get(path);
    if (id === undefined) {
      id = this.paths.length;
      this.paths.push(path);
      this.pathIds.set(path, id);
      if (write && emit !== undefined) emit(JSON.stringify(["p", path]) + "\n");
    }
    return id;
  }

  private open(): void {
    if (this.recordCount === 0 && this.paths.length === 0) {
      writeFileSync(this.path, DEPS_HEADER + "\n");
    }
    this.fd = openSync(this.path, "a");
  }

  private compact(): void {
    // Rebuild the path table from live entries only.
    this.paths.length = 0;
    this.pathIds.clear();
    let text = DEPS_HEADER + "\n";
    const emit = (line: string) => (text += line);
    for (const [output, e] of this.entries) {
      const outId = this.intern(output, true, emit);
      const ids = e.deps.map(d => this.intern(d, true, emit));
      text += JSON.stringify(["d", outId, e.mtime, ids]) + "\n";
    }
    writeFileSync(this.path + ".tmp", text);
    renameSync(this.path + ".tmp", this.path);
    this.recordCount = this.entries.size;
  }
}
