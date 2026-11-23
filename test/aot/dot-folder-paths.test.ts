// Tools write code into folders whose names begin with a dot (.contentlayer/generated, .svelte-kit, .velite), and programs
// load it by a path that they spell out. Where the build knows every value of the specifier, each of them is a file of the
// program like any other. The executable runs in an empty folder with its sources gone: it prints what plain Bun printed.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const say = `const say = async load => { try { return (await load()).v; } catch (error) { return error.constructor.name; } };\n`;
const never = "process.argv.length > 99";
const forms = {
  "the path alone": `console.log(await say(() => import("./.gen/page.mjs")));\n`,
  "one of two paths": `console.log(await say(() => import(${never} ? "./gen/page.mjs" : "./.gen/page.mjs")));\n`,
  "one of two names behind the folder": `const name = ${never} ? "x" : "page";\nconsole.log(await say(() => import("./.gen/" + name + ".mjs")));\n`,
  "a path out of a table": `const table = { a: "./gen/page.mjs", b: "./.gen/page.mjs" };\nconst key = ${never} ? "a" : "b";\nconsole.log(await say(() => import(table[key])));\n`,
  "a dot folder below a folder": `const rest = ${never} ? "page" : ".inner/page";\nconsole.log(await say(() => import("./gen/" + rest + ".mjs")));\n`,
};

test.each(Object.entries(forms))("a file in a dot folder is in the executable: %s", async (_, text) => {
  using dir = tempDir("dot-folder-paths", {
    "app/main.mjs": say + text,
    "app/gen/page.mjs": `export const v = "gen";\n`,
    "app/gen/.inner/page.mjs": `export const v = "dot gen";\n`,
    "app/.gen/page.mjs": `export const v = "dot gen";\n`,
    "away/empty.txt": "",
  });
  const app = join(String(dir), "app");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const plain = await run([bunExe(), "main.mjs"], app, bunEnv);
  expect(plain.stdout).toBe("dot gen\n");
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], app, bunEnv);
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  rmSync(app, { recursive: true });
  expect((await run([executable], away, bunEnv)).stdout).toBe(plain.stdout);
});
