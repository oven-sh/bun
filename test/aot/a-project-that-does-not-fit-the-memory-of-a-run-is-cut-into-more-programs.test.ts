// `bun test --aot --aot-memory-limit=<size>`: "What doesn't fit as one program is compiled as several." What the test files import is built in layers: the
// packages, and above them the files of the project. The number of layers was two whatever the limit said, so the build of a large project took what it took.
// Now the run estimates what the build of the project's files would hold, and cuts them into as many programs, one above the other, as are each expected to fit.
//
// The estimate goes by the bytes of the source, with what a large application was measured to take. Code as dense as this project's takes more than that: each
// build says what the plan expected of it and what it took, and this test holds only what is true of every project: a smaller limit brings more programs, each of
// them takes much less, and the tests see no difference.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, tempDir } from "harness";
import { buildEnvironment } from "./harness/flags";
import { expectLayers } from "./harness/layers";
import { run } from "./harness/run";
import { test } from "./supported";

const itemsOfModule = 40;
// The smallest that leaves room between the limits: below 11 MB a run that does not fit as one program is cut at once, so no limit brings layers and one program.
const bytesOfProject = 14_000_000;

function moduleAt(index: number) {
  const items = Array.from({ length: itemsOfModule }, (_, item) => {
    const name = `${index}_${item}`;
    return (
      `export interface Item${name} { id: number; name: string; tags: string[]; next?: Item${name} }\n` +
      `export function make${name}(id: number, name: string): Item${name} {\n  const made: Item${name} = { id: id + ${item}, name: name + "${item}", tags: [name] };\n` +
      `  if (id > ${item + 3}) made.next = make${name}(id - ${item + 4}, name);\n  return made;\n}\n` +
      `export function weigh${name}(item: Item${name}): number {\n  let sum = item.id + item.name.length;\n  for (const tag of item.tags) sum += tag.length;\n` +
      `  return item.next ? sum + weigh${name}(item.next) : sum;\n}\n`
    );
  });
  return (
    (index ? `import { last${index - 1} } from "./m${index - 1}.ts";\n` : "") +
    items.join("") +
    `export function last${index}(seed: number): number {\n  return weigh${index}_0(make${index}_0(seed, "n")) + ${index ? `last${index - 1}(seed)` : "0"};\n}\n`
  );
}

function project() {
  const files: Record<string, string> = {
    "package.json": `{ "name": "planned", "type": "module" }\n`,
    "tsconfig.json": `{ "compilerOptions": { "strict": true, "module": "preserve", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "noEmit": true } }\n`,
  };
  let count = 0;
  for (let bytes = 0; bytes < bytesOfProject; count++) bytes += (files[`src/m${count}.ts`] = moduleAt(count)).length;
  for (let file = 0; file < 4; file++) {
    const last = count - 1 - file;
    files[`tests/t${file}.test.ts`] =
      `import { expect, test } from "bun:test";\nimport { last${last} } from "../src/m${last}.ts";\n` +
      `test("t${file}", () => {\n  console.log("t${file}", last${last}(2));\n  expect(last${last}(2)).toBeGreaterThan(0);\n});\n`;
  }
  return files;
}

const printedByTests = (text: string) =>
  text
    .split("\n")
    .filter(line => /^t\d /.test(line))
    .sort();

// What a sanitizer build has resident is mostly the sanitizer's: shadow memory and the freed blocks that it keeps. The two builds take it a quarter of an hour.
test.skipIf(isASAN)(
  "a smaller limit cuts the files of the project into more programs",
  async () => {
    using dir = tempDir("aot-layers-are-planned", project());
    const plain = await run([bunExe(), "test"], String(dir), bunEnv);
    expect(plain.exitCode).toBe(0);
    const largest: Record<string, number> = {};
    for (const [limit, programs] of [
      ["505MB", 1],
      ["445MB", 2],
    ] as const) {
      const { stdout, stderr, exitCode } = await run(
        [bunExe(), "test", "--aot", "--parallel=4", `--aot-memory-limit=${limit}`],
        String(dir),
        { ...bunEnv, [buildEnvironment.logsPhaseTimes]: "1" },
      );
      // There every test file has a program of its own, with all that it imports.
      if (stderr.includes("this Bun loads one program a realm")) return;
      expect({ exitCode, printed: printedByTests(stdout + stderr) }).toEqual({
        exitCode: 0,
        printed: printedByTests(plain.stdout + plain.stderr),
      });
      // The run says its form when it begins, and plans while the packages are built.
      expectLayers(stderr);
      expect(stderr).toContain(` | ${programs} programs, each may take `);
      // Each build of files of the project says what it took, and what the plan had said.
      const took = [
        ...stderr.matchAll(
          /^AOT part build \| (?:the lowest of )?what test files share \| .* most resident (\d+) KB/gm,
        ),
      ].map(match => Number(match[1]));
      const compared = [
        ...stderr.matchAll(
          /^AOT part build \| the plan said that it may take \d+ MB \| most resident \d+ MB: \d+ percent of that$/gm,
        ),
      ];
      expect({ builds: took.length, compared: compared.length }).toEqual({ builds: programs, compared: programs });
      largest[limit] = Math.max(...took);
    }
    expect(largest["445MB"]).toBeLessThan(largest["505MB"] * 0.7);
  },
  300_000,
);
