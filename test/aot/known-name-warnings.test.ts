// TS100064 says that a load's path isn't a constant and may name code that isn't in the executable. Where the build has read
// every name that the path can be and has found a module under each, there is nothing to warn of. Where one name is missing,
// or the build can't read the name, the warning stays.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const never = "process.argv.length > 99";
const files = {
  "app/lib/a.js": `module.exports = "a";\n`,
  "app/lib/b.mjs": `export default "b";\n`,
  "app/lib/c.js": `module.exports = "c";\n`,
  "away/empty.txt": "",
};
const quiet: [string, string, string, string][] = [
  [
    "the href of a URL",
    "main.mjs",
    `console.log((await import(new URL("./lib/b.mjs", import.meta.url).href)).default);\n`,
    "b\n",
  ],
  ["a URL", "main.mjs", `console.log((await import(new URL("./lib/b.mjs", import.meta.url))).default);\n`, "b\n"],
  [
    "what import.meta.resolve answers",
    "main.mjs",
    `console.log((await import(import.meta.resolve("./lib/b.mjs"))).default);\n`,
    "b\n",
  ],
  [
    "a template over a list of one",
    "main.cjs",
    `const n = ["a"][0];\nconsole.log(require(\`./lib/\${n}.js\`));\n`,
    "a\n",
  ],
  [
    "a template over two names",
    "main.cjs",
    `const n = ${never} ? "c" : "a";\nconsole.log(require(\`./lib/\${n}.js\`));\n`,
    "a\n",
  ],
];
const warned: [string, string, string][] = [
  [
    "one of two names has no file",
    "main.cjs",
    `const n = ${never} ? "x" : "a";\nconsole.log(require(\`./lib/\${n}.js\`));\n`,
  ],
  ["a name out of the environment", "main.cjs", `console.log(require(process.env.NAME_OF_MODULE ?? "./lib/a.js"));\n`],
];

async function build(entry: string, text: string) {
  const dir = tempDir("known-name-warnings", { ...files, [`app/${entry}`]: text });
  const app = join(String(dir), "app");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], app, bunEnv);
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  return { dir, app, away, executable, said: built.stdout + built.stderr };
}

test.each(quiet)("no warning: %s", async (_, entry, text, expected) => {
  const { dir, app, away, executable, said } = await build(entry, text);
  using _dir = dir;
  expect(said).not.toContain("TS100064");
  rmSync(app, { recursive: true });
  expect((await run([executable], away, bunEnv)).stdout).toBe(expected);
});

test.each(warned)("still warned: %s", async (_, entry, text) => {
  const { dir, said } = await build(entry, text);
  using _dir = dir;
  expect(said).toContain("TS100064");
});
