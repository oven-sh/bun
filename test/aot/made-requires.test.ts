import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const elsewhere = `document.currentScript && document.currentScript.src || new URL("main.js", document.baseURI).href`;
const loads: Record<string, (name: string) => string> = {
  "tsup-call.cjs": name =>
    `var url = () => typeof document === "undefined" ? new URL("file:" + __filename).href : ${elsewhere}; var own = url(); var m = require("module"); var load = m.createRequire.call(void 0, own); load("${name}")`,
  "tsup-template.cjs": name =>
    `var url = () => typeof document === "undefined" ? new URL(\`file:\${__filename}\`).href : ${elsewhere}; var own = url(); var m = require("module"); var load = (0, m.createRequire)(own); (() => load("${name}"))()`,
  "rollup.cjs": name =>
    `var m = require("module"); var load = m.createRequire(typeof document === "undefined" ? require("u" + "rl").pathToFileURL(__filename).href : (${elsewhere})); load("${name}")`,
  "comma.cjs": name => `var m = require("module"); (0, m.createRequire)(__filename)("${name}")`,
  "call.cjs": name => `var m = require("module"); m.createRequire.call(void 0, __filename)("${name}")`,
  "held.cjs": name => `var m = require("module"); var load = (0, m.createRequire)(__filename); load("${name}")`,
  "url-text.cjs": name => `require("module").createRequire(new URL("file:" + __filename).href)("${name}")`,
  "url-object.cjs": name => `require("module").createRequire(new URL("file://" + __filename))("${name}")`,
  "scheme.cjs": name => `require("module").createRequire("file://" + __filename)("${name}")`,
  "path-to-url.cjs": name => `require("module").createRequire(require("url").pathToFileURL(__filename))("${name}")`,
  "path-to-text.cjs": name =>
    `require("module").createRequire(require("url").pathToFileURL(__filename).href)("${name}")`,
  "meta.mjs": name => `import { createRequire } from "module"; createRequire(new URL(import.meta.url).href)("${name}")`,
  "resolve-symbol.cjs": name => `require(require.resolve("${name}", { [Symbol.for("outside")]: true }))`,
  "resolve-jest.cjs": name =>
    `require(require.resolve("${name}", { [(globalThis["no-such-name"] || globalThis.Symbol).for("outside")]: true }))`,
  "resolve-empty.cjs": name => `require(require.resolve("${name}", {}))`,
  "resolve-nothing.cjs": name => `require(require.resolve("${name}", undefined))`,
  "resolve-held.cjs": name => `const options = { other: [] }; require(require.resolve("${name}", options))`,
};

async function build(project: string, entry: string, executable: string) {
  const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], project);
  const errors = built.stderr.split("\n").filter(line => line.startsWith("error"));
  expect({ errors, exitCode: built.exitCode }).toEqual({ errors: [], exitCode: 0 });
}

test("a package that a made require names is in the executable", async () => {
  const files = Object.keys(loads);
  const packageOf = (file: string) => "dep-" + file.replace(".", "-");
  using dir = tempDir("aot-made-requires", {
    "project/package.json": `{ "name": "project" }`,
    "project/entry.mjs": files.map(file => `import "./${file}";\n`).join(""),
    ...Object.fromEntries(
      files.map(file => {
        const statements = loads[file](packageOf(file) + "/sub").split("; ");
        const last = statements.pop();
        return [`project/${file}`, [...statements, `console.log(${last}.name)`].join(";\n") + ";\n"];
      }),
    ),
    ...Object.fromEntries(
      files.flatMap(file => [
        [
          `project/node_modules/${packageOf(file)}/package.json`,
          JSON.stringify({ name: packageOf(file), version: "1.0.0", exports: { "./sub": "./lib/sub.js" } }),
        ],
        [`project/node_modules/${packageOf(file)}/lib/sub.js`, `exports.name = "sub for ${file}";\n`],
      ]),
    ),
    "elsewhere/empty.txt": "",
  });
  const project = join(String(dir), "project");
  const executable = join(String(dir), "program");
  const plain = await run([bunExe(), "entry.mjs"], project, bunEnv);
  expect(plain.stdout.trim().split("\n").sort()).toEqual(files.map(file => `sub for ${file}`).sort());
  await build(project, "./entry.mjs", executable);
  const compiled = await run([executable], join(String(dir), "elsewhere"), bunEnv);
  expect({ stdout: compiled.stdout.trim().split("\n").sort(), exitCode: compiled.exitCode }).toEqual({
    stdout: plain.stdout.trim().split("\n").sort(),
    exitCode: 0,
  });
}, 180_000);

