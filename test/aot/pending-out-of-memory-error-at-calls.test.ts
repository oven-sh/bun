// A store that adds a field to an existing object cannot collect. When it runs out of memory it finishes on the heap's reserve
// and leaves an out-of-memory error pending. The next call in each loop below is one the compiler knows does not collect, so the
// pending error must not start a collection inside that call. The loop's own poll collects the garbage and withdraws the error.
// An executable built with --aot-validate stops with "CallCollected" when a collection runs inside such a call.
import { expect } from "bun:test";
import { test } from "./harness/declare";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported, withoutCoreDump } from "./harness/commands";

const objects = 40_000;

const calls: Record<string, string> = {
  closureByValue: `closures[i % 12](i)`,
  uptime: `(process.uptime() > 0 ? 1 : 0)`,
  setDate: `(Number.isNaN(date.setDate(1)) ? 0 : 1)`,
  dateUTC: `(Date.UTC(2020, 1, 1, 1, 1, 1, i & 7) > 0 ? 1 : 0)`,
  bufferCompare: `Buffer.compare(buffer, buffer) + 1`,
  bufferEquals: `(buffer.equals(buffer) ? 1 : 0)`,
  boundFunction: `boundAddOne(0)`,
  mapHas: `(map.has(1) ? 1 : 0)`,
};

const program = `const closures = [${Array.from({ length: 12 }, (_, n) => `(x: number) => x + ${n}`).join(", ")}];
const date = new Date(0);
const buffer = Buffer.alloc(8);
const boundAddOne = ((x: number) => x + 1).bind(null);
const map = new Map<number, number>([[1, 1]]);
const plain: any[] = [];
for (let i = 0; i < ${objects}; i++) plain.push({ a: i });
// Garbage by the time the stores begin. Only a collection makes room for the fields they add.
let garbage: unknown[] | null = [];
for (let i = 0; i < 600_000; i++) garbage.push({ a: i, b: i, c: i, d: i });
garbage = null;
${Object.entries(calls)
  .map(
    ([name, call]) => `function ${name}() {
  let sum = 0;
  for (let i = 0; i < plain.length; i++) {
    const o = plain[i];
${Array.from({ length: 40 }, (_, index) => `    o.f${index} = i;`).join("\n")}
    sum += ${call};
  }
  return sum;
}
`,
  )
  .join("")}const runs: Record<string, () => number> = { ${Object.keys(calls).join(", ")} };
console.log(runs[process.argv[2]]());
`;

let sumOfClosures = 0;
for (let i = 0; i < objects; i++) sumOfClosures += i + (i % 12);

test.skipIf(!!unsupported)(
  "a pending out-of-memory error starts no collection inside a call that does not collect",
  async () => {
    await slot(async () => {
      using dir = tempDir("aot-pending-out-of-memory-error-at-calls", { "entry.ts": program, "tsconfig.json": "{}" });
      const folder = String(dir);
      const executable = join(folder, isWindows ? "entry.exe" : "entry");
      built(
        await spawned(
          [bunExe(), "build", "--compile", "--aot", "--aot-validate", "entry.ts", "--outfile", executable],
          folder,
          bunEnv,
        ),
      );
      const results = Object.fromEntries(
        await Promise.all(
          Object.keys(calls).map(async name => {
            const ran = await spawned(withoutCoreDump([executable, name]), folder, {
              ...bunEnv,
              BUN_JSC_markedBlockCageSizeInMB: "64",
            });
            return [name, { stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }];
          }),
        ),
      );
      expect(results).toEqual(
        Object.fromEntries(
          Object.keys(calls).map(name => [
            name,
            {
              stdout: (name === "closureByValue" ? sumOfClosures : objects) + "\n",
              stderr: "",
              exitCode: 0,
              signal: null,
            },
          ]),
        ),
      );
    });
  },
  240_000,
);
