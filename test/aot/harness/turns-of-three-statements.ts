// For turns-of-three-statements-*.test.ts. `fuzz/fuzzilli/write-turn-sweep.ts` writes every turn of three small statements, some millions of programs in eleven rows. Here it hands over a few of each row, spread
// over the row, and a few by name. Each is built alone, into an executable of its own: does the build end with an executable, and does that print what `bun <file>` prints?
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { programNamed, stretch } from "../fuzz/fuzzilli/write-turn-sweep";
import { test } from "../supported";
import { ask } from "./everyday-programs";
import { run } from "./run";

// With it the build stops where a stage hands on what the next one does not take. Without it only some builds of Bun look.
const checked = "--aot-check=VerifyEachStage";

const rows = [
  "lists",
  "numbers",
  "objects",
  "records",
  "grids",
  "generators",
  "texts",
  "handed",
  "quiet",
  "pairs",
  "held",
];

// The row, the name, and what the program prints: a line for each call of its function. A number stands in front of a name; it moves when the row grows.
const byName: [row: string, name: string, prints: [string, ...string[]]][] = [
  [
    "lists",
    "integers-up-read-i-int--store-j-masked--again-i-int",
    [
      "n31 n0.5 n2 n0 n0 n18 n8 n3 | n5 n3 n8 | n18 n6 n10 n14 n15 n25 n38 n67",
      "n31 n0.5 n2 n0 n0 n18 n8 n3 | n5 n3 n8 | n18 n6 n10 n14 n15 n25 n38 n67",
      "n0 n0.5 n0 n0 n0 n0 n8 n3 | n5 n3 n8 | n0 n1 n2 n3 n4 n5 n6 n7",
    ],
  ],
  [
    "lists",
    "fractions-up-throw--add-at-the-counter--module-takes-t",
    [
      "threw | n5 n3 n8 | n0.5 n1.5 n2.5 n3.5 n4.5 n5.5 n6.5 n7.5",
      "threw | nNaN n3 n8 | n0.5 n1.5 n2.5 n3.5 n4.5 n5.5 n6.5 n7.5",
      "n0 n0.5 n0 n0 n0 n0.5 n8 n3 | nNaN n3 n8 | n0.5 n1.5 n2.5 n3.5 n4.5 n5.5 n6.5 n7.5",
    ],
  ],
  [
    "lists",
    "integers-up-break--carry--module-takes-t",
    [
      "n0 n0.5 n0 n0 n0 n0 n8 n3 | n5 n3 n8 | n0 n1 n2 n3 n4 n5 n6 n7",
      "n0 n18.5 n0 n0 n4 n0 n8 n3 | n18.5 n3 n8 | n0 n1 n2 n3 n4 n5 n6 n7",
      "n0 n0.5 n0 n0 n0 n0 n8 n3 | n18.5 n3 n8 | n0 n1 n2 n3 n4 n5 n6 n7",
    ],
  ],
  [
    "quiet",
    "quiet-integers-that-nobody-knows-down-count-the-marked--read-the-one-before--store-the-next",
    [
      "n0 n0.5 uundefined n1 n3 n8 n0 n3 | n5 n3 n8 | n3 uundefined n3 n1 n4 n1 n5 n9 | n0 n0 n0 n0 n0 n0 n0 n0",
      "n0 n0.5 uundefined n2 n3 n8 n0 n3 | n5 n3 n8 | n3 uundefined n3 n1 n4 n1 n5 n9 | n0 n0 n0 n0 n0 n0 n0 n0",
      "n0 n0.5 uundefined n0 n3 n8 n0 n3 | n5 n3 n8 | n3 uundefined n3 n1 n4 n1 n5 n9 | n0 n0 n0 n0 n0 n0 n0 n0",
      "n0 n0.5 uundefined n1 n3 n8 n0 n3 | n5 n3 n8 | n3 uundefined n3 n1 n4 n1 n5 n9 | n0 n0 n0 n0 n0 n0 n0 n0",
    ],
  ],
  [
    "held",
    "held-a-captured-variable-integers-that-nobody-knows-down-store-t--store-the-next--sum-int",
    [
      "n0 n0.5 n0 n0 n0.5 n8 | n8 | n0.5 n0 n0 n0 n0 n0 n0 n0",
      "n0 n0.5 n0 n0 n0.5 n8 | n8 | n0.5 n0 n0 n0 n0 n0 n0 n0",
      "n0 n0.5 n0 n0 n0.5 n8 | n8 | n0.5 n0 n0 n0 n0 n0 n0 n0",
      "n0 n0.5 n0 n0 n0.5 n8 | n8 | n0.5 n0 n0 n0 n0 n0 n0 n0",
    ],
  ],
];

// Sorted by the names of their files: the parts are dealt from that order.
const byFileName = (one: { name: string }, other: { name: string }) =>
  one.name < other.name ? -1 : one.name > other.name ? 1 : 0;

export function turnsOfThreeStatementsIn(part: number, parts: number) {
  // The stride has no factor in common with the length of any row.
  rows
    .flatMap(row => [...stretch(row, 1, 24, 104729)])
    .sort(byFileName)
    .filter((_, at) => at % parts === part - 1)
    .forEach(ask);
}

// The ones by name are asked for more than `ask` asks for: plain Bun and the executable print just the lines that stand beside the name, and nothing on stderr.
// A name that no program of its row has stops the file where it loads.
export function turnsOfThreeStatementsByName() {
  const programs = byName.map(([row, name, prints]) => ({ ...programNamed(row, name), prints })).sort(byFileName);
  for (const { name, text, prints } of programs)
    test(name, async () => {
      using dir = tempDir("aot-turn-by-name", { [name]: text });
      const folder = String(dir);
      const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
      const [plain, build] = await Promise.all([
        run([bunExe(), "./" + name], folder, bunEnv),
        run([bunExe(), "build", "--compile", "--aot", checked, "./" + name, "--outfile", executable], folder, bunEnv),
      ]);
      const stated = { stdout: prints.map(line => line + "\n").join(""), stderr: "", exitCode: 0 };
      expect(plain).toEqual(stated);
      expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      expect(await run([executable], folder, bunEnv)).toEqual(stated);
    });
}
