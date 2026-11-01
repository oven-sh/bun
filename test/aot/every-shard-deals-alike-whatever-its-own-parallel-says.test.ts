import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Each machine of a sharded run deals the test files for itself and keeps its own share. A file that one machine gives to the other
// and the other gives back runs nowhere, and both report success. So the deal may hang only on what all of them have: the files, their
// sizes, what they reach and the recorded times. `--parallel` is a machine's own: think of `--parallel=$(nproc)` on unlike runners.

const fileCount = 30;
const names = Array.from({ length: fileCount }, (_, index) => `tests/t${String(index).padStart(2, "0")}.test.ts`);
const libraries = Array.from({ length: 12 }, (_, index) => `l${index}`);
// Unlike sizes, unlike reach, unlike times, all by rule.
const bytesOf = (library: number) => 1_000 * (1 + ((library * 37) % 11)) ** 2;
const reachOf = (index: number) => libraries.filter((_, library) => (index * 7 + library * 5) % 13 < 1 + (index % 5));
const millisecondsOf = (index: number) => [2, 5, 20, 60, 150, 400][(index * 5) % 6];

const project = () =>
  tempDir("aot-every-shard-deals-alike", {
    "package.json": `{ "name": "shards" }`,
    "timings.json": JSON.stringify({
      version: 1,
      files: Object.fromEntries(names.map((name, index) => [name, millisecondsOf(index)])),
    }),
    // A comment weighs as code does where the files are dealt, and takes no time to compile.
    ...Object.fromEntries(
      libraries.map((name, index) => [
        `lib/${name}.ts`,
        `// ${Buffer.alloc(bytesOf(index), "x")}\nexport const name = "${name}";\n`,
      ]),
    ),
    ...Object.fromEntries(
      names.map((name, index) => [
        name,
        `import { expect, test } from "bun:test";
${reachOf(index)
  .map(library => `import { name as ${library} } from "../lib/${library}";`)
  .join("\n")}
test("reads what it imports", () => expect([${reachOf(index).join(", ")}]).toEqual(${JSON.stringify(reachOf(index))}));
`,
      ]),
    ),
  });

const waysToSayParallel = [[], ["--parallel=1"], ["--parallel=4"], ["--parallel=8"], ["--parallel=16"]];

/** The test files that shard `index` of `count` runs. */
async function filesOfShard(dir: string, index: number, count: number, parallel: string[]) {
  const command = [bunExe(), "test", "--aot", "--timings=timings.json", ...parallel, `--shard=${index + 1}/${count}`];
  const { stdout, stderr, exitCode } = await run(command, dir, bunEnv);
  expect({ exitCode, failed: stderr.match(/^ *(\d+) fail$/m)?.[1] ?? "0" }).toEqual({ exitCode: 0, failed: "0" });
  return [...new Set([...(stdout + stderr).matchAll(/^(tests\/t\d+\.test\.ts):$/gm)].map(match => match[1]))].sort();
}

test.each([2, 3, 5])(
  "%d shards: whichever way each of them says --parallel, every file runs in one of them",
  async count => {
    using dir = project();
    // If a shard runs the same files however it is started, every mixture of the five ways runs what one way runs.
    const deals: string[][][] = [];
    for (const parallel of waysToSayParallel) {
      const shards = Array.from({ length: count }, (_, index) => filesOfShard(String(dir), index, count, parallel));
      deals.push(await Promise.all(shards));
    }
    expect(deals[0].flat().sort()).toEqual(names);
    for (const [way, deal] of deals.entries()) {
      expect({ parallel: waysToSayParallel[way].join(), deal }).toEqual({
        parallel: waysToSayParallel[way].join(),
        deal: deals[0],
      });
    }
  },
  600_000,
);
