import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { symlinkSync } from "node:fs";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { slot } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { withoutDebugInformation } from "./harness/without-debug-information";
import { test } from "./supported";

const programOf = (load: string) => `
const load = async name => {
  const loaded = await ${load};
  const value = loaded.default ?? loaded;
  return typeof value === "string" ? value.trim() : value.said;
};
(async () => {
  const [name, catches] = process.argv.slice(2);
  if (!catches) return console.log(await load(name));
  try {
    console.log(await load(name));
  } catch (error) {
    console.log("threw " + error.code);
  }
})();
`;
// Each is a project of its own: beside another one, a start that names nothing finds that one's code, and with it what that one asks for.
const programs = {
  "a-folder": programOf(`require("./locales/" + name)`),
  "a-pattern-of-exports": programOf(`require("tables/langs/" + name)`),
  "the-start-of-the-name-of-a-file": programOf(`require("./lang-" + name)`),
  "nothing": programOf(`require("./" + name)`),
  "nothing-imported": programOf(`import("./" + name)`),
  "the-folder-above": programOf(`require("./src/above.cjs")(name)`),
  "an-alias-of-the-own-folder": programOf(`require("./src/by-alias.cjs")(name)`),
  "nothing-but-an-end": programOf(`require("./" + name + ".json")`),
  "nothing-but-a-type": programOf(`import("./" + name, { with: { type: "json" } })`),
  "nothing-but-the-type-of-text": programOf(`import("./" + name, { with: { type: "text" } })`),
  "nothing-beside-a-path-with-a-type": programOf(`require("./typed.cjs").load(name)`),
  "a-folder-given-to-create-require": programOf(
    `require("node:module").createRequire(__dirname + "/locales/")("./" + name)`,
  ),
  "its-own-folder-through-two-dots": programOf(`require("./locales/index.cjs")(name)`),
  "nothing-in-an-installed-package": programOf(`require("installed")(name)`),
  "nothing-in-a-package-of-the-workspace": programOf(`require("linked")(name)`),
  "nothing-beside-a-file-whose-type-alone-is-imported": programOf(`require("./typed.ts").load(name)`),
  "a-scope-of-packages": programOf(`require("@acme/app")(name)`),
  "nothing-beside-many": programOf(`require("./" + name)`),
  "nothing-beside-a-file-imported-by-name": programOf(`(require("./table.json"), require("./" + name))`),
  "the-start-of-a-name-with-a-dot": programOf(`require("./.hidden." + name)`),
  "the-start-of-a-name-with-a-dot-and-an-end": programOf(`require("./.hidden." + name + ".cjs")`),
};
type Program = keyof typeof programs;

const data = [
  ".env.local",
  "deploy.sh",
  "guide.md",
  "id.pem",
  "lang-en.json",
  "locales/.env.local",
  "locales/deploy.sh",
  "locales/en.json",
  "locales/guide.md",
  "locales/notes.txt",
  "locales/page.html",
  "node_modules/@acme/tables/data.json",
  "node_modules/installed/node_modules/inner/table.json",
  "node_modules/installed/rows/table.json",
  "node_modules/installed/table.json",
  "node_modules/sibling/table.json",
  "node_modules/tables/data/en.json",
  "notes.txt",
  "packages/linked/table.json",
  "page.html",
  "run.log",
  "src/notes.txt",
  "table.json",
];
const dataOfSomePrograms = ["conf.jsonc", "query.sql"];
const contentsOf = (owner: string, files: string[]) =>
  Object.fromEntries(
    files.map(file => {
      const said = `made-up mark of ${owner}: ${file}`;
      return [`${owner}/${file}`, /\.jsonc?$/.test(file) ? JSON.stringify({ said }) : said + "\n"];
    }),
  );
