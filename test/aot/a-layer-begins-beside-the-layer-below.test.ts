import { afterEach, beforeEach, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { availableParallelism } from "node:os";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { availableMemory, memoryLimitOfCommandsAtOnce } from "./harness/memory-limit";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

// Over layers, the files of packages that only computed imports reach are a program of their own, under the files of the project.
// The build of the layer above it begins beside its build. Of the program below a front end needs to know only which files it
// holds, so that build guesses them: what the build below begins with. It waits for the program before it checks types, and looks
// whether the guess was right. Where it was not, it is started again above the program, as it would have been without all this.
// `TestRunLayersBuiltAlone`: every layer is built with nothing beside it.

// The tests run at once: each builds and runs in a folder of its own.
const test = oneAtATime.concurrent;
// A test has one run over layers in flight, and the build of its lowest layer keeps several processors busy: a quarter as many
// tests as processors run at once, two at least. Such a run takes 1.2 GB of the machine's memory with a debug build and 0.2 GB
// with a release build, and a build with a sanitizer is taken for a debug build. run() ends every run of the file where the
// machine has less left than a seventh of what the commands of a file may hold, so no more tests run at once than have room
// beside twice that, one at least. The others wait in a hook without a limit, where the time of a test does not run.
const roomForARun = (isDebug || isASAN ? 2 : 0.5) * 2 ** 30;
const roomNow = availableMemory() - (2 * memoryLimitOfCommandsAtOnce) / 7;
let free = Math.max(1, Math.min(Math.max(2, availableParallelism() >> 2), Math.floor(roomNow / roomForARun)));
const waiting: (() => void)[] = [];
beforeEach(() => (free > 0 ? void free-- : new Promise<void>(resolve => waiting.push(resolve))), 0);
afterEach(() => {
  const next = waiting.shift();
  if (next) next();
  else free++;
});
// supported.ts sets the limit for the first file of a process alone. A test takes a debug build one to four and a half minutes,
// by how busy the machine is.
raiseDefaultTimeout(isDebug ? 900_000 : 120_000);

// The lowest layer of a run holds Bun's own code, and its build is most of what a run costs. That build starts over where the
// layer holds a CommonJS file of a package, and the layer holds twice as many of Bun's modules where a file requires a name that
// no text spells. These tests are about the two layers above it: the file that their projects import by name is an ES module,
// and no file requires such a name.
const part = (name: string, more = "") =>
  `${more}\n(globalThis.ran ??= []).push("${name}");\nmodule.exports = { name: "${name}" };`;
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "noImplicitAny": false } }`,
  "node_modules/big/package.json": `{ "name": "big", "version": "1.0.0", "main": "./lib/index.mjs" }`,
  "node_modules/big/lib/index.mjs": `export const shared = name => "shared:" + name;`,
  "node_modules/big/build/one.js": part("one"),
  "node_modules/big/build/two.js": part("two"),
  "src/load.ts": `import { shared } from "big";
    export const load = async (name: string) => (await import(\`big/build/\${name}.js\`)).default;
    export const direct = () => shared("direct");`,
  "a.test.ts": `import { test } from "bun:test";
    import { load, direct } from "./src/load";
    test("computed imports", async () => {
      console.log("seen", direct(), JSON.stringify([await load("one"), await load("two")]), (globalThis as any).ran.join());
      console.log("parsed", Number.parseFloat("1.5"));
    });`,
  "b.test.ts": `import { test } from "bun:test";\ntest("another file", () => { console.log("another file runs"); });`,
};
// What plain Bun says of their two test files on stderr: each test with its verdict, and the counts.
const twoFilesPass = [
  " 0 fail",
  " 2 pass",
  "(pass) another file",
  "(pass) computed imports",
  "Ran 2 tests across 2 files.",
];

// What a run says of the builds of the two layers, in its order. The build of the project's files begins while the build below
// is under way:
const beside = [
  "what computed imports reach begins",
  "what test files share begins",
  "what computed imports reach has ended",
  "what test files share has ended",
];
// where it is started again, it ends without a program and begins once more, above the program below:
const startedAgain = [...beside, "what test files share begins", "what test files share has ended"];
// and with `TestRunLayersBuiltAlone` it begins when the build below has ended.
const oneAfterTheOther = [
  "what computed imports reach begins",
  "what computed imports reach has ended",
  "what test files share begins",
  "what test files share has ended",
];

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: flags.length ? "1" : undefined };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr.slice(-4000));
  const began = stderr.match(
    /^AOT part build \| began beside the build below \| files guessed (\d+) \| files asked about \d+ \| answered otherwise by the program (\d+) \| it ends with what tests replace as it began (\w+)$/m,
  );
  const builds = stderr.matchAll(
    /^AOT test run step \| the build (begins|has ended): (what computed imports reach|what test files share) \|/gm,
  );
  const built = {
    began: began ? { guessed: +began[1], otherwise: +began[2], endsAsItBegan: began[3] === "true" } : undefined,
    builds: [...builds].map(([, step, layer]) => `${layer} ${step}`),
  };
  return {
    // Where this Bun loads one program a realm (macOS, Windows, a hardened build) a run has no layers. Everywhere else run() has
    // asked for them.
    built: /^AOT test run \| layers 2 \|/m.test(stderr) ? built : undefined,
    // A folder is run in the order in which it is read, so the lines are sorted.
    seen: {
      stdout: stdout
        .split("\n")
        .filter(line => line && !line.startsWith("bun test "))
        .sort(),
      // Each test with its verdict, the counts, and every line that begins with an error.
      results: stderr
        .split("\n")
        .filter(line =>
          /^(\((pass|fail|skip|todo)\) |\w*[Ee]rror\b| *\d+ (pass|fail|skip|todo)$|Ran \d+ tests? across )/.test(line),
        )
        .map(line => line.replace(/ \[[\d.]+m?s\]$/, ""))
        .sort(),
      exitCode,
    },
  };
}
type Ran = Awaited<ReturnType<typeof runTests>>;

