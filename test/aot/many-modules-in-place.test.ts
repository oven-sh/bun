// The project is built at half its size and at its whole size, and the instructions of the two builds are compared, so the answer is the same on a busy machine.
import { expect } from "bun:test";
import { bunExe, isASAN, isDebug, tempDir } from "harness";
import { countsInstructions, measureCommand } from "./analysis-scaling/measure-check";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { waysFor } from "./harness/ways";
import { afterAll, beforeAll, describe, test } from "./listed";

raiseDefaultTimeout(120_000);

const sizes = countsInstructions() ? [1500, 3000] : [3000];
const exportsOfEach = 10;
/**
 * Twice the modules may cost this many times the instructions: it is 1.90. Work that grows as n log n costs 2.19 times as many, with the square four times:
 * a square that makes the whole build a third dearer passes this.
 */
const mostGrowth = 2.2;

function files(modules: number): Record<string, string> {
  const made: Record<string, string> = {};
  for (let i = 0; i < modules; i++) {
    const lines: string[] = [];
    if (i) lines.push(`import * as before from "./m${i - 1}";`, `import { f${i - 1}_0 } from "./m${i - 1}";`);
    for (let j = 0; j < exportsOfEach; j++) {
      const more = i && j === 0 ? ` + f${i - 1}_0(x) + before.f${i - 1}_1(x)` : "";
      lines.push(`export function f${i}_${j}(x: number): number { return (x + ${j}${more}) % 1000; }`);
    }
    made[`m${i}.ts`] = lines.join("\n") + "\n";
  }
  made["main.test.ts"] = `
    import { test, mock } from "bun:test";
    import * as last from "./m${modules - 1}";
    const handedOn = [mock];
    test("case", () => {
      console.log("see:", last.f${modules - 1}_0(1), handedOn.length);
    });
  `;
  return made;
}

async function seen(cwd: string, args: string[]) {
  const { stdout, stderr, instructions } = await measureCommand(cwd, [bunExe(), ...args], 120_000);
  return { seen: (stdout + stderr).split("\n").filter(line => line.startsWith("see:")), instructions };
}

describe.skipIf(isDebug || isASAN)(
  "the work of a test build grows with the number of its modules, not with the square of it",
  () => {
    let folders: ReturnType<typeof tempDir>[] = [];
    const plain: string[][] = [];
    beforeAll(async () => {
      folders = sizes.map(size => tempDir("many-modules-in-place", files(size)));
      for (const folder of folders) plain.push((await seen(String(folder), ["test", "./main.test.ts"])).seen);
    });
    afterAll(() => folders.forEach(folder => folder[Symbol.dispose]()));

    test("plain Bun", () => {
      expect(plain.map(lines => lines.length)).toEqual(sizes.map(() => 1));
    });

    // `bun test` takes the two flags for one: the same build again.
    test.each([...waysFor(["--aot", "--debug-aot"], false)])("%s", async flag => {
      const counted: (number | undefined)[] = [];
      for (const [index, folder] of folders.entries()) {
        const compiled = await seen(String(folder), ["test", flag, "./main.test.ts"]);
        expect({ modules: sizes[index], seen: compiled.seen }).toEqual({ modules: sizes[index], seen: plain[index] });
        counted.push(compiled.instructions);
      }
      const [half, whole] = counted;
      if (half === undefined || whole === undefined) return;
      const told = `${sizes[0]} modules take ${half} instructions, ${sizes[1]} modules take ${(whole / half).toFixed(2)} times as many`;
      console.log(`GROWTH ${flag}: ${told}`);
      expect(whole / half < mostGrowth ? "" : told).toBe("");
    });
  },
);
