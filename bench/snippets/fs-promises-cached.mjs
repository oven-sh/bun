// Async node:fs calls whose answer the kernel already holds in memory, beside their sync twins
// and beside calls that the kernel cannot answer from memory.
//
//   bun fs-promises-cached.mjs            time per call (mitata)
//   bun fs-promises-cached.mjs --usage    CPU time and context switches per call, whole process
//
// The files are in a temporary directory that becomes the working directory, and the paths
// are relative: an absolute path is answered only on the mount of the root directory.
// BUN_FEATURE_FLAG_DISABLE_ASYNC_FS_FAST_PATH=1 gives the thread pool's numbers.
import { existsSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { lstat, readFile, stat } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "fs-promises-cached-"));
process.chdir(dir);
writeFileSync("file.txt", "x".repeat(1024));
symlinkSync("file.txt", "link");
writeFileSync("large.bin", Buffer.alloc(2 << 20, 1));
// The first lookup of each name puts it into the kernel's cache.
statSync("file.txt");
existsSync("missing.txt");
// A path on another mount than the working directory's, if this machine has the usual one.
const otherMount = existsSync("/proc/self/stat") ? "/proc/self/stat" : null;

const missing = path => stat(path).catch(() => {});
const statCallback = path => new Promise(resolve => fs.stat(path, resolve));
let fresh = 0;
// A name that nothing has looked up: the kernel cannot say whether it exists.
const neverSeen = () => missing("never-seen-" + fresh++);

const single = {
  "statSync(file)": () => statSync("file.txt"),
  "await stat(file)": () => stat("file.txt"),
  "await lstat(symlink)": () => lstat("link"),
  "await stat(file of 2 MiB)": () => stat("large.bin"),
  "await stat(missing)": () => missing("missing.txt"),
  "fs.stat(file, callback)": () => statCallback("file.txt"),
  ...(typeof Bun !== "undefined" && { "await Bun.file(file).stat()": () => Bun.file("file.txt").stat() }),
  "await readFile(1 KB), not answered": () => readFile("file.txt"),
  "await stat(never seen), not answered": neverSeen,
  ...(otherMount && { "await stat(other mount), not answered": () => stat(otherMount) }),
};

const widths = [2, 4, 8, 16, 17, 32, 64, 1024];
const many = (width, call) => Promise.all(Array.from({ length: width }, call));
const batches = {
  "stat(file)": width => many(width, () => stat("file.txt")),
  "stat(missing)": width => many(width, () => missing("missing.txt")),
  "stat(never seen)": width => many(width, neverSeen),
  "stat(file), one never seen first": width => many(width, (_, i) => (i === 0 ? neverSeen() : stat("file.txt"))),
  "stat(file), one never seen last": width => many(width, (_, i) => (i === width - 1 ? neverSeen() : stat("file.txt"))),
  "stat(file) then readFile, half each": width =>
    many(width, (_, i) => (i < width / 2 ? stat("file.txt") : readFile("file.txt"))),
};

// Calls that nothing awaits together: `width` of them are under way at any time.
const stream = (width, total) =>
  new Promise(resolve => {
    let started = 0;
    let settled = 0;
    const next = () => {
      if (++settled === total) return resolve();
      if (started < total) start();
    };
    const start = () => {
      started++;
      stat("file.txt").then(next);
    };
    for (let i = 0; i < width; i++) start();
  });

if (process.argv.includes("--usage")) {
  const usage = async (name, calls, work) => {
    await work();
    const before = process.resourceUsage();
    const started = performance.now();
    await work();
    const wall = performance.now() - started;
    const after = process.resourceUsage();
    const cpu = after.userCPUTime + after.systemCPUTime - before.userCPUTime - before.systemCPUTime;
    const switches =
      after.voluntaryContextSwitches +
      after.involuntaryContextSwitches -
      before.voluntaryContextSwitches -
      before.involuntaryContextSwitches;
    console.log(
      `${name.padEnd(52)} ${((wall * 1000) / calls).toFixed(2).padStart(8)} us  ${(cpu / calls).toFixed(2).padStart(8)} us CPU  ${(switches / calls).toFixed(2).padStart(6)} switches`,
    );
  };
  const CALLS = Number(process.env.CALLS) || 50_000;
  // Every name that is never seen before stays in the kernel's cache afterwards.
  const callsOf = name => (name.includes("(never seen)") ? CALLS / 10 : CALLS);
  for (const [name, call] of Object.entries(single)) {
    const calls = callsOf(name);
    await usage(name, calls, async () => {
      for (let i = 0; i < calls; i++) await call();
    });
  }
  for (const [name, batch] of Object.entries(batches)) {
    for (const width of widths) {
      const rounds = Math.max(1, Math.floor(callsOf(name) / width));
      await usage(`${width} x ${name}`, rounds * width, async () => {
        for (let i = 0; i < rounds; i++) await batch(width);
      });
    }
  }
  for (const width of [4, 8, 16]) {
    await usage(`stream of ${width} x stat(file)`, CALLS, () => stream(width, CALLS));
  }
} else {
  const { bench, group, run } = await import("../runner.mjs");
  group("one call", () => {
    for (const [name, call] of Object.entries(single)) bench(name, call);
  });
  for (const width of widths) {
    group(`${width} calls at once`, () => {
      for (const [name, batch] of Object.entries(batches)) bench(`${width} x ${name}`, () => batch(width));
    });
  }
  group("calls that nothing awaits together", () => {
    for (const width of [4, 8, 16]) bench(`stream of ${width} x stat(file), 1000 calls`, () => stream(width, 1000));
  });
  await run();
}

process.chdir(tmpdir());
rmSync(dir, { recursive: true, force: true });
