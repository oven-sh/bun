// How files are loaded. A compiler that knows every file of a program answers a `require()` or an `import` in place where it can, and leaves the rest to a loader of its own at run time. A fault shows where the
// two disagree, or where either disagrees with Bun's loader: one file is reached in two ways, and between them the program did something to the file, to its exports or to the loader.
//
// SMALL WORLDS are enumerated whole, nothing is drawn: a main file, one file beside it, and two or three deeds in a row, each of which says what it got. The tables do not know of each other.
// run-loads.ts runs them as test runs.
//
//   bun write-loads.ts --small-worlds <folder> [--only <part of a name>]     one file for each world, further files behind `// @filename: ./<path>`, for `run-alone.ts --programs <folder>`
//   bun write-loads.ts --test-projects <folder> [--deeds 3] [--in-company] [--only <part of a name>]    one project for each row of deeds: every main file and every file beside it as a test file in a folder of its own
//
// A deed can change how the whole build is made (a walk over require.cache, a loader of the program's own): in a project all worlds do the same deeds, so none hides or causes the fault of another.
// Bun keeps a loader that a test file stores in Module._extensions for the next test files, also under --isolate: a world takes back what it did to the loader.
//
// No world prints a path, a stack or the text of a function, and none makes the order in which sibling files run its observer.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { deedsOfMocks } from "./write-loads-mocks.ts";

export type World = { name: string; extension: ".cjs" | ".mjs"; text: string };

/** What a deed got, in primitives: its type, its keys in their order, two members, which names it has, and how it names itself. */
const say = `const say = (tag, value) => {
  const short = each => (each === null || (typeof each !== "object" && typeof each !== "function") ? String(each) : typeof each === "function" ? "function" : "{" + Object.keys(each).join() + "}");
  if (value === null || (typeof value !== "object" && typeof value !== "function")) return console.log(tag, typeof value, String(value));
  // A mock of vitest's kind throws where a name is read that its factory did not give.
  const member = name => {
    try {
      return short(value[name]);
    } catch (error) {
      return "threw " + error?.name;
    }
  };
  console.log(tag, typeof value, "keys", Object.keys(value).join(), "a", member("a"), "default", member("default"), "has", "a" in value, "default" in value, "__esModule" in value, Object.prototype.toString.call(value));
};
const undo = [];
const attempt = async (tag, deed) => {
  try {
    await deed();
  } catch (error) {
    console.log(tag, "threw", error?.name, error?.code);
  }
};
`;

