// `await import(path)` and `require(path)` where `path` is no constant: the build embeds the files that the written parts of the path name, however the
// program puts the path together. `"./plugins/".concat(name, ".ts")` and `path += name` name the files that `"./plugins/" + name + ".ts"` names.
// A default that is stored with `||=`, `??=` or in an `if`, or that stands in a destructuring pattern or at a parameter, names the file that
// `process.env.PLUGIN || "./plugins/a.ts"` names.
//
// One build for all spellings. Each spelling loads from a folder of its own, so that no spelling finds a file that another one has embedded. The executable
// runs in an empty folder, and each row holds it to what `bun <the main file>` prints. The stored programs under
// parallel/files-that-only-a-computed-name-finds/ build the same spellings one by one, on every thread and in every way.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const name = `const name = process.env.NAME_OF_PLUGIN || "a";\n`;
const imported = `export const { mark } = await `;

/** `names` says what is written: every file that the parts may name, or the one file of the default. */
type Spelling = { file: "load.mjs" | "load.cjs"; text: string; names: "each file of the folder" | "the default" };
const spellings: Record<string, Spelling> = {
  "parts joined with +": {
    file: "load.mjs",
    text: `${name}${imported}import("./plugins/" + name + ".ts");\n`,
    names: "each file of the folder",
  },
  "a template": {
    file: "load.mjs",
    text: `${name}${imported}import(\`./plugins/\${name}.ts\`);\n`,
    names: "each file of the folder",
  },
  "parts joined with concat()": {
    file: "load.mjs",
    text: `${name}${imported}import("./plugins/".concat(name, ".ts"));\n`,
    names: "each file of the folder",
  },
  "parts appended with +=": {
    file: "load.mjs",
    text: `${name}let path = "./plugins/";\npath += name;\npath += ".ts";\n${imported}import(path);\n`,
    names: "each file of the folder",
  },
  "require() of parts joined with concat()": {
    file: "load.cjs",
    text: `${name}exports.mark = require("./plugins/".concat(name, ".cjs")).mark;\n`,
    names: "each file of the folder",
  },
  "require() of parts appended with +=": {
    file: "load.cjs",
    text: `${name}let path = "./plugins/";\npath += name;\nexports.mark = require(path + ".cjs").mark;\n`,
    names: "each file of the folder",
  },
  "a default behind ||": {
    file: "load.mjs",
    text: `${imported}import(process.env.PATH_OF_PLUGIN || "./plugins/a.ts");\n`,
    names: "the default",
  },
  "a default stored with ||=": {
    file: "load.mjs",
    text: `let path = process.env.PATH_OF_PLUGIN;\npath ||= "./plugins/a.ts";\n${imported}import(path);\n`,
    names: "the default",
  },
  "a default stored with ??=": {
    file: "load.mjs",
    text: `let path = process.env.PATH_OF_PLUGIN;\npath ??= "./plugins/a.ts";\n${imported}import(path);\n`,
    names: "the default",
  },
  "a default stored in an if": {
    file: "load.mjs",
    text: `let path = process.env.PATH_OF_PLUGIN;\nif (!path) path = "./plugins/a.ts";\n${imported}import(path);\n`,
    names: "the default",
  },
  "a default in a destructuring pattern": {
    file: "load.mjs",
    text: `const { PATH_OF_PLUGIN = "./plugins/a.ts" } = process.env;\n${imported}import(PATH_OF_PLUGIN);\n`,
    names: "the default",
  },
  "a default of a parameter": {
    file: "load.mjs",
    text: `const load = (path = "./plugins/a.ts") => import(path);\n${imported}load(process.env.PATH_OF_PLUGIN);\n`,
    names: "the default",
  },
  "require() of a default stored with ||=": {
    file: "load.cjs",
    text: `let path = process.env.PATH_OF_PLUGIN;\npath ||= "./plugins/a.cjs";\nexports.mark = require(path).mark;\n`,
    names: "the default",
  },
  "require() of a default that a function stores in its parameter": {
    file: "load.cjs",
    text: `function load(path) {\n  path = path || "./plugins/a.cjs";\n  return require(path);\n}\nexports.mark = load(process.env.PATH_OF_PLUGIN).mark;\n`,
    names: "the default",
  },
};

const titles = Object.keys(spellings);
const files: Record<string, string> = {
  "main.mjs": `const loads = [\n${titles.map((title, index) => `  () => import("./s${index}/${spellings[title].file}"),\n`).join("")}];
for (const load of loads) console.log(await load().then(it => it.mark, error => error.message.split("\\n")[0]));
`,
};
titles.forEach((title, index) => {
  const { file, text } = spellings[title];
  files[`s${index}/${file}`] = text;
  for (const plugin of ["a", "b"]) {
    if (file === "load.mjs")
      files[`s${index}/plugins/${plugin}.ts`] = `export const mark: string = "${plugin} of ${index}";\n`;
    else files[`s${index}/plugins/${plugin}.cjs`] = `exports.mark = "${plugin} of ${index}";\n`;
  }
});

const plugins = ["a", "b"] as const;
type Printed = Record<(typeof plugins)[number], string[]>;
const folders: Disposable[] = [];
afterAll(() => folders.forEach(folder => folder[Symbol.dispose]()));
let asked: Promise<{ plain: Printed; compiled: Printed }> | undefined;
/** What each spelling printed under plain Bun and in the executable, in the order of the table, for each plug-in that the environment names. */
const printed = () =>
  (asked ??= (async () => {
    const sources = tempDir("aot-computed-import-spellings", files);
    const elsewhere = tempDir("aot-computed-import-spellings-run", {});
    folders.push(sources, elsewhere);
    const executable = join(String(elsewhere), isWindows ? "program.exe" : "program");
    // What a load reads does not hang on the threads of a build. One thread keeps this build out of a race between the threads of the engine that a debug
    // build of Bun dies of now and then.
    const built = await run(
      [bunExe(), ...compileCommand, withThreads(1), "main.mjs", "--outfile", executable],
      String(sources),
    );
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const linesOf = async (command: string[], cwd: string, plugin: string) => {
      const ran = await run(command, cwd, { ...bunEnv, NAME_OF_PLUGIN: plugin });
      expect({ stderr: ran.exitCode ? ran.stderr : "", exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return ran.stdout.split("\n").slice(0, titles.length);
    };
    const plain = {} as Printed;
    const compiled = {} as Printed;
    for (const plugin of plugins) {
      plain[plugin] = await linesOf([bunExe(), "main.mjs"], String(sources), plugin);
      compiled[plugin] = await linesOf([executable], String(elsewhere), plugin);
    }
    return { plain, compiled };
  })());

test.each(titles)("the executable holds what is written: %s", async title => {
  const index = titles.indexOf(title);
  const { plain, compiled } = await printed();
  const loads = (plugin: "a" | "b") => (spellings[title].names === "each file of the folder" ? plugin : "a");
  const expected = { a: `${loads("a")} of ${index}`, b: `${loads("b")} of ${index}` };
  expect({ a: plain.a[index], b: plain.b[index] }).toEqual(expected);
  expect({ a: compiled.a[index], b: compiled.b[index] }).toEqual(expected);
});
