import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
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
  "a-folder-given-to-create-require": programOf(
    `require("node:module").createRequire(__dirname + "/locales/")("./" + name)`,
  ),
  "its-own-folder-through-two-dots": programOf(`require("./locales/index.cjs")(name)`),
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
  "node_modules/tables/data/en.json",
  "notes.txt",
  "page.html",
  "run.log",
  "src/notes.txt",
  "table.json",
];
const filesOf = (owner: string) => ({
  ...Object.fromEntries(
    data.map(file => {
      const said = `made-up mark of ${owner}: ${file}`;
      return [`${owner}/${file}`, file.endsWith(".json") ? JSON.stringify({ said }) : said + "\n"];
    }),
  ),
  [`${owner}/part.cjs`]: `exports.said = "made-up mark of ${owner}: part.cjs";\n`,
  [`${owner}/src/part.cjs`]: `exports.said = "made-up mark of ${owner}: src/part.cjs";\n`,
  [`${owner}/node_modules/tables/package.json`]: JSON.stringify({
    name: "tables",
    exports: { "./langs/*": "./data/*.json" },
  }),
  [`${owner}/node_modules/@acme/tables/package.json`]: JSON.stringify({ name: "@acme/tables", main: "data.json" }),
  [`${owner}/node_modules/@acme/app/package.json`]: JSON.stringify({ name: "@acme/app", main: "index.js" }),
  [`${owner}/node_modules/@acme/app/index.js`]: `module.exports = name => require("@acme/" + name);\n`,
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

const forms = { closed: [], withCodeFromDisk: ["--aot-allow-code-from-disk"] };
type Form = keyof typeof forms;
const builds = new Map<string, Promise<{ executable: string; said: string }>>();
function build(program: Program, form: Form = "closed") {
  const executable = join(directory, program, "bin", form + (isWindows ? ".exe" : ""));
  const start = async () => {
    const command = [bunExe(), "build", "--compile", "--aot", ...forms[form], "./main.cjs", "--outfile", executable];
    const { stderr, exitCode } = await run(command, join(directory, program, "tool"));
    expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    return { executable, said: stderr.replaceAll("\\", "/") };
  };
  if (!builds.has(executable)) builds.set(executable, start());
  return builds.get(executable)!;
}
const dataHeldBy = (executable: string) => {
  const bytes = readFileSync(executable);
  return data.filter(file => bytes.includes(`made-up mark of tool: ${file}`));
};
async function answersIn(program: Program, folder: string, command: string[]) {
  const { stdout } = await run([...command, "and catches"], join(directory, program, folder), bunEnv);
  return stdout.trim();
}
const plainAnswer = (program: Program, name: string) =>
  answersIn(program, "tool", [bunExe(), join(directory, program, "tool/main.cjs"), name]);

// Where code may come from disk, a require() made for a folder without code of the program is taken for one of a file from disk, which finds no file of the executable.
const formsThatAnswer = (program: Program) =>
  program === "a-folder-given-to-create-require" ? (["closed"] as const) : (["closed", "withCodeFromDisk"] as const);
test.failing(
  "a start that names a-folder-given-to-create-require, where code may come from disk: what is in the executable is found",
  async () => {
    const { executable } = await build("a-folder-given-to-create-require", "withCodeFromDisk");
    expect(await answersIn("a-folder-given-to-create-require", "empty", [executable, "en"])).toBe(
      "made-up mark of tool: locales/en.json",
    );
  },
  600_000,
);

test.each([
  [
    "a-folder",
    ["en", "en.json", "notes.txt"],
    ["locales/deploy.sh", "locales/en.json", "locales/guide.md", "locales/notes.txt", "locales/page.html"],
  ],
  ["a-pattern-of-exports", ["en"], ["node_modules/tables/data/en.json"]],
  ["the-start-of-the-name-of-a-file", ["en", "en.json"], ["lang-en.json"]],
  ["nothing-but-an-end", ["table", "locales/en"], ["lang-en.json", "locales/en.json", "table.json"]],
  ["nothing-but-a-type", ["table.json", "locales/en.json"], ["lang-en.json", "locales/en.json", "table.json"]],
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
    for (const form of formsThatAnswer(program)) {
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

test.each([
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
