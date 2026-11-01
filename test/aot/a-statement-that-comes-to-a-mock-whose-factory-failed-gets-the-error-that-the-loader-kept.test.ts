import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The factory of a mock fails while an import statement asks for the mocked module. `bun test` keeps the record of the module with that error: the next statement
// that comes to it gets the same error, and the factory is not asked. An import() of the module drops the record and asks the factory; a require() asks the factory and
// leaves the record; taking the module out of require.cache drops the record; a second mock.module() drops it with the records of all that failed above.
// Each error says which call of the factory threw it.
const shapes: Record<string, { imports: string[]; text: string }> = {
  "mocked.ts": { imports: [], text: `export const v = "real v";` },
  "names.ts": { imports: ["mocked.ts"], text: `import { v } from "./mocked.ts"; export const seen = () => typeof v;` },
  "other.ts": { imports: ["mocked.ts"], text: `import { v } from "./mocked.ts"; export const seen = () => typeof v;` },
  "above.ts": {
    imports: ["names.ts"],
    text: `import { seen as below } from "./names.ts"; export const seen = () => "above " + below();`,
  },
  "requires.cjs": {
    imports: ["mocked.ts"],
    text: `const all = require("./mocked.ts"); exports.seen = () => typeof all.v;`,
  },
};

const cases: Record<string, string[]> = {
  "an-import-of-the-module-then-an-importer": ["import mocked.ts", "import names.ts", "import other.ts"],
  "a-require-of-the-module-then-an-importer": ["require mocked.ts", "import names.ts", "require other.ts"],
  "an-import-of-the-module-drops-the-record": [
    "import names.ts",
    "import mocked.ts",
    "import other.ts",
    "import names.ts",
  ],
  "a-require-of-the-module-leaves-the-record": ["import names.ts", "require mocked.ts", "require other.ts"],
  "the-module-is-taken-out-of-the-cache": ["import names.ts", "evict mocked.ts", "import other.ts", "import names.ts"],
  "the-importer-is-taken-out-of-the-cache": ["import names.ts", "evict names.ts", "import names.ts", "import other.ts"],
  "both-are-taken-out-of-the-cache": ["import names.ts", "evict names.ts", "evict mocked.ts", "import names.ts"],
  "a-second-mock-fails-too": ["import names.ts", "mock-again-fails", "import names.ts", "import other.ts"],
  "a-second-mock-works": [
    "import above.ts",
    "mock-again",
    "import other.ts",
    "import names.ts",
    "import above.ts",
    "require above.ts",
  ],
  "a-second-mock-works-by-require": ["require above.ts", "mock-again", "require names.ts", "require above.ts"],
  "a-second-mock-before-any-importer": ["import mocked.ts", "mock-again", "import mocked.ts", "import names.ts"],
  "a-commonjs-importer-asks-each-time": [
    "require requires.cjs",
    "import names.ts",
    "require requires.cjs",
    "import other.ts",
  ],
  "the-factory-works-the-second-time": [
    "fails-once",
    "import names.ts",
    "import other.ts",
    "import mocked.ts",
    "import other.ts",
    "import names.ts",
  ],
  "the-factory-would-work-the-second-time": [
    "fails-once",
    "import names.ts",
    "evict names.ts",
    "import names.ts",
    "import other.ts",
  ],
};

const files: Record<string, string> = { "package.json": `{ "name": "the-error-that-the-loader-kept" }` };
function write(folder: string, shape: string) {
  const path = `src/${folder}/${shape}`;
  if (path in files) return;
  files[path] = `${shapes[shape].text} console.log("the body of ${shape} runs");`;
  for (const imported of shapes[shape].imports) write(folder, imported);
}

const tests = Object.entries(cases).map(([name, steps]) => {
  const mocked = JSON.stringify(`./src/${name}/mocked.ts`);
  const failsOnce = steps.includes("fails-once");
  const lines = steps.map(step => {
    const [how, shape] = step.split(" ");
    if (shape) write(name, shape);
    const path = JSON.stringify(`./src/${name}/${shape}`);
    const answer = shape === "mocked.ts" ? ".v" : ".seen()";
    if (how === "import") return `await say(${JSON.stringify(step)}, async () => (await import(${path}))${answer});`;
    if (how === "require") return `await say(${JSON.stringify(step)}, () => require(${path})${answer});`;
    if (how === "evict") return `delete require.cache[require.resolve(${path})]; console.log(${JSON.stringify(step)});`;
    if (how === "mock-again")
      return `mock.module(${mocked}, () => { console.log("the second factory is called"); return { v: 1 }; });`;
    if (how === "mock-again-fails")
      return `mock.module(${mocked}, () => { console.log("the second factory is called"); throw new RangeError("from the second factory"); });`;
    return "";
  });
  return `test(${JSON.stringify(name)}, async () => {
    console.log(${JSON.stringify("# " + name)});
    let calls = 0;
    mock.module(${mocked}, () => {
      console.log("the factory is called");
      if (++calls === 1 || ${!failsOnce}) throw new RangeError("from call " + calls);
      return { v: 1 };
    });
    ${lines.join("\n    ")}
  });`;
});

files["failed.test.ts"] = `
  import { test, mock } from "bun:test";
  const say = (label: string, f: () => unknown) =>
    Promise.resolve().then(f).then(v => console.log(label, String(v)), e => console.log(label, e.constructor.name, e.message));
  ${tests.join("\n  ")}`;

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
  using directory = tempDir("the-error-that-the-loader-kept", files);
  const plain = await printedBy(String(directory), words);
  const text = plain.printed.join("\n");
  expect(text).toContain(
    "# a-require-of-the-module-leaves-the-record\nthe factory is called\nimport names.ts RangeError from call 1\nthe factory is called\nrequire mocked.ts RangeError from call 2\nrequire other.ts RangeError from call 1\n#",
  );
  expect(text).toContain(
    "# an-import-of-the-module-drops-the-record\nthe factory is called\nimport names.ts RangeError from call 1\nthe factory is called\nimport mocked.ts RangeError from call 2\nthe factory is called\nimport other.ts RangeError from call 3\nimport names.ts RangeError from call 1\n#",
  );
  expect(text).toContain(
    "# a-second-mock-works-by-require\nthe factory is called\nrequire above.ts RangeError from call 1\nthe second factory is called\nthe body of names.ts runs\nrequire names.ts number\nthe body of above.ts runs\nrequire above.ts above number\n#",
  );
  expect(await printedBy(String(directory), words, "--aot")).toEqual(plain);
});
