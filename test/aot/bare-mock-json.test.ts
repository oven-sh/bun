// A JSON file that has been loaded is mocked without a factory, or its original is asked for under a mock: it has a default export and a name for each key, like an ES module.
// Plain `bun test` says what is right.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
import { describe, test } from "./supported";

raiseDefaultTimeout(120_000);

const shared = {
  "package.json": `{ "type": "module" }`,
  "data.json": `{ "v": "real", "n": 1, "list": [1, 2], "in": { "deep": "real deep" } }`,
  "lib.mjs": `import it, { v } from "./data.json";
export const now = () => JSON.stringify(it) + " " + v;`,
  "z.test.js": `import { test } from "bun:test";
import { now } from "./lib.mjs";
test("z", () => console.log("| the next file:", now()));`,
};
const factory = `() => ({ default: { v: "mock" }, v: "mock v" })`;

const bodies: Record<string, string> = {
  "vi.mock": `vi.mock("./data.json");`,
  "jest.mock": `jest.mock("./data.json");`,
  "with spies": `vi.mock("./data.json", { spy: true });`,
  "then required": `vi.mock("./data.json"); console.log("| required:", say(require("./data.json")));`,
  "then imported": `vi.mock("./data.json"); console.log("| imported:", say(await import("./data.json")));`,
  "then unmocked": `vi.mock("./data.json"); vi.doUnmock("./data.json"); console.log("| imported:", say(await import("./data.json")));`,
  "importActual under a mock": `mock.module("./data.json", ${factory}); console.log("| actual:", say(await vi.importActual("./data.json")));`,
  "requireActual under a mock": `mock.module("./data.json", ${factory}); console.log("| actual:", say(jest.requireActual("./data.json")));`,
  "the original handed to a factory": `await mock.module("./data.json", async original => {
    const names = await original();
    console.log("| original:", say(names));
    return { ...names, v: "mock v" };
  });`,
};

const ways: [string, Record<string, string>][] = [
  ["as one program", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }],
];

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.split("\n").filter(line => line.startsWith("| ")), results, exitCode };
}

// It failed in both ways on the build in front of the cure, as six more did: none in layers alone.
const witness = "vi.mock";

describe.each(ways)("%s", (way, env) => {
  const runsIn = (name: string) => waysFor(ways, name === witness).some(([each]) => each === way);
  test.each(Object.keys(bodies).filter(runsIn))("%s", async name => {
    using dir = tempDir("bare-mock-json", {
      ...shared,
      "a.test.js": `import { jest, mock, test, vi } from "bun:test";
import { now } from "./lib.mjs";
const say = names => JSON.stringify(names) + " " + Object.keys(names ?? {});
test("t", async () => {
  console.log("| before:", now());
  ${bodies[name]}
  console.log("| after:", now());
});`,
    });
    const plain = await runTests(String(dir), {});
    expect(plain.exitCode).toBe(0);
    expect(plain.printed[0]).toBe(`| before: {"v":"real","n":1,"list":[1,2],"in":{"deep":"real deep"}} real`);
    expect(plain.printed.at(-1)).toBe(plain.printed[0].replace("before", "the next file"));
    expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
  });
});
