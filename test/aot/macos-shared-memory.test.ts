// On macOS `bun test --aot` hands the compiled program over in a deleted file, not in POSIX shared memory. These answers of the
// kernel decide it. They are asked from inside Bun, which has the entitlements that matter. If one changes, look again.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isMacOS, tempDir } from "harness";
import { join } from "node:path";

const cc = Bun.which("cc") || Bun.which("clang");

test.skipIf(!isMacOS || !isArm64 || !cc)("code cannot be shared through POSIX shared memory", async () => {
  using dir = tempDir("macos-shared-memory", {});
  const library = join(String(dir), "questions.dylib");
  await using compiler = Bun.spawn({
    cmd: [cc!, "-dynamiclib", "-o", library, join(import.meta.dir, "macos-shared-memory.c")],
    env: bunEnv,
    stderr: "inherit",
  });
  expect(await compiler.exited).toBe(0);

  const script = `require("bun:ffi").dlopen(${JSON.stringify(library)}, { ask: { args: [], returns: "void" } }).symbols.ask();`;
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "inherit" });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout.trim().split("\n")).toEqual([
    "a name of 32 bytes: no",
    "ftruncate: yes",
    "st_size as ftruncate was given it: no",
    "st_size rounded up to a page: yes",
    "a second ftruncate: no",
    "write: no",
    "pwrite: no",
    "read: no",
    "pread: no",
    "a private view: no",
    "a shared view that can be written: yes",
    "a shared view that can be executed: no",
    "mprotect of a shared view to executable: no",
    "a higher maximum for a shared view: no",
    "mach_vm_read of a shared view: yes",
    "a copy that shares the pages: no",
  ]);
  expect(exitCode).toBe(0);
});
