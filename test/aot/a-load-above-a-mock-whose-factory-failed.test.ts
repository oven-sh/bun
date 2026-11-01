import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const shapes: Record<string, { imports: string[]; text: string }> = {
  "mocked.ts": { imports: [], text: `export const v = "real v";` },
  "names.ts": { imports: ["mocked.ts"], text: `import { v } from "./mocked.ts"; export const seen = () => typeof v;` },
  "other.ts": { imports: ["mocked.ts"], text: `import { v } from "./mocked.ts"; export const seen = () => typeof v;` },
  "namespace.ts": {
    imports: ["mocked.ts"],
    text: `import * as all from "./mocked.ts"; export const seen = () => typeof all.v;`,
  },
  "bare.ts": { imports: ["mocked.ts"], text: `import "./mocked.ts"; export const seen = () => "bare";` },
  "star.ts": { imports: ["mocked.ts"], text: `export * from "./mocked.ts"; export const seen = () => "star";` },
  "again.ts": { imports: ["mocked.ts"], text: `export { v } from "./mocked.ts"; export const seen = () => "again";` },
  "above-names.ts": {
    imports: ["names.ts"],
    text: `import { seen as below } from "./names.ts"; export const seen = () => "above " + below();`,
  },
  "above.ts": {
    imports: ["namespace.ts"],
    text: `import { seen as below } from "./namespace.ts"; export const seen = () => "above " + below();`,
  },
  "top.ts": {
    imports: ["above.ts"],
    text: `import { seen as below } from "./above.ts"; export const seen = () => "top " + below();`,
  },
  "beside.ts": { imports: [], text: `export const seen = () => "beside";` },
  "with-beside.ts": {
    imports: ["beside.ts", "mocked.ts"],
    text: `import { seen as beside } from "./beside.ts"; import * as all from "./mocked.ts"; export const seen = () => beside() + typeof all.v;`,
  },
  "ring-a.ts": {
    imports: ["ring-b.ts"],
    text: `import { seen as b } from "./ring-b.ts"; export const seen = () => typeof b;`,
  },
  "ring-b.ts": {
    imports: ["ring-a.ts", "mocked.ts"],
    text: `import { seen as a } from "./ring-a.ts"; import * as all from "./mocked.ts"; export const seen = () => typeof a + typeof all.v;`,
  },
  "requires.ts": {
    imports: ["mocked.ts"],
    text: `const all = require("./mocked.ts"); export const seen = () => typeof all.v;`,
  },
  "requires.cjs": {
    imports: ["mocked.ts"],
    text: `const all = require("./mocked.ts"); exports.seen = () => typeof all.v;`,
  },
  "above-requires.ts": {
    imports: ["requires.cjs"],
    text: `import { seen as below } from "./requires.cjs"; export const seen = () => "above " + below();`,
  },
  "built-in.ts": {
    imports: [],
    text: `import { platform } from "node:os"; export const seen = () => typeof platform;`,
  },
};

const throws = `() => { console.log("the factory is called"); throw new RangeError("from the factory"); }`;
const cases: Record<string, { factory?: string; mocked?: string; again?: true; steps: string[] }> = {
  "the-same-module-again": { steps: ["import names.ts", "import names.ts", "import names.ts"] },
  "by-require": { steps: ["require names.ts", "require names.ts", "require names.ts"] },
  "by-one-after-the-other": { steps: ["require names.ts", "import names.ts", "require names.ts"] },
  "by-a-name-made-at-run-time": {
    steps: [
      "import-computed top.ts",
      "import-computed top.ts",
      "require-computed above.ts",
      "import-computed above.ts",
    ],
  },
  "a-namespace": { steps: ["import namespace.ts", "import namespace.ts", "import namespace.ts"] },
  "no-name": { steps: ["import bare.ts", "import bare.ts", "import bare.ts"] },
  "every-name-exported-again": { steps: ["import star.ts", "import star.ts", "import star.ts"] },
  "one-name-exported-again": { steps: ["import again.ts", "import again.ts", "import again.ts"] },
  "the-mocked-module-in-between": {
    steps: ["import names.ts", "import mocked.ts", "import names.ts", "import mocked.ts"],
  },
  "another-importer": {
    again: true,
    steps: ["import names.ts", "import other.ts", "import names.ts", "import other.ts"],
  },
  "a-module-above": {
    again: true,
    steps: ["import above-names.ts", "import above-names.ts", "import names.ts", "import names.ts", "require names.ts"],
  },
  "the-importer-below-the-root-is-loaded-once-more": {
    again: true,
    steps: [
      "import top.ts",
      "import above.ts",
      "import namespace.ts",
      "import namespace.ts",
      "require namespace.ts",
      "import namespace.ts",
      "require above.ts",
      "import top.ts",
      "require top.ts",
    ],
  },
  "a-require-comes-first": {
    again: true,
    steps: [
      "import above.ts",
      "require namespace.ts",
      "require namespace.ts",
      "import namespace.ts",
      "require above.ts",
    ],
  },
  "all-by-require": {
    again: true,
    steps: ["require above.ts", "require namespace.ts", "import namespace.ts", "import above.ts", "require above.ts"],
  },
  "a-statement-imports-it-anew": {
    again: true,
    steps: ["import namespace.ts", "import above.ts", "import namespace.ts", "require namespace.ts", "import above.ts"],
  },
  "a-statement-imports-it-anew-by-require": {
    again: true,
    steps: ["require namespace.ts", "require above.ts", "require namespace.ts", "import namespace.ts"],
  },
  "a-statement-imports-it-anew-and-finds-no-name": {
    again: true,
    steps: [
      "import names.ts",
      "import above-names.ts",
      "import names.ts",
      "import above-names.ts",
      "require names.ts",
      "require above-names.ts",
    ],
  },
  "mocked-again": { steps: ["import names.ts", "mock-again", "import names.ts", "import names.ts"] },
  "mocked-again-below-a-root": {
    steps: ["import top.ts", "mock-again", "import top.ts", "import namespace.ts", "require namespace.ts"],
  },
  "a-module-beside-the-mocked-one": { steps: ["import with-beside.ts", "import beside.ts", "import with-beside.ts"] },
  "a-ring": { again: true, steps: ["import ring-a.ts", "import ring-a.ts", "import ring-b.ts", "import ring-b.ts"] },
  "taken-out-of-the-cache": {
    again: true,
    steps: ["import names.ts", "evict names.ts", "import names.ts", "import names.ts"],
  },
  "a-factory-that-answers-no-object": {
    factory: `() => { console.log("the factory is called"); }`,
    steps: ["import names.ts", "import names.ts", "import names.ts"],
  },
  "a-factory-whose-promise-is-rejected": {
    factory: `() => { console.log("the factory is called"); return Promise.reject(new RangeError("rejected")); }`,
    steps: ["import names.ts", "import names.ts", "import names.ts"],
  },
  "a-require-in-the-importer": { steps: ["import requires.ts", "import requires.ts", "import requires.ts"] },
  "a-commonjs-importer-runs-again": { steps: ["require requires.cjs", "require requires.cjs", "require requires.cjs"] },
  "through-a-commonjs-importer": {
    steps: ["import above-requires.ts", "import above-requires.ts", "import above-requires.ts"],
  },
  "a-built-in-module": { mocked: "node:os", steps: ["import built-in.ts", "import built-in.ts", "import built-in.ts"] },
};

