import { expect, test as testOfPlainBun } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { test } from "./supported";

const modules = {
  "package.json": `{ "type": "module" }`,
  "src/mocked.js": `export const v = "real v";`,
  "src/importer.js": `import * as all from "./mocked.js"; export const seen = () => typeof all.v;`,
  "src/above.js": `import { seen as below } from "./importer.js"; export const seen = () => "above " + below();`,
};
const testFile = (body: string) => `import { test, mock } from "bun:test";
const say = (label, f) =>
  Promise.resolve().then(f).then(v => console.log(label, String(v)), e => console.log(label, e.constructor.name, e.message));
test("loads", async () => {
  ${body}
});`;

const factoryThrew = {
  ...modules,
  "a.test.js": testFile(`mock.module("./src/mocked.js", () => { throw new RangeError("from the factory"); });
  await say("import above", async () => (await import("./src/above.js")).seen());
  await say("import importer", async () => (await import("./src/importer.js")).seen());`),
};
const factoryStillRuns = {
  ...modules,
  "a.test.js": testFile(`mock.module("./src/mocked.js", () => {
    console.log("the factory is called");
    try { require("./src/importer.js"); } catch {}
    return { v: "mocked v" };
  });
  await say("import importer", async () => (await import("./src/importer.js")).seen());`),
};
const syntaxError = {
  "package.json": `{}`,
  "main.cjs": `try {
  require("./importer.mjs");
  console.log("require answered");
} catch (e) {
  console.log("require threw", e.name);
}`,
  "importer.mjs": `import "./first.cjs";
import "./broken.mjs";
console.log("the body of importer runs");`,
  "first.cjs": `import("./importer.mjs").then(
  () => console.log("import answered"),
  e => console.log("import rejected", e.name),
);`,
  "broken.mjs": `export const = ;`,
};

async function printedBy(directory: string, ...command: string[]) {
  const { stdout, stderr, exitCode } = await run(command, directory, bunEnv);
  if (exitCode !== 0) console.error(stderr);
  const printed = stdout.replace(/^bun test .*\n/, "").trim();
  return { printed: printed.split("\n"), exitCode };
}

testOfPlainBun("a mock's factory threw", async () => {
  using directory = tempDir("first-fetch-threw-in-a-factory", factoryThrew);
  const { printed, exitCode } = await printedBy(String(directory), bunExe(), "test");
  expect(printed[0]).toBe("import above RangeError from the factory");
  expect(printed.at(-1)).toStartWith("import importer ");
  expect(exitCode).toBe(0);
});

test("a mock's factory threw, compiled", async () => {
  using directory = tempDir("first-fetch-threw-in-a-factory", factoryThrew);
  expect(await printedBy(String(directory), bunExe(), "test", "--aot")).toEqual(
    await printedBy(String(directory), bunExe(), "test"),
  );
});

testOfPlainBun("a mock's factory still runs", async () => {
  using directory = tempDir("first-fetch-still-runs-a-factory", factoryStillRuns);
  const { printed, exitCode } = await printedBy(String(directory), bunExe(), "test");
  expect(printed[0]).toBe("the factory is called");
  expect(printed.at(-1)).toStartWith("import importer ");
  expect(exitCode).toBe(0);
});

const afterSyntaxError = { printed: ["require threw AggregateError", "import rejected AggregateError"], exitCode: 0 };

testOfPlainBun("require() read a file with a syntax error", async () => {
  using directory = tempDir("first-fetch-threw-a-syntax-error", syntaxError);
  expect(await printedBy(String(directory), bunExe(), "run", "./main.cjs")).toEqual(afterSyntaxError);
});

test("require() read a file with a syntax error, compiled", async () => {
  using directory = tempDir("first-fetch-threw-a-syntax-error", syntaxError);
  const outfile = join(String(directory), isWindows ? "compiled.exe" : "compiled");
  const build = [bunExe(), "build", "--compile", "--aot", "--external", "./broken.mjs", "./main.cjs"];
  expect((await printedBy(String(directory), ...build, "--outfile", outfile)).exitCode).toBe(0);
  expect(await printedBy(String(directory), outfile)).toEqual(afterSyntaxError);
});