test("a require that was made for another file is not taken for the file's own", async () => {
  const dep = (name: string) => ({
    "package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
    "index.js": `exports.name = "${name}";\n`,
  });
  const attempt = `const attempt = act => { try { return act().name; } catch (error) { return error.code; } };`;
  using dir = tempDir("aot-made-requires-elsewhere", {
    "package.json": `{ "name": "project" }`,
    "document.cjs": `
      ${attempt}
      globalThis.document = { currentScript: { src: require("url").pathToFileURL(__dirname + "/other/main.js").href } };
      var load = require("module").createRequire(typeof document === "undefined" ? require("url").pathToFileURL(__filename).href : document.currentScript.src);
      delete globalThis.document;
      console.log("document:", attempt(() => load("dep")));`,
    "twice.cjs": `
      ${attempt}
      function make(base) {
        var load = require("module").createRequire(base || __filename);
        return () => attempt(() => load("dep"));
      }
      const [first, second, third] = [make(__dirname + "/other/main.js"), make(), make(__dirname + "/other/main.js")];
      console.log("twice:", first(), second(), third());`,
    "a.test.cjs": `require("./document.cjs"); require("./twice.cjs"); require("bun:test").test("t", () => {});`,
    "entry.cjs": `require("./document.cjs"); require("./twice.cjs");`,
    "node_modules/dep": dep("near"),
    "other/node_modules/dep": dep("other"),
  });
  const project = String(dir);
  const said = (stdout: string) => stdout.split("\n").filter(line => /^(document|twice):/.test(line));
  const plain = await run([bunExe(), "entry.cjs"], project, bunEnv);
  expect(said(plain.stdout)).toEqual(["document: other", "twice: other near other"]);
  const tested = await run([bunExe(), "test", "--aot", "./a.test.cjs"], project, bunEnv);
  expect(said(tested.stdout)).toEqual(said(plain.stdout));
  await build(project, "./entry.cjs", join(project, "program"));
  const compiled = await run([join(project, "program")], project, bunEnv);
  const [document, twice] = said(compiled.stdout);
  expect(document).not.toContain("near");
  expect(twice.split(" ").map(word => word === "near")).toEqual([false, false, true, false]);
}, 180_000);

test("require.resolve() with paths does not answer from its own file", async () => {
  const dep = (name: string) => ({
    "package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
    "index.js": `exports.name = "${name}";\n`,
  });
  using dir = tempDir("aot-made-requires-paths", {
    "package.json": `{ "name": "project" }`,
    "entry.cjs": `
      const path = require("node:path");
      const say = found => console.log(found.replaceAll("\\\\", "/").includes("other/node_modules") ? "other" : "near");
      for (const from of [{ paths: [path.join(__dirname, "other")] }, path.join(__dirname, "other/")]) {
        try {
          say(require.resolve("dep", from));
        } catch (error) {
          console.log(error.code);
        }
      }`,
    "node_modules/dep": dep("near"),
    "other/node_modules/dep": dep("other"),
  });
  const project = String(dir);
  const plain = await run([bunExe(), "entry.cjs"], project, bunEnv);
  expect(plain.stdout).toBe("other\nnear\n");
  await build(project, "./entry.cjs", join(project, "program"));
  const compiled = await run([join(project, "program")], project, bunEnv);
  const [withPaths, withText] = compiled.stdout.split("\n");
  expect(withPaths).not.toBe("near");
  expect(withText).toBe("near");
}, 180_000);
