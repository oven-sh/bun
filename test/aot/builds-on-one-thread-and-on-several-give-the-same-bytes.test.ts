// A build with --aot gives the same executable, byte for byte, whatever the number of threads. The flow analysis goes in rounds, on 32 lanes; when this fault stood it had one lane at one thread.
// The library lays accessors in fields, and each waits until its field is asked. Who asked a field of another lane once woke it a round later than who asked a field of its own,
// so calls saw other types on the way, and what they had asked for on the way stood in the tables: two executables of this program.
import { describe, expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./harness/commands";
import { afterAll, test } from "./harness/default-timeout";
import { withoutDebugInformation } from "./harness/without-debug-information";

const sources = {
  "entry.mjs": `
import util from "node:util";
const found = util.debuglog({ toUpperCase: () => "constructor" });
console.log(
  found === Object
    ? found.getOwnPropertyDescriptor(Reflect.getPrototypeOf(function () {}), "constructor").value("return 6 * 7")()
    : "nothing is inherited",
);
`,
};

// An alias may name the type of a value whose annotation names other aliases of the same file. Such an annotation was once looked at on its own while those aliases were still being looked at:
// they counted as trusted there, and every thread was told. Which thread asked first decided whether `table` is of its declared type or only expected to be.
const sourcesOfNamedTypes = {
  "entry.ts": `
import { show, type Id, type Key } from "./table";
function count(names: [Key, Id]) { return names.length; }
console.log(count(["a", "b"]), show());
`,
  "table.ts": `
const names = { first: "a", second: "b", third: "c" } as const;
export type Key = (typeof names)[keyof typeof names];
interface Row { id: string; weight: number; next: string | null }
function create(): Record<Key, Row> {
  const rows = {} as Record<Key, Row>;
  for (const key of Object.values(names)) rows[key] = { id: key, weight: key.length, next: null };
  return rows;
}
export const table: Record<Key, Row> = create();
export type Id = (typeof table)[Key]["id"];
export function show() { return Object.keys(table).length + table.a.weight; }
`,
};

describe.skipIf(!!unsupported)("compile/aot/builds-on-one-thread-and-on-several-give-the-same-bytes", () => {
  const folder = String(tempDir("aot-same-bytes-by-threads", sources));
  const folderOfNamedTypes = String(tempDir("aot-same-bytes-by-threads-named-types", sourcesOfNamedTypes));
  afterAll(() => {
    rmSync(folder, { recursive: true, force: true });
    rmSync(folderOfNamedTypes, { recursive: true, force: true });
  });

  async function hashBuilds(folder: string, entry: string, threadCounts: number[]) {
    const executable = join(folder, isWindows ? "compiled.exe" : "compiled");
    const wire = join(folder, "compiled.ir");
    const hashes: string[] = [];
    for (const threads of threadCounts) {
      built(
        await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            ...withoutDebugInformation,
            "--aot",
            `--aot-threads=${threads}`,
            `--aot-out=${wire}`,
            entry,
            "--outfile",
            executable,
          ],
          folder,
          bunEnv,
        ),
      );
      hashes.push(`${Bun.hash(readFileSync(wire)).toString(16)} ${Bun.hash(readFileSync(executable)).toString(16)}`);
      rmSync(wire);
      rmSync(executable);
    }
    return hashes;
  }

  test("builds on one, two and eight threads are equal", async () => {
    await slot(async () => {
      const hashes = await hashBuilds(folder, "./entry.mjs", [1, 2, 8]);
      expect(hashes).toEqual(hashes.map(() => hashes[0]));
    });
  }, 600_000);

  test("builds of types that name each other are equal on one thread and on many", async () => {
    await slot(async () => {
      const hashes = await hashBuilds(folderOfNamedTypes, "./entry.ts", [1, 4, 16, 32]);
      expect(hashes).toEqual(hashes.map(() => hashes[0]));
    });
  }, 600_000);
});
