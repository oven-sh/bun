import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const library = `export function used(): number { return 1 }
export function unused(): number { const s: { a: number } = { a: 1 }; return s.b }
`;
const main = `import { used } from "./lib";\nimport "./way.cjs";\nconsole.log(used());\n`;

const ways: Record<string, string> = {
  "tests its parent": `if (!module.parent) console.log("no parent");\n`,
  "reads its parent": `console.log(typeof module.parent);\n`,
  "reads its children": `console.log(module.children.length);\n`,
  "reads an entry of require.cache": `console.log(typeof require.cache[__filename + "?"]);\n`,
  "lists require.cache": `console.log(Object.keys(require.cache).some(path => path.endsWith("lib.ts")));\n`,
  "hands its module object on": `function kind(m) { return typeof m; }\nconsole.log(kind(module));\n`,
  "stores a function of the loader": `const Module = require("node:module");\nconst load = Module._load;\nModule._load = function (...all) { return load.apply(this, all); };\nconsole.log("stored");\n`,
};

for (const [name, way] of Object.entries(ways)) {
  test.concurrent(
    `a type error in an export that nothing imports stops no build where a CommonJS file ${name}`,
    async () => {
      using dir = tempDir("no-module-object", { "main.ts": main, "lib.ts": library, "way.cjs": way });
      const plain = await run([bunExe(), "main.ts"], String(dir), bunEnv);
      const build = await run(
        [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "program"],
        String(dir),
        bunEnv,
      );
      expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
      const ran = await run([join(String(dir), "program")], String(dir), bunEnv);
      expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    },
    240_000,
  );
}

test("a type error in an export of an ES module that require loads stops the build where code gets at module objects", async () => {
  using dir = tempDir("module-object-made-by-require", {
    "main.cjs": `const lib = require("./lib.ts");\nconsole.log(lib.used());\nfor (const child of module.children) console.log(Object.keys(child.exports).join());\n`,
    "lib.ts": library,
  });
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "program"],
    String(dir),
    bunEnv,
  );
  expect({ names: build.stderr.includes("TS2339"), exitCode: build.exitCode }).toEqual({ names: true, exitCode: 1 });
}, 240_000);
