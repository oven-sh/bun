// A CommonJS file has run because something required it, and no import has come to it yet. A mock is laid over it and ends with its test file.
// The next test file imports the file: it gets the names and the values of the file, not those of the mock. Plain `bun test` says what is right.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./default-timeout";
import { run } from "./run";
import { waysFor } from "./ways";
import { describe, test } from "../supported";

raiseDefaultTimeout(120_000);

const whole = `console.log("| lib runs");\nmodule.exports = { v: "real v", w: "real w" };`;
const libraries: Record<string, { name: string; files: Record<string, string> }> = {
  "a .cjs file": { name: "./lib.cjs", files: { "package.json": `{ "type": "module" }`, "lib.cjs": whole } },
  "exports.x =": {
    name: "./lib.cjs",
    files: {
      "package.json": `{ "type": "module" }`,
      "lib.cjs": `console.log("| lib runs");\nexports.v = "real v";\nexports.w = "real w";`,
    },
  },
  "a .js file of a CommonJS package": {
    name: "./inner/lib.js",
    files: {
      "package.json": `{ "type": "module" }`,
      "inner/package.json": `{ "type": "commonjs" }`,
      "inner/lib.js": whole,
    },
  },
  "the main file of a package": {
    name: "pkg",
    files: {
      "package.json": `{ "type": "module" }`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "main": "index.js" }`,
      "node_modules/pkg/index.js": whole,
    },
  },
};

const user = (name: string) => `import { createRequire } from "node:module";
const lib = createRequire(import.meta.url)("${name}");
export const seen = () => JSON.stringify(lib);`;
const show = `const show = ns => Object.keys(ns).sort().map(key => key + "=" + JSON.stringify(ns[key])).join(" ");`;
const firstFiles: Record<string, (name: string) => string> = {
  "the mock comes at the top": name => `import { mock, test } from "bun:test";
import * as user from "./user.mjs";
mock.module("${name}", () => ({ v: "mock v" }));
${show}
test("first", async () => console.log("| first:", user.seen(), "|", show(await import("${name}"))));`,
  "the mock comes in a test": name => `import { mock, test } from "bun:test";
import * as user from "./user.mjs";
test("first", () => {
  mock.module("${name}", () => ({ v: "mock v" }));
  console.log("| first:", user.seen());
});`,
};
const second = (name: string) => `import { test } from "bun:test";
import { createRequire } from "node:module";
import * as ns from "${name}";
import whole, { v, w } from "${name}";
import * as user from "./user.mjs";
${show}
console.log("| second, at the top:", show(ns), "|", v, w, JSON.stringify(whole));
test("second", async () => {
  console.log("| second, import():", show(await import("${name}")), (await import("${name}")) === ns);
  console.log("| second, require():", JSON.stringify(createRequire(import.meta.url)("${name}")), user.seen());
});`;

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

/**
 * Every case builds its project, most of them in layers: under a sanitizer most of a minute of processor time each.
 * So the cases are dealt to several test files: of `of` files, this one takes every `of`-th case, from the `part`-th on.
 */
export function mockOverARequiredFile(part: number, of: number) {
  describe.each(ways)("%s", (way, env) => {
    describe.each(Object.keys(firstFiles))("%s", first => {
      // The witness failed in both ways on the build in front of the cure, as seven more did: none in layers alone.
      const runsIn = (library: string) =>
        waysFor(ways, first === "the mock comes at the top" && library === "a .cjs file").some(([each]) => each === way);
      const mine = Object.keys(libraries).filter((_, index) => index % of === part);
      test.each(mine.filter(runsIn))("%s", async library => {
        const { name, files } = libraries[library];
        using dir = tempDir("mock-over-required-file", {
          ...files,
          "user.mjs": user(name),
          "a.test.mjs": firstFiles[first](name),
          "b.test.mjs": second(name),
        });
        const plain = await runTests(String(dir), {});
        expect(plain.results).toEqual(["pass first", "pass second"]);
        expect(plain.printed.join("\n")).toContain(`| second, at the top: default={"v":"real v","w":"real w"}`);
        expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
      });
    });
  });
}
