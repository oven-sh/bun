import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { afterAll, test } from "./harness/default-timeout";
import { run } from "./harness/run";

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
const builds = new Map<string, Promise<{ executable: string; said: string }>>();
function build(program: Program, form: Form = "closed") {
  const executable = join(directory, program, "bin", form + (isWindows ? ".exe" : ""));
  const start = async () => {
    const flags = ["--compile", "--aot", "--explain", ...forms[form]];
    const command = [bunExe(), "build", ...flags, "./main.cjs", "--outfile", executable];
    const { stderr, exitCode } = await run(command, join(directory, program, "tool"));
    expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return { executable, said: stderr.replaceAll("\\", "/") };
  };
  if (!builds.has(executable)) builds.set(executable, start());
  return builds.get(executable)!;
}
const dataHeldBy = (executable: string) => {
  const bytes = readFileSync(executable);
  return [...data, ...dataOfSomePrograms].sort().filter(file => bytes.includes(`made-up mark of tool: ${file}`));
};
async function answersIn(program: Program, folder: string, command: string[]) {
  const { stdout } = await run([...command, "and catches"], join(directory, program, folder), bunEnv);
  return stdout.trim();
}
const plainAnswer = (program: Program, name: string) =>
  answersIn(program, "tool", [bunExe(), join(directory, program, "tool/main.cjs"), name]);

test.each([
  [
    "a-folder",
    ["en", "en.json", "notes.txt"],
    ["locales/deploy.sh", "locales/en.json", "locales/guide.md", "locales/notes.txt", "locales/page.html"],
  ],
  ["a-pattern-of-exports", ["en"], ["node_modules/tables/data/en.json"]],
  ["the-start-of-the-name-of-a-file", ["en", "en.json"], ["lang-en.json"]],
  ["nothing-but-an-end", ["table", "locales/en"], ["lang-en.json", "locales/en.json", "table.json"]],
  [
    "nothing-but-a-type",
    ["table.json", "locales/en.json", "conf.jsonc"],
    ["conf.jsonc", "lang-en.json", "locales/en.json", "table.json"],
  ],
  [
    "nothing-but-the-type-of-text",
    ["query.sql", "locales/notes.txt"],
    ["id.pem", "locales/notes.txt", "notes.txt", "query.sql", "run.log", "src/notes.txt"],
  ],
  [
    "its-own-folder-through-two-dots",
    ["en", "en.json"],
    ["locales/deploy.sh", "locales/en.json", "locales/guide.md", "locales/notes.txt", "locales/page.html"],
  ],
  [
    "a-folder-given-to-create-require",
    ["en", "en.json"],
    ["locales/deploy.sh", "locales/en.json", "locales/guide.md", "locales/notes.txt", "locales/page.html"],
  ],
] as const)(
  "a start that names %s: what the path may name is in the executable, and the build says so",
  async (program, names, held) => {
    for (const form of ["closed", "withCodeFromDisk"] as const) {
      const { executable, said } = await build(program, form);
      expect({ form, held: dataHeldBy(executable) }).toEqual({ form, held: [...held] });
      expect(said).toContain(`TS100088: `);
      expect(said).toContain(`These aren't code: ${held.join(", ")}\n`);
      for (const name of names) {
        const plain = await plainAnswer(program, name);
        expect(plain).toStartWith("made-up mark of tool: ");
        for (const folder of ["tool", "stranger", "empty"])
          expect({ form, name, folder, answer: await answersIn(program, folder, [executable, name]) }).toEqual({
            ...{ form, name, folder },
            answer: plain,
          });
      }
    }
  },
  600_000,
);

