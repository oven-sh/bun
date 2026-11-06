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

test.each([
  [
    "a-folder",
    ["en", "en.json", "notes.txt"],
    ["locales/deploy.sh", "locales/en.json", "locales/guide.md", "locales/notes.txt", "locales/page.html"],
  ],
  ["a-pattern-of-exports", ["en"], ["node_modules/tables/data/en.json"]],
  ["the-start-of-the-name-of-a-file", ["en", "en.json"], ["lang-en.json"]],
  ["nothing-but-an-end", ["table", "locales/en"], ["lang-en.json", "locales/en.json", "table.json"]],
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
