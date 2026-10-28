// The compiler follows every value of a program from where it is made to where it is used, and proves what it proves from what it has NOT seen arrive. So more to begin with may never prove more:
// whatever the analysis finds for a program, it finds for the same program with something added.
//
// `--aot-flow=widened` (hidden) asks that of a build. The analysis is solved twice: as it is, and with more given to places that `--aot-layout-seed=<n>` draws: an object nobody knows, a value nobody
// knows, or what another place of the same function holds. The seed also says how many places are drawn and whether only in the code of the program or in Bun's library too. The functions that are
// reached, the built-ins that are used, the ways in for code nobody has seen and what every place may hold are compared. What only the first solve has stops the build: an internal error that says in
// numbers what sort of thing is lacking, how many and the first; the engine's test program says the same in words, with the rules on the way there. The build goes on from the second solve, which knows less and is as true, so the executable answers as plain Bun does.
//
// `--aot-sabotage=WhatIsGivenTakesThePlaceOfWhatComes` (hidden) loses something on purpose: a place that is drawn forgets what the program itself brings there.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { registry } from "./harness/registry";
import { slot, spawned, told, unsupported } from "./run-programs";
import { describe, test } from "./supported";

const source = `
type Pair = { left: number; right: string };
function make(left: number, right: string): Pair { return { left, right }; }
function leftOf(pair: Pair): number { return pair.left + 1; }
function rightOf(pair: Pair): string { return pair.right + "!"; }
const pairs = [make(1, "one"), make(2, "two")];
for (const pair of pairs) console.log(leftOf(pair), rightOf(pair));`;

async function buildAndRun(...flags: string[]) {
  using folder = tempDir("aot-a-flow-analysis-that-is-given-more", { "main.ts": source });
  const directory = String(folder);
  const executable = join(directory, "main");
  return await slot(async () => {
    const build = await spawned(
      [bunExe(), "build", "--compile", "--aot", "--aot-flow=widened", ...flags, "./main.ts", "--outfile", executable],
      directory,
      bunEnv,
    );
    if (build.exitCode) return { build };
    return {
      build,
      compiled: told(await spawned([executable], directory, bunEnv)),
      plain: told(await spawned([bunExe(), "run", "./main.ts"], directory, bunEnv)),
    };
  });
}

const hasTheWord = !unsupported && registry().sabotages?.includes("WhatIsGivenTakesThePlaceOfWhatComes");

describe.skipIf(!hasTheWord)("compile/aot/a flow analysis that is given more finds no less", () => {
  test.concurrent.each(Array.from({ length: 16 }, (_, seed) => seed))(
    "seed %d: nothing is lost, and what is built from the wider solve answers as plain Bun does",
    async seed => {
      const { build, compiled, plain } = await buildAndRun(`--aot-layout-seed=${seed}`);
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
      expect(compiled).toEqual(plain);
    },
  );

  test("what a place loses where it is given more stops the build, which names the place", async () => {
    const stopped = (
      await Promise.all(
        Array.from({ length: 16 }, (_, seed) =>
          buildAndRun(`--aot-layout-seed=${seed}`, "--aot-sabotage=WhatIsGivenTakesThePlaceOfWhatComes"),
        ),
      )
    ).filter(({ build }) => build.exitCode);
    expect(stopped.length).toBeGreaterThan(0);
    // The sort of what is lacking, how many lack something, the first of them.
    for (const { build } of stopped)
      expect(build.stderr).toMatch(
        /internal compiler error \(AnalyzeFlow\): FlowFindsLessFromMore: .*; [0-4] \d+ \d+$/m,
      );
  });

  test("a word that is not listed stops the build", async () => {
    using folder = tempDir("aot-a-flow-analysis-that-is-given-more", { "main.ts": source });
    const build = await spawned(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "--aot-flow=narrowed",
        "./main.ts",
        "--outfile",
        join(String(folder), "main"),
      ],
      String(folder),
      bunEnv,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: expect.stringContaining("narrowed"),
      exitCode: 1,
    });
  });
});