type Beside = { name: string; file: string; text: string; more?: Record<string, string> };
/** The file beside the main file: what kind it is and what it makes of its exports. */
// prettier-ignore
const besides: Beside[] = [
  { name: "names", file: "lib.cjs", text: `exports.a = 1;\n` },
  { name: "literal", file: "lib.cjs", text: `module.exports = { a: 1 };\n` },
  { name: "function", file: "lib.cjs", text: `module.exports = function made() {};\nmodule.exports.a = 1;\n` },
  { name: "text", file: "lib.cjs", text: `exports.a = 1;\nmodule.exports = "text";\n` },
  { name: "undefined", file: "lib.cjs", text: `exports.a = 1;\nmodule.exports = undefined;\n` },
  { name: "deleted", file: "lib.cjs", text: `exports.a = 1;\ndelete module.exports;\n` },
  { name: "defined", file: "lib.cjs", text: `exports.a = 1;\nObject.defineProperty(module, "exports", { value: { a: 2 }, configurable: true, enumerable: true, writable: true });\n` },
  { name: "getter", file: "lib.cjs", text: `exports.a = 1;\nObject.defineProperty(module, "exports", { enumerable: true, get() { return { a: 2 }; } });\n` },
  { name: "marked", file: "lib.cjs", text: `exports.__esModule = true;\nexports.default = 5;\nexports.a = 1;\n` },
  { name: "marked-by-definition", file: "lib.cjs", text: `Object.defineProperty(exports, "__esModule", { value: true });\nexports.default = 5;\nexports.a = 1;\n` },
  { name: "counting-getter", file: "lib.cjs", text: `let reads = 0;\nObject.defineProperty(exports, "a", { enumerable: true, get() { return ++reads; } });\n` },
  { name: "counts-runs", file: "lib.cjs", text: `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.a = globalThis.runs;\n` },
  { name: "throws-once", file: "lib.cjs", text: `exports.a = 1;\nif (!globalThis.threw) {\n  globalThis.threw = true;\n  throw new RangeError("made up");\n}\nexports.b = 2;\n` },
  { name: "throws", file: "lib.cjs", text: `exports.a = 1;\nthrow new RangeError("made up");\n` },
  { name: "this", file: "lib.cjs", text: `this.a = 1;\n` },
  { name: "returns-early", file: "lib.cjs", text: `exports.a = 1;\nif (exports.a) return;\nexports.b = 2;\n` },
  { name: "rebinds-exports", file: "lib.cjs", text: `exports.a = 1;\nexports = { a: 2 };\nexports.b = 3;\n` },
  { name: "fills-later", file: "lib.cjs", text: `exports.a = 1;\nqueueMicrotask(() => { exports.a = 2; exports.late = 3; });\n` },
  { name: "replaces-later", file: "lib.cjs", text: `exports.a = 1;\nqueueMicrotask(() => { module.exports = { a: 2 }; });\n` },
  { name: "frozen", file: "lib.cjs", text: `module.exports = Object.freeze({ a: 1 });\n` },
  { name: "without-prototype", file: "lib.cjs", text: `module.exports = Object.assign(Object.create(null), { a: 1 });\n` },
  { name: "class", file: "lib.cjs", text: `module.exports = class Made { static a = 1; };\n` },
  { name: "es-names", file: "lib.mjs", text: `export const a = 1;\n` },
  { name: "es-default", file: "lib.mjs", text: `export default 5;\nexport const a = 1;\n` },
  { name: "es-default-alone", file: "lib.mjs", text: `export default { a: 1 };\n` },
  { name: "es-live", file: "lib.mjs", text: `export let a = 1;\nqueueMicrotask(() => { a = 2; });\n` },
  { name: "es-awaits", file: "lib.mjs", text: `export const a = await Promise.resolve(1);\n` },
  { name: "es-marked", file: "lib.mjs", text: `export const __esModule = true;\nexport default 5;\nexport const a = 1;\n` },
  { name: "es-says-module-exports", file: "lib.mjs", text: `const whole = { a: 2 };\nexport { whole as "module.exports" };\nexport const a = 1;\n` },
  { name: "es-counts-runs", file: "lib.mjs", text: `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexport const a = globalThis.runs;\n` },
  { name: "es-throws", file: "lib.mjs", text: `export const a = 1;\nthrow new RangeError("made up");\n` },
  { name: "es-star", file: "lib.mjs", text: `export * from "./deep.mjs";\nexport const b = 2;\n`, more: { "deep.mjs": `export const a = 1;\nexport default 5;\n` } },
  { name: "es-star-of-commonjs", file: "lib.mjs", text: `export * from "./deep.cjs";\nexport const b = 2;\n`, more: { "deep.cjs": `exports.a = 1;\nexports.default = 5;\n` } },
  { name: "es-empty", file: "lib.mjs", text: `globalThis.ran = true;\n` },
  { name: "data-record", file: "lib.json", text: `{ "a": 1 }\n` },
  { name: "data-list", file: "lib.json", text: `[1, 2]\n` },
  { name: "data-text", file: "lib.json", text: `"text"\n` },
  { name: "data-with-default", file: "lib.json", text: `{ "default": 5, "a": 1 }\n` },
  { name: "data-marked", file: "lib.json", text: `{ "__esModule": true, "default": 5, "a": 1 }\n` },
];

