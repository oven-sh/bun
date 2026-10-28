import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { built, slot, spawned } from "./run-programs";
import { test } from "./supported";

/** The pieces of code that compiled code shares, by the first word of their names: how many, and their bytes. */
function sharedCodeByFamily(map: string) {
  const labels = map
    .split("\n")
    .map(line => line.split("\t"))
    .filter(fields => fields[0] === "T" && fields.length >= 3)
    .map(fields => ({ offset: Number(fields[1]), family: fields[2].replace(/[.#( ].*/, "") }))
    .sort((a, b) => a.offset - b.offset);
  const families = new Map<string, { labels: number; bytes: number }>();
  labels.forEach(({ offset, family }, index) => {
    const entry = families.get(family) ?? { labels: 0, bytes: 0 };
    entry.labels++;
    entry.bytes += index + 1 < labels.length ? labels[index + 1].offset - offset : 0;
    families.set(family, entry);
  });
  return families;
}

// TODO: every table of handlers is emitted whole, for each way to store (strict, sloppy, a definition) times each way to name the
// property (a name, a key, a free name): 308 handlers, 105 KB of the 224 KB that `console.log(1)` holds beside its own code.
test.todo(
  "a program that stores nothing by name holds no handlers of such stores",
  async () => {
    using dir = tempDir("aot-handlers-of-stores", { "main.js": "console.log(1);\n" });
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
    const families = sharedCodeByFamily(readFileSync(mapPath, "utf8"));
    // The map lists shared code at all.
    expect(families.size).toBeGreaterThan(10);
    expect(families.get("StoreSlot") ?? { labels: 0, bytes: 0 }).toEqual({ labels: 0, bytes: 0 });
  },
  240_000,
);
