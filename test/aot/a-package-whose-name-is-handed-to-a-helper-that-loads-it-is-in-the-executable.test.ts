// `const { tryRequire } = require("./util"); const colors = tryRequire("colors")`: the name and the require() stand in two files. An executable that doesn't hold the package
// takes the helper's fallback, and nothing says so.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { limitOfARun, limitWithASAN, slot } from "./harness/commands";
import { run } from "./harness/run";
import { test, testOneByOne } from "./supported";

const packages = (...kinds: string[]) =>
  Object.fromEntries(kinds.map(kind => [`node_modules/fake-${kind}/index.js`, `exports.kind = "${kind}";\n`]));
const tries = `name => { try { return require(name); } catch { return null; } }`;
const show = `const show = it => (it ? it.kind : "none");\n`;
const sloppyOrStrict = `console.log((function () { return typeof this; })());\n`;
// In the last two programs each package holds a text of its own. The texts that stand in an executable say which packages it holds.
const marked = ["tools", "fake-big"];
const markOf = (name: string) => `made-up mark of the package ${name}`;
const withMark = (name: string, code = "") => ({
  [`node_modules/${name}/index.js`]: `${code}exports.text = "${markOf(name)}";\n`,
});

/** `said`: what the program prints. `holds`: of the marked packages, those that the executable holds. */
const cases: Record<string, { files: Record<string, string>; said: string; holds?: string[] }> = {
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
  "a file that the program imports keeps its kind beside a module that such a text names": {
    files: {
      "package.json": "{}",
      "main.cjs": `const make = given => name => given(name);\nconst load = make(require);\nif (process.argv.length > 9) load("./m.mjs");\nimport("./x.cjs").then(() => console.log("done"));\n`,
      "m.mjs": `import "./x.cjs";\nexport default 1;\n`,
      "x.cjs": sloppyOrStrict,
    },
    said: "undefined\ndone",
  },
  "a maker of the same file that hands the name on loads in front of the import() behind it": {
    files: {
      "package.json": "{}",
      "main.cjs": `const make = given => name => given(name);\nconst load = make(require);\nload("./m.mjs");\nimport("./x.cjs").then(() => console.log("done"));\n`,
      "m.mjs": `import "./x.cjs";\nexport default 1;\n`,
      "x.cjs": sloppyOrStrict,
    },
    said: "object\ndone",
  },
  "a function of a built-in module that only shares the helper's name: its text brings no package": {
    files: {
      "main.cjs": `const { basename } = require("node:path");\nconsole.log(basename("fake-big"), typeof require("tools").basename);\n`,
      ...withMark("tools", `exports.basename = name => require(name);\n`),
      ...withMark("fake-big"),
    },
    said: "fake-big function",
    holds: ["tools"],
  },
  "a function taken out of an object of the file's own that only shares the helper's name: its text brings no package":
    {
      files: {
        "main.cjs": `const { get } = { get: name => name.length };\nconsole.log(get("fake-big"), typeof require("tools").get);\n`,
        ...withMark("tools", `exports.get = name => require(name);\n`),
        ...withMark("fake-big"),
      },
      said: "8 function",
      holds: ["tools"],
    },
};

const forms = { closed: [], withCodeFromDisk: ["--aot-allow-code-from-disk"] };
type Form = keyof typeof forms;
const bothForms = Object.keys(forms) as Form[];
/**
 * As `Promise.all`, but it waits for all of them before it throws what one of them threw. `run()` throws where the commands
 * of the file hold too much memory together, and a case that ends removes its folder: by then no command of it is left there.
 */
async function allOf<Asked extends readonly unknown[] | []>(asked: Asked) {
  const thrown = (await Promise.allSettled(asked)).find(one => one.status === "rejected");
  if (thrown) throw (thrown as PromiseRejectedResult).reason;
  return Promise.all(asked);
}
/** What `ask` answers for each form of the executable. Both are asked at once. */
const ofEachForm = async <Answer>(ask: (form: Form) => Answer | Promise<Answer>) =>
  Object.fromEntries(await allOf(bothForms.map(async form => [form, await ask(form)] as const)));
const inBothForms = <Answer>(answer: Answer) => Object.fromEntries(bothForms.map(form => [form, answer]));

// The builds are nearly all of the time. So the cases run beside one another, and so do the commands of a case that don't wait
// for one another. Each command takes a slot: no more of them run at once than the machine has processors.
// A debug build of Bun is more than a GB, and so is every executable that it builds: there the cases run one by one.
const declare = isDebug ? testOneByOne : test.concurrent;
const limitOfACase = 600_000;
// A command that hangs is killed at its limit, and gives its slot back. On a debug build one build takes minutes: there a
// command has as long as its case.
const limit = isDebug ? limitOfACase : isASAN ? limitWithASAN : limitOfARun;

/** What a run prints that ends well: its lines on stdout, nothing on stderr, exit code 0. */
const prints = (said: string) => ({ stdout: said + "\n", stderr: "", exitCode: 0 });
/** The marked packages whose text stands in the file. */
function markedPackagesIn(executable: string) {
  const bytes = readFileSync(executable);
  return marked.filter(name => bytes.includes(markOf(name)));
}

declare.each(Object.entries(cases))(
  "%s",
  async (_, { files, said, holds }) => {
    using dir = tempDir("aot-a-name-handed-to-a-helper", files);
    const folder = String(dir);
    const main = Object.keys(files).find(name => name.startsWith("main."))!;
    const executableOf = (form: Form) => join(folder, "bin", form + (isWindows ? ".exe" : ""));
    const start = (...command: string[]) => slot(() => run(command, folder, bunEnv, limit));
    // A build that succeeds still warns where a require() takes a name that is no constant (TS100064): its stderr is shown only if it fails.
    async function build(form: Form) {
      const flags = ["--compile", "--aot", ...forms[form]];
      const outfile = join("bin", form);
      const { stderr, exitCode } = await start(bunExe(), "build", ...flags, `./${main}`, "--outfile", outfile);
      return { stderr: exitCode === 0 ? "" : stderr, exitCode };
    }

    // Plain Bun and the two builds only read the folder, and each build writes a file of its own.
    const [plain, built] = await allOf([start(bunExe(), main), ofEachForm(build)]);
    expect(plain).toEqual(prints(said));
    expect(built).toEqual(inBothForms({ stderr: "", exitCode: 0 }));

    // The packages leave the disk before an executable starts: what it loads, it holds.
    if (existsSync(join(folder, "node_modules"))) renameSync(join(folder, "node_modules"), join(folder, "gone"));
    expect(await ofEachForm(form => start(executableOf(form)))).toEqual(inBothForms(prints(said)));
    if (holds) expect(await ofEachForm(form => markedPackagesIn(executableOf(form)))).toEqual(inBothForms(holds));
  },
  limitOfACase,
);
