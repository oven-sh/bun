/**
 * A GNU-make-style jobserver for the rustc processes ninja runs.
 *
 * ninja bounds how many *edges* run at once; it cannot see that one rustc spawns worker threads of its
 * own (`-Zthreads=8` frontend workers locally, one LLVM thread per codegen unit), nor that a pipelined
 * rustc outlives its metadata edge (rust/run.ts). Under cargo both were bounded by cargo's jobserver:
 * every running rustc held one token and its extra threads drew from the same pool, which rustc finds
 * through `CARGO_MAKEFLAGS`. This recreates that pool — one token per hardware thread — and rust/run.ts
 * takes a token per live rustc. Only `CARGO_MAKEFLAGS` is set, not `MAKEFLAGS`: rustc (and cc-rs in
 * build scripts) participate; ninja itself and the nested dep builds are scheduled exactly as before.
 *
 * POSIX: a fifo (`--jobserver-auth=fifo:PATH`, the make 4.4 protocol; nothing to inherit across exec).
 * Windows: a named semaphore (`--jobserver-auth=NAME`, make's Windows protocol). Creating and waiting on
 * it takes Win32 calls, made through bun:ffi: the build driver (which may be running under Node) starts
 * `bun jobserver.ts serve NAME COUNT` to create and hold the semaphore for the build's lifetime, and the
 * rustc edges run under Bun (rust/emit.ts). Where there is still no pool (a filesystem without fifos,
 * ninja run by hand) run.ts compiles libraries unpipelined, so that ninja's -j bounds the rustc processes.
 */

