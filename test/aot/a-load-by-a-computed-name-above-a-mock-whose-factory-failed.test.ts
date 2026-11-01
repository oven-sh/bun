import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const texts: Record<string, string> = {
  "mocked.ts": `export const v = "real v";`,
  "names.ts": `import { v } from "./mocked.ts"; export const seen = () => typeof v;`,
  "other.ts": `import { v } from "./mocked.ts"; export const seen = () => typeof v;`,
  "namespace.ts": `import * as all from "./mocked.ts"; export const seen = () => typeof all.v;`,
  "star.ts": `export * from "./mocked.ts"; export const seen = () => "star";`,
  "above-names.ts": `import { seen as below } from "./names.ts"; export const seen = () => "above " + below();`,
  "above.ts": `import { seen as below } from "./namespace.ts"; export const seen = () => "above " + below();`,
  "top.ts": `import { seen as below } from "./above.ts"; export const seen = () => "top " + below();`,
  "beside.ts": `export const seen = () => "beside";`,
  "with-beside.ts": `import { seen as beside } from "./beside.ts"; import * as all from "./mocked.ts"; export const seen = () => beside() + typeof all.v;`,
  "ring-a.ts": `import { seen as b } from "./ring-b.ts"; export const seen = () => typeof b;`,
  "ring-b.ts": `import { seen as a } from "./ring-a.ts"; import * as all from "./mocked.ts"; export const seen = () => typeof a + typeof all.v;`,
  "requires.cjs": `const all = require("./mocked.ts"); exports.seen = () => typeof all.v;`,
  "above-requires.ts": `import { seen as below } from "./requires.cjs"; export const seen = () => "above " + below();`,
  "virtual.ts": `import * as all from "on-no-disk"; export const seen = () => typeof all.v;`,
  "above-virtual.ts": `import { seen as below } from "./virtual.ts"; export const seen = () => "above " + below();`,
  "top-virtual.ts": `import { seen as below } from "./above-virtual.ts"; export const seen = () => "top " + below();`,
};

const throws = `() => { console.log("the factory is called"); throw new RangeError("from the factory"); }`;
const cases: Record<string, { factory?: string; mocked?: string; steps: string[] }> = {
  "the-importer-below-the-root-is-loaded-once-more": {
    steps: ["import above.ts", "import namespace.ts", "import namespace.ts", "require namespace.ts"],
  },
  "two-modules-above-the-importer": {
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
  "a-require-of-the-module-above-the-importer": {
    steps: ["import top.ts", "import top.ts", "require above.ts", "import above.ts", "require namespace.ts"],
  },
  "the-same-module-again": { steps: ["import names.ts", "import names.ts", "require names.ts", "import names.ts"] },
  "by-require": { steps: ["require namespace.ts", "require namespace.ts", "import namespace.ts"] },
  "every-name-exported-again": { steps: ["import star.ts", "import star.ts", "require star.ts"] },
  "the-mocked-module-in-between": {
    steps: ["import names.ts", "import mocked.ts", "import names.ts", "require mocked.ts", "import mocked.ts"],
  },
  "the-mocked-module-first": {
    steps: ["import mocked.ts", "import above.ts", "import namespace.ts", "require namespace.ts"],
  },
  "another-importer": { steps: ["import names.ts", "import other.ts", "import names.ts", "import other.ts"] },
  "a-name-is-not-found-the-second-time": {
    steps: ["import above-names.ts", "import above-names.ts", "import names.ts", "import names.ts", "require names.ts"],
  },
  "a-require-comes-first": {
    steps: [
      "import above.ts",
      "require namespace.ts",
      "require namespace.ts",
      "import namespace.ts",
      "require above.ts",
    ],
  },
  "all-by-require": {
    steps: ["require above.ts", "require namespace.ts", "import namespace.ts", "import above.ts", "require above.ts"],
  },
  "a-statement-imports-it-anew": {
    steps: ["import namespace.ts", "import above.ts", "import namespace.ts", "require namespace.ts", "import above.ts"],
  },
  "mocked-again-below-a-root": {
    steps: ["import top.ts", "mock-again", "import top.ts", "import namespace.ts", "require namespace.ts"],
  },
  "a-module-beside-the-mocked-one": { steps: ["import with-beside.ts", "import beside.ts", "import with-beside.ts"] },
  "a-ring": { steps: ["import ring-a.ts", "import ring-a.ts", "import ring-b.ts", "import ring-b.ts"] },
  "taken-out-of-the-cache": {
    steps: ["import above.ts", "evict namespace.ts", "import namespace.ts", "import namespace.ts", "import above.ts"],
  },
  "the-importer-that-began-the-load-taken-out-of-the-cache": {
    steps: ["import namespace.ts", "evict namespace.ts", "import namespace.ts", "import namespace.ts"],
  },
  "taken-out-of-the-cache-behind-the-second-load": {
    steps: [
      "import above.ts",
      "import namespace.ts",
      "evict namespace.ts",
      "import namespace.ts",
      "import namespace.ts",
    ],
  },
  "the-root-taken-out-of-the-cache": {
    steps: ["import above.ts", "evict above.ts", "import above.ts", "import above.ts", "import namespace.ts"],
  },
  "the-mocked-module-taken-out-of-the-cache": {
    steps: ["import above.ts", "evict mocked.ts", "import namespace.ts", "import namespace.ts", "import mocked.ts"],
  },
  "a-factory-that-answers-no-object": {
    factory: `() => { console.log("the factory is called"); }`,
    steps: ["import above.ts", "import namespace.ts", "import namespace.ts", "require namespace.ts"],
  },
  "a-factory-whose-promise-is-rejected": {
    factory: `() => { console.log("the factory is called"); return Promise.reject(new RangeError("rejected")); }`,
    steps: ["import above.ts", "import namespace.ts", "import namespace.ts", "require namespace.ts"],
  },
  "a-module-that-is-on-no-disk": {
    mocked: "on-no-disk",
    steps: [
      "import top-virtual.ts",
      "import above-virtual.ts",
      "import virtual.ts",
      "import virtual.ts",
      "require virtual.ts",
      "require above-virtual.ts",
      "import top-virtual.ts",
    ],
  },
  "through-a-commonjs-importer": {
    steps: ["import above-requires.ts", "import above-requires.ts", "require requires.cjs", "import above-requires.ts"],
  },
};

function project(buildKnowsNameOfFile: boolean) {
  const files: Record<string, string> = { "package.json": `{ "name": "a-load-by-a-computed-name" }` };
  function write(folder: string, file: string) {
    const path = `src/${folder}/${file}`;
    if (path in files) return;
    files[path] = `${texts[file]} console.log("the body of ${folder}/${file} runs");`;
    for (const [, imported] of texts[file].matchAll(/"\.\/([a-z.-]+)"/g)) write(folder, imported);
  }
  const tests = Object.entries(cases).map(
    ([name, { factory = throws, mocked: replaced = `./src/${name}/mocked.ts`, steps }]) => {
      const mocked = JSON.stringify(replaced);
      const lines = steps.map(step => {
        const [how, file] = step.split(" ");
        if (how === "mock-again")
          return `mock.module(${mocked}, () => { console.log("the second factory is called"); return { v: 1 }; });`;
        write(name, file);
        const path = buildKnowsNameOfFile
          ? `"./src/" + made(${JSON.stringify(name)}) + ${JSON.stringify("/" + file)}`
          : `at(${JSON.stringify(name)}, ${JSON.stringify(file)})`;
        const answer = file === "mocked.ts" ? ".v" : ".seen()";
        if (how === "import")
          return `await say(${JSON.stringify(step)}, async () => (await import(${path}))${answer});`;
        if (how === "require") return `await say(${JSON.stringify(step)}, () => require(${path})${answer});`;
        return `delete require.cache[require.resolve(${path})];`;
      });
      return `test(${JSON.stringify(name)}, async () => {
    console.log(${JSON.stringify("# " + name)});
    mock.module(${mocked}, ${factory});
    ${lines.join("\n    ")}
  });`;
    },
  );
  files["failed.test.ts"] = `
  import { test, mock } from "bun:test";
  const say = (label: string, f: () => unknown) =>
    Promise.resolve().then(f).then(v => console.log(label, String(v)), e => console.log(label, e.constructor.name, e.message));
  const made = (text: string) => text.split("").join("");
  const at = (folder: string, file: string) => "./src/" + made(folder) + "/" + file;
  ${tests.join("\n  ")}`;
  return files;
}

async function printedBy(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.replace(/^bun test .*\n/, "").split("\n"), exitCode };
}

