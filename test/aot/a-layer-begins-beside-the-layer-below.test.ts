import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Over layers, the files of packages that only computed imports reach are a program of their own, under the files of the project.
// The build of the layer above it begins beside its build. Of the program below a front end needs to know only which files it
// holds, so that build guesses them: what the build below begins with. It waits for the program before it checks types, and looks
// whether the guess was right. Where it was not, it is started again above the program, as it would have been without all this.
// `TestRunLayersBuiltAlone`: every layer is built with nothing beside it.
const part = (name: string, more = "") =>
  `${more}\n(globalThis.ran ??= []).push("${name}");\nmodule.exports = { name: "${name}" };`;
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "allowJs": true, "noImplicitAny": false } }`,
  "node_modules/big/package.json": `{ "name": "big", "version": "1.0.0", "main": "./lib/index.js" }`,
  "node_modules/big/lib/index.js": `exports.shared = name => "shared:" + name;`,
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

async function runTests(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: flags.length ? "1" : undefined };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr.slice(-4000));
  const began = stderr.match(
    /^AOT part build \| began beside the build below \| files guessed (\d+) \| files asked about \d+ \| answered otherwise by the program (\d+) \| it ends with what tests replace as it began (\w+)$/m,
  );
  return {
    began: began ? { guessed: +began[1], otherwise: +began[2], endsAsItBegan: began[3] === "true" } : undefined,
    // The build that was started again says so too.
    buildsOfProject: [...stderr.matchAll(/^AOT part build \| what test files share \|/gm)].length,
    hasLayers: /^AOT test run \| layers 2 \|/m.test(stderr),
    seen: {
      stdout: stdout
        .split("\n")
        .filter(line => line && !line.startsWith("bun test "))
        .sort(),
      results: results.sort(),
      exitCode,
    },
  };
}

test("a right guess: one build of the project's files, begun beside the build below", async () => {
  using dir = tempDir("aot-layer-begins-beside", files);
  const plain = await runTests(String(dir), "");
  expect(plain.seen.results.length).toBe(2);
  expect(plain.seen.exitCode).toBe(0);
  const [beside, alone] = await Promise.all([
    runTests(String(dir), "TestRunLayers:2", "--aot"),
    runTests(String(dir), "TestRunLayers:2,TestRunLayersBuiltAlone", "--aot"),
  ]);
  expect(beside.seen).toEqual(plain.seen);
  expect(alone.seen).toEqual(plain.seen);
  if (!beside.hasLayers) return;
  expect(beside.began).toEqual({ guessed: 2, otherwise: 0, endsAsItBegan: true });
  expect(beside.buildsOfProject).toBe(1);
  expect(alone.began).toBeUndefined();
}, 240_000);

test("the program below ends with more that is replaced than it was told of: the build above is started again", async () => {
  using dir = tempDir("aot-layer-begins-beside-again", {
    ...files,
    "node_modules/big/build/two.js": part("two", `Number.parseFloat = () => 7;`),
  });
  const plain = await runTests(String(dir), "");
  expect(plain.seen.stdout).toContain("parsed 7");
  const beside = await runTests(String(dir), "TestRunLayers:2", "--aot");
  expect(beside.seen).toEqual(plain.seen);
  if (!beside.hasLayers) return;
  expect(beside.began).toEqual({ guessed: 2, otherwise: 0, endsAsItBegan: false });
  expect(beside.buildsOfProject).toBe(2);
}, 240_000);

test("a file that the project's files and the files behind the computed import both load runs once", async () => {
  using dir = tempDir("aot-layer-begins-beside-other-files", {
    ...files,
    "node_modules/big/lib/late.js": `(globalThis.ran ??= []).push("late");\nexports.late = "late";`,
    "node_modules/big/build/two.js": part("two", `require("../lib/late.js");`),
    "src/load.ts": `${files["src/load.ts"]}\nconst name = "big/lib/late.js";\nexport const late = () => require(name).late;`,
    "a.test.ts": `${files["a.test.ts"]}\nimport { late } from "./src/load";\ntest("late", () => { console.log("late", late(), (globalThis as any).ran.join()); });`,
  });
  const plain = await runTests(String(dir), "");
  expect(plain.seen.results.length).toBe(3);
  const beside = await runTests(String(dir), "TestRunLayers:2", "--aot");
  expect(beside.seen).toEqual(plain.seen);
}, 240_000);

test("no computed import: the build above goes on without a program below", async () => {
  using dir = tempDir("aot-layer-begins-beside-nothing", {
    "package.json": `{ "type": "module" }`,
    "src/value.ts": `export const value = 1;`,
    "a.test.ts": `import { test } from "bun:test";\nimport { value } from "./src/value";\ntest("one", () => { console.log("value", value); });`,
  });
  const plain = await runTests(String(dir), "");
  const beside = await runTests(String(dir), "TestRunLayers:2", "--aot");
  expect(beside.seen).toEqual(plain.seen);
  if (!beside.hasLayers) return;
  expect(beside.began).toEqual({ guessed: 0, otherwise: 0, endsAsItBegan: true });
  expect(beside.buildsOfProject).toBe(1);
}, 120_000);
