// load.js imports the files of a list by a name that it puts together. One of them imports a name that nobody exports, so the build of a test run leaves that file to
// the loader, which says what is wrong with it. The import took a file left outside among its candidates for a name that nobody knows, and dropped them all: as one
// program `Cannot load 'one.js': it wasn't compiled with the program`, for the good files too; under require() they ran from disk.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const loads = (how: string) => `console.log("OUT load");
for (const file of ["one.js", "broken.js", "two.js"]) {
  try {
    ${how}("./" + file);
  } catch (error) {
    console.log("OUT", file, error.name, String(error.message).replace(/ in module .*/s, ""));
  }
}`;
const files = (how: string) => ({
  "package.json": `{ "name": "import-list-broken", "type": "module" }`,
  "load.js": loads(how),
  "load.test.js": `import { test } from "bun:test";\nimport "./load.js";\ntest("loaded", () => {});`,
  "dep.js": `export function a() {}`,
  "one.js": `console.log("OUT one", new Error().stack.includes("one.js"));`,
  "broken.js": `console.log("OUT broken"); import { nope } from "./dep.js"; export const f = () => nope;`,
  "two.js": `console.log("OUT two");`,
});

async function run(dir: string, flags: string[], words = "") {
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: dir,
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return {
    lines: stdout.split("\n").filter(line => line.startsWith("OUT")),
    exitCode,
    refused: /loads? of code that wasn't compiled/.test(stdout + stderr),
  };
}

test.each(["await import", "require"])(
  "%s() of a list with a file that fails to link",
  async how => {
    using folder = tempDir("aot-import-list-broken", files(how));
    const dir = String(folder);
    const plain = await run(dir, []);
    expect(plain).toEqual({
      lines: ["OUT load", "OUT one true", "OUT broken.js SyntaxError Export named 'nope' not found", "OUT two"],
      exitCode: 0,
      refused: false,
    });
    for (const words of ["TestRunLayers:0", "TestRunLayers:1", "TestRunLayers:2"])
      expect({ words, ...(await run(dir, ["--aot"], words)) }).toEqual({ words, ...plain });
  },
  240_000,
);
