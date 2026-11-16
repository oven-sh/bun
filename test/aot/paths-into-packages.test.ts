// A program may spell out the path of a file of an installed package: "./node_modules/a/index.mjs". Where the build knows
// every value of the specifier, such a file is a file of the program like any other: the executable runs in an empty folder
// with its sources gone and prints what plain Bun printed. What decides is not what a folder is called, but whether the
// build was told to leave the package outside (--external): parallel/modules/external-package holds that side.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const say = `const say = async load => { try { return (await load()).v; } catch (error) { return error.constructor.name; } };\n`;
const never = "process.argv.length > 99";
const forms = {
  "the path alone": `console.log(await say(() => import("./node_modules/a/index.mjs")));\n`,
  "one of two paths": `console.log(await say(() => import(${never} ? "./b.mjs" : "./node_modules/a/index.mjs")));\n`,
  "one of two names behind the folder": `const name = ${never} ? "x" : "a";\nconsole.log(await say(() => import("./node_modules/" + name + "/index.mjs")));\n`,
  "a path out of a table": `const table = { p: "./b.mjs", q: "./node_modules/a/index.mjs" };\nconst key = ${never} ? "p" : "q";\nconsole.log(await say(() => import(table[key])));\n`,
};
const files = (text: string) => ({
  "app/main.mjs": say + text,
  "app/b.mjs": `export const v = "b";\n`,
  "app/node_modules/a/index.mjs": `export const v = "package a";\n`,
  "app/node_modules/a/package.json": `{ "name": "a", "version": "1.0.0", "main": "index.mjs", "type": "module" }\n`,
  "away/empty.txt": "",
});

test.each(Object.entries(forms))("a file of a package is in the executable: %s", async (_, text) => {
  using dir = tempDir("paths-into-packages", files(text));
  const app = join(String(dir), "app");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const plain = await run([bunExe(), "main.mjs"], app, bunEnv);
  expect(plain.stdout).toBe("package a\n");
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], app, bunEnv);
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  rmSync(app, { recursive: true });
  expect((await run([executable], away, bunEnv)).stdout).toBe(plain.stdout);
});

test("beside a path into a package that is left outside, the other path is in the executable", async () => {
  const text = `console.log(await say(() => import(${never} ? "./node_modules/a/index.mjs" : "./b.mjs")));\n`;
  using dir = tempDir("paths-into-packages", files(text));
  const app = join(String(dir), "app");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--external", "a", "main.mjs", "--outfile", executable],
    app,
    bunEnv,
  );
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  rmSync(app, { recursive: true });
  expect((await run([executable], away, bunEnv)).stdout).toBe("b\n");
});