import { spawn, spawnSync } from "node:child_process";
import { closeSync, constants, existsSync, openSync, readSync, rmSync, writeSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

export interface Jobserver {
  /** Environment to add for ninja's children. */
  env: Record<string, string>;
  /** Release OS resources (the pool dies with this process anyway). */
  close(): void;
}

/** `--jobserver-auth=` value → the make protocol it names. */
function parseAuth(makeflags: string | undefined): { fifo: string } | { semaphore: string } | undefined {
  const auth = /--jobserver-auth=(\S+)/.exec(makeflags ?? "")?.[1];
  if (auth === undefined) return undefined;
  if (auth.startsWith("fifo:")) return { fifo: auth.slice("fifo:".length) };
  if (process.platform === "win32") return { semaphore: auth };
  return undefined; // `R,W` inherited descriptors: not something this pool hands out
}

export async function createJobserver(hostOs: string, bun: string): Promise<Jobserver | undefined> {
  // Every process asks the pool for every token it uses (no participant keeps make's "implicit" token), so the
  // pool holds the full count.
  const tokens = availableParallelism();
  if (hostOs === "windows") return await createSemaphoreJobserver(tokens, bun);
  return createFifoJobserver(tokens);
}

function createFifoJobserver(tokens: number): Jobserver | undefined {
  // The path travels inside the whitespace-separated CARGO_MAKEFLAGS, so it must not contain a space: the system
  // temp directory rather than the build directory (checkouts under "My Projects" exist).
  const path = join(tmpdir(), `bun-build-jobserver-${process.pid}.fifo`);
  if (/\s/.test(path)) return undefined;
  rmSync(path, { force: true });
  const mk = spawnSync("mkfifo", ["-m", "600", path], { stdio: "ignore" });
  if (mk.status !== 0 || !existsSync(path)) return undefined;
  // O_RDWR: opening a fifo for both ends never blocks, and keeping this descriptor open for the life of the build
  // keeps the unread tokens alive (a fifo's buffer is dropped with its last opener).
  const fd = openSync(path, constants.O_RDWR | constants.O_NONBLOCK);
  writeSync(fd, "|".repeat(tokens));
  return {
    env: { CARGO_MAKEFLAGS: `-j --jobserver-auth=fifo:${path}` },
    close() {
      closeSync(fd);
      rmSync(path, { force: true });
    },
  };
}

/** kernel32 through bun:ffi, or undefined under Node. */
function kernel32() {
  if (process.platform !== "win32" || process.versions.bun === undefined) return undefined;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { dlopen, FFIType, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const lib = dlopen("kernel32.dll", {
    CreateSemaphoreW: { args: [FFIType.ptr, FFIType.i32, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
    OpenSemaphoreW: { args: [FFIType.u32, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
    WaitForSingleObject: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
    ReleaseSemaphore: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
  });
  const wide = (s: string) => ptr(Buffer.from(s + "\0", "utf16le"));
  return { ...lib.symbols, wide };
}

/** Start `bun jobserver.ts serve` (below) to hold the semaphore; it exits when this process does (its stdin closes). */
async function createSemaphoreJobserver(tokens: number, bun: string): Promise<Jobserver | undefined> {
  const name = `bun-build-jobserver-${process.pid}`;
  const child = spawn(bun, [import.meta.filename, "serve", name, String(tokens)], {
    stdio: ["pipe", "pipe", "inherit"],
    windowsHide: true,
  });
  const ready = await new Promise<boolean>(resolve => {
    child.stdout!.once("data", d => resolve(String(d).startsWith("ready")));
    child.once("exit", () => resolve(false));
    child.once("error", () => resolve(false));
  });
  if (!ready) return undefined;
  child.unref();
  (child.stdout as unknown as { unref?: () => void }).unref?.();
  (child.stdin as unknown as { unref?: () => void }).unref?.();
  return {
    env: { CARGO_MAKEFLAGS: `-j --jobserver-auth=${name}` },
    close() {
      child.stdin!.end();
    },
  };
}

// `jobserver.ts serve NAME COUNT`: create the named semaphore, say "ready", hold it until stdin closes.
if (process.argv[1] === import.meta.filename && process.argv[2] === "serve") {
  const [name, count] = process.argv.slice(3);
  const k32 = kernel32();
  const handle =
    k32 !== undefined && name !== undefined
      ? k32.CreateSemaphoreW(null, Number(count), Number(count), k32.wide(name))
      : null;
  if (!handle) {
    process.stderr.write("jobserver.ts serve: needs Bun on Windows (bun:ffi) to create the semaphore\n");
    process.exit(1);
  }
  process.stdout.write("ready\n");
  process.stdin.on("end", () => process.exit(0));
  process.stdin.on("close", () => process.exit(0));
  process.stdin.resume();
}

// ───────────────────────────────────────────────────────────────────────────
// Client side (rust/run.ts): one token per running rustc
// ───────────────────────────────────────────────────────────────────────────

/** A held token; `release` returns it to the pool (idempotent). */
export interface JobserverToken {
  release(): void;
}

/** Whether `CARGO_MAKEFLAGS` names a pool this process can take tokens from. */
export function jobserverAvailable(): boolean {
  const auth = parseAuth(process.env.CARGO_MAKEFLAGS);
  if (auth === undefined) return false;
  if ("fifo" in auth) return existsSync(auth.fifo);
  return kernel32() !== undefined;
}

/** Block until a token is available in the pool `CARGO_MAKEFLAGS` names and take it; undefined when there is no usable pool. */
export function acquireJobserverToken(): JobserverToken | undefined {
  const auth = parseAuth(process.env.CARGO_MAKEFLAGS);
  if (auth === undefined) return undefined;
  if ("fifo" in auth) {
    let fd: number;
    try {
      fd = openSync(auth.fifo, "r+"); // O_RDWR without O_NONBLOCK: the read below blocks until a token arrives
    } catch {
      return undefined;
    }
    const byte = Buffer.alloc(1);
    if (readSync(fd, byte, 0, 1, null) !== 1) {
      closeSync(fd);
      return undefined;
    }
    let held = true;
    return {
      release() {
        if (!held) return;
        held = false;
        try {
          writeSync(fd, byte);
        } catch {
          // pool gone (build over): nothing to return it to
        } finally {
          closeSync(fd);
        }
      },
    };
  }
  const k32 = kernel32();
  if (k32 === undefined) return undefined;
  const SYNCHRONIZE = 0x00100000;
  const SEMAPHORE_MODIFY_STATE = 0x0002;
  const handle = k32.OpenSemaphoreW(SYNCHRONIZE | SEMAPHORE_MODIFY_STATE, 0, k32.wide(auth.semaphore));
  if (!handle) return undefined;
  if (k32.WaitForSingleObject(handle, 0xffffffff) !== 0) {
    k32.CloseHandle(handle);
    return undefined;
  }
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      k32.ReleaseSemaphore(handle, 1, null);
      k32.CloseHandle(handle);
    },
  };
}
