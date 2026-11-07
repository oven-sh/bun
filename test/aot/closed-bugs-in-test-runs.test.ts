import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { cpSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Each folder beside this file is what showed a bug of `bun test --aot` that is closed, as it was found. Its test files are stored
// as `.scene.` files, so that nothing takes them for tests of this repository. A compiled run ends and says what a plain run does.
const scenes: Record<string, { flags: string[]; says: string }> = {
  "2993-virtual-modules-of-a-preloaded-plugin": { flags: ["--isolate", "--parallel=2"], says: "SEEN" },
  "3013-stringify-and-a-replaced-to-iso-string": { flags: ["--isolate", "--parallel=2"], says: "SEEN" },
  "3013-stringify-and-a-replaced-to-json": { flags: ["--isolate", "--parallel=2"], says: "SEEN" },
  "3026-module-written-by-a-test-requires-a-mocked-module": { flags: [], says: "RESULT" },
  "3088-json-required-in-a-fresh-realm": { flags: ["--isolate"], says: "R " },
  "3092-module-written-by-a-test-then-imported-by-a-literal": { flags: [], says: "SAID" },
};
const stored = join(import.meta.dir, "closed-bugs-in-test-runs");

test("every stored scene is run", () => {
  expect(readdirSync(stored).sort()).toEqual(Object.keys(scenes).sort());
});

for (const [scene, { flags, says }] of Object.entries(scenes)) {
  test.concurrent(
    scene,
    async () => {
      async function report(...more: string[]) {
        using dir = tempDir(`aot-closed-bug-${scene.split("-")[0]}`, {});
        cpSync(join(stored, scene), String(dir), { recursive: true });
        for (const path of readdirSync(String(dir), { recursive: true, encoding: "utf8" }))
          if (path.includes(".scene."))
            renameSync(join(String(dir), path), join(String(dir), path.replace(".scene.", ".test.")));
        const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...more, ...flags], String(dir), bunEnv);
        return {
          said: (stdout + stderr)
            .split("\n")
            .filter(line => line.startsWith(says))
            .sort(),
          exitCode,
        };
      }
      const plain = await report();
      expect(plain.said.length).toBeGreaterThan(0);
      expect(await report("--aot")).toEqual(plain);
    },
    300_000,
  );
}
