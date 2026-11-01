import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const look = `
import fs from "node:fs";
import path from "node:path";
const root = import.meta.dir;
async function seen(name) {
  const at = path.join(root, name);
  const tried = async read => { try { return String(await read()).trim(); } catch (error) { return error.code ?? error.name; } };
  return [
    name,
    await tried(() => fs.readFileSync(at, "utf8")),
    await tried(() => Bun.file(at).text()),
    await tried(() => fs.promises.readFile(at, "utf8")),
    fs.existsSync(at),
    await tried(() => (fs.statSync(at).isFile() ? "file" : "folder")),
    await tried(() => Bun.file(at).exists()),
  ].join(" ");
}
for (const name of process.argv.slice(2)) console.log(await seen(name));
`;

async function build(dir: string, aot: boolean, assets: string[]) {
  const outfile = aot ? "compiled.exe" : "bundled.exe";
  const flags = assets.flatMap(asset => ["--asset", asset]);
  const cmd = [
    bunExe(),
    "build",
    "--compile",
    ...(aot ? ["--aot"] : []),
    "./index.mjs",
    ...flags,
    "--outfile",
    outfile,
  ];
  const built = await run(cmd, dir, bunEnv);
  return { outfile: join(dir, outfile), exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" };
}

async function lines(dir: string, outfile: string, names: string[]) {
  const { stdout, stderr, exitCode } = await run([outfile, ...names], dir, bunEnv);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return stdout.trim().split("\n");
}

const found = (name: string, text: string) => `${name} ${text} ${text} ${text} true file true`;
const missing = (name: string) => `${name} ENOENT ENOENT ENOENT false ENOENT false`;

describe.concurrent("the names of a file given to --asset", () => {
  test("its base name and its path find the same bytes", async () => {
    using dir = tempDir("aot-asset-names-one", {
      "index.mjs": look,
      "a/config.json": "one",
      "deep/down/note.txt": "two",
    });
    const assets = ["./a/config.json", join(String(dir), "deep/down/note.txt")];
    const bundled = await build(String(dir), false, assets);
    const compiled = await build(String(dir), true, assets);
    expect([bundled.stderr, compiled.stderr]).toEqual(["", ""]);
    const byBaseName = [found("config.json", "one"), found("note.txt", "two")];
    expect(await lines(String(dir), bundled.outfile, ["config.json", "note.txt"])).toEqual(byBaseName);
    expect(await lines(String(dir), compiled.outfile, ["config.json", "note.txt"])).toEqual(byBaseName);
    expect(
      await lines(String(dir), compiled.outfile, ["a/config.json", "deep/down/note.txt", "down/note.txt"]),
    ).toEqual([found("a/config.json", "one"), found("deep/down/note.txt", "two"), missing("down/note.txt")]);
  }, 120_000);

  test("two files of one base name are found by their paths alone", async () => {
    using dir = tempDir("aot-asset-names-two", {
      "index.mjs": look,
      "a/config.json": "of a",
      "b/config.json": "of b",
    });
    const compiled = await build(String(dir), true, ["./a/config.json", "./b/config.json"]);
    expect(compiled.stderr).toBe("");
    expect(await lines(String(dir), compiled.outfile, ["a/config.json", "b/config.json", "config.json"])).toEqual([
      found("a/config.json", "of a"),
      found("b/config.json", "of b"),
      missing("config.json"),
    ]);
  }, 120_000);

  test("what lies at the root under that name stays what the name finds", async () => {
    using dir = tempDir("aot-asset-names-taken", {
      "index.mjs": `import { told } from "./told.mjs";\nvoid told;\n${look}`,
      "told.mjs": "export const told = 1;",
      "config.json": "at the root",
      "a/config.json": "below",
      "a/told.mjs": "no module",
      "a/data": "a file",
      "data/inside.txt": "in a folder",
    });
    const compiled = await build(String(dir), true, [
      "./a/config.json",
      "./config.json",
      "./a/told.mjs",
      "./a/data",
      "./data",
    ]);
    expect(compiled.stderr).toBe("");
    const names = ["config.json", "a/config.json", "a/told.mjs", "a/data", "data/inside.txt"];
    expect(await lines(String(dir), compiled.outfile, names)).toEqual([
      found("config.json", "at the root"),
      found("a/config.json", "below"),
      found("a/told.mjs", "no module"),
      found("a/data", "a file"),
      found("data/inside.txt", "in a folder"),
    ]);
    expect(await lines(String(dir), compiled.outfile, ["told.mjs", "data"])).toEqual([
      "told.mjs ENOENT ENOENT ENOENT true file false",
      "data EISDIR ENOENT EISDIR true folder false",
    ]);
  }, 120_000);

  test("the files of a folder have no second names", async () => {
    using dir = tempDir("aot-asset-names-folder", {
      "index.mjs": look,
      "dir/in.json": "in",
      "dir/sub/deep.json": "deep",
    });
    const compiled = await build(String(dir), true, ["./dir"]);
    expect(compiled.stderr).toBe("");
    expect(
      await lines(String(dir), compiled.outfile, ["dir/in.json", "dir/sub/deep.json", "in.json", "deep.json"]),
    ).toEqual([
      found("dir/in.json", "in"),
      found("dir/sub/deep.json", "deep"),
      missing("in.json"),
      missing("deep.json"),
    ]);
  }, 120_000);

  test("the second name is found and not listed", async () => {
    using dir = tempDir("aot-asset-names-listed", {
      "index.mjs": `
import fs from "node:fs";
console.log(fs.readdirSync(import.meta.dir).sort().join());
console.log(fs.readdirSync(import.meta.dir, { recursive: true }).filter(name => name.endsWith(".json")).sort().join());
console.log(Bun.embeddedFiles.map(file => file.name).sort().join());
console.log(fs.existsSync(import.meta.dir + "/config.json"), fs.readFileSync(import.meta.dir + "/config.json", "utf8"));
`,
      "a/config.json": `{ "n": 1 }`,
    });
    const compiled = await build(String(dir), true, ["./a/config.json"]);
    expect(compiled.stderr).toBe("");
    expect(await lines(String(dir), compiled.outfile, [])).toEqual([
      "a,index.mjs",
      "a/config.json",
      "a/config.json",
      `true { "n": 1 }`,
    ]);
  }, 120_000);
});
