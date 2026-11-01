// A kernel for Linux on ARM64 may have pages of 64 KB: RHEL 8, Oracle's UEK, the 64k kernels for NVIDIA Grace. Plain Bun runs there. A compiled program aborted
// before its first statement: what lies above its instance was laid out in steps of 16 KB, and the page that a loop polls could not be a page of its own.
// No machine of CI has such a kernel, so a library in front of libc imitates one: ./pages-64k.c.
// A real one has confirmed the library (2026-11-01, Linux 6.18 with pages of 64 KB on a Graviton3): the three programs below ran there, and what aborts under the library aborted there.
import { expect } from "bun:test";
import { bunEnv, bunExe, isArm64, isASAN, isLinux, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";

const cc = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const programs = join(import.meta.dir, "parallel");
const isThere = "pages64k: a page has 65536 bytes\n";

test.skipIf(!!unsupported || !isLinux || !isArm64 || isASAN || !cc)(
  "a compiled program runs where a page has 64 KB",
  async () => {
    await slot(async () => {
      using dir = tempDir("aot-pages-64k", { "hello.ts": `console.log("hello", [1, 2, 3].map(n => n * 2).join());\n` });
      const folder = String(dir);
      const library = join(folder, "pages-64k.so");
      const compiled = await spawned(
        [cc!, "-O1", "-shared", "-fPIC", "-o", library, join(import.meta.dir, "pages-64k.c"), "-ldl"],
        folder,
        bunEnv,
      );
      expect({ stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const on64KB = {
        ...bunEnv,
        LD_PRELOAD: bunEnv.LD_PRELOAD ? `${library}:${bunEnv.LD_PRELOAD}` : library,
        PAGES64K_LOG: "1",
      };
      for (const [program, env] of [
        [join(folder, "hello.ts"), {}],
        // Every poll fires: the page that the loops poll is protected and opened again.
        [
          join(programs, "soundness", "polls-in-functions-that-call-nothing-come-back.js"),
          { BUN_JSC_forceTrapAwareStackChecks: "1" },
        ],
        // A second thread has an instance of its own, and the poll is its loop's only way out.
        [join(programs, "calls", "worker-terminated-inside-loop-calls.ts"), {}],
      ] as const) {
        const executable = join(folder, "program");
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", program, "--outfile", executable],
          folder,
          bunEnv,
        );
        expect(built.exitCode).toBe(0);
        const asEver = await spawned([executable], folder, { ...bunEnv, ...env });
        expect({ stderr: asEver.stderr, exitCode: asEver.exitCode }).toEqual({ stderr: "", exitCode: 0 });
        const there = await spawned([executable], folder, { ...on64KB, ...env });
        // The library says once a process that it is there, and no call is refused.
        expect(there.stderr).toStartWith(isThere);
        expect({
          stdout: there.stdout,
          stderr: there.stderr.replaceAll(isThere, ""),
          exitCode: there.exitCode,
        }).toEqual({
          stdout: asEver.stdout,
          stderr: "",
          exitCode: 0,
        });
      }
    });
  },
  240_000,
);
