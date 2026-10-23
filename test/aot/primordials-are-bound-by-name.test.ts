// internal/primordials has two texts: the interpreter's walks the keys of Map, Set and WeakMap, the compiler's (src/js/ahead-of-time) binds each member under a constant key.
// The fixture prints all that a program could see of the module's exports. Both texts must print the same, and both must agree with the walk that the fixture makes itself.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, told, unsupported } from "./run-programs";

test.skipIf(!!unsupported)(
  "compile/aot/the members of the safe classes are those that walking the keys of their built-ins gives",
  () =>
    slot(async () => {
      using dir = tempDir("aot-primordials", {});
      const fixture = join(import.meta.dir, "primordials-are-bound-by-name.fixture.mjs");
      const executable = join(String(dir), "program");
      built(
        await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            "--compile-exec-argv=--expose-internals",
            fixture,
            "--outfile",
            executable,
          ],
          String(dir),
          bunEnv,
        ),
      );
      const plain = await spawned([bunExe(), "--expose-internals", fixture], String(dir), bunEnv);
      const compiled = await spawned([executable], String(dir), bunEnv);
      expect(compiled.signal).toBeNull();
      expect(told(compiled)).toEqual(told(plain));
      expect(plain.stdout.match(/the keys are those of the walk: true true$/gm)).toHaveLength(3);
    }),
  600_000,
);