/** Plain Bun prints `seen` in the folder and ends so, the run over layers does the same, and its two layers are built as `built`. */
async function runsAsPlain(directory: string, words: string, seen: Ran["seen"], built: NonNullable<Ran["built"]>) {
  const plain = await runTests(directory, "");
  expect(plain).toEqual({ built: undefined, seen });
  const compiled = await runTests(directory, words, "--aot");
  expect(compiled.seen).toEqual(plain.seen);
  if (compiled.built) expect(compiled.built).toEqual(built);
}

test("a right guess: one build of the project's files, begun beside the build below", async () => {
  using dir = tempDir("aot-layer-begins-beside", files);
  await runsAsPlain(
    String(dir),
    "TestRunLayers:2",
    {
      stdout: ["another file runs", "parsed 1.5", `seen shared:direct [{"name":"one"},{"name":"two"}] one,two`],
      results: twoFilesPass,
      exitCode: 0,
    },
    { began: { guessed: 2, otherwise: 0, endsAsItBegan: true }, builds: beside },
  );
});

test("TestRunLayersBuiltAlone: every layer is built with nothing beside it", async () => {
  using dir = tempDir("aot-layer-begins-alone", files);
  await runsAsPlain(
    String(dir),
    "TestRunLayers:2,TestRunLayersBuiltAlone",
    {
      stdout: ["another file runs", "parsed 1.5", `seen shared:direct [{"name":"one"},{"name":"two"}] one,two`],
      results: twoFilesPass,
      exitCode: 0,
    },
    { began: undefined, builds: oneAfterTheOther },
  );
});

test("the program below ends with more that is replaced than it was told of: the build above is started again", async () => {
  using dir = tempDir("aot-layer-begins-beside-again", {
    ...files,
    "node_modules/big/build/two.js": part("two", `Number.parseFloat = () => 7;`),
  });
  await runsAsPlain(
    String(dir),
    "TestRunLayers:2",
    {
      stdout: ["another file runs", "parsed 7", `seen shared:direct [{"name":"one"},{"name":"two"}] one,two`],
      results: twoFilesPass,
      exitCode: 0,
    },
    { began: { guessed: 2, otherwise: 0, endsAsItBegan: false }, builds: startedAgain },
  );
});

test("a file that the project's files and the files behind the computed import both load runs once", async () => {
  // The lowest layer takes the files of packages that the test files reach by the names in their texts, and the guess takes what
  // the computed import stands for. `late.js` is in neither: the project requires it in a file that only a computed import of its
  // own reaches, and the build of the project's files compiles that file.
  using dir = tempDir("aot-layer-begins-beside-other-files", {
    ...files,
    "node_modules/big/lib/late.js": `(globalThis.ran ??= []).push("late");\nexports.late = "late";`,
    "node_modules/big/build/two.js": part("two", `require("../lib/late.js");`),
    "src/later/late.ts": `export const late = () => require("big/lib/late.js").late;`,
    "src/load.ts": `${files["src/load.ts"]}\nexport const later = async (name: string) => (await import(\`./later/\${name}.ts\`)).late();`,
    "a.test.ts": `${files["a.test.ts"]}\nimport { later } from "./src/load";\ntest("late", async () => { console.log("late", await later("late"), (globalThis as any).ran.join()); });`,
  });
  await runsAsPlain(
    String(dir),
    "TestRunLayers:2",
    {
      stdout: [
        "another file runs",
        "late late one,late,two",
        "parsed 1.5",
        `seen shared:direct [{"name":"one"},{"name":"two"}] one,late,two`,
      ],
      results: [
        " 0 fail",
        " 3 pass",
        "(pass) another file",
        "(pass) computed imports",
        "(pass) late",
        "Ran 3 tests across 2 files.",
      ],
      exitCode: 0,
    },
    // The guess holds the two files that the import stands for. The program also holds the file that one of them requires.
    { began: { guessed: 2, otherwise: 1, endsAsItBegan: true }, builds: startedAgain },
  );
});

test("no computed import: the build above goes on without a program below", async () => {
  using dir = tempDir("aot-layer-begins-beside-nothing", {
    "package.json": `{ "type": "module" }`,
    "src/value.ts": `export const value = 1;`,
    "a.test.ts": `import { test } from "bun:test";\nimport { value } from "./src/value";\ntest("one", () => { console.log("value", value); });`,
  });
  await runsAsPlain(
    String(dir),
    "TestRunLayers:2",
    { stdout: ["value 1"], results: [" 0 fail", " 1 pass", "(pass) one", "Ran 1 test across 1 file."], exitCode: 0 },
    { began: { guessed: 0, otherwise: 0, endsAsItBegan: true }, builds: beside },
  );
});
