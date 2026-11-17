// For everyday-mocks-*.test.ts. Each case of everyday-mock-cases.ts is laid out as a project of its own and run by `bun test` and by `bun test --aot`, each run in a folder and a process of its own: beside
// other cases most of what goes wrong here looks right. What `bun test` says is the specification: the line that the project prints, how each test ends and the exit code must be equal.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "../supported";
import { everydayMockCases } from "./everyday-mock-cases";
import { run } from "./run";

// Where the two runs part today, and what the compiled run says of its second test there. Such a case is run all the same. It fails by any other difference, and once the two runs agree: its line goes out.
const stillWrong: [cases: RegExp, secondTest: string, what: string][] = [];

// AOT_TEST_RUN_WORDS puts every compiled run under its words, as in test-runs-in-folders.ts.
const wordsOfAll = process.env.AOT_TEST_RUN_WORDS ?? "";

async function outcomeOf(files: Record<string, string>, words: string, ...flags: string[]) {
  using dir = tempDir("aot-everyday-mock", files);
  const env = {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "0",
    BUN_DEBUG_TEST_AOT_WORDS: words,
  };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./everyday.test.js"], String(dir), env);
  return {
    printed: stdout.split("\n").filter(line => line.startsWith("SAID ")),
    tests: stderr
      .split("\n")
      .filter(line => /^\((pass|fail|skip|todo)\) /.test(line))
      .map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
    exitCode,
    lastWords: exitCode > 1 ? stderr.split("\n").filter(Boolean).slice(-12) : [],
  };
}

/** `parts` files share the cases, each a stretch of them. */
export function everydayMocks(part: number, parts: number) {
  const cases = everydayMockCases();
  const stretch = Math.ceil(cases.length / parts);
  for (const { name, files } of cases.slice((part - 1) * stretch, part * stretch)) {
    test(name, async () => {
      const [plain, compiled] = await Promise.all([outcomeOf(files, ""), outcomeOf(files, wordsOfAll, "--aot")]);
      expect(plain.printed).toHaveLength(1);
      const secondTest = stillWrong.find(([names]) => names.test(name))?.[1];
      expect(compiled).toEqual(
        secondTest === undefined
          ? plain
          : { ...plain, printed: [plain.printed[0].replace(/ \. 2[ ,].*$/, " . " + secondTest)] },
      );
    });
  }
}
