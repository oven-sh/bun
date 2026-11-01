// An installed package of test helpers wraps spyOn and makes the names itself: `exports.spyAll = object => Object.keys(object).map(name => spyOn(object, name))`.
// A test hands it the namespace of an ES module of the project. Over layers only the program that holds the package knew of such a spy, and the exports of the
// project's file were compiled as nobody's to replace: "TypeError: Cannot spy on 'inner' of .. because the build didn't see a test spy on it".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

// The keys of a namespace come in the order of the alphabet: `inner` is the first.
const packages = {
  "every function of the object": [
    `exports.spy = object => Object.keys(object).filter(name => typeof object[name] === "function").map(name => spyOn(object, name));`,
    "OUT real,real! 1,2",
    "OUT real,SPIED",
  ],
  "names that the package puts together": [
    `exports.spy = object => ["na" + "me", "in" + "ner"].map(name => spyOn(object, name));`,
    "OUT real,real! 2,1",
    "OUT SPIED,SPIED!",
  ],
  "names that the package spells": [
    `exports.spy = object => [spyOn(object, "name"), spyOn(object, "inner")];`,
    "OUT real,real! 2,1",
    "OUT SPIED,SPIED!",
  ],
};

async function linesOf(text: string, flags: string[], words?: string) {
  using dir = tempDir("aot-package-spies", {
    "package.json": `{ "name": "p" }`,
    "node_modules/helpers/package.json": `{ "name": "helpers", "main": "index.js" }`,
    "node_modules/helpers/index.js": `const { spyOn } = require("bun:test");\n${text}\n`,
    "src/dep.mjs": `export const name = () => "real";\nexport const inner = () => name() + "!";\n`,
    "src/service.mjs": `import { name, inner } from "./dep.mjs";\nexport const run = () => [name(), inner()].join();\n`,
    "a.test.mjs": `
      import { test } from "bun:test";
      import helpers from "helpers";
      import * as service from "./src/service.mjs";
      import * as dep from "./src/dep.mjs";
      test("t", () => {
        const spies = helpers.spy(dep);
        console.error("OUT", service.run(), spies.map(spy => spy.mock.calls.length).join());
        spies[0].mockReturnValue("SPIED");
        console.error("OUT", service.run());
      });`,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error|TypeError)/.test(line)), exitCode };
}

test.concurrent.each(Object.entries(packages))(
  "%s",
  async (_, [text, ...lines]) => {
    const plain = await linesOf(text, []);
    expect(plain).toEqual({ lines, exitCode: 0 });
    expect(await linesOf(text, ["--aot"])).toEqual(plain);
    expect(await linesOf(text, ["--aot"], "TestRunLayers:2")).toEqual(plain);
    expect(await linesOf(text, ["--aot"], "TestRunLayers:3")).toEqual(plain);
  },
  240_000,
);