const filesOf = (owner: string) => ({
  ...contentsOf(owner, data),
  [`${owner}/part.cjs`]: `exports.said = "made-up mark of ${owner}: part.cjs";\n`,
  [`${owner}/src/part.cjs`]: `exports.said = "made-up mark of ${owner}: src/part.cjs";\n`,
  [`${owner}/node_modules/tables/package.json`]: JSON.stringify({
    name: "tables",
    exports: { "./langs/*": "./data/*.json" },
  }),
  [`${owner}/node_modules/@acme/tables/package.json`]: JSON.stringify({ name: "@acme/tables", main: "data.json" }),
  [`${owner}/node_modules/@acme/app/package.json`]: JSON.stringify({ name: "@acme/app", main: "index.js" }),
  [`${owner}/node_modules/@acme/app/index.js`]: `module.exports = name => require("@acme/" + name);\n`,
  ...Object.fromEntries(
    [
      "node_modules/installed",
      "node_modules/installed/node_modules/inner",
      "node_modules/sibling",
      "packages/linked",
    ].flatMap(folder => [
      [`${owner}/${folder}/package.json`, JSON.stringify({ name: folder.split("/").at(-1), main: "index.cjs" })],
      [`${owner}/${folder}/index.cjs`, `module.exports = name => require("./" + name);\n`],
    ]),
  ),
  [`${owner}/.hidden.cjs`]: `exports.said = "made-up mark of ${owner}: .hidden.cjs";\n`,
});

const projectOf = (program: string, text: string) => ({
  ...filesOf("tool"),
  ...filesOf("stranger"),
  "tool/main.cjs": text,
  "tool/src/above.cjs": `module.exports = name => require("../" + name);\n`,
  ...(program === "an-alias-of-the-own-folder" && {
    "tool/src/by-alias.cjs": `module.exports = name => require("@/" + name);\n`,
    "tool/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }),
  }),
  ...(program === "its-own-folder-through-two-dots" && {
    "tool/locales/index.cjs": `module.exports = name => require("../locales/" + name);\n`,
  }),
  ...(program === "the-start-of-a-name-with-a-dot-and-an-end" && {
    "tool/.hidden.first.cjs": "",
    "tool/.hidden.first.json": "{}",
  }),
  ...(program === "nothing-beside-a-file-whose-type-alone-is-imported" && {
    "tool/typed.ts": `import type table from "./table.json";\nexport const load = (name: string): typeof table => require("./" + name);\n`,
  }),
  ...(program.startsWith("nothing-but-") && program.includes("-type") && contentsOf("tool", dataOfSomePrograms)),
  ...(program === "nothing-beside-a-path-with-a-type" && {
    "tool/typed.cjs": `exports.load = name => import("./" + name, { with: { type: "json" } });\nexports.other = name => import("./" + name);\n`,
  }),
  ...(program === "nothing-beside-many" &&
    Object.fromEntries(["a", "b", "c", "d", "e", "f"].map(name => [`tool/many/${name}.json`, "{}"]))),
  "empty/nothing.txt": "",
});
const dir = tempDir(
  "aot-a-computed-import-embeds-what-its-written-name-asks-for",
  Object.fromEntries(
    Object.entries(programs).flatMap(([program, text]) =>
      Object.entries(projectOf(program, text)).map(([file, contents]) => [`${program}/${file}`, contents]),
    ),
  ),
);
afterAll(() => dir[Symbol.dispose]());
const directory = String(dir);
for (const owner of ["tool", "stranger"]) {
  const project = join(directory, "nothing-in-a-package-of-the-workspace", owner);
  symlinkSync(join(project, "packages/linked"), join(project, "node_modules/linked"), "junction");
}

const forms = { closed: [], withCodeFromDisk: ["--aot-allow-code-from-disk"] };
type Form = keyof typeof forms;
const bothForms = ["closed", "withCodeFromDisk"] as const;
const builds = new Map<string, Promise<{ executable: string; said: string }>>();
// The tests run beside one another: a build or a start of a program takes a slot, so that no more of them run at once than the machine has processors.
function build(program: Program, form: Form = "closed") {
  const executable = join(directory, program, "bin", form + (isWindows ? ".exe" : ""));
  const start = async () => {
    const flags = ["--compile", "--aot", ...forms[form], ...withoutDebugInformation];
    const command = [bunExe(), "build", ...flags, "./main.cjs", "--outfile", executable];
    const { stderr, exitCode } = await slot(() => run(command, join(directory, program, "tool")));
    expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return { executable, said: stderr.replaceAll("\\", "/") };
  };
  if (!builds.has(executable)) builds.set(executable, start());
  return builds.get(executable)!;
}

