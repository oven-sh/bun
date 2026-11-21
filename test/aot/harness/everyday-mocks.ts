// For everyday-mocks-*.test.ts. Each case of everyday-mock-cases.ts is laid out as a project of its own and run by `bun test` and by `bun test --aot`, each run in a folder and a process of its own: beside
// other cases most of what goes wrong here looks right. What `bun test` says is the specification: all that it writes and the exit code must be equal, but for the times.
// A compiled run writes more in one kind of case alone, where the test file calls jest.resetModules(): what loads behind that call runs from source, and the build and the run say so.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "../supported";
import { everydayMockCases } from "./everyday-mock-cases";
import { run } from "./run";

// Where the two runs part today, and what the compiled run says of its second test there. Such a case is run all the same. It fails by any other difference, and once the two runs agree: its line goes out.
const stillWrong: [cases: RegExp, secondTest: string, what: string][] = [];

// AOT_TEST_RUN_WORDS puts every compiled run under its words, as in test-runs-in-folders.ts.
const wordsOfAll = process.env.AOT_TEST_RUN_WORDS ?? "";

/** The last line ends with a newline, which begins no line. An empty line anywhere else is a line. */
const linesOf = (written: string) => written.replace(/\n$/, "").split("\n");

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
    // Every line but the one that names the version of Bun.
    stdout: linesOf(stdout).filter(line => !line.startsWith("bun test v")),
    // Every line, without the times, which differ from run to run. A word that begins with TestRun makes the runner say what the build handed over.
    stderr: linesOf(stderr)
      .map(line => line.replace(/ \[[\d.]+m?s\]$/, ""))
      .filter(line => !(words && line.startsWith("AOT test run | "))),
    exitCode,
  };
}

// What a test notes: what the kitchen serves, what the kettle boils, its brand, how often the mock was called and how often the body of the real file has run.
// Where the load or one of the calls throws, the test notes that in their place.
const reading = "(mock|real|undefined)/(mock|real) brand,(mock|real|undefined),(mock|real) brand,(\\d+|-),\\d+";

/** All that `bun test` writes to stderr for a file whose tests pass, without the times. */
const reportOf = (tests: string[]) => [
  "",
  "everyday.test.js:",
  ...tests.map(title => `(pass) ${title}`),
  "",
  ` ${tests.length} pass`,
  " 0 fail",
  `Ran ${tests.length} ${tests.length === 1 ? "test" : "tests"} across 1 file.`,
];

/** What a compiled run wrote to stderr: the report of the runner, what the build said in front of it and what the run lists behind it. A run that came to no report has all that it wrote in the place of one. */
function partsOf(stderr: string[]) {
  const begins = stderr.indexOf("everyday.test.js:") - 1;
  const ends = stderr.findIndex(line => /^Ran \d+ tests? across 1 file\.$/.test(line));
  const [from, to] = begins < 0 || ends < begins ? [0, stderr.length] : [begins, ends + 1];
  return { build: stderr.slice(0, from), report: stderr.slice(from, to), lists: stderr.slice(to) };
}

/** TS100078, as the build writes it: the line of the call, a mark under it, the warning that what loads again after resetModules() runs from source, and where the call is. */
const warningOfAReset = (line: number, column: number) => [
  expect.stringMatching(new RegExp(`^${line} \\| +jest\\.resetModules\\(\\);$`)),
  expect.stringMatching(/^ +\^$/),
  expect.stringMatching(/^warn: TS100078: /),
  expect.stringMatching(new RegExp(`^ +at .*everyday\\.test\\.js:${line}:${column}$`)),
];

/**
 * The lists behind the report of a compiled run, on one line: `ran from source: kettle.mjs?actual, kitchen.mjs; didn't run again: kitchen.mjs`.
 * A list is a heading that counts compiled files, and below it as many lines as it counts, each with the name of a file in front. Whatever is no such list stays as it was written.
 */
function listsOf(lines: string[]) {
  const lists: string[] = [];
  for (let at = 0; at < lines.length;) {
    const [, count, what] = /^(\d+) compiled files? (ran from source|didn't run again)\b.*:$/.exec(lines[at]) ?? [];
    const files = lines.slice(at + 1, at + 1 + Number(count)).flatMap(line => /^  (\S+?)[:,] /.exec(line)?.[1] ?? []);
    if (!what || files.length !== Number(count)) return [...lists, ...lines.slice(at)].join("; ");
    lists.push(`${what}: ${files.sort().join(", ")}`);
    at += 1 + files.length;
  }
  return lists.join("; ");
}

/** `parts` files share the cases, each a stretch of them. */
export function everydayMocks(part: number, parts: number) {
  const cases = everydayMockCases();
  const stretch = Math.ceil(cases.length / parts);
  for (const { name, files } of cases.slice((part - 1) * stretch, part * stretch)) {
    const text = files["everyday.test.js"].split("\n");
    const tests = text.flatMap(line => /^test\("(\w+)"/.exec(line)?.[1] ?? []);
    const reset = text.findIndex(line => line.includes("jest.resetModules();"));
    // Behind a reset, a second test that takes the kitchen by import() or require() loads it again. `kind` is how its file ends.
    const [, kind] = text.map(line => /(?:import|require)\("\.\/kitchen\.(\w+)"\)/.exec(line)).find(Boolean) ?? [];
    const loadsAgain = reset >= 0 && tests.length > 1 && kind !== undefined;
    test(name, async () => {
      const [plain, compiled] = await Promise.all([outcomeOf(files, ""), outcomeOf(files, wordsOfAll, "--aot")]);
      // A specification is a whole answer: every test of the file passes, each has noted what it was served, and the run says nothing else. A run that stopped on its way,
      // or one in which every load threw, would be equal to a compiled run that did the same.
      expect(plain).toEqual({
        stdout: [
          expect.stringMatching(new RegExp(`^SAID ${tests.map((_, at) => `${at + 1},${reading}`).join(" \\. ")}$`)),
        ],
        stderr: reportOf(tests),
        exitCode: 0,
      });
      const { build, report, lists } = partsOf(compiled.stderr);
      const secondTest = stillWrong.find(([names]) => names.test(name))?.[1];
      expect({ ...compiled, stderr: report }).toEqual(
        secondTest === undefined
          ? plain
          : { ...plain, stdout: [plain.stdout[0].replace(/ \. 2[ ,].*$/, " . " + secondTest)] },
      );
      // What a compiled run alone says. The build warns where the test file resets the modules, and of nothing else. A file that loads again behind a reset runs from
      // source, and the run lists it: the kitchen, and with it the kettle where the kitchen or a mock takes the real one. Some such runs also say that they did not run the
      // kitchen again. Every other case lists nothing: all of its files ran compiled, so it tested compiled code.
      expect({ build, lists: listsOf(lists) }).toEqual({
        build: reset < 0 ? [] : warningOfAReset(reset + 1, text[reset].indexOf("jest") + 1),
        lists: loadsAgain
          ? expect.stringMatching(
              new RegExp(
                `^ran from source: (kettle\\.${kind}(\\?actual)?, )?kitchen\\.${kind}(; didn't run again: kitchen\\.${kind})?$`,
              ),
            )
          : "",
      });
    });
  }
}
