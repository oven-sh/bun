// `import("./deep0.mjs"); import("./single.mjs")` in a test: Bun reads the texts of a level a turn behind those of the level above, so the single file runs ahead of the four files that were
// asked for first. A compiled run counts the levels below the file that a call asks for. It did not where the file lies in another image than the call, as a file of the project does for a
// test file of a run in layers: there the deep graph ran first.
// The lines are stored: plain Bun prints them (12 runs of 12 on a quiet machine), but it reads files on other threads, and on a busy machine the order wavers.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const file = (name: string, imports: string[], waits = false) =>
  imports.map(it => `import "./${it}";\n`).join("") +
  `globalThis.log.push("run ${name}");\n` +
  (waits ? `await null;\nglobalThis.log.push("resumed ${name}");\n` : "");
const shapes = {
  "four files and one": {
    files: {
      "deep0.mjs": file("deep0", ["deep1.mjs"]),
      "deep1.mjs": file("deep1", ["deep2.mjs"]),
      "deep2.mjs": file("deep2", ["deep3.mjs"]),
      "deep3.mjs": file("deep3", []),
      "single.mjs": file("single", []),
    },
    lines: "run single | single loaded | run deep3 | run deep2 | run deep1 | run deep0 | deep loaded",
  },
  "three files, of which one waits, and one": {
    files: {
      "deep0.mjs": file("deep0", ["deep1.mjs"]),
      "deep1.mjs": file("deep1", ["deep2.mjs"], true),
      "deep2.mjs": file("deep2", []),
      "single.mjs": file("single", []),
    },
    lines: "run single | single loaded | run deep2 | run deep1 | resumed deep1 | run deep0 | deep loaded",
  },
};

for (const [shape, { files, lines }] of Object.entries(shapes))
  for (const [form, words] of [
    ["as one program", "TestRunLayers:0"],
    ["over two layers", "TestRunLayers:2"],
  ])
    test.concurrent(
      `${shape}, ${form}`,
      async () => {
        using dir = tempDir("aot-shallow-ahead-of-deep", {
          ...files,
          "a.test.mjs": `
          import { test } from "bun:test";
          test("t", async () => {
            globalThis.log = [];
            await Promise.all([
              import("./deep0.mjs").then(() => globalThis.log.push("deep loaded")),
              import("./single.mjs").then(() => globalThis.log.push("single loaded")),
            ]);
            process.stderr.write("OUT " + globalThis.log.join(" | ") + "\\n");
          });`,
        });
        const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
        await using run = Bun.spawn({
          cmd: [bunExe(), "test", "--aot", "--isolate"],
          cwd: String(dir),
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
        const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
        expect(stderr.split("\n").filter(line => line.startsWith("OUT"))).toEqual(["OUT " + lines]);
        expect(exitCode).toBe(0);
      },
      240_000,
    );
