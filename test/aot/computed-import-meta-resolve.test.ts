// `import.meta.resolve(name)` where the build can read every value of `name`. An executable reads no package.json when it
// runs, so what a key of "exports" leads to is known to the build alone. A path is only joined to the URL of the module,
// whether a file is there or not, and the name of a built-in module is its own answer: as in plain Bun.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const never = "process.argv.length > 99";
const say = `const say = name => { try { console.log(import.meta.resolve(name).split("/").slice(-3).join("/")); } catch (error) { console.log("throws", error.name, error.code); } };\n`;
const forms = (name: string) => ({
  "out of a list": `say([${JSON.stringify(name)}][0]);\n`,
  "one of two": `say(${never} ? "x" : ${JSON.stringify(name)});\n`,
  "joined from parts": `say(${JSON.stringify(name.split("/"))}.join(${never} ? "-" : "/"));\n`,
});
const names = {
  "a key of exports": ["sub/a", "sub/lib/a.js\n"],
  "the package": ["sub", "node_modules/sub/index.js\n"],
  "a file that exports do not list": ["sub/lib/a.js", "throws ResolveMessage ERR_MODULE_NOT_FOUND\n"],
  "a package that is not there": ["absent/a", "throws ResolveMessage ERR_MODULE_NOT_FOUND\n"],
} as const;
const cases = Object.entries(names).flatMap(([what, [name, expected]]) =>
  Object.entries(forms(name)).map(([how, text]) => [what, how, text, expected] as const),
);
const files = (text: string) => ({
  "app/main.mjs": say + text,
  "app/b.mjs": `export const v = "b";\n`,
  "app/node_modules/sub/package.json": `{ "name": "sub", "version": "1.0.0", "exports": { ".": "./index.js", "./a": "./lib/a.js" } }\n`,
  "app/node_modules/sub/index.js": `exports.which = "index";\n`,
  "app/node_modules/sub/lib/a.js": `exports.which = "a";\n`,
  "away/empty.txt": "",
});

async function plainAndCompiled(text: string) {
  using dir = tempDir("computed-import-meta-resolve", files(text));
  const app = join(String(dir), "app");
  const away = join(String(dir), "away");
  const executable = join(away, isWindows ? "main.exe" : "main");
  const plain = await run([bunExe(), "main.mjs"], app, bunEnv);
  const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable], app, bunEnv);
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  const inPlace = (await run([executable], app, bunEnv)).stdout;
  rmSync(app, { recursive: true });
  return { plain: plain.stdout, inPlace, away: (await run([executable], away, bunEnv)).stdout };
}

test.each(cases)("%s, %s", async (_what, _how, text, expected) => {
  expect(await plainAndCompiled(text)).toEqual({ plain: expected, inPlace: expected, away: expected });
});

test("a path is joined and a built-in module is its own answer", async () => {
  const text = [`"./b"`, `"./absent.mjs"`, `"../up.mjs"`, `"node:fs"`, `"bun:sqlite"`]
    .map(name => `console.log(import.meta.resolve(${never} ? "sub/a" : ${name}).split("/").at(-1));\n`)
    .join("");
  const expected = "b\nabsent.mjs\nup.mjs\nnode:fs\nbun:sqlite\n";
  expect(await plainAndCompiled(text)).toEqual({ plain: expected, inPlace: expected, away: expected });
});
