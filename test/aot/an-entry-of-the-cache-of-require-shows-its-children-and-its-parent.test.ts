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
  "a variable of a CommonJS file": [
    "a.test.cjs",
    `const { test } = require("bun:test");\n` + body("const entry = require.cache[path];"),
  ],
  "Module._cache": [
    "a.test.ts",
    fromBunTest + `import Module from "node:module";\n` + body("const entry = (Module as any)._cache[path];"),
  ],
};

async function linesOf(name: string, text: string, flags: string[]) {
  using dir = tempDir("aot-entry-of-the-cache", {
    "src/counter.cjs": `let n = 0; exports.bump = () => ++n; exports.dep = require("./dep.cjs");`,
    "src/dep.cjs": `exports.d = 1;`,
    [name]: text,
  });
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags],
    cwd: String(dir),
    env: bunEnv,
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
  },
  240_000,
);