// Row 4099. Where the build knows nothing of the names and the run has layers, the loader itself walks the graph, and a fetch that fails leaves no record of the
// importer: once the mocked module is out of require.cache, the next import() of the importer asks the factory again. `bun test` keeps the importer's record.
// The case goes red the day it agrees: take it out of its list then.
const differsToday: Record<string, string[]> = {
  "TestRunLayers:0 false": [],
  "TestRunLayers:0 true": [],
  "TestRunLayers:2,TestRunPartFiles:1 false": ["the-mocked-module-taken-out-of-the-cache"],
  "TestRunLayers:2,TestRunPartFiles:1 true": [],
};

function casesOf(lines: string[]) {
  const found: Record<string, string[]> = {};
  let name = "";
  for (const line of lines) {
    if (line.startsWith("# ")) name = line.slice(2);
    (found[name] ??= []).push(line);
  }
  return found;
}

function expectSameButForRow4099(
  way: string,
  compiled: { printed: string[]; exitCode: number },
  plain: typeof compiled,
) {
  expect(compiled.exitCode).toBe(plain.exitCode);
  const [received, expected] = [casesOf(compiled.printed), casesOf(plain.printed)];
  expect(Object.keys(received)).toEqual(Object.keys(expected));
  for (const name of Object.keys(expected)) {
    const [is, shouldBe] = [
      { name, lines: received[name] },
      { name, lines: expected[name] },
    ];
    if (differsToday[way].includes(name)) expect(is).not.toEqual(shouldBe);
    else expect(is).toEqual(shouldBe);
  }
}

describe.each([
  ["the build knows nothing of the name", false],
  ["the build knows the name of the file", true],
])("%s", (_, buildKnowsNameOfFile) => {
  test.each([
    ["as one program", "TestRunLayers:0"],
    ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
  ])("%s", async (_, words) => {
    using directory = tempDir("a-load-by-a-computed-name", project(buildKnowsNameOfFile));
    const plain = await printedBy(String(directory), words);
    const error = "RangeError from the factory";
    expect(plain.printed.join("\n")).toContain(
      `# by-require\nthe factory is called\nrequire namespace.ts ${error}\nrequire namespace.ts ${error}\nimport namespace.ts ${error}\n#`,
    );
    expect(plain.printed.join("\n")).toContain(
      `import above.ts ${error}\nimport namespace.ts ${error}\nimport namespace.ts ${error}\nrequire namespace.ts ${error}\n`,
    );
    expectSameButForRow4099(
      `${words} ${buildKnowsNameOfFile}`,
      await printedBy(String(directory), words, "--aot"),
      plain,
    );
  });
});
