// BUN_AOT_TEST_FILES_FROM_DISK=1: the test files are not compiled, and import compiled files.
// src/odd.js is well formed, and what it imports or hands on is not there or is no program. Under `bun test` the load of the test
// file fails with what is wrong below: before a name that it imports is looked for, and before a file that it imports runs.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const words: Record<string, Record<string, string>> = {
  "the test files from disk": { BUN_AOT_TEST_FILES_FROM_DISK: "1" },
  "the test files from disk, and a file that imports what they name": {
    BUN_AOT_TEST_FILES_FROM_DISK: "1",
    BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
  },
};

const suite = {
  "package.json": `{ "name": "suite", "type": "module" }`,
  "src/good.js": `export const good = () => "good";\n`,
  "src/prints.js": `console.log("a file beside the one that cannot load has run");\n`,
  "tests/healthy.test.js": `import { expect, test } from "bun:test";
import { good } from "../src/good.js";
test("a healthy file", () => {
  expect(good()).toBe("good");
});
`,
  "tests/takes-a-name.test.js": `import { expect, test } from "bun:test";
import "../src/prints.js";
import { through } from "../src/odd.js";
test("a name of a file that cannot load", () => {
  expect(through).toBe(1);
});
`,
  "tests/asks-twice.test.js": `import { expect, test } from "bun:test";
const ask = () => import("../src/odd.js").then(() => "loaded", error => error);
test("the load is caught twice", async () => {
  const [first, second] = [await ask(), await ask()];
  console.error("CAUGHT", String(first?.message ?? first), "|", String(second?.message ?? second), "|", first === second);
});
`,
};

const brokenFile = { "src/broken.js": `export const a = ;\n` };

const cannotLoad: Record<string, Record<string, string>> = {
  "hands on a name of a file with a syntax error": {
    "src/odd.js": `export { a as through } from "./broken.js";\n`,
    ...brokenFile,
  },
  "hands on the default export of a file with a syntax error": {
    "src/odd.js": `export { default as through } from "./broken.js";\n`,
    ...brokenFile,
  },
  "hands on every name of a file with a syntax error": {
    "src/odd.js": `export * from "./broken.js";\n`,
    ...brokenFile,
  },
  "imports a name of a file with a syntax error and exports it": {
    "src/odd.js": `import { a } from "./broken.js";\nexport { a as through };\n`,
    ...brokenFile,
  },
  "hands on a name that the next file hands on from a file with a syntax error": {
    "src/odd.js": `export { through } from "./between.js";\n`,
    "src/between.js": `export { a as through } from "./broken.js";\n`,
    ...brokenFile,
  },
  "hands on a name of a file that is not there": {
    "src/odd.js": `export { through } from "./nowhere.js";\n`,
  },
  "hands on every name of a file that is not there": {
    "src/odd.js": `export * from "./nowhere.js";\n`,
  },
  "hands on a file that is not there as an object": {
    "src/odd.js": `export * as through from "./nowhere.js";\n`,
  },
  "hands on a name of a module of Node that does not exist": {
    "src/odd.js": `export { through } from "node:there-is-no-such-module";\n`,
  },
  "exports the name itself and imports a file that is not there": {
    "src/odd.js": `import "./nowhere.js";\nexport const through = 1;\n`,
  },
  "lacks the name and imports a file that is not there": {
    "src/odd.js": `import "./nowhere.js";\nexport const other = 1;\n`,
  },
};

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags, "./tests"], directory, {
    ...bunEnv,
    ...env,
  });
  const withoutDirectory = stderr.replace(/[^\s'"]*\/(src|tests)\//g, "$1/");
  const ends = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  return {
    errors: [...withoutDirectory.matchAll(/^-{31}\n([^]*?)\n-{31}$/gm)].map(match => match[1]),
    caught: withoutDirectory.match(/^CAUGHT .*$/m)?.[0],
    ends: ends.sort(),
    counts: [...stderr.matchAll(/^ *(\d+) (pass|fail|errors?)$/gm)].map(match => `${match[1]} ${match[2]}`),
    stdout: stdout.replace(/^bun test .*\n/, ""),
    exitCode,
  };
}

for (const [form, env] of Object.entries(words)) {
  test.concurrent.each(Object.keys(cannotLoad))(`${form}: a file that %s`, async name => {
    using dir = tempDir("aot-a-test-file-from-disk-imports-a-file-that-cannot-load", { ...suite, ...cannotLoad[name] });
    const plain = await runTests(String(dir), {});
    expect(plain.errors.join("\n")).not.toContain("through");
    expect(plain.errors).toHaveLength(1);
    expect(plain).toMatchObject({
      ends: ["pass a healthy file", "pass the load is caught twice"],
      counts: ["2 pass", "1 fail", "1 error"],
      stdout: "",
      exitCode: 1,
    });
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });
}
