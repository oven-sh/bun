// A program names a file by a constant absolute path, and the file is created after the build: a configuration file under /etc, say.
// The executable loads it as `bun <file>` does. Code is refused unless the build allows code from disk.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const timeout = 120_000;

const data: Record<string, string> = {
  "data.json": `{ "kind": "json", "list": [1, 2] }`,
  "data.toml": `kind = "toml"\n`,
  "data.yaml": `kind: yaml\n`,
  "data.txt": `text\n`,
};

const prelude = String.raw`
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const show = (label, value) =>
  console.log(label, typeof value, JSON.stringify(value), value && typeof value === "object" ? Object.keys(value).join() : "");
const attempt = async (label, load) => {
  try {
    show(label, await load());
  } catch (error) {
    console.log(label, "threw", error.name, error.code);
  }
};
`;

const loadsOfData = (folder: string) => {
  const at = (name: string) => JSON.stringify(join(folder, name));
  return String.raw`${prelude}
const json = ${at("data.json")};
await attempt("require json", () => require(${at("data.json")}));
await attempt("require json through a variable", () => require(json));
await attempt("require json twice", () => require(json) === require(json));
await attempt("require toml", () => require(${at("data.toml")}));
await attempt("require yaml", () => require(${at("data.yaml")}));
await attempt("require txt", () => require(${at("data.txt")}));
await attempt("import json", () => import(${at("data.json")}));
await attempt("import json through a variable", () => import(json));
await attempt("import and require", async () => (await import(json)).default === require(json));
await attempt("import toml", () => import(${at("data.toml")}));
await attempt("import txt", () => import(${at("data.txt")}));
await attempt("import with a type", () => import(${at("data.txt")}, { with: { type: "text" } }));
await attempt("import.meta.require", () => import.meta.require(json));
await attempt("require.resolve", () => require.resolve(json) === json);
await attempt("import.meta.resolve", () => import.meta.resolve(json) === Bun.pathToFileURL(json).href);
await attempt("require nothing", () => require(${at("none.json")}));
await attempt("import nothing", () => import(${at("none.json")}));
await attempt("require.resolve nothing", () => require.resolve(${at("none.json")}));
await attempt("import.meta.require nothing", () => import.meta.require(${at("none.json")}));
if (require("node:fs").existsSync(json)) show("outside a try block", require(json));
`;
};

const loadsOfCode = (folder: string) => {
  const at = (name: string) => JSON.stringify(join(folder, name));
  return String.raw`${prelude}
await attempt("require code", () => require(${at("code.cjs")}));
await attempt("import code", async () => (await import(${at("code.mjs")})).default);
`;
};

async function buildThenCreate(program: (folder: string) => string, files: Record<string, string>, flags: string[]) {
  const dir = tempDir("aot-absolute-path", {});
  const later = join(String(dir), "later");
  writeFileSync(join(String(dir), "main.mjs"), program(later));
  const executable = join(String(dir), isWindows ? "program.exe" : "program");
  const build = await spawned(
    [bunExe(), "build", "--compile", "--aot", ...flags, "./main.mjs", "--outfile", executable],
    String(dir),
    bunEnv,
  );
  built(build);
  mkdirSync(later);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(later, name), text);
  return { dir, executable, build };
}

describe("a constant absolute path that does not exist at build time", () => {
  test.concurrent(
    "loads data files as plain Bun does",
    async () => {
      const { dir, executable, build } = await buildThenCreate(loadsOfData, data, []);
      using _ = dir;
      expect(build.stderr).not.toContain("isn't a constant");
      const plain = await spawned([bunExe(), "./main.mjs"], String(dir), bunEnv);
      expect(plain.stdout).toContain(`require json object {"kind":"json","list":[1,2]} kind,list`);
      expect(plain.stdout).toContain("import nothing threw ResolveMessage ERR_MODULE_NOT_FOUND");
      expect(await spawned([executable], String(dir), bunEnv)).toEqual(plain);
    },
    timeout,
  );

  const code = { "code.cjs": `module.exports = { kind: "cjs" };`, "code.mjs": `export default { kind: "mjs" };` };

  test.concurrent(
    "refuses code",
    async () => {
      const { dir, executable } = await buildThenCreate(loadsOfCode, code, []);
      using _ = dir;
      expect(await spawned([executable], String(dir), bunEnv)).toEqual({
        stdout: "require code threw Error MODULE_NOT_FOUND\nimport code threw Error ERR_MODULE_NOT_FOUND\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      });
    },
    timeout,
  );

  // A hardened Bun rejects the flag.
  test.concurrent.skipIf(isHardened)(
    "loads code with --aot-allow-code-from-disk",
    async () => {
      const { dir, executable } = await buildThenCreate(loadsOfCode, code, ["--aot-allow-code-from-disk"]);
      using _ = dir;
      const plain = await spawned([bunExe(), "./main.mjs"], String(dir), bunEnv);
      expect(plain.stdout).toBe(`require code object {"kind":"cjs"} kind\nimport code object {"kind":"mjs"} kind\n`);
      expect(await spawned([executable], String(dir), bunEnv)).toEqual(plain);
    },
    timeout,
  );
});