export type Deed = {
  name: string;
  /** Lines in front of everything else, for a statement that cannot stand in a function. */
  head?: (file: string, at: number) => string;
  body: (file: string, at: number) => string;
  fits?: (main: World["extension"], beside: Beside) => boolean;
  /** An executable has no such deed. */
  inTestRunsAlone?: true;
  /** Lines for the one preload of the project, once for each world, which names its file by a path from the root. */
  preload?: (path: string, at: number) => string;
  /** More files in the folder of the world. */
  files?: (file: string, at: number) => Record<string, string>;
};
/** `require.cache` of an executable lists no compiled module, and the page on compatibility says so. In a test run it lists them. */
const asksForAnEntryOfTheCache = /-the-cache$|-in-the-cache$|^plants-an-entry$/;
const isCommonJS = (beside: Beside) => beside.file.endsWith(".cjs");
/** What the main file does, in a row. Each says what it got under its own tag. */
// prettier-ignore
const deeds: Deed[] = [
  { name: "requires", body: (file, at) => `say("${at} requires", require("./${file}"));` },
  { name: "requires-made-name", body: (file, at) => `say("${at} requires-made-name", require("./" + JSON.parse('"${file}"')));` },
  { name: "requires-handed-over", body: (file, at) => `say("${at} requires-handed-over", [require][JSON.parse("0")]("./${file}"));` },
  { name: "requires-in-a-function", body: (file, at) => `const load${at} = () => require("./${file}");\n  say("${at} requires-in-a-function", load${at}());\n  say("${at} and again", load${at}());` },
  { name: "requires-by-module", fits: main => main === ".cjs", body: (file, at) => `say("${at} requires-by-module", module.require("./${file}"));` },
  { name: "requires-by-a-made-require", body: (file, at) => `say("${at} requires-by-a-made-require", require("node:module").createRequire(require.resolve("./${file}"))("./${file}"));` },
  { name: "imports-late", body: (file, at) => `say("${at} imports-late", await import("./${file}"));` },
  { name: "imports-late-made-name", body: (file, at) => `say("${at} imports-late-made-name", await import("./" + JSON.parse('"${file}"')));` },
  { name: "imports-all", fits: main => main === ".mjs", head: (file, at) => `import * as all${at} from "./${file}";`, body: (_, at) => `say("${at} imports-all", all${at});` },
  { name: "imports-default", fits: (main, beside) => main === ".mjs" && !/^es-(?:names|live|awaits|counts-runs|throws|star|star-of-commonjs|empty|says-module-exports)$/.test(beside.name), head: (file, at) => `import whole${at} from "./${file}";`, body: (_, at) => `say("${at} imports-default", whole${at});` },
  { name: "imports-a-name", fits: (main, beside) => main === ".mjs" && !/^(?:es-default-alone|es-empty|data-list|data-text)$/.test(beside.name), head: (file, at) => `import { a as named${at} } from "./${file}";`, body: (_, at) => `say("${at} imports-a-name", named${at});` },
  { name: "waits-a-turn", body: (_, at) => `await new Promise(done => setTimeout(done, 1));\n  console.log("${at} waits-a-turn");` },
  { name: "stores-a-member", body: (file, at) => `const got${at} = require("./${file}");\n  if (got${at} !== null && typeof got${at} === "object") got${at}.a = "stored";\n  console.log("${at} stores-a-member");` },
  { name: "takes-out-of-the-cache", body: (file, at) => `console.log("${at} takes-out-of-the-cache", delete require.cache[require.resolve("./${file}")]);` },
  { name: "replaces-exports-in-the-cache", body: (file, at) => `const entry${at} = require.cache[require.resolve("./${file}")];\n  if (entry${at}) entry${at}.exports = { a: "replaced" };\n  console.log("${at} replaces-exports-in-the-cache", typeof entry${at});` },
  { name: "deletes-exports-in-the-cache", body: (file, at) => `const entry${at} = require.cache[require.resolve("./${file}")];\n  console.log("${at} deletes-exports-in-the-cache", typeof entry${at}, entry${at} ? delete entry${at}.exports : "nothing");` },
  { name: "defines-a-getter-in-the-cache", body: (file, at) => `const entry${at} = require.cache[require.resolve("./${file}")];\n  if (entry${at}) Object.defineProperty(entry${at}, "exports", { configurable: true, get() { return { a: "got" }; } });\n  console.log("${at} defines-a-getter-in-the-cache", typeof entry${at});` },
  { name: "plants-an-entry", body: (file, at) => `const key${at} = require.resolve("./${file}");\n  require.cache[key${at}] = { id: key${at}, filename: key${at}, loaded: true, exports: { a: "planted" }, children: [], paths: [] };\n  console.log("${at} plants-an-entry");` },
  { name: "asks-the-cache", body: (file, at) => `console.log("${at} asks-the-cache", require.resolve("./${file}") in require.cache, typeof require.cache[require.resolve("./${file}")]?.exports);` },
  { name: "walks-the-cache", body: (_, at) => `let count${at} = 0;\n  for (const key in require.cache) count${at}++;\n  console.log("${at} walks-the-cache", count${at} >= 0);` },
  { name: "looks-at-its-children", fits: main => main === ".cjs", body: (_, at) => `console.log("${at} looks-at-its-children", module.children.length, module.children.map(child => typeof child.exports + ":" + child.loaded).join());` },
  { name: "wraps-the-loader", fits: (_, beside) => isCommonJS(beside), body: (_, at) => `const loaders${at} = require("node:module")._extensions;\n  const had${at} = Object.hasOwn(loaders${at}, ".cjs");\n  const was${at} = loaders${at}[".cjs"];\n  undo.push(() => { if (had${at}) loaders${at}[".cjs"] = was${at}; else delete loaders${at}[".cjs"]; });\n  const before${at} = was${at} ?? loaders${at}[".js"];\n  loaders${at}[".cjs"] = (module, filename) => { console.log("${at} the loader is asked"); before${at}(module, filename); };\n  console.log("${at} wraps-the-loader");` },
  { name: "a-loader-that-answers-itself", fits: (_, beside) => isCommonJS(beside), body: (_, at) => `const loaders${at} = require("node:module")._extensions;\n  const had${at} = Object.hasOwn(loaders${at}, ".cjs");\n  const was${at} = loaders${at}[".cjs"];\n  undo.push(() => { if (had${at}) loaders${at}[".cjs"] = was${at}; else delete loaders${at}[".cjs"]; });\n  const before${at} = was${at} ?? loaders${at}[".js"];\n  loaders${at}[".cjs"] = module => { module.exports = { a: "by the loader" }; };\n  console.log("${at} a-loader-that-answers-itself");` },
  { name: "a-loader-that-throws-once", fits: (_, beside) => isCommonJS(beside), body: (_, at) => `const loaders${at} = require("node:module")._extensions;\n  const had${at} = Object.hasOwn(loaders${at}, ".cjs");\n  const was${at} = loaders${at}[".cjs"];\n  undo.push(() => { if (had${at}) loaders${at}[".cjs"] = was${at}; else delete loaders${at}[".cjs"]; });\n  const before${at} = was${at} ?? loaders${at}[".js"];\n  let thrown${at} = false;\n  loaders${at}[".cjs"] = (module, filename) => { if (!thrown${at}) { thrown${at} = true; throw new EvalError("made up"); } before${at}(module, filename); };\n  console.log("${at} a-loader-that-throws-once");` },
  { name: "a-loader-that-hands-on-another-module", fits: (_, beside) => isCommonJS(beside), body: (_, at) => `const Module${at} = require("node:module");\n  const loaders${at} = require("node:module")._extensions;\n  const had${at} = Object.hasOwn(loaders${at}, ".cjs");\n  const was${at} = loaders${at}[".cjs"];\n  undo.push(() => { if (had${at}) loaders${at}[".cjs"] = was${at}; else delete loaders${at}[".cjs"]; });\n  const before${at} = was${at} ?? loaders${at}[".js"];\n  loaders${at}[".cjs"] = (module, filename) => { const other = new Module${at}(filename, module); before${at}(other, filename); module.exports = { a: "through", inner: other.exports }; };\n  console.log("${at} a-loader-that-hands-on-another-module");` },
];