const files: Record<string, string> = { "package.json": `{ "name": "a-load-above-a-mock-whose-factory-failed" }` };
function write(folder: string, shape: string) {
  const path = `src/${folder}/${shape}`;
  if (path in files) return;
  files[path] = `${shapes[shape].text} console.log("the body of ${folder}/${shape} runs");`;
  for (const imported of shapes[shape].imports) write(folder, imported);
}

const hasAssertions = isASAN || isDebug;
if (hasAssertions)
  console.error(
    "SKIPPED: a-load-above-a-mock-whose-factory-failed.test.ts: the cases in which a statement comes to the mocked module again: there plain `bun test` fails an assertion of the module loader, which only a build without assertions passes",
  );
const casesOfThisBuild = Object.entries(cases).filter(([, { again }]) => !again || !hasAssertions);
const tests = casesOfThisBuild.map(([name, { factory = throws, mocked = `./src/${name}/mocked.ts`, steps }]) => {
  const lines = steps.map(step => {
    const [how, shape] = step.split(" ");
    if (shape) write(name, shape);
    const path = JSON.stringify(`./src/${name}/${shape}`);
    const computed = `"./src/" + ${JSON.stringify(name.split(""))}.join("") + ${JSON.stringify("/" + shape)}`;
    const answer = shape === "mocked.ts" ? ".v" : ".seen()";
    if (how === "import") return `await say(${JSON.stringify(step)}, async () => (await import(${path}))${answer});`;
    if (how === "require") return `await say(${JSON.stringify(step)}, () => require(${path})${answer});`;
    if (how === "import-computed")
      return `await say(${JSON.stringify(step)}, async () => (await import(${computed}))${answer});`;
    if (how === "require-computed") return `await say(${JSON.stringify(step)}, () => require(${computed})${answer});`;
    if (how === "evict") return `delete require.cache[require.resolve(${path})];`;
    return `mock.module(${JSON.stringify(mocked)}, () => { console.log("the second factory is called"); return { v: 1 }; });`;
  });
  return `test(${JSON.stringify(name)}, async () => {
    console.log(${JSON.stringify("# " + name)});
    mock.module(${JSON.stringify(mocked)}, ${factory});
    ${lines.join("\n    ")}
  });`;
});

write("the-same-error", "names.ts");
files["failed.test.ts"] = `
  import { test, mock } from "bun:test";
  const say = (label: string, f: () => unknown) =>
    Promise.resolve().then(f).then(v => console.log(label, String(v)), e => console.log(label, e.constructor.name, e.message));
  ${tests.join("\n  ")}
  test("the same error", async () => {
    mock.module("./src/the-same-error/mocked.ts", ${throws});
    const errors: unknown[] = [];
    for (const turn of [1, 2, 3]) await import("./src/the-same-error/names.ts").catch(e => errors.push(e));
    try { require("./src/the-same-error/names.ts"); } catch (e) { errors.push(e); }
    console.log("the same error", errors.map(e => e === errors[0]).join());
  });`;

async function printedBy(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.replace(/^bun test .*\n/, "").split("\n"), exitCode };
}

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("%s", async (_, words) => {
  using directory = tempDir("a-load-above-a-mock-whose-factory-failed", files);
  const plain = await printedBy(String(directory), words);
  const error = "RangeError from the factory";
  expect(plain.printed.join("\n")).toContain(
    `# a-namespace\nthe factory is called\nimport namespace.ts ${error}\nimport namespace.ts ${error}\nimport namespace.ts ${error}\n#`,
  );
  if (!hasAssertions)
    expect(plain.printed.join("\n")).toContain(
      `import above.ts ${error}\nthe body of the-importer-below-the-root-is-loaded-once-more/namespace.ts runs\nimport namespace.ts ${error}\nimport namespace.ts ${error}\nrequire namespace.ts undefined\n`,
    );
  expect(plain.printed).toContain("the same error true,true,true,true");
  expect(await printedBy(String(directory), words, "--aot")).toEqual(plain);
});