test("without --explain the build doesn't list the data files", async () => {
  const executable = join(directory, "a-folder", "bin", "unexplained" + (isWindows ? ".exe" : ""));
  const command = [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", executable];
  const { stderr, exitCode } = await run(command, join(directory, "a-folder", "tool"));
  expect(stderr).not.toContain("TS100088");
  expect(exitCode).toBe(0);
  expect(dataHeldBy(executable)).toEqual(dataHeldBy((await build("a-folder")).executable));
}, 600_000);

test.each(["nothing", "nothing-imported", "the-folder-above", "an-alias-of-the-own-folder"] as const)(
  "a start that names %s: the code is in the executable and no data file",
  async program => {
    const plain = await plainAnswer(program, "part.cjs");
    expect(plain).toStartWith("made-up mark of tool: ");
    for (const form of ["closed", "withCodeFromDisk"] as const) {
      const { executable, said } = await build(program, form);
      expect({ form, held: dataHeldBy(executable) }).toEqual({ form, held: [] });
      expect(said).not.toContain("TS100088");
      for (const folder of ["tool", "stranger", "empty"])
        expect(await answersIn(program, folder, [executable, "part.cjs"])).toBe(plain);
    }
  },
  600_000,
);

test.each([
  ["nothing", "MODULE_NOT_FOUND"],
  ["nothing-imported", "ERR_MODULE_NOT_FOUND"],
  ["the-folder-above", "MODULE_NOT_FOUND"],
] as const)(
  "a start that names %s: a closed executable looks for a relative name in no folder on disk",
  async (program, code) => {
    const { executable } = await build(program);
    for (const folder of ["tool", "stranger", "empty"])
      expect({ folder, answer: await answersIn(program, folder, [executable, "table.json"]) }).toEqual({
        folder,
        answer: "threw " + code,
      });
  },
  600_000,
);

test("a start that names a scope of packages, written in one of them: the data file that is the main file of another", async () => {
  const plain = await plainAnswer("a-scope-of-packages", "tables");
  expect(plain).toBe("made-up mark of tool: node_modules/@acme/tables/data.json");
  for (const form of ["closed", "withCodeFromDisk"] as const) {
    const { executable } = await build("a-scope-of-packages", form);
    expect({ form, held: dataHeldBy(executable) }).toEqual({ form, held: ["node_modules/@acme/tables/data.json"] });
    for (const folder of ["tool", "stranger", "empty"])
      expect(await answersIn("a-scope-of-packages", folder, [executable, "tables"])).toBe(plain);
  }
}, 600_000);

test("a start that names nothing, written in an installed package: the code and the data of that package and of no other", async () => {
  const program = "nothing-in-an-installed-package";
  for (const form of ["closed", "withCodeFromDisk"] as const) {
    const { executable, said } = await build(program, form);
    const held = ["node_modules/installed/rows/table.json", "node_modules/installed/table.json"];
    expect({ form, held: dataHeldBy(executable) }).toEqual({ form, held });
    expect(said).toContain(`These aren't code: node_modules/installed/package.json, ${held.join(", ")}\n`);
    expect(said).not.toContain("TS100089");
    for (const name of ["table", "rows/table.json"]) {
      const plain = await plainAnswer(program, name);
      expect(plain).toStartWith("made-up mark of tool: node_modules/installed/");
      for (const folder of ["tool", "stranger", "empty"])
        expect(await answersIn(program, folder, [executable, name])).toBe(plain);
    }
  }
}, 600_000);

test("a start that names nothing, written in a package of the workspace that is linked into node_modules: no data file", async () => {
  const program = "nothing-in-a-package-of-the-workspace";
  expect(await plainAnswer(program, "table")).toBe("made-up mark of tool: packages/linked/table.json");
  const { executable, said } = await build(program);
  expect(dataHeldBy(executable)).toEqual([]);
  expect(said).toContain(
    "The executable doesn't embed packages/linked/package.json, packages/linked/table.json, which",
  );
  for (const folder of ["tool", "stranger", "empty"])
    expect(await answersIn(program, folder, [executable, "table"])).toBe("threw MODULE_NOT_FOUND");
}, 600_000);

test.each([
  [
    "nothing-beside-a-file-whose-type-alone-is-imported",
    "lang-en.json, locales/en.json, table.json, deploy.sh, guide.md and 9 more, which",
    "Write the extension",
  ],
  [
    "nothing",
    "lang-en.json, locales/en.json, table.json, deploy.sh, guide.md and 9 more, which",
    "Write the extension",
  ],
  [
    "nothing-beside-many",
    "lang-en.json, locales/en.json, many/a.json, many/b.json, many/c.json and 15 more, which",
    "Write the extension",
  ],
  [
    "nothing-beside-a-file-imported-by-name",
    "lang-en.json, locales/en.json, deploy.sh, guide.md, id.pem and 8 more, which",
    "Write the extension",
  ],
  [
    "nothing-beside-a-path-with-a-type",
    "deploy.sh, guide.md, id.pem, locales/deploy.sh, locales/guide.md and 6 more, which",
    "Write the extension",
  ],
  ["the-start-of-a-name-with-a-dot", ".hidden.cjs, which", "begins with a dot"],
  ["the-start-of-a-name-with-a-dot-and-an-end", ".hidden.first.cjs, which", "begins with a dot"],
] as const)(
  "a start that names %s: the build warns of what it leaves out",
  async (program, names, cure) => {
    const { said } = await build(program);
    const warning = said.split("\n").find(line => line.includes("TS100089: "));
    expect(warning).toContain("The executable doesn't embed " + names);
    expect(warning).toContain(cure);
  },
  600_000,
);

test("a file whose name begins with a dot is not found, though the written start spells the dot", async () => {
  const program = "the-start-of-a-name-with-a-dot";
  expect(await plainAnswer(program, "cjs")).toBe("made-up mark of tool: .hidden.cjs");
  const { executable } = await build(program);
  for (const folder of ["tool", "stranger", "empty"])
    expect(await answersIn(program, folder, [executable, "cjs"])).toBe("threw MODULE_NOT_FOUND");
}, 600_000);

test("the refusal says what to write instead", async () => {
  const { executable } = await build("nothing");
  const startedIn = join(directory, "nothing", "stranger");
  const { stdout, stderr, exitCode } = await run([executable, "table.json"], startedIn, bunEnv);
  expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  expect(stderr).toContain("Cannot find module './table.json'");
  expect(stderr).toContain("it isn't in this executable");
  expect(stderr).toContain("write its folder or its extension in the path");
}, 600_000);

test("where code may come from disk, a data file that the executable lacks is still looked for on disk", async () => {
  const { executable } = await build("nothing", "withCodeFromDisk");
  expect(await answersIn("nothing", "tool", [executable, "table.json"])).toBe("made-up mark of tool: table.json");
}, 600_000);