function writeWorld(extension: World["extension"], beside: Beside, first: Deed, second: Deed): World {
  const heads = [first.head?.(beside.file, 1), second.head?.(beside.file, 2)].filter(Boolean).join("\n");
  const steps = [first, second]
    .map(
      (deed, index) =>
        `await attempt("${index + 1} ${deed.name}", async () => {\n  ${deed.body(beside.file, index + 1)}\n});`,
    )
    .join("\n");
  const main =
    extension === ".mjs" ? `${heads ? heads + "\n" : ""}${say}${steps}\n` : `${say}(async () => {\n${steps}\n})();\n`;
  const files = { [beside.file]: beside.text, ...beside.more };
  return {
    name: `${extension.slice(1)}--${beside.name}--${first.name}--${second.name}`,
    extension,
    text:
      main +
      Object.entries(files)
        .map(([path, text]) => `// @filename: ./${path}\n${text}`)
        .join(""),
  };
}

/** The same world as a test file: the deeds run in the test, and a last line says where what it printed ends. */
function writeTestFile(extension: World["extension"], beside: Beside, row: Deed[], name: string) {
  const heads = row
    .map((deed, index) => deed.head?.(beside.file, index + 1))
    .filter(Boolean)
    .join("\n");
  const steps = row
    .map(
      (deed, index) =>
        `  await attempt("${index + 1} ${deed.name}", async () => {\n  ${deed.body(beside.file, index + 1)}\n  });`,
    )
    .join("\n");
  const runner =
    extension === ".mjs"
      ? `import { jest, mock, test, vi } from "bun:test";\n`
      : `const { jest, mock, test, vi } = require("bun:test");\n`;
  return `${runner}${heads ? heads + "\n" : ""}${say}test(${JSON.stringify(name)}, async () => {\n  console.log("== BEGIN ${name}");\n${steps}\n  for (const each of undo) each();\n  console.log("== END ${name}");\n});\n`;
}

const loads = (deed: Deed) => /^(?:requires|imports)/.test(deed.name);
/** Two deeds of which one loads, or a load, any deed, and a load again. */
/** A row that is named, of any length: for a fault whose shape is known. */
export function rowOfDeeds(names: string[]): Deed[] {
  return names.map(name => {
    const deed = [...deeds, ...deedsOfMocks].find(each => each.name === name);
    if (!deed) throw new Error(`no deed is called ${name}`);
    return deed;
  });
}

