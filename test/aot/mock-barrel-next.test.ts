// A file stands between a mocked file and its user (`export * from "./dep.js"`), beside the mocked file in the image below the user's. The mock has a name more.
// The next test file mocks nothing and imports the user again: the name is gone, and the values are the file's own. Plain `bun test` says what is right.
// One realm, the test files named in order, over the layers that the run takes by itself and as one program.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(300_000);

const fillers = 20;
const functionsOfFiller = 1_650;
const own = `export const flag = "real";\nexport const plain = "real";\n`;
const more = `() => ({ flag: "one", plain: "one", added: "added" })`;
const say = `export const report = () => [barrel.flag, barrel.added, Object.keys(barrel).sort().join("+")].join();\n`;
const star = `export * from "./dep.js";\n`;
const throughBarrel = `import * as barrel from "./barrel.js";\n` + say;

type Kind = { files: Record<string, string>; user: string; below?: string; mock?: string };
const kinds: Record<string, Kind> = {
  // From the second pair on the mocked file has run when it is mocked.
  "company": { files: { "dep.js": own }, user: `import * as barrel from "./dep.js";\n` + say },
  "a-barrel": { files: { "dep.js": own, "barrel.js": star }, user: throughBarrel },
  "two-barrels": {
    files: { "dep.js": own, "inner.js": star, "barrel.js": `export * from "./inner.js";\n` },
    user: throughBarrel,
  },
  "its-own-name-too": {
    files: { "dep.js": own, "barrel.js": star + `export const own = "own";\n` },
    user: throughBarrel,
  },
  "as-a-namespace": {
    files: { "dep.js": own, "barrel.js": `export * as barrel from "./dep.js";\n` },
    user: `import { barrel } from "./barrel.js";\n` + say,
  },
  "the-user-is-a-barrel-too": {
    files: { "dep.js": own, "barrel.js": star },
    user: `export * from "./barrel.js";\nimport * as barrel from "./user.js";\n` + say,
  },
  "a-commonjs-file": {
    files: {
      "dep.cjs": `exports.flag = "real";\nexports.plain = "real";\n`,
      "barrel.js": `export * from "./dep.cjs";\n`,
    },
    user: throughBarrel,
    below: "dep.cjs",
  },
  "mock.module": {
    files: { "dep.js": own, "barrel.js": star },
    user: throughBarrel,
    mock: `mock.module(DEP, ${more});`,
  },
  "a-name-less": {
    files: { "dep.js": own, "barrel.js": star },
    user: throughBarrel,
    mock: `vi.doMock(DEP, () => ({ flag: "one" }));`,
  },
  "the-barrel-is-below-the-fillers": {
    files: { "dep.js": own, "barrel.js": star },
    user: throughBarrel,
    below: "barrel.js",
  },
  "a-function-between": {
    files: {
      "dep.js": own,
      "barrel.js": `import * as all from "./dep.js";\nexport const keys = () => Object.keys(all).sort().join("+");\nexport const added = () => all.added;\n`,
    },
    user: `import { keys, added } from "./barrel.js";\nexport const report = () => [added(), keys()].join();\n`,
  },
};

function project() {
  const files: Record<string, string> = { "package.json": `{ "type": "module" }` };
  const importsOfUser = Array.from({ length: fillers }, (_, n) => `import "../../fill/f${n}.js";\n`).join("");
  let importsOfFiller = "";
  const testFiles: string[] = [];
  for (const [name, kind] of Object.entries(kinds)) {
    for (const [file, text] of Object.entries(kind.files)) files[`src/${name}/${file}`] = text;
    files[`src/${name}/user.js`] = importsOfUser + kind.user;
    importsOfFiller += `import "../src/${name}/${kind.below ?? "dep.js"}";\n`;
    const mocked = `"./src/${name}/${"dep.cjs" in kind.files ? "dep.cjs" : "dep.js"}"`;
    const head = `import { mock, test, vi } from "bun:test";
const look = async step => console.log("| ${name}", step, (await import("./src/${name}/user.js")).report());\n`;
    files[`${name}-1.test.js`] =
      head +
      `test("${name}", async () => {\n  ${(kind.mock ?? `vi.doMock(DEP, ${more});`).replace("DEP", mocked)}\n  await look("mocked");\n});\n`;
    files[`${name}-2.test.js`] = head + `test("${name}, the next file", () => look("next"));\n`;
    testFiles.push(`./${name}-1.test.js`, `./${name}-2.test.js`);
  }
  for (let n = 0; n < fillers; n++) {
    let text = importsOfFiller;
    for (let i = 0; i < functionsOfFiller; i++) text += `export function f${n}_${i}(x) { return x + ${i}; }\n`;
    files[`fill/f${n}.js`] = text;
  }
  return { files, testFiles };
}

test("the next test file reads the file's own names through a file between", async () => {
  const { files, testFiles } = project();
  using dir = tempDir("mock-barrel-next", files);
  const runTests = async (...flags: string[]) => {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" };
    const command = [bunExe(), "test", "--parallel=1", "--no-isolate", ...flags, ...testFiles];
    const { stdout, stderr, exitCode } = await run(command, String(dir), env);
    if (exitCode !== 0) console.error(stderr);
    const form = /^AOT test run \| (layers|one program)/m.exec(stdout + stderr)?.[1];
    return { printed: stdout.split("\n").filter(line => line.startsWith("| ")), exitCode, form };
  };
  const plain = await runTests();
  expect(plain.exitCode).toBe(0);
  expect(plain.printed).toHaveLength(testFiles.length);
  expect(plain.printed).toContain("| a-barrel mocked one,added,added+flag+plain");
  expect(plain.printed).toContain("| a-barrel next real,,flag+plain");
  expect(await runTests("--aot", "--aot-memory-limit", "1MB")).toEqual({ ...plain, form: "layers" });
  expect(await runTests("--aot")).toEqual({ ...plain, form: "one program" });
});
