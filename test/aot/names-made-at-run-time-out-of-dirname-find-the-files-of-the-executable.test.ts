import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "./harness/declare";

// Next.js's server makes the paths of its pages and manifests out of `__dirname` and require()s them, behind a hook on
// Module._resolveFilename. The pages are further entry points of the build and the manifests are files that --asset gave it.
const server = `
const path = require("path");
process.chdir(__dirname);
const hooks = process.env.HOOKS ?? "";
const mod = require("module");
if (hooks.includes("resolve")) {
  const original = mod._resolveFilename;
  mod._resolveFilename = function (request, parent, isMain, options) { return original.call(mod, request, parent, isMain, options); };
}
if (hooks.includes("require")) {
  const original = mod.prototype.require;
  mod.prototype.require = function (request) { return original.call(this, request); };
}
const folder = process.env.DIST ?? ".next";
const dist = path.join(__dirname, folder);
const at = (...parts) => path.join(dist, "server", ...parts);
const shown = text => String(text).replaceAll(__dirname, "<dir>").replaceAll("\\\\", "/");
const say = async (label, f) => {
  try { console.log(label + ":", shown(await f())); } catch (e) { console.log(label + ":", e.code ?? e.name); }
};
(async () => {
  await say("a JSON file that is an asset", () => require(at("manifest.json")).name);
  await say("a .js file that is a further entry point", () => require(at("pages", "_document.js")).name);
  await say("without its extension", () => require(at("pages", "_document")).name);
  await say("a .cjs file", () => require(at("pages", "common.cjs")).name);
  await say("a .mjs file by import()", async () => (await import(at("pages", "module.mjs"))).name);
  await say("a .mjs file by require()", () => require(at("pages", "module.mjs")).name);
  await say("a .js file by import()", async () => (await import(at("pages", "_document.js"))).default.name);
  await say("a JSON file by import()", async () => (await import(at("manifest.json"))).default.name);
  await say("a folder with index.js", () => require(at("folder")).name);
  await say("a folder with package.json", () => require(at("pkgdir")).name);
  await say("with .. in the path", () => require(dist + "/server/pages/../chunks/1.js").name);
  await say("require.resolve", () => require.resolve(at("pages", "_document.js")));
  await say("require.resolve without the extension", () => require.resolve(at("pages", "_document")));
  await say("require.resolve of the asset", () => require.resolve(at("manifest.json")));
  await say("required twice, the same object", () => require(at("pages", "_document.js")) === require(at("pages", "_document.js")));
  await say("the same as by a relative name", () => require(at("chunks", "1.js")) === require("./" + folder + "/server/chunks/1.js"));
  await say("the asset twice, the same object", () => require(at("manifest.json")) === require(at("manifest.json")));
  await say("a file URL by import()", async () => (await import(require("url").pathToFileURL(at("pages", "module.mjs")).href)).name);
  await say("createRequire(__filename) with such a name", () => mod.createRequire(__filename)(at("chunks", "1.js")).name);
  await say("createRequire(__filename), the asset by a relative name", () => mod.createRequire(__filename)("./" + folder + "/server/manifest.json").name);
  await say("createRequire(__filename), a file by a relative name", () => mod.createRequire(__filename)("./" + folder + "/server/chunks/1.js").name);
  await say("what is not there", () => require(at("pages", "nothing.js")).name);
  await say("an asset that is not there", () => require(at("nothing.json")).name);
  await say("fs reads an asset", () => require("fs").readFileSync(at("notes.txt"), "utf8").trim());
})();
`;

test("names made at run time out of __dirname find the files of the executable", async () => {
  using dir = tempDir("aot-names-out-of-dirname", {
    "site/server.js": server,
    "site/.next/server/manifest.json": `{ "name": "manifest" }`,
    "site/.next/server/notes.txt": "some text\n",
    "site/.next/server/pages/_document.js": `exports.name = "_document";`,
    "site/.next/server/pages/common.cjs": `exports.name = "common";`,
    "site/.next/server/pages/module.mjs": `export const name = "module";`,
    "site/.next/server/folder/index.js": `exports.name = "index of folder";`,
    "site/.next/server/pkgdir/package.json": `{ "name": "pkgdir", "main": "./lib/main.js" }`,
    "site/.next/server/pkgdir/lib/main.js": `exports.name = "main of pkgdir";`,
    "site/.next/server/chunks/1.js": `exports.name = "chunk";`,
  });
  const site = join(String(dir), "site");
  const executable = join(String(dir), "executable");
  const run = async (cmd: string[], hooks = "") => {
    await using proc = Bun.spawn({ cmd, cwd: site, env: { ...bunEnv, HOOKS: hooks }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { lines: stdout.trim().split("\n"), stderr, exitCode };
  };

  const allHooks = ["", "resolve", "resolve,require"];
  const expected = await Promise.all(allHooks.map(hooks => run([bunExe(), "server.js"], hooks)));
  expect(expected[0].lines).toContain("a JSON file that is an asset: manifest");
  expect(expected[0].lines).toContain("a .js file that is a further entry point: _document");
  expect(expected[0].lines).toContain("what is not there: MODULE_NOT_FOUND");
  expect(expected[0].lines.length).toBe(24);

  const sources = ["js", "cjs", "mjs"].map(extension => `.next/server/**/*.${extension}`);
  const built = await run([
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "./server.js",
    ...sources,
    "--asset",
    ".next",
    "--outfile",
    executable,
  ]);
  // The build warns of the names that it cannot follow.
  expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });

  for (const [index, hooks] of allHooks.entries()) expect(await run([executable], hooks)).toEqual(expected[index]);
  renameSync(site, join(String(dir), "moved-away"));
  // The server calls process.chdir(__dirname).
  mkdirSync(site);
  for (const [index, hooks] of allHooks.entries()) expect(await run([executable], hooks)).toEqual(expected[index]);
}, 600_000);
