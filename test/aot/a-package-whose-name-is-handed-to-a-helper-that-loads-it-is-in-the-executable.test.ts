// `const { tryRequire } = require("./util"); const colors = tryRequire("colors")`: the name and the require() stand in two files. An executable that doesn't hold the package
// takes the helper's fallback, and nothing says so.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

const packages = (...kinds: string[]) =>
  Object.fromEntries(kinds.map(kind => [`node_modules/fake-${kind}/index.js`, `exports.kind = "${kind}";\n`]));
const tries = `name => { try { return require(name); } catch { return null; } }`;
const show = `const show = it => (it ? it.kind : "none");\n`;
const sloppyOrStrict = `console.log((function () { return typeof this; })());\n`;

const cases: Record<string, { files: Record<string, string>; said: string; leftOut?: string }> = {
  "a helper that is taken apart, read off, held whole, called at once, or handed on by another file": {
    files: {
      "main.cjs": `const { tryRequire } = require("./named.cjs");\nconst bring = require("./named.cjs").bring;\nconst load = require("./whole.cjs");\n${show}console.log(show(tryRequire("fake-a")), show(bring("fake-b")), show(load("fake-c")), show(require("./whole.cjs")("fake-d")), show(require("./again.cjs")("fake-e")));\n`,
      "named.cjs": `exports.tryRequire = ${tries};\nexports.bring = ${tries};\n`,
      "whole.cjs": `module.exports = ${tries};\n`,
      "again.cjs": `module.exports = require("./whole.cjs");\n`,
      ...packages("a", "b", "c", "d", "e"),
    },
    said: "a b c d e",
  },
  "a helper that is imported, or required as the TypeScript compiler writes it": {
    files: {
      "main.mjs": `import load from "./whole.cjs";\nimport compiled from "./compiled.cjs";\nconsole.log(load("fake-a")?.kind ?? "none", compiled.b?.kind ?? "none");\n`,
      "whole.cjs": `module.exports = ${tries};\n`,
      "compiled.cjs": `var __importDefault = (this && this.__importDefault) || function (mod) { return (mod && mod.__esModule) ? mod : { "default": mod }; };\nconst whole_1 = __importDefault(require("./whole.cjs"));\nexports.b = (0, whole_1.default)("fake-b");\n`,
      ...packages("a", "b"),
    },
    said: "a b",
  },
  "a helper that is declared first and exported afterwards, and one that its own file calls": {
    files: {
      "main.cjs": `const util = require("./util.cjs");\nconst whole = require("./declared.cjs");\n${show}console.log(show(util.tryRequire("fake-a")), show(util.second("fake-b")), show(whole("fake-c")), show(util.own));\n`,
      "util.cjs": `function tryRequire(name) { try { return require(name); } catch { return null; } }\nfunction other(name) { try { return require(name); } catch { return null; } }\nmodule.exports = { tryRequire, own: tryRequire("fake-d") };\nmodule.exports.first = module.exports.second = other;\n`,
      "declared.cjs": `function load(name) { try { return require(name); } catch { return null; } }\nmodule.exports = load;\n`,
      ...packages("a", "b", "c", "d"),
    },
    said: "a b c d",
  },
  "a helper of a package, behind two files that hand it on": {
    files: {
      "main.cjs": `${show}console.log(show(require("loader")("fake-a")));\n`,
      "node_modules/loader/index.js": `module.exports = require("./lib");\n`,
      "node_modules/loader/lib/index.js": `module.exports = require("./load");\n`,
      "node_modules/loader/lib/load.js": `module.exports = ${tries};\n`,
      ...packages("a"),
    },
    said: "a",
  },
  "a helper that is made with the require() of the file that calls it": {
    files: {
      "main.cjs": `const optional = require("./make.cjs")(require);\nconsole.log((optional("fake-a") || { kind: "fallback" }).kind, (require("./make.cjs")(require)("fake-b") || { kind: "fallback" }).kind);\n`,
      "make.cjs": `module.exports = load => name => { try { return load(name); } catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; } };\n`,
      ...packages("a", "b"),
    },
    said: "a b",
  },
  "a helper that is stored in require": {
    files: {
      "main.cjs": `const made = require("./lazy.cjs")(require);\nconst own = require;\nrequire = made;\nrequire("fake-a", "first");\nrequire = own;\nlet text;\ntry { text = made.first.kind; } catch (error) { text = error.code; }\nconsole.log(text);\n`,
      "lazy.cjs": `module.exports = load => {\n  const proxy = (name, alias) => Object.defineProperty(proxy, alias, { configurable: true, get: () => load(name) });\n  return proxy;\n};\n`,
      "node_modules/fake-a/package.json": `{ "name": "fake-a", "version": "1.0.0", "main": "lib/a.js" }`,
      "node_modules/fake-a/lib/a.js": `exports.kind = "a";\n`,
    },
    said: "a",
  },
  "a function of another object that only shares the helper's name: the text that it gets makes no file CommonJS": {
    files: {
      "package.json": "{}",
      "main.cjs": `const tools = { load: name => require(name) };\nconst other = { load: text => console.log(text) };\nother.load("./setup.cjs");\nconsole.log(typeof tools.load);\nimport("./setup.cjs").then(() => console.log("done"));\n`,
      "setup.cjs": sloppyOrStrict,
    },
    said: "./setup.cjs\nfunction\nundefined\ndone",
  },
  "a function that a file which requires the helper exports: the text that it gets makes no file CommonJS": {
    files: {
      "package.json": "{}",
      "main.cjs": `const say = require("./say.cjs");\nsay("./setup.cjs");\nimport("./setup.cjs").then(() => console.log("done"));\n`,
      "say.cjs": `const load = require("./load.cjs");\nmodule.exports = text => console.log(text, typeof load);\n`,
      "load.cjs": `module.exports = name => require(name);\n`,
      "setup.cjs": sloppyOrStrict,
    },
    said: "./setup.cjs function\nundefined\ndone",
  },
  "a function that is made with require and only prints its text: the text makes no file CommonJS": {
    files: {
      "package.json": "{}",
      "main.cjs": `const say = require("./wrap.cjs")(require);\nsay("./setup.cjs");\nimport("./setup.cjs").then(() => console.log("done"));\n`,
      "wrap.cjs": `module.exports = load => text => console.log(text, typeof load);\n`,
      "setup.cjs": sloppyOrStrict,
    },
    said: "./setup.cjs function\nundefined\ndone",
  },
  "a function of a built-in module that only shares the helper's name: its text brings no package": {
    files: {
      "main.cjs": `const { basename } = require("node:path");\nconsole.log(basename("fake-big"), typeof require("tools").basename);\n`,
      "node_modules/tools/index.js": `exports.basename = name => require(name);\n`,
      "node_modules/fake-big/index.js": `exports.text = "made-up mark of a package that nobody loads";\n`,
    },
    said: "fake-big function",
    leftOut: "made-up mark of a package that nobody loads",
  },
  "a function taken out of an object of the file's own that only shares the helper's name: its text brings no package":
    {
      files: {
        "main.cjs": `const { get } = { get: name => name.length };\nconsole.log(get("fake-big"), typeof require("tools").get);\n`,
        "node_modules/tools/index.js": `exports.get = name => require(name);\n`,
        "node_modules/fake-big/index.js": `exports.text = "made-up mark of a package that nobody loads";\n`,
      },
      said: "8 function",
      leftOut: "made-up mark of a package that nobody loads",
    },
};

test.each(Object.entries(cases))(
  "%s",
  async (_, { files, said, leftOut }) => {
    using dir = tempDir("aot-a-name-handed-to-a-helper", files);
    const folder = String(dir);
    const main = Object.keys(files).find(name => name.startsWith("main."))!;
    expect((await run([bunExe(), main], folder)).stdout.trim()).toBe(said);
    const forms = { closed: [], withCodeFromDisk: ["--aot-allow-code-from-disk"] };
    for (const [form, flags] of Object.entries(forms)) {
      const command = [bunExe(), "build", "--compile", "--aot", ...flags, `./${main}`, "--outfile", join("bin", form)];
      const { stderr, exitCode } = await run(command, folder);
      expect({ form, stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ form, stderr: "", exitCode: 0 });
    }
    if (existsSync(join(folder, "node_modules"))) renameSync(join(folder, "node_modules"), join(folder, "gone"));
    for (const form of Object.keys(forms)) {
      const executable = join(folder, "bin", form + (isWindows ? ".exe" : ""));
      expect({ form, said: (await run([executable], folder)).stdout.trim() }).toEqual({ form, said });
      if (leftOut) expect(readFileSync(executable).includes(leftOut)).toBe(false);
    }
  },
  600_000,
);
