import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./harness/commands";
import { test } from "./supported";

/** The names of the pieces of code that compiled code shares, up to the first dot. */
async function sharedCodeOf(program: string) {
  using dir = tempDir("aot-code-for-traps", { "main.js": program });
  const folder = String(dir);
  const mapPath = join(folder, "main.map");
  await slot(async () => {
    built(
      await spawned(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "./main.js",
          "--outfile",
          join(folder, isWindows ? "main.exe" : "main"),
        ],
        folder,
        { ...bunEnv, BUN_JSC_aotMapFilePath: mapPath },
      ),
    );
  });
  return new Set(
    readFileSync(mapPath, "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(fields => fields[0] === "T" && fields.length >= 3)
      .map(fields => fields[2].replace(/[.#( ].*/, "")),
  );
}

test("a program that makes no proxy holds no code that reads and calls traps", async () => {
  const without = await sharedCodeOf("console.log(1);\n");
  // The map lists shared code at all.
  expect(without.size).toBeGreaterThan(10);
  expect(without.has("ThroughProxy")).toBe(false);
  // Nothing else in this program reads a name above an object on behalf of another receiver.
  expect(without.has("TryGetSuperById")).toBe(false);
  const withOne = await sharedCodeOf("const proxy = new Proxy({ a: 1 }, {});\nconsole.log(proxy.a);\n");
  expect(withOne.has("ThroughProxy")).toBe(true);
  const evaluated = await sharedCodeOf("console.log((0, eval)(process.argv[2] ?? '1'));\n");
  expect(evaluated.has("ThroughProxy")).toBe(true);
  // Native code can make one and hand it over.
  const withAddon = await sharedCodeOf("try {\n  process.dlopen({ exports: {} }, process.argv[2]);\n} catch {}\n");
  expect(withAddon.has("ThroughProxy")).toBe(true);
}, 240_000);
