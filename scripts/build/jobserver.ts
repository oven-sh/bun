/**
 * A GNU-make-style jobserver for the rustc processes ninja runs.
 *
 * ninja already limits how many *processes* run at once; what it cannot see is that a single rustc
 * spawns worker threads of its own (`-Zthreads=8` frontend workers locally, one LLVM thread per codegen
 * unit). Under cargo those threads drew tokens from cargo's jobserver, so N crates × M threads never
 * meant N×M runnable threads; rustc looks for that jobserver in `CARGO_MAKEFLAGS` and, finding none,
 * gives every process its own pool the size of the machine. This recreates cargo's arrangement: one
 * pool with a token per hardware thread, advertised through `CARGO_MAKEFLAGS` only — rustc (and
 * cc-rs in build scripts) participate; ninja itself and the nested dep builds are scheduled exactly as
 * before.
 *
 * POSIX: a fifo (`--jobserver-auth=fifo:PATH`, the make 4.4 protocol; nothing to inherit across
 * exec). Windows: a named semaphore (`--jobserver-auth=NAME`), which needs a Win32 call and is
 * therefore only created when this script runs under Bun (bun:ffi); under Node on Windows rustc keeps
 * its per-process pools, as it did whenever cargo was not involved.
 */

import { spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, mkdirSync, openSync, rmSync, writeSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";

export interface Jobserver {
  /** Environment to add for ninja's children. */
  env: Record<string, string>;
  /** Release OS resources (the pool dies with this process anyway). */
  close(): void;
}

export function createJobserver(buildDir: string, hostOs: string): Jobserver | undefined {
  const tokens = availableParallelism();
  if (hostOs === "windows") return createSemaphoreJobserver(tokens);
  return createFifoJobserver(buildDir, tokens);
}

function createFifoJobserver(buildDir: string, tokens: number): Jobserver | undefined {
  mkdirSync(buildDir, { recursive: true });
  const path = join(buildDir, `jobserver-${process.pid}.fifo`);
  rmSync(path, { force: true });
  const mk = spawnSync("mkfifo", ["-m", "600", path], { stdio: "ignore" });
  if (mk.status !== 0 || !existsSync(path)) return undefined;
  // O_RDWR: opening a fifo for both ends never blocks, and keeping this descriptor open for the life
  // of the build keeps the unread tokens alive (a fifo's buffer is dropped with its last opener).
  const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
  // One implicit token per process is the protocol's convention (make itself holds one); the pool
  // carries the rest. rustc takes its first thread as the implicit token and acquires the others.
  writeSync(fd, "|".repeat(Math.max(1, tokens - 1)));
  return {
    env: { CARGO_MAKEFLAGS: `-j --jobserver-auth=fifo:${path}` },
    close() {
      closeSync(fd);
      rmSync(path, { force: true });
    },
  };
}

function createSemaphoreJobserver(tokens: number): Jobserver | undefined {
  if (process.versions.bun === undefined) return undefined;
  // bun:ffi — resolved at runtime so this file loads under Node too.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const k32 = dlopen("kernel32.dll", {
    CreateSemaphoreW: { args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  const name = `bun-build-jobserver-${process.pid}`;
  const wide = Buffer.from(name + "\0", "utf16le");
  const count = Math.max(1, tokens - 1);
  const handle = k32.symbols.CreateSemaphoreW(null, count, count, ptr(wide));
  if (handle === null || handle === 0) return undefined;
  return {
    env: { CARGO_MAKEFLAGS: `-j --jobserver-auth=${name}` },
    close() {
      k32.symbols.CloseHandle(handle);
    },
  };
}
