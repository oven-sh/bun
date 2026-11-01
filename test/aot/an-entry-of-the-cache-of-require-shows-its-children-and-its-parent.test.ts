// In a test run `require.cache` lists the compiled files. The run time keeps track of who has required whom only in a program that names a way from one module object to another, and
// the build looked for such a name on `module`, `require.main` and what they lead to. An entry taken out of the cache was none of those: run as one program, `entry.children` and
// `entry.parent` were undefined in an ES module and `children` was empty in a CommonJS file, so code that clears a module with all below it (`entry.children.forEach(..)`) threw.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const show = `console.error("OUT", typeof entry.children, entry.children?.map(child => child.id.split("/").pop()).join(), entry.parent === null ? "null" : typeof entry.parent, String(entry.parent?.id).split("/").pop());`;
const body = (take: string) => `test("t", () => {
  const path = require.resolve("./src/counter.cjs");
  require("./src/counter.cjs").bump();
  ${take}
  ${show}
});`;
const fromBunTest = `import { test } from "bun:test";\n`;
const forms: Record<string, [string, string]> = {
  "a variable of a TypeScript file": ["a.test.ts", fromBunTest + body("const entry = require.cache[path]!;")],
  "a variable of an ES module": ["a.test.mjs", fromBunTest + body("const entry = require.cache[path];")],
  "a variable of a CommonJS file": [
    "a.test.cjs",
    `const { test } = require("bun:test");\n` + body("const entry = require.cache[path];"),
  ],
  "a written key": [
    "a.test.ts",
    fromBunTest + body(`const entry = require.cache[require.resolve("./src/counter.cjs")]!;`),
  ],
  "read where it stands": [
    "a.test.ts",
    fromBunTest +
      body(
        "const entry = { get children() { return require.cache[path]!.children; }, get parent() { return require.cache[path]!.parent; } };",
      ),
  ],
  "a file of the project hands it out": [
    "a.test.ts",
    fromBunTest + `import { look } from "./src/look.cjs";\n` + body("const entry = look(path);"),
  ],
  "Module._cache": [
    "a.test.ts",
    fromBunTest + `import Module from "node:module";\n` + body("const entry = (Module as any)._cache[path];"),
  ],
};

async function linesOf(name: string, text: string, flags: string[], words?: string) {
  using dir = tempDir("aot-entry-of-the-cache", {
    "src/counter.cjs": `let n = 0; exports.bump = () => ++n; exports.dep = require("./dep.cjs");`,
    "src/dep.cjs": `exports.d = 1;`,
    "src/look.cjs": `exports.look = path => require.cache[path];`,
    [name]: text,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => line.startsWith("OUT")), exitCode };
}

test.concurrent.each(Object.entries(forms))(
  "taken by %s",
  async (_, [name, text]) => {
    const plain = await linesOf(name, text, []);
    expect(plain.lines).toEqual([expect.stringMatching(/^OUT object dep\.cjs object \S+$/)]);
    expect(await linesOf(name, text, ["--aot"])).toEqual(plain);
    expect(await linesOf(name, text, ["--aot", "--isolate"], "TestRunLayers:2")).toEqual(plain);
  },
  240_000,
);
