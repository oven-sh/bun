import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A file that one place of a program names in writing and another by a name that is computed is one module under `bun run`. A
// computed name finds only the entry points of an executable: with the file as another entry point it is one module there too.

const files = {
  "lib.cjs": `globalThis.runs = (globalThis.runs || 0) + 1;\nlet n = 0;\nexports.name = "lib";\nexports.next = () => ++n;\n`,
  "made-require.mjs": `import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
const name = ["./lib", ".cjs"].join("");
console.log(made("./lib.cjs") === made(name), globalThis.runs);
`,
  "require.cjs": `const name = ["./lib", ".cjs"].join("");
console.log(require("./lib.cjs") === require(name), globalThis.runs);
`,
  "import-and-made-require.mjs": `import lib from "./lib.cjs";
import { createRequire } from "node:module";
const name = ["./lib", ".cjs"].join("");
console.log(lib === createRequire(import.meta.url)(name), globalThis.runs, (await import(name)).default === lib, globalThis.runs);
`,
  "state.mjs": `import { createRequire } from "node:module";
const made = createRequire(import.meta.url);
const name = ["./lib", ".cjs"].join("");
console.log(made("./lib.cjs").next(), made(name).next(), made("./lib.cjs") === made(name), globalThis.runs);
`,
};

async function sameAsPlain(main: string, ...flags: string[]) {
  using dir = tempDir("written-and-computed", files);
  const plain = await run([bunExe(), "run", main], String(dir));
  expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", ...flags, main, "lib.cjs", "--outfile", "program"],
    String(dir),
  );
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const ran = await run([join(String(dir), "program")], String(dir));
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}

for (const main of Object.keys(files).filter(name => name !== "lib.cjs")) {
  test(
    `in place, a file is one module however it is named: ${main}`,
    () => sameAsPlain(main, "--compile-in-place"),
    120_000,
  );
  test(
    `in an ordinary executable, a file is one module however it is named: ${main}`,
    () => sameAsPlain(main),
    120_000,
  );
}