const mark = "made-up mark of tool: ";
// The executable is read once, in pieces. Behind each mark stands the name of the file that holds it.
async function marksIn(executable: string) {
  const files = [...data, ...dataOfSomePrograms].sort();
  const longest = Math.max(...files.map(file => file.length));
  const held = new Set<string>();
  const piece = Buffer.allocUnsafe(4 * 1024 * 1024);
  const opened = await open(executable, "r");
  try {
    // What is left of the last piece stands in front of the next one, so that a mark that lies across two pieces is found.
    let left = 0;
    while (true) {
      const { bytesRead } = await opened.read(piece, left, piece.length - left, null);
      if (bytesRead === 0) break;
      const bytes = piece.subarray(0, left + bytesRead);
      for (let at = bytes.indexOf(mark); at !== -1; at = bytes.indexOf(mark, at + 1)) {
        const behind = bytes.toString("latin1", at + mark.length, at + mark.length + longest);
        for (const file of files) if (behind.startsWith(file)) held.add(file);
      }
      left = Math.min(mark.length + longest, bytes.length);
      piece.copyWithin(0, bytes.length - left, bytes.length);
    }
  } finally {
    await opened.close();
  }
  return files.filter(file => held.has(file));
}
let lastSearch: Promise<unknown> = Promise.resolve();
// The search runs on this thread, between the other tests. One executable at a time: two searches would only take turns at the disk.
function dataHeldBy(executable: string) {
  const held = lastSearch.then(() => marksIn(executable));
  lastSearch = held.catch(() => {});
  return held;
}

