import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

async function run(cwd: string, cmd: string[], env = bunEnv) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, env);
  return { stdout, stderr, exitCode };
}

async function bothWays(dir: string, entryPoint: string, ...flags: string[]) {
  const app = join(dir, "app");
  const plain = await run(app, [bunExe(), "run", entryPoint]);
  const built = await run(app, [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    entryPoint,
    ...flags,
    "--outfile",
    "../built.exe",
  ]);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  renameSync(app, join(dir, "moved-away"));
  return { plain, compiled: await run(dir, ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" }) };
}

test("an asset in a folder of a folder keeps its path", async () => {
  using dir = tempDir("aot-asset-in-a-folder-of-a-folder", {
    "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
for (const name of ["outer/inner/note.txt", "inner/note.txt", "outer/other.txt"]) console.log(name, fs.existsSync(path.join(__dirname, name)));
console.log(fs.readdirSync(path.join(__dirname, "outer")).join(), fs.readFileSync(path.join(__dirname, "outer", "inner", "note.txt"), "utf8"), fs.readFileSync(path.join(__dirname, "deep", "down", "one.txt"), "utf8"));
`,
    "app/outer/inner/note.txt": "a note",
    "app/deep/down/one.txt": "one file",
  });
  const { plain, compiled } = await bothWays(
    String(dir),
    "./main.cjs",
    "--asset",
    "./outer/inner",
    "--asset",
    "deep/down/one.txt",
  );
  expect(plain).toEqual({
    stdout: "outer/inner/note.txt true\ninner/note.txt false\nouter/other.txt false\ninner a note one file\n",
    stderr: "",
    exitCode: 0,
  });
  expect(compiled).toEqual(plain);
}, 120_000);

test("an asset beside the entry point leaves the entry point at the root", async () => {
  using dir = tempDir("aot-asset-beside-the-entry-point-itself", {
    "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(path.basename(__dirname), fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8"), fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
`,
    "app/public/index.html": "<p>a page</p>",
    "app/data.json": "{}",
  });
  const { plain, compiled } = await bothWays(
    String(dir),
    "./main.cjs",
    "--asset",
    "./public",
    "--asset",
    "./data.json",
  );
  expect(plain).toEqual({ stdout: "app <p>a page</p> {}\n", stderr: "", exitCode: 0 });
  expect(compiled).toEqual({ ...plain, stdout: "root <p>a page</p> {}\n" });
}, 120_000);

test("an asset beside the folder of the entry point is beside it in the executable", async () => {
  using dir = tempDir("aot-asset-beside-the-entry-point", {
    "app/dist/server/entry.mjs": `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { name } from "./chunks/part.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
console.log(path.basename(here), name, import.meta.dir === here, path.basename(process.argv[1]), Bun.main === fileURLToPath(import.meta.url));
console.log(fs.readFileSync(path.join(here, "..", "client", "index.html"), "utf8"), fs.readdirSync(path.join(here, "..")).sort().join());
`,
    "app/dist/server/chunks/part.mjs": `export const name = "a part";\n`,
    "app/dist/client/index.html": "<p>a page</p>",
  });
  const { plain, compiled } = await bothWays(String(dir), "./dist/server/entry.mjs", "--asset", "dist/client");
  expect(plain).toEqual({
    stdout: "server a part true entry.mjs true\n<p>a page</p> client,server\n",
    stderr: "",
    exitCode: 0,
  });
  expect(compiled).toEqual(plain);
}, 120_000);

test("the folder of the entry point itself is an asset", async () => {
  using dir = tempDir("aot-asset-holds-the-entry-point", {
    "app/server/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(path.basename(__dirname), fs.readFileSync(__filename, "utf8").split("\\n")[0], fs.readFileSync(path.join(__dirname, "note.txt"), "utf8"), fs.readdirSync(__dirname).sort().join());
`,
    "app/server/note.txt": "a note",
  });
  const { plain, compiled } = await bothWays(String(dir), "./server/start.cjs", "--asset", "server");
  expect(plain).toEqual({
    stdout: `server const fs = require("node:fs"); a note note.txt,start.cjs\n`,
    stderr: "",
    exitCode: 0,
  });
  expect(compiled).toEqual(plain);
}, 120_000);

test("only an asset at the top has to differ from the name of the executable", async () => {
  using dir = tempDir("aot-asset-named-like-the-executable", {
    "app/main.cjs": `console.log(require("node:fs").readFileSync(require("node:path").join(__dirname, "outer", "built.exe", "note.txt"), "utf8"));\n`,
    "app/outer/built.exe/note.txt": "a note",
    "app/built.exe/note.txt": "another",
  });
  const refused = await run(join(String(dir), "app"), [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "./main.cjs",
    "--asset",
    "./built.exe",
    "--outfile",
    "../built.exe",
  ]);
  expect({
    stderr: refused.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: refused.exitCode,
  }).toEqual({
    stderr: [`error: asset "./built.exe" would embed at the same path as the entry point; use a different outfile`],
    exitCode: 1,
  });
  const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "./outer/built.exe");
  expect(plain).toEqual({ stdout: "a note\n", stderr: "", exitCode: 0 });
  expect(compiled).toEqual(plain);
}, 120_000);

test("--root decides what the paths start from", async () => {
  using dir = tempDir("aot-asset-under-a-written-root", {
    "app/packages/site/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(path.basename(__dirname), path.basename(path.dirname(__dirname)), fs.readFileSync(path.join(__dirname, "..", "..", "shared", "data", "note.txt"), "utf8"));
`,
    "app/shared/data/note.txt": "a note",
  });
  const { plain, compiled } = await bothWays(
    String(dir),
    "./packages/site/main.cjs",
    "--root",
    ".",
    "--asset",
    "shared/data",
  );
  expect(plain).toEqual({ stdout: "site packages a note\n", stderr: "", exitCode: 0 });
  expect(compiled).toEqual(plain);
}, 120_000);

test("an asset from outside of the working directory lies beside the entry point by its name", async () => {
  using dir = tempDir("aot-asset-from-elsewhere", {
    "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(fs.existsSync(path.join(__dirname, "..", "elsewhere", "note.txt")), fs.existsSync(path.join(__dirname, "elsewhere", "note.txt")));
`,
    "elsewhere/note.txt": "a note",
  });
  const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "../elsewhere");
  expect(plain).toEqual({ stdout: "true false\n", stderr: "", exitCode: 0 });
  expect(compiled).toEqual({ ...plain, stdout: "false true\n" });
}, 120_000);
