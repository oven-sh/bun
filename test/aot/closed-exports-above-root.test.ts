// A program built in a folder of its own finds its packages in a node_modules further up, as in a monorepo. A package
// with "exports" has only the names written there, also where the name is computed, none of the package's files is in the
// executable, and the executable runs in place, so that the file asked for lies on the disk.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const never = "process.argv.length > 99";
const names = {
  "a name out of a list": `const name = ["sub/lib/a.js"][0];\n`,
  "one of two names": `const name = ${never} ? "x" : "sub/lib/a.js";\n`,
  "a name joined from parts": `const name = ["sub", "lib", "a.js"].join(${never} ? "-" : "/");\n`,
};
const say = `const say = async (what, load) => { try { console.log(what, await load()); } catch (error) { console.log(what, "throws", error.name, error.code); } };\n`;
const imports = `await say("import", async () => (await import(name)).default.which);\n`;
const loads = {
  "main.cjs": `say("require", () => require(name).which).then(() => say("require.resolve", () => typeof require.resolve(name)));\n`,
  "main.mjs": imports + `await say("import.meta.resolve", () => typeof import.meta.resolve(name));\n`,
};
const cases = Object.entries(names).flatMap(([how, name]) =>
  Object.entries(loads).map(([entry, load]) => [how, entry, say + name + load] as const),
);
const packageFiles = {
  "node_modules/sub/package.json": `{ "name": "sub", "version": "1.0.0", "exports": { ".": "./index.js", "./a": "./lib/a.js" } }\n`,
  "node_modules/sub/index.js": `exports.which = "index";\n`,
  "node_modules/sub/lib/a.js": `exports.which = "a";\n`,
};

async function plainAndCompiled(entry: string, text: string) {
  using dir = tempDir("closed-exports-above-root", { ...packageFiles, [`app/${entry}`]: text });
  const app = join(String(dir), "app");
  const executable = join(app, isWindows ? "main.exe" : "main");
  const plain = await run([bunExe(), entry], app, bunEnv);
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], app, bunEnv);
  expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({ exitCode: 0, stderr: "" });
  return { plain: plain.stdout, compiled: (await run([executable], app, bunEnv)).stdout };
}

test.each(cases)("a path that the exports do not list is not found: %s, %s", async (_, entry, text) => {
  const { plain, compiled } = await plainAndCompiled(entry, text);
  expect(plain.match(/ throws /g)).toHaveLength(2);
  expect(compiled).toBe(plain);
});

test.each(Object.entries({ ...loads, "main.mjs": imports }))(
  "a name that the exports list is found: %s",
  async (entry, load) => {
    const { plain, compiled } = await plainAndCompiled(entry, say + `const name = ["sub/a"][0];\n` + load);
    expect(plain).toContain(" a\n");
    expect(compiled).toBe(plain);
  },
);