const linesWith = (said: string, code: string) => said.split("\n").filter(line => line.includes(code));
/** The files that each note of a build lists as data that the executable embeds. */
const notesOf = (said: string) => linesWith(said, "TS100088").map(line => line.split("These aren't code: ")[1] ?? line);
/** The files that each warning of a build lists as data that the executable leaves out. */
const warningsOf = (said: string) =>
  linesWith(said, "TS100089").map(line => /doesn't embed (.*), which this path may name/.exec(line)?.[1] ?? line);

const folders = ["tool", "stranger", "empty"] as const;
/** What a start prints that ends well: one line on stdout, nothing on stderr, exit code 0. */
const prints = (line: string) => ({ stdout: line + "\n", stderr: "", exitCode: 0 });
const finds = (file: string) => prints(mark + file);
const throws = (code: string) => prints("threw " + code);
const inEachFolder = <Answer>(answer: Answer) => Object.fromEntries(folders.map(folder => [folder, answer]));
const mapValues = <Value, Mapped>(values: Record<string, Value>, map: (value: Value) => Mapped) =>
  Object.fromEntries(Object.entries(values).map(([key, value]) => [key, map(value)]));
/** What `ask` answers for each key. All are asked at once. */
const atOnce = async <Key extends string, Answer>(keys: readonly Key[], ask: (key: Key) => Promise<Answer>) =>
  Object.fromEntries(await Promise.all(keys.map(async key => [key, await ask(key)] as const)));

/** One start of a program for a name: it prints what the load gave it, or the code of what the load threw. */
const started = (program: Program, folder: string, command: string[]) =>
  slot(() => run([...command, "and catches"], join(directory, program, folder), bunEnv));
/** What plain Bun prints for each name, started in the project. */
const plainAnswers = (program: Program, names: readonly string[]) =>
  atOnce(names, name => started(program, "tool", [bunExe(), join(directory, program, "tool/main.cjs"), name]));
/** What an executable prints for each name, started in each folder: in its project, in another one and in an empty one. */
const answersOf = (program: Program, executable: string, names: readonly string[]) =>
  atOnce(names, name => atOnce(folders, folder => started(program, folder, [executable, name])));
/** Of one build: the data files that the executable holds, the files that the notes of the build list, and what the executable prints. */
async function askedOf(program: Program, form: Form, names: readonly string[]) {
  const { executable, said } = await build(program, form);
  const [held, answers] = await Promise.all([dataHeldBy(executable), answersOf(program, executable, names)]);
  return { form, held, notes: notesOf(said), answers };
}
/** The names under plain Bun and in both forms of the executable, all at once. */
const inEveryWay = (program: Program, names: readonly string[]) =>
  Promise.all([plainAnswers(program, names), ...bothForms.map(form => askedOf(program, form, names))]);

test.concurrent.each([
  [
    "a-folder",
    { en: "locales/en.json", "en.json": "locales/en.json", "notes.txt": "locales/notes.txt" },
    ["locales/deploy.sh", "locales/en.json", "locales/guide.md", "locales/notes.txt", "locales/page.html"],
  ],
  ["a-pattern-of-exports", { en: "node_modules/tables/data/en.json" }, ["node_modules/tables/data/en.json"]],
  ["the-start-of-the-name-of-a-file", { en: "lang-en.json", "en.json": "lang-en.json" }, ["lang-en.json"]],
  [
    "nothing-but-an-end",
    { table: "table.json", "locales/en": "locales/en.json" },
    ["lang-en.json", "locales/en.json", "table.json"],
  ],
  [
    "nothing-but-a-type",
    { "table.json": "table.json", "locales/en.json": "locales/en.json", "conf.jsonc": "conf.jsonc" },
    ["conf.jsonc", "lang-en.json", "locales/en.json", "table.json"],
  ],
  [
    "nothing-but-the-type-of-text",
    { "query.sql": "query.sql", "locales/notes.txt": "locales/notes.txt" },
    ["id.pem", "locales/notes.txt", "notes.txt", "query.sql", "run.log", "src/notes.txt"],
  ],
  [
    "its-own-folder-through-two-dots",
    { en: "locales/en.json", "en.json": "locales/en.json" },
    ["locales/deploy.sh", "locales/en.json", "locales/guide.md", "locales/notes.txt", "locales/page.html"],
  ],
  [
    "a-folder-given-to-create-require",
    { en: "locales/en.json", "en.json": "locales/en.json" },
    ["locales/deploy.sh", "locales/en.json", "locales/guide.md", "locales/notes.txt", "locales/page.html"],
  ],
] as const)(
  "a start that names %s: what the path may name is in the executable, and the build says so",
  async (program, found, held) => {
    const [plain, ...compiled] = await inEveryWay(program, Object.keys(found));
    expect(plain).toEqual(mapValues(found, finds));
    expect(compiled).toEqual(
      bothForms.map(form => ({
        form,
        held: [...held],
        notes: [held.join(", ")],
        answers: mapValues(found, file => inEachFolder(finds(file))),
      })),
    );
  },
  600_000,
);

test.concurrent.each([
  ["nothing", "part.cjs"],
  ["nothing-imported", "part.cjs"],
  ["the-folder-above", "part.cjs"],
  ["an-alias-of-the-own-folder", "src/part.cjs"],
] as const)(
  "a start that names %s: the code is in the executable and no data file",
  async (program, file) => {
    const [plain, ...compiled] = await inEveryWay(program, ["part.cjs"]);
    expect(plain).toEqual({ "part.cjs": finds(file) });
    expect(compiled).toEqual(
      bothForms.map(form => ({ form, held: [], notes: [], answers: { "part.cjs": inEachFolder(finds(file)) } })),
    );
  },
  600_000,
);

test.concurrent.each([
  ["nothing", "MODULE_NOT_FOUND"],
  ["nothing-imported", "ERR_MODULE_NOT_FOUND"],
  ["the-folder-above", "MODULE_NOT_FOUND"],
] as const)(
  "a start that names %s: a closed executable looks for a relative name in no folder on disk",
  async (program, code) => {
    const { executable } = await build(program);
    expect(await answersOf(program, executable, ["table.json"])).toEqual({ "table.json": inEachFolder(throws(code)) });
  },
  600_000,
);

test.concurrent(
  "a start that names a scope of packages, written in one of them: the data file that is the main file of another",
  async () => {
    const file = "node_modules/@acme/tables/data.json";
    const notes = [
      "node_modules/@acme/app/package.json, node_modules/@acme/tables/data.json, node_modules/@acme/tables/package.json",
    ];
    const [plain, ...compiled] = await inEveryWay("a-scope-of-packages", ["tables"]);
    expect(plain).toEqual({ tables: finds(file) });
    expect(compiled).toEqual(
      bothForms.map(form => ({ form, held: [file], notes, answers: { tables: inEachFolder(finds(file)) } })),
    );
  },
  600_000,
);

test.concurrent(
  "a start that names nothing, written in an installed package: the code and the data of that package and of no other",
  async () => {
    const program = "nothing-in-an-installed-package";
    const found = {
      table: "node_modules/installed/table.json",
      "rows/table.json": "node_modules/installed/rows/table.json",
    };
    const held = ["node_modules/installed/rows/table.json", "node_modules/installed/table.json"];
    const [plain, ...compiled] = await inEveryWay(program, Object.keys(found));
    expect(plain).toEqual(mapValues(found, finds));
    expect(compiled).toEqual(
      bothForms.map(form => ({
        form,
        held,
        notes: [`node_modules/installed/package.json, ${held.join(", ")}`],
        answers: mapValues(found, file => inEachFolder(finds(file))),
      })),
    );
    for (const form of bothForms)
      expect({ form, warnings: warningsOf((await build(program, form)).said) }).toEqual({ form, warnings: [] });
  },
  600_000,
);

test.concurrent(
  "a start that names nothing, written in a package of the workspace that is linked into node_modules: no data file",
  async () => {
    const program = "nothing-in-a-package-of-the-workspace";
    const [plain, { executable, said }] = await Promise.all([plainAnswers(program, ["table"]), build(program)]);
    expect(plain).toEqual({ table: finds("packages/linked/table.json") });
    expect(await dataHeldBy(executable)).toEqual([]);
    expect(warningsOf(said)).toEqual(["packages/linked/package.json, packages/linked/table.json"]);
    expect(await answersOf(program, executable, ["table"])).toEqual({
      table: inEachFolder(throws("MODULE_NOT_FOUND")),
    });
  },
  600_000,
);

// Each place that may name what is left out has a warning of its own.
test.concurrent.each([
  [
    "nothing-beside-a-file-whose-type-alone-is-imported",
    2,
    "lang-en.json, locales/en.json, table.json, deploy.sh, guide.md and 9 more",
    "Write the extension",
  ],
  ["nothing", 2, "lang-en.json, locales/en.json, table.json, deploy.sh, guide.md and 9 more", "Write the extension"],
  [
    "nothing-beside-many",
    2,
    "lang-en.json, locales/en.json, many/a.json, many/b.json, many/c.json and 15 more",
    "Write the extension",
  ],
  [
    "nothing-beside-a-file-imported-by-name",
    2,
    "lang-en.json, locales/en.json, deploy.sh, guide.md, id.pem and 8 more",
    "Write the extension",
  ],
  [
    "nothing-beside-a-path-with-a-type",
    3,
    "deploy.sh, guide.md, id.pem, locales/deploy.sh, locales/guide.md and 6 more",
    "Write the extension",
  ],
  ["the-start-of-a-name-with-a-dot", 1, ".hidden.cjs", "begins with a dot"],
  ["the-start-of-a-name-with-a-dot-and-an-end", 1, ".hidden.first.cjs", "begins with a dot"],
] as const)(
  "a start that names %s: the build warns of what it leaves out",
  async (program, places, names, cure) => {
    const { said } = await build(program);
    expect(warningsOf(said)).toEqual(Array.from({ length: places }, () => names));
    for (const warning of linesWith(said, "TS100089")) expect(warning).toContain(cure);
  },
  600_000,
);

test.concurrent(
  "a file whose name begins with a dot is not found, though the written start spells the dot",
  async () => {
    const program = "the-start-of-a-name-with-a-dot";
    const [plain, { executable }] = await Promise.all([plainAnswers(program, ["cjs"]), build(program)]);
    expect(plain).toEqual({ cjs: finds(".hidden.cjs") });
    expect(await answersOf(program, executable, ["cjs"])).toEqual({ cjs: inEachFolder(throws("MODULE_NOT_FOUND")) });
  },
  600_000,
);

test.concurrent(
  "the refusal says what to write instead",
  async () => {
    const { executable } = await build("nothing");
    const startedIn = join(directory, "nothing", "stranger");
    const { stdout, stderr, exitCode } = await slot(() => run([executable, "table.json"], startedIn, bunEnv));
    expect(stderr).toContain("Cannot find module './table.json'");
    expect(stderr).toContain("it isn't in this executable");
    expect(stderr).toContain("write its folder or its extension in the path");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  },
  600_000,
);

test.concurrent(
  "where code may come from disk, a data file that the executable lacks is still looked for on disk",
  async () => {
    const { executable } = await build("nothing", "withCodeFromDisk");
    expect(await started("nothing", "tool", [executable, "table.json"])).toEqual(finds("table.json"));
  },
  600_000,
);
