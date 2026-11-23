// Where some code of the program may take a file out of require.cache, or stores into require.extensions, the loader of the run time links the import statements
// of a test file. A CommonJS file that an ES module imports further down still runs while the graph is loaded, ahead of every ES body, as in `bun test`.
// What such code does to a build holds for the whole program, so each project is built by itself.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const triggers = {
  "delete require.cache[key]": `exports.get = key => { delete require.cache[key]; };`,
  "require.extensions[ext] = handler": `exports.set = (ext, handler) => { require.extensions[ext] = handler; };`,
};

async function run(dir: string, flags: string[]) {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, exitCode] = await Promise.all([child.stdout.text(), child.exited]);
  return { lines: stdout.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.concurrent.each(Object.entries(triggers))(
  "%s in the program, two files between",
  async (_, trigger) => {
    using folder = tempDir("aot-left-import-order", {
      "package.json": `{ "name": "left-import-order", "type": "module" }`,
      "node_modules/q/package.json": `{ "name": "q", "main": "c.js" }`,
      "node_modules/q/c.js": `console.log("OUT c");\n${trigger}`,
      "e.mjs": `console.log("OUT e"); export const e = 1;`,
      "one.mjs": `import c from "q"; console.log("OUT one"); export const one = c;`,
      "two.mjs": `import { one } from "./one.mjs"; console.log("OUT two"); export const two = one;`,
      "t.test.mjs": `import { test } from "bun:test";
import { e } from "./e.mjs";
import { two } from "./two.mjs";
test("t", () => console.log("OUT t", e, typeof two));`,
    });
    const plain = await run(String(folder), []);
    expect(plain).toEqual({ lines: ["OUT c", "OUT e", "OUT one", "OUT two", "OUT t 1 object"], exitCode: 0 });
    expect(await run(String(folder), ["--aot"])).toEqual(plain);
  },
  240_000,
);
