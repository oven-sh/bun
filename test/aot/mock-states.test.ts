import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { all, filesOf } from "./harness/mock-sequences";
import { countedMockStates, howToAddSteps } from "./harness/mock-states";
import { run } from "./harness/run";
import { test } from "./supported";

// Holds the run time against the table of the life of a mock. It judges no answer: mock-sequences*.test.ts and mock-factory-time.test.ts do. Every sequence of
// harness/mock-sequences.ts in one project, each a test file of its own, so that each also meets the end of the file before it: as one program, over two layers,
// and as the run divides it by itself. A step that a run takes and mock-states.table.txt lacks fails here, and nowhere else.
// Behind the first vi.resetModules() of a realm every file that has run is left to the host, for all later test files. So the sequences that reset come last.
const ordered = [...all].sort((a, b) => Number(a.steps.includes("reset")) - Number(b.steps.includes("reset")));
const files = Object.assign(
  { "package.json": `{ "type": "module" }` },
  ...ordered.map(sequence => filesOf(sequence, 0)),
);
// `bun test <folder>` runs the files as the file system lists them, and which file comes behind which decides some steps. Named, they run in the order of the names.
const inOrder = ordered.map(({ id }) => `./test/${id}.test.js`);
const ways: Record<string, string> = {
  "as one program": "TestRunLayers:0",
  "over two layers": "TestRunLayers:2",
  "over two layers, a part a file": "TestRunLayers:2,TestRunPartFiles:1",
};

for (const [way, words] of Object.entries(ways)) {
  test(`every step stands in the table: ${way}`, async () => {
    using dir = tempDir("aot-mock-states", files);
    using states = countedMockStates();
    await run([bunExe(), "test", "--aot", ...inOrder], String(dir), {
      ...bunEnv,
      ...states.env,
      NO_COLOR: "1",
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    const { seen, lacking } = states.stepsThatTableLacks();
    // A run that counted nothing would pass for the wrong reason.
    expect(seen).toBeGreaterThan(40);
    if (lacking.length) throw new Error(lacking.join("\n") + "\n" + howToAddSteps);
  }, 600_000);
}
