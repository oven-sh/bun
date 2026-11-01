// A hoisted `vi.mock()` stands in place of a module whose body never ran, and a test ends it with `vi.doUnmock()`. Whoever was linked against the mock goes on
// reading it: bindings, a namespace object that the file holds, a module that passes the names on. Only a later load gets the module itself.
// ../mock-ends-user-stays.test.ts has the mock that ends with its test file. Plain `bun test` says what is right.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./default-timeout";
import { run } from "./run";
import { waysFor } from "./ways";
import { describe, test } from "../supported";

raiseDefaultTimeout(120_000);

const said = `const said = run => { try { return String(run()); } catch (error) { return error.constructor.name + ": " + error.message; } };`;
const dep = `console.log("| dep runs");
export function fn() { return "real fn"; }
export const value = "real value";
export let count = 0;
export const bump = () => ++count;`;
const user = (name: string) => `console.log("| ${name} runs");
import { fn, value } from "./dep.js";
${said}
export const seen = () => said(() => fn() + ", " + value);`;
const head = `import { test, vi } from "bun:test";
import * as ns from "./dep.js";
import * as star from "./star.js";
import { fn, value } from "./dep.js";
import { seen } from "./user.js";
vi.mock("./dep.js", () => { console.log("| factory runs"); return { fn: () => "mock fn", value: "mock value" }; });
${said}
const all = () => [said(() => fn()), said(() => value), said(() => ns.fn()), said(() => ns.value), said(() => star.fn()), said(() => star.value), Object.keys(ns).join("+"), seen()].join(" . ");`;

const shared = {
  "package.json": `{}`,
  "dep.js": dep,
  "star.js": `console.log("| star runs");\nexport * from "./dep.js";`,
  "user.js": user("user"),
  "late.js": user("late"),
};

const projects: Record<string, Record<string, string>> = {
  "nothing loads the module behind the end": {
    "a.test.js": `${head}
test("the mock ends", () => {
  console.log("| mocked:", all());
  vi.doUnmock("./dep.js");
  console.log("| ended:", all());
});
test("the next test", () => console.log("| the next test:", all()));`,
    "b.test.js": `import { test } from "bun:test";
import { seen } from "./user.js";
import { value } from "./dep.js";
test("the next file", () => console.log("| the next file:", value, ".", seen()));`,
  },
  "another module is loaded behind the end": {
    "other.js": `console.log("| other runs");\nexport const other = 1;`,
    "a.test.js": `${head}
test("the mock ends", async () => {
  vi.doUnmock("./dep.js");
  console.log("| other:", (await import("./other.js")).other);
  console.log("| ended:", all());
});`,
  },
  "import() behind the end": {
    "a.test.js": `${head}
test("the mock ends", async () => {
  vi.doUnmock("./dep.js");
  console.log("| ended:", all());
  const late = await import("./dep.js");
  console.log("| import():", late === ns, late.fn(), late.value, late.bump(), Object.keys(late).join("+"));
});`,
  },
  "a late user behind the end": {
    "a.test.js": `${head}
test("the mock ends", async () => {
  vi.doUnmock("./dep.js");
  console.log("| ended:", all());
  console.log("| a late user:", (await import("./late.js")).seen());
  console.log("| require():", require("./dep.js").value);
});`,
  },
  "require() behind the end": {
    "a.test.js": `${head}
test("the mock ends", () => {
  vi.doUnmock("./dep.js");
  console.log("| ended:", all());
  console.log("| require():", require("./dep.js").value, require("./dep.js").fn());
});`,
  },
  "a module that passes the names on is loaded behind the end": {
    "late-star.js": `console.log("| late star runs");\nexport * from "./dep.js";`,
    "a.test.js": `${head}
test("the mock ends", async () => {
  vi.doUnmock("./dep.js");
  console.log("| ended:", all());
  const late = await import("./late-star.js");
  console.log("| through it:", late.fn(), late.value, Object.keys(late).join("+"));
});`,
  },
  "a mock without a factory behind the end": {
    "a.test.js": `${head}
test("the mock ends", async () => {
  vi.doUnmock("./dep.js");
  console.log("| ended:", all());
  vi.doMock("./dep.js");
  const made = await import("./dep.js");
  console.log("| import():", vi.isMockFunction(made.fn), String(made.fn()), made.value);
});`,
  },
  "the original behind the end": {
    "a.test.js": `${head}
test("the mock ends", async () => {
  vi.doUnmock("./dep.js");
  console.log("| ended:", all());
  const actual = await vi.importActual("./dep.js");
  console.log("| importActual():", actual.fn(), actual.value);
});`,
  },
  "the next file imports a user alone": {
    "a.test.js": `${head}
test("the mock ends", () => {
  vi.doUnmock("./dep.js");
  console.log("| ended:", all());
});`,
    "b.test.js": `import { test } from "bun:test";
import { seen } from "./user.js";
test("the next file", () => console.log("| the next file:", seen()));`,
  },
  "a second mock behind the end": {
    "a.test.js": `${head}
test("the mock ends", async () => {
  vi.doUnmock("./dep.js");
  console.log("| ended:", all());
  vi.doMock("./dep.js", () => ({ fn: () => "second fn", value: "second value" }));
  const second = await import("./dep.js");
  console.log("| import():", second === ns, second.fn(), second.value);
});`,
  },
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  // TODO(bun): row 4115: `bun test` takes the importers of a mocked module out of its loader with the mock, so they run again for the next test file.
  // A compiled importer runs once.
  const printed = stdout.split("\n").filter(line => line.startsWith("| ") && !/^\| (user|star) runs/.test(line));
  return { printed, results, exitCode };
}

/**
 * Every case builds its project, half of them in layers: under a sanitizer most of a minute of processor time each.
 * So the cases are dealt to several test files: of `of` files, this one takes every `of`-th case, from the `part`-th on.
 */
export function mockEndsInATest(part: number, of: number) {
  const isMine = (index: number) => index % of === part;
  const names = Object.keys(projects);

  // `bun test` loads the user anew, against the module itself. The one compiled user goes on, and the module runs when the user is asked for again.
  test.each(isMine(names.length) ? ways : [])("a user that require() loaded is required again, %s", async (_, env) => {
    using dir = tempDir("mock-ends-in-test", {
      ...shared,
      "a.test.js": `import { test, vi } from "bun:test";
test("the mock ends", () => {
  vi.doMock("./dep.js", () => ({ fn: () => "mock fn", value: "mock value" }));
  console.log("| mocked:", require("./user.js").seen());
  vi.doUnmock("./dep.js");
  console.log("| again:", require("./user.js").seen());
});`,
    });
    const plain = await runTests(String(dir), {});
    expect(plain.printed).toEqual(["| mocked: mock fn, mock value", "| dep runs", "| again: real fn, real value"]);
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });

  describe.each(ways)("%s", (way, env) => {
    // The witness failed in both ways on the build in front of the cure, as nine more did: none in layers alone.
    const runsIn = (name: string) => waysFor(ways, name === "a late user behind the end").some(([each]) => each === way);
    test.each(names.filter((name, index) => isMine(index) && runsIn(name)))("%s", async name => {
      using dir = tempDir("mock-ends-in-test", { ...shared, ...projects[name] });
      const plain = await runTests(String(dir), {});
      expect(plain.printed).toContain(
        "| ended: mock fn . mock value . mock fn . mock value . mock fn . mock value . fn+value . mock fn, mock value",
      );
      expect(plain.exitCode).toBe(0);
      expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
    });
  });
}