export function* rowsOfDeeds(count: 2 | 3): Generator<Deed[]> {
  const all = [...deeds, ...deedsOfMocks];
  for (const first of all)
    for (const second of all) {
      if (count === 2 && (loads(first) || loads(second))) yield [first, second];
      // A mock under a mock, and then a load.
      if (count === 3 && (loads(first) || (first.inTestRunsAlone && second.inTestRunsAlone)))
        for (const third of all) if (loads(third)) yield [first, second, third];
    }
}

export type Project = { name: string; files: Record<string, string> };
/**
 * Every main file and every file beside it that fit the row, each as a test file in a folder of its own. Nothing where none fits.
 * `inCompany` lays one more test file beside the worlds. It does nothing to them: it lets `require.cache` out of the build's sight, and that decides how every require() of the run is compiled.
 */
export function writeProject(row: Deed[], inCompany: boolean): Project | undefined {
  const files: Record<string, string> = { "package.json": `{ "name": "loads" }\n` };
  const preload: string[] = [];
  for (const extension of [".cjs", ".mjs"] as const)
    for (const beside of besides) {
      if (!row.every(deed => deed.fits?.(extension, beside) ?? true)) continue;
      const name = `${extension.slice(1)}--${beside.name}`;
      files[`p/${name}/main.test${extension}`] = writeTestFile(extension, beside, row, name);
      const more = row.map((deed, index) => deed.files?.(beside.file, index + 1));
      for (const [path, text] of Object.entries(Object.assign({ [beside.file]: beside.text, ...beside.more }, ...more)))
        files[`p/${name}/${path}`] = text;
      row.forEach((deed, index) => deed.preload && preload.push(deed.preload(`./p/${name}/${beside.file}`, index + 1)));
    }
  if (Object.keys(files).length === 1) return;
  if (preload.length) {
    files["preload.mjs"] = `import { mock, vi } from "bun:test";\n${preload.join("\n")}\n`;
    files["bunfig.toml"] = `[test]\npreload = ["./preload.mjs"]\n`;
  }
  if (inCompany)
    files["p/zz-company/main.test.cjs"] =
      `for (const name in require.cache) void name;\nrequire("bun:test").test("company", () => console.log("== END zz-company"));\n`;
  return { name: row.map(deed => deed.name).join("--") + (inCompany ? "--in-company" : ""), files };
}

export function* testProjects(count: 2 | 3 = 2, inCompany = false): Generator<Project> {
  for (const row of rowsOfDeeds(count)) {
    const project = writeProject(row, inCompany);
    if (project) yield project;
  }
}

/** Every main file, every file beside it, every pair of deeds that fit, in both orders and twice the same. */
export function* smallWorlds(): Generator<World> {
  for (const extension of [".cjs", ".mjs"] as const)
    for (const beside of besides)
      for (const first of deeds)
        for (const second of deeds) {
          if (![first, second].every(deed => deed.fits?.(extension, beside) ?? true)) continue;
          // Two deeds that load nothing say nothing of a load.
          if (![first, second].some(deed => /^(?:requires|imports)/.test(deed.name))) continue;
          if ([first, second].some(deed => asksForAnEntryOfTheCache.test(deed.name))) continue;
          yield writeWorld(extension, beside, first, second);
        }
}

if (import.meta.main) {
  const words = process.argv.slice(2);
  const option = (name: string) => (words.includes(`--${name}`) ? words[words.indexOf(`--${name}`) + 1] : undefined);
  const projects = option("test-projects");
  if (projects) {
    let [count, worlds] = [0, 0];
    for (const project of testProjects(option("deeds") === "3" ? 3 : 2, words.includes("--in-company"))) {
      if (!project.name.includes(option("only") ?? "")) continue;
      for (const [path, text] of Object.entries(project.files)) {
        mkdirSync(dirname(join(projects, project.name, path)), { recursive: true });
        writeFileSync(join(projects, project.name, path), text);
      }
      count++;
      worlds += Object.keys(project.files).filter(path => path.includes("/main.test.")).length;
    }
    console.log(count, "projects", worlds, "worlds");
    process.exit(0);
  }
  const out = option("small-worlds");
  if (!out)
    throw new Error(
      "usage: bun write-loads.ts --small-worlds <folder> | --test-projects <folder> [--only <part of a name>]",
    );
  mkdirSync(out, { recursive: true });
  let count = 0;
  for (const world of smallWorlds()) {
    if (!world.name.includes(option("only") ?? "")) continue;
    writeFileSync(join(out, world.name + world.extension), world.text);
    count++;
  }
  console.log(count, "worlds");
}
