import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { cpSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bothWays, bothWaysIn, plainAndBeside, run, say, warnings } from "./harness/embedded-files";
import { describe, test } from "./supported";

describe.concurrent("files that are embedded without --asset", () => {
  test("hidden files, lock files and folders that are no packages keep their warning", async () => {
    using dir = tempDir("aot-package-files-never-embedded", {
      "app/node_modules/tool/package.json": `{ "name": "tool", "main": "index.cjs" }`,
      "app/node_modules/tool/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.reads = {
  "a package's data": () => fs.readFileSync(path.join(__dirname, "data.txt"), "utf8"),
  "its hidden file": () => fs.readFileSync(path.join(__dirname, ".env"), "utf8"),
  "a file in its hidden folder": () => fs.readFileSync(path.join(__dirname, ".cache", "state.txt"), "utf8"),
  "its lock file": () => fs.readFileSync(path.join(__dirname, "package-lock.json"), "utf8"),
};
`,
      "app/node_modules/tool/data.txt": "data",
      "app/node_modules/tool/.env": "hidden",
      "app/node_modules/tool/.cache/state.txt": "state",
      "app/node_modules/tool/package-lock.json": "{}",
      "app/node_modules/loose.txt": "loose",
      "app/node_modules/.cache/tool/state.txt": "cached",
      "app/src/node_modules/config/secret.txt": "secret",
      "app/package.json": `{ "name": "server" }`,
      "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import tool from "tool";
${say}
const here = import.meta.dirname;
for (const [label, read] of Object.entries(tool.reads)) say(label, read);
say("a file directly in node_modules", () => fs.readFileSync(path.join(here, "node_modules/loose.txt"), "utf8"));
say("a hidden folder of node_modules", () => fs.readFileSync(path.join(here, "node_modules/.cache/tool/state.txt"), "utf8"));
say("a folder without a package.json", () => fs.readFileSync(path.join(here, "src/node_modules/config/secret.txt"), "utf8"));
`,
    });
    const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs");
    expect(plain.stdout).toBe(`a package's data data
its hidden file hidden
a file in its hidden folder state
its lock file {}
a file directly in node_modules loose
a hidden folder of node_modules cached
a folder without a package.json secret
`);
    expect(compiled).toEqual({
      stdout: `a package's data data
its hidden file ENOENT
a file in its hidden folder ENOENT
its lock file ENOENT
a file directly in node_modules ENOENT
a hidden folder of node_modules ENOENT
a folder without a package.json ENOENT
`,
      stderr: "",
      exitCode: 0,
    });
    expect(warnings(built)).toEqual([
      "warn TS100098 node_modules/.cache/tool/state.txt",
      "warn TS100098 node_modules/loose.txt",
      "warn TS100098 node_modules/tool/.cache/state.txt",
      "warn TS100098 node_modules/tool/.env",
      "warn TS100098 node_modules/tool/package-lock.json",
      "warn TS100098 src/node_modules/config/secret.txt",
    ]);
  }, 120_000);

  const searchers = {
    "app/node_modules/climber/package.json": `{ "name": "climber", "version": "3.1.4", "type": "module", "exports": "./lib/deep/index.js" }`,
    "app/node_modules/climber/lib/deep/index.js": `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
export function version() {
  let folder = path.dirname(fileURLToPath(import.meta.url));
  for (let steps = 0; steps < 8 && !fs.existsSync(path.join(folder, "package.json")); steps++) folder = path.dirname(folder);
  return JSON.parse(fs.readFileSync(path.join(folder, "package.json"), "utf8")).version;
}
`,
    "app/node_modules/layered/package.json": `{ "name": "layered", "version": "2.0.0", "exports": "./dist/esm/index.js" }`,
    "app/node_modules/layered/dist/esm/package.json": `{ "type": "module" }`,
    "app/node_modules/layered/dist/esm/index.js": `import fs from "node:fs";
export const list = folder => fs.readdirSync(folder);
`,
    "app/node_modules/@scope/lister/package.json": `{ "name": "@scope/lister", "version": "5.5.5", "main": "index.cjs" }`,
    "app/node_modules/@scope/lister/index.cjs": `exports.stat = name => require("node:fs/promises").stat(name);
`,
    "app/node_modules/named/package.json": `{ "name": "named", "version": "4.4.4", "type": "module", "exports": "./lib/index.js" }`,
    "app/node_modules/named/lib/index.js": `import fs from "node:fs";
import path from "node:path";
export const read = name => fs.readFileSync(path.join(import.meta.dirname, "..", name), "utf8");
`,
    "app/node_modules/quiet/package.json": `{ "name": "quiet", "version": "9.9.9", "type": "module", "exports": "./index.js" }`,
    "app/node_modules/quiet/index.js": `import fs from "node:fs";
export const isMarked = () => fs.existsSync("/.made-up-marker");
`,
    "app/package.json": `{ "name": "server", "version": "7.8.9" }`,
    "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import { version } from "climber";
import { list } from "layered";
import lister from "@scope/lister";
import { read } from "named";
import { isMarked } from "quiet";
${say}
// The build cannot see these names, so they are no reads that it knows.
const made = (...names) => path.join(import.meta.dirname, ...names.map(name => Buffer.from(name).toString()));
const versionAt = (...names) => JSON.parse(fs.readFileSync(made(...names, "package.json"), "utf8")).version;
say("a package that climbs to its manifest", () => version());
say("at the root of a package that lists folders", () => versionAt("node_modules", "layered"));
say("beside its code", () => fs.existsSync(made("node_modules", "layered", "dist", "esm", "package.json")));
say("a scoped package that queries files", () => versionAt("node_modules", "@scope", "lister"));
say("a known folder with an unknown name", () => JSON.parse(read(Buffer.from("package.json").toString())).version);
say("a package that asks about a known path elsewhere", () => versionAt("node_modules", "quiet"));
say("the program's own", () => versionAt());
say("they are used", () => [typeof list, typeof lister.stat, isMarked()].join());
say("Bun.embeddedFiles", () => Bun.embeddedFiles.map(it => it.name).sort().join());
`,
  };

  test("the package.json of a package whose code reads paths that the build cannot know", async () => {
    using dir = tempDir("aot-package-json-of-searching-packages", searchers);
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
    const embedded = `a package that climbs to its manifest 3.1.4
at the root of a package that lists folders 2.0.0
beside its code true
a scoped package that queries files 5.5.5
a known folder with an unknown name 4.4.4
`;
    const used = `they are used function,function,false\nBun.embeddedFiles \n`;
    expect(plain.stdout).toBe(
      `${embedded}a package that asks about a known path elsewhere 9.9.9\nthe program's own 7.8.9\n${used}`,
    );
    expect(compiled).toEqual({
      stdout: `${embedded}a package that asks about a known path elsewhere ENOENT\nthe program's own ENOENT\n${used}`,
      stderr: "",
      exitCode: 0,
    });
    expect(warnings(built)).toEqual([]);
  }, 120_000);

  test("--explain lists each such package.json once", async () => {
    using dir = tempDir("aot-package-json-files-listed", searchers);
    const { built } = await bothWaysIn(String(dir), "app", "./main.mjs", "--explain");
    expect(warnings(built).filter(it => it.includes("TS100170"))).toEqual([
      "note TS100170 node_modules/@scope/lister/package.json",
      "note TS100170 node_modules/climber/package.json",
      "note TS100170 node_modules/layered/dist/esm/package.json",
      "note TS100170 node_modules/layered/package.json",
      "note TS100170 node_modules/named/package.json",
    ]);
  }, 120_000);

  const helper = {
    "app/package.json": `{ "name": "application" }`,
    "app/node_modules/helper/package.json": `{ "name": "helper", "main": "index.cjs" }`,
    "app/node_modules/helper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.findName = folder => {
  for (let steps = 0; steps < 8; steps++, folder = path.dirname(folder)) {
    const candidate = path.join(folder, "package.json");
    if (fs.existsSync(candidate)) return JSON.parse(fs.readFileSync(candidate, "utf8")).name;
  }
  return "none";
};
`,
  };
  const asksHelper = `exports.ownName = () => require("helper").findName(__dirname);
`;
  const readsOwnName = `import fs from "node:fs";
import path from "node:path";
${say}
say("the program's own", () => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "package.json"), "utf8")).name);
`;

  test("a search for the nearest package.json finds the same one as in plain Bun", async () => {
    using dir = tempDir("aot-nearest-package-json", {
      ...helper,
      "app/node_modules/asker/package.json": `{ "name": "asker", "main": "index.cjs" }`,
      "app/node_modules/asker/index.cjs": asksHelper,
      "app/node_modules/outer/package.json": `{ "name": "outer", "main": "index.cjs" }`,
      "app/node_modules/outer/index.cjs": `exports.has = name => require("node:fs").existsSync(name);
exports.names = () => [require("inner").ownName(), require("./vendor/lib/index.cjs").ownName()].join();
`,
      "app/node_modules/outer/node_modules/inner/package.json": `{ "name": "inner", "main": "index.cjs" }`,
      "app/node_modules/outer/node_modules/inner/index.cjs": asksHelper,
      "app/node_modules/outer/vendor/lib/package.json": `{ "name": "vendored" }`,
      "app/node_modules/outer/vendor/lib/index.cjs": asksHelper,
      "app/main.mjs": `${readsOwnName}import asker from "asker";
import outer from "outer";
say("a package below the program", asker.ownName);
say("a package and a folder below a package that searches", outer.names);
say("that package searches", () => outer.has("/.made-up-marker"));
`,
    });
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs", "--explain");
    expect(plain.stdout).toBe(
      `the program's own application\na package below the program asker\na package and a folder below a package that searches inner,vendored\nthat package searches false\n`,
    );
    expect(compiled).toEqual(plain);
    expect(warnings(built).filter(it => /TS100166|TS10017\d/.test(it))).toEqual([
      "note TS100166 package.json",
      "note TS100170 node_modules/asker/package.json",
      "note TS100170 node_modules/helper/package.json",
      "note TS100170 node_modules/outer/node_modules/inner/package.json",
      "note TS100170 node_modules/outer/package.json",
      "note TS100170 node_modules/outer/vendor/lib/package.json",
    ]);
  }, 120_000);

  test.skipIf(isWindows).each([[[]], [["--asset", "../../packages/reads/package.json"]]])(
    "a workspace package that is linked in from beside the project reads a file beside its code %j",
    async flags => {
      using dir = tempDir("aot-linked-workspace-package-reads", {
        "app/package.json": `{ "name": "repository" }`,
        "app/apps/web/package.json": `{ "name": "web" }`,
        "app/apps/web/main.mjs": `import reads from "reads";
${say}
say("a read beside the package's code", reads.ownName);
`,
        "app/packages/reads/package.json": `{ "name": "reads", "main": "index.cjs" }`,
        "app/packages/reads/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.ownName = () => JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).name;
`,
      });
      mkdirSync(join(String(dir), "app/apps/web/node_modules"));
      symlinkSync("../../../packages/reads", join(String(dir), "app/apps/web/node_modules/reads"));
      const { plain, built, compiled } = await bothWaysIn(String(dir), "app/apps/web", "./main.mjs", ...flags);
      expect(plain.stdout).toBe(`a read beside the package's code reads\n`);
      expect(compiled.stdout).toBe(`a read beside the package's code ${flags.length ? "reads" : "ENOENT"}\n`);
      expect(warnings(built)).toEqual(flags.length ? [] : ["warn TS100098 ../../packages/reads/package.json"]);
    },
    120_000,
  );

  test("a listing of a folder that stands on the disk holds the disk's names alone", async () => {
    using dir = tempDir("aot-listing-beside-sources", {
      "app/logo.txt": "the logo",
      "app/note.txt": "a note",
      "app/gone.txt": "gone",
      "app/sub/other.txt": "other",
      "app/main.mjs": `import logo from "./logo.txt" with { type: "file" };
import fs from "node:fs";
import path from "node:path";
const opened = async folder => {
  const names = [];
  for await (const entry of fs.opendirSync(folder)) names.push(entry.name);
  return names;
};
const list = async folder => {
  const said = [
    fs.readdirSync(folder),
    fs.readdirSync(Buffer.from(folder)),
    fs.readdirSync(folder, { withFileTypes: true }).map(it => it.name),
    await fs.promises.readdir(folder),
    await opened(folder),
  ];
  const below = fs.readdirSync(folder, { recursive: true }).map(it => it.replaceAll("\\\\", "/"));
  console.log([...new Set(said.map(it => it.sort().join(" ")))].join(" | "), "below", below.sort().join(" "));
};
console.log(typeof logo, fs.readFileSync(path.join(__dirname, "note.txt"), "utf8"));
if (process.argv.includes("away")) {
  fs.mkdirSync(__dirname, { recursive: true });
  fs.writeFileSync(path.join(__dirname, "written.txt"), "written");
}
await list(__dirname);
process.chdir(__dirname);
await list(".");
`,
    });
    const [app, outfile] = [join(String(dir), "app"), join(String(dir), "built.exe")];
    const assets = ["--asset", "./note.txt", "--asset", "./gone.txt"];
    const command = [bunExe(), "build", "--compile", "--aot", "./main.mjs", ...assets, "--outfile", outfile];
    const built = await run(app, command);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    rmSync(join(app, "gone.txt"));
    const plain = await run(app, [bunExe(), "run", "./main.mjs"]);
    const listed = "logo.txt main.mjs note.txt sub below logo.txt main.mjs note.txt sub sub/other.txt";
    expect(plain).toEqual({ stdout: `string a note\n${listed}\n${listed}\n`, stderr: "", exitCode: 0 });
    const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
    expect(await run(String(dir), [outfile], env)).toEqual(plain);
    renameSync(app, join(String(dir), "moved-away"));
    // The program makes the folder where the sources are not there.
    const made = "written.txt below written.txt";
    const stdout = `string a note\n${made}\n${made}\n`;
    expect(await run(String(dir), [outfile, "away"], env)).toEqual({ stdout, stderr: "", exitCode: 0 });
  }, 120_000);

  test("a write that fails leaves what is embedded as it is, in a folder that is on the disk without the sources", async () => {
    using dir = tempDir("aot-writes-that-fail", {
      "app/main.mjs": `import { start } from "store"; await start();`,
      "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
      "app/node_modules/store/below.cjs": `exports.below = name => require("node:path").join(__dirname, "data", name);`,
      "app/node_modules/store/index.mjs": `import fs from "node:fs";
import path from "node:path";
import { $ } from "bun";
import { below } from "./below.cjs";
const own = name => path.join(import.meta.dirname, "data", name);
const read = name => fs.readFileSync(own(name), "utf8") + " " + fs.readFileSync(below(name), "utf8");
const say = async (label, change, name) => {
  let said = "done";
  try { const done = await change(); if (done?.exitCode) said = "fails"; } catch (error) { said = error.code; }
  console.log(label, said, name ? read(name) : "");
};
export const start = async () => {
  for (const name of ["a", "b", "c", "d", "e"]) fs.readFileSync(own(name + ".txt"));
  fs.readFileSync(own("deep/f.txt"));
  const opened = fs.openSync(own("a.txt")), missing = below("missing.txt");
  await say("a copy of nothing", () => fs.copyFileSync(missing, below("a.txt")), "a.txt");
  await say("a later copy of nothing", () => fs.promises.copyFile(missing, below("a.txt")), "a.txt");
  await say("Bun.write() of nothing", () => Bun.write(below("a.txt"), Bun.file(missing)), "a.txt");
  console.log("what is open", fs.readFileSync(opened, "utf8"));
  fs.closeSync(opened);
  // Somebody else has laid it there.
  await say("nothing over another's", () => Bun.write(below("laid.txt"), Bun.file(missing)));
  console.log("another's", fs.readFileSync(own("laid.txt"), "utf8"));
  await say("wx", () => fs.closeSync(fs.openSync(below("b.txt"), "wx")), "b.txt");
  await say("a copy that must make it", () => fs.copyFileSync(below("c.txt"), below("b.txt"), fs.constants.COPYFILE_EXCL), "b.txt");
  await say("mkdir", () => fs.mkdirSync(below("b.txt")), "b.txt");
  await say("mkdir below it", () => fs.mkdirSync(below("b.txt") + "/x", { recursive: true }), "b.txt");
  await say("symlink", () => fs.symlinkSync("c.txt", below("b.txt")), "b.txt");
  await say("an append that must make it", () => fs.appendFileSync(below("b.txt"), "x", { flag: "ax" }), "b.txt");
  await say("a write onto a folder", () => fs.writeFileSync(below("deep"), "x"), "deep/f.txt");
  await say("an append onto a folder", () => fs.appendFileSync(below("deep"), "x"), "deep/f.txt");
  await say("Bun.write() onto a folder", () => Bun.write(below("deep"), "x"), "deep/f.txt");
  await say("a writer onto a folder", () => Bun.file(path.join(below("deep"))).writer().end(), "deep/f.txt");
  await say("> onto a folder", () => $\`echo x > \${below("deep")}\`.nothrow().quiet(), "deep/f.txt");
  fs.mkdirSync(below("made"));
  await say("a rename over a folder", () => fs.renameSync(below("made"), below("deep")), "deep/f.txt");
  await say("mv over a folder", () => $\`mv \${below("made")} \${below("deep")}\`.nothrow().quiet(), "deep/f.txt");
  await say("rm -f of a folder", () => $\`rm -f \${below("deep")}\`.nothrow().quiet(), "deep/f.txt");
  await say("touch", () => $\`touch \${below("d.txt")}\`.nothrow().quiet(), "d.txt");
  await say("a write", () => fs.writeFileSync(below("e.txt"), "new"), "e.txt");
};
`,
      ...Object.fromEntries(
        ["a", "b", "c", "d", "e", "laid", "deep/f"].map(name => [`app/node_modules/store/data/${name}.txt`, "first"]),
      ),
    });
    const [app, outfile] = [join(String(dir), "app"), join(String(dir), "built.exe")];
    const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    renameSync(app, join(String(dir), "moved-away"));
    mkdirSync(join(app, "node_modules/store/data"), { recursive: true });
    writeFileSync(join(app, "node_modules/store/data/laid.txt"), "laid");
    expect(await run(String(dir), [outfile], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual({
      stdout: `a copy of nothing ENOENT first first
a later copy of nothing ENOENT first first
Bun.write() of nothing ENOENT first first
what is open first
nothing over another's ENOENT${" "}
another's first
wx EEXIST first first
a copy that must make it EEXIST first first
mkdir EEXIST first first
mkdir below it ENOTDIR first first
symlink EEXIST first first
an append that must make it EEXIST first first
a write onto a folder EISDIR first first
an append onto a folder EISDIR first first
Bun.write() onto a folder EISDIR first first
a writer onto a folder EISDIR first first
> onto a folder fails first first
a rename over a folder ENOTEMPTY first first
mv over a folder fails first first
rm -f of a folder fails first first
touch done first first
a write done new new
`,
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test("what the shell's mv moves is gone and what it leaves is there, also where it fails part-way", async () => {
    const names = ["a", "b", "c", "d", "e", "f"];
    using dir = tempDir("aot-mv-leaves-some", {
      "app/main.mjs": `import { start } from "store"; console.log(await start());`,
      "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
      "app/node_modules/store/below.cjs": `exports.below = name => require("node:path").join(__dirname, "data", name);`,
      "app/node_modules/store/index.mjs": `import fs from "node:fs";
import path from "node:path";
import { $ } from "bun";
import { below } from "./below.cjs";
const own = name => path.join(import.meta.dirname, "data", name);
const text = file => { try { return fs.readFileSync(file, "utf8"); } catch (error) { return error.code; } };
const said = [];
const say = async (label, command, ...names) => {
  const { exitCode } = await command.nothrow().quiet();
  said.push([label, exitCode === 0, ...names.map(name => text(own(name)) + "/" + text(below(name)))].join(" "));
};
export const start = async () => {
  for (const name of ["a", "b", "c", "d", "e", "f"]) fs.readFileSync(own(name + ".txt"));
  fs.mkdirSync(below("into"));
  fs.writeFileSync(below("into/e.txt"), "there");
  await say("one under -n", $\`mv -n \${below("a.txt")} \${below("b.txt")}\`, "a.txt", "b.txt");
  await say("part-way", $\`mv \${below("c.txt")} \${below("missing.txt")} \${below("d.txt")} \${below("into")}\`, "c.txt", "d.txt");
  await say("some under -n", $\`mv -n \${below("e.txt")} \${below("f.txt")} \${below("into")}\`, "e.txt", "f.txt");
  said.push(fs.readdirSync(below("into")).sort().join());
  return said.join("\\n");
};
`,
      ...Object.fromEntries(names.map(name => [`app/node_modules/store/data/${name}.txt`, name])),
    });
    const { plain, compiled } = await plainAndBeside(String(dir));
    expect(plain).toEqual({
      stdout: `one under -n true a/a b/b
part-way false ENOENT/ENOENT d/d
some under -n true e/e ENOENT/ENOENT
c.txt,e.txt,f.txt
`,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.each(["beside its sources", "where its files are gone"])(
    "a package reads what other threads have copied and written, %s",
    async place => {
      const rows = ["copied", "called back", "cp", "written", "opened", "shell", "folder/shell", "folder/deep/shell"];
      const some = ["a", "b", "c", "d", "e", "f", "g", "h"].map(name => `some/${name}`);
      using dir = tempDir("aot-writes-of-other-threads", {
        "app/main.mjs": `import { start } from "store"; console.log(await start());`,
        "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
        "app/node_modules/store/below.cjs": `exports.below = name => require("node:path").join(__dirname, "data", name);`,
        "app/node_modules/store/index.mjs": `import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { $ } from "bun";
import { below } from "./below.cjs";
const own = name => path.join(import.meta.dirname, "data", name);
const from = fs.mkdtempSync(path.join(os.tmpdir(), "copied-from-"));
const said = [];
const say = async (write, ...names) => {
  const opened = names.map(name => fs.openSync(own(name)));
  for (const name of names) {
    fs.mkdirSync(path.dirname(path.join(from, name)), { recursive: true });
    fs.writeFileSync(path.join(from, name), "new");
  }
  await write(path.join(from, names[0]), below(names[0]));
  for (const [index, name] of names.entries()) {
    // On Windows a file that was opened keeps its bytes.
    const kept = process.platform === "win32" ? "new" : fs.readFileSync(opened[index], "utf8");
    said.push([name, fs.readFileSync(own(name), "utf8"), kept].join(" "));
    fs.closeSync(opened[index]);
  }
};
export const start = async () => {
  try {
    await say((source, target) => fs.promises.copyFile(source, target), "copied");
    await say((source, target) => new Promise(done => fs.copyFile(source, target, done)), "called back");
    await say((source, target) => fs.promises.cp(source, target), "cp");
    await say((source, target) => fs.promises.writeFile(target, "new"), "written");
    await say(async (source, target) => {
      const handle = await fs.promises.open(target, "w");
      await handle.writeFile("new");
      await handle.close();
    }, "opened");
    await say((source, target) => $\`cp \${source} \${target}\`, "shell");
    await say(() => $\`cp -R \${path.join(from, "folder")} \${below("")}\`, "folder/shell", "folder/deep/shell");
    const some = ["a", "b", "c", "d", "e", "f", "g", "h"].map(name => "some/" + name);
    fs.mkdirSync(path.join(from, "some"));
    for (const name of [...some, "some/folder"]) fs.writeFileSync(path.join(from, name), "new");
    fs.mkdirSync(below("some/folder"));
    const { exitCode } = await $\`cp -R \${path.join(from, "some")} \${below("")}\`.nothrow().quiet();
    said.push("laid " + fs.readFileSync(own("folder/laid"), "utf8"));
    const isSame = name => fs.readFileSync(own(name), "utf8") === fs.readFileSync(below(name), "utf8");
    said.push("some " + (exitCode !== 0) + " " + some.every(isSame));
  } finally {
    fs.rmSync(from, { recursive: true });
  }
  return said.join("\\n");
};
`,
        ...Object.fromEntries(
          [...rows, ...some, "folder/laid"].map(name => [`app/node_modules/store/data/${name}`, "first"]),
        ),
      });
      const [app, copy, outfile] = ["app", "copy", "built.exe"].map(it => join(String(dir), it));
      cpSync(app, copy, { recursive: true });
      const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", outfile]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      if (place !== "beside its sources") {
        renameSync(app, join(String(dir), "moved-away"));
        for (const folder of ["folder/deep", "some"]) {
          mkdirSync(join(app, "node_modules/store/data", folder), { recursive: true });
        }
      }
      // The program has not written this one, so it is not trusted.
      writeFileSync(join(app, "node_modules/store/data/folder/laid"), "laid");
      const env = { ...bunEnv, BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS: "1" };
      const plain = await run(copy, [bunExe(), "run", "./main.mjs"], env);
      const compiled = await run(String(dir), [outfile], { ...env, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      const stdout = [...rows.map(name => `${name} new new`), "laid first", "some true true", ""].join("\n");
      expect(plain).toEqual({ stdout, stderr: "", exitCode: 0 });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  // On Windows a file that was opened keeps its bytes.
  test.skipIf(isWindows)(
    "what a package has open follows the writes of a Worker and of other threads",
    async () => {
      using dir = tempDir("aot-descriptors-of-threads", {
        "app/main.mjs": `import { start } from "store";
const workers = ["one", "two", "three"].map(() => new Worker(new URL("./worker.mjs", import.meta.url).href));
const ask = (index, request) => new Promise((done, fail) => {
  workers[index].onmessage = event => done(event.data);
  workers[index].onerror = event => fail(event.message);
  workers[index].postMessage(request);
});
console.log(await start(ask, index => workers[index].terminate()));
for (const worker of workers) worker.terminate();
`,
        "app/worker.mjs": `import fs from "node:fs";
import { below, openForWorker } from "store";
self.onmessage = ({ data: { opens, writes, removes, moves } }) => {
  if (writes) fs.writeFileSync(below(writes), "new");
  if (removes) fs.unlinkSync(below(removes));
  if (moves) fs.renameSync(below(moves), below(moves + ".moved"));
  self.postMessage(opens ? openForWorker(opens) : "done");
};
`,
        "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
        "app/node_modules/store/below.cjs": `exports.below = name => require("node:path").join(__dirname, "data", name);`,
        "app/node_modules/store/index.mjs": `import fs from "node:fs";
import path from "node:path";
export { below } from "./below.cjs";
import { below } from "./below.cjs";
const own = name => path.join(import.meta.dirname, "data", name);
export const openForWorker = name => fs.openSync(own(name));
export const start = async (ask, terminate) => {
  const said = [], read = descriptor => fs.readFileSync(descriptor, "utf8");
  for (const name of ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"]) fs.readFileSync(own(name));
  // Each is the first that this thread does with its descriptor, or at all, behind the write.
  const [a, b, c, d, e, f] = ["a", "b", "c", "d", "e", "f"].map(name => fs.openSync(own(name)));
  await ask(0, { writes: "a" });
  said.push("Bun.file " + (await Bun.file(a).text()));
  await ask(0, { writes: "b" });
  said.push("a child " + Bun.spawnSync({ cmd: ["cat"], stdin: b }).stdout);
  await ask(0, { writes: "c", removes: "c" });
  said.push("removed " + read(c));
  await ask(0, { writes: "d", moves: "d" });
  said.push("moved " + read(d));
  const part = Buffer.alloc(1);
  fs.readSync(e, part);
  await ask(0, { writes: "e" });
  said.push("begun " + part + read(e));
  const handed = await ask(0, { opens: "g" });
  fs.writeFileSync(below("g"), "new");
  said.push("opened by a Worker " + read(handed));
  const other = await ask(0, { opens: "h" });
  await ask(1, { writes: "h" });
  said.push("opened by a Worker, written by another " + read(other));
  const left = await ask(2, { opens: "i" });
  terminate(2);
  fs.writeFileSync(below("i"), "new");
  said.push("opened by a Worker that has ended " + read(left));
  const handle = await fs.promises.open(own("j"));
  await ask(0, { writes: "j" });
  said.push("a handle " + (await handle.readFile("utf8")));
  await handle.close();
  const written = fs.promises.writeFile(below("f"), "new");
  for (let seen, start = Date.now(); (seen = fs.readFileSync(below("f"), "utf8")) !== "new"; ) {
    if (Date.now() - start > 30_000) throw new Error("the write that is not awaited: " + JSON.stringify(seen));
  }
  said.push("not awaited " + read(f));
  await written;
  return said.join("\\n");
};
`,
        ...Object.fromEntries([..."abcdefghij"].map(name => [`app/node_modules/store/data/${name}`, "first"])),
      });
      const { plain, compiled } = await plainAndBeside(String(dir));
      expect(plain).toEqual({
        stdout: [
          "Bun.file new",
          "a child new",
          "removed new",
          "moved new",
          "begun few",
          "opened by a Worker new",
          "opened by a Worker, written by another new",
          "opened by a Worker that has ended new",
          "a handle new",
          "not awaited new",
          "",
        ].join("\n"),
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("a failed mv leaves what the disk does not have", async () => {
    using dir = tempDir("aot-mv-of-embedded-file", {
      "app/main.mjs": `import { start } from "store"; console.log(await start());`,
      "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.cjs" }`,
      "app/node_modules/store/index.cjs": `const fs = require("node:fs"), path = require("node:path");
const at = name => path.join(__dirname, "data", name);
exports.start = async () => {
  for (const name of ["a", "b"]) fs.readFileSync(path.join(__dirname, "data", name + ".txt"));
  fs.mkdirSync(at("into"), { recursive: true });
  const { exitCode } = await Bun.$\`mv \${at("a.txt")} \${at("b.txt")} \${at("into")}\`.nothrow().quiet();
  return [exitCode === 0, fs.readFileSync(at("a.txt"), "utf8"), fs.readFileSync(at("b.txt"), "utf8")].join();
};
`,
      "app/node_modules/store/data/a.txt": "a",
      "app/node_modules/store/data/b.txt": "b",
    });
    const [app, outfile] = [join(String(dir), "app"), join(String(dir), "built.exe")];
    const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    renameSync(app, join(String(dir), "moved-away"));
    const compiled = await run(String(dir), [outfile], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(compiled).toEqual({ stdout: "false,a,b\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test("what a package removes or renames beside itself is gone for it, where the executable runs beside its sources", async () => {
    const at = (name: string) => `path.join(__dirname, ${JSON.stringify(name)})`;
    const ways = [
      ["rmSync", "a.txt", `fs.rmSync(${at("a.txt")})`],
      ["unlinkSync", "b.txt", `fs.unlinkSync(${at("b.txt")})`],
      ["renameSync", "c.txt", `fs.renameSync(${at("c.txt")}, ${at("c.old")})`],
      ["promises.rm", "d.txt", `fs.promises.rm(${at("d.txt")})`],
      ["Bun.file().delete()", "e.txt", `Bun.file(${at("e.txt")}).delete()`],
      ["rmSync of its folder", "cache/f.txt", `fs.rmSync(${at("cache")}, { recursive: true })`],
      ["rmSync and a write", "g.txt", `(fs.rmSync(${at("g.txt")}), fs.writeFileSync(${at("g.txt")}, "written"))`],
      ["nothing", "h.txt", `undefined`],
    ];
    using dir = tempDir("aot-package-removes-its-file", {
      "app/package.json": `{ "name": "server" }`,
      "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
      "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
      "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = async () => {
${ways
  .map(
    ([label, name, change]) => `  say(${JSON.stringify(label)}, () => fs.readFileSync(${at(name)}, "utf8"));
  await ${change};
  say(${JSON.stringify(label)}, () => fs.readFileSync(${at(name)}, "utf8") + " " + fs.existsSync(${at(name)}));`,
  )
  .join("\n")}
};
`,
      ...Object.fromEntries(ways.map(([, name]) => [`app/node_modules/keeper/${name}`, "first"])),
    });
    const cwd = join(String(dir), "app");
    const built = await run(cwd, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "../built.exe"]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    const after = (label: string) =>
      ({ "rmSync and a write": "written true", nothing: "first true" })[label] ?? "ENOENT";
    expect(compiled).toEqual({
      stdout: ways.map(([label]) => `${label} first\n${label} ${after(label)}\n`).join(""),
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test.skipIf(isWindows)(
    "a file that nobody named is gone where something else removed it beside the sources",
    async () => {
      const at = (name: string) => `path.join(__dirname, ${JSON.stringify(name)})`;
      using dir = tempDir("aot-unnamed-file-removed-by-others", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
keeper.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = () => {
  say("a child process", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  require("node:child_process").execFileSync("rm", [${at("a.txt")}]);
  say("a child process", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  say("through a link", () => fs.readFileSync(${at("b.txt")}, "utf8"));
  fs.symlinkSync(__dirname, __dirname + "-linked");
  fs.unlinkSync(__dirname + "-linked/b.txt");
  say("through a link", () => fs.readFileSync(${at("b.txt")}, "utf8") + " " + fs.existsSync(${at("b.txt")}));
  say("named by --asset", () => fs.readFileSync(${at("c.txt")}, "utf8"));
  require("node:child_process").execFileSync("rm", [${at("c.txt")}]);
  say("named by --asset", () => fs.readFileSync(${at("c.txt")}, "utf8"));
};
`,
        "app/node_modules/keeper/a.txt": "first",
        "app/node_modules/keeper/b.txt": "first",
        "app/node_modules/keeper/c.txt": "first",
      });
      const cwd = join(String(dir), "app");
      const asset = ["--asset", "node_modules/keeper/c.txt"];
      const built = await run(cwd, [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "./main.mjs",
        ...asset,
        "--outfile",
        "../built.exe",
      ]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout: `a child process first
a child process ENOENT
through a link first
through a link ENOENT
named by --asset first
named by --asset first
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test("a package hands its folder to another that asks for several names", async () => {
    using dir = tempDir("aot-names-asked-in-folder", {
      "app/main.mjs": `import pkg from "pkg";
pkg.run();
`,
      "app/node_modules/finder/package.json": `{ "name": "finder", "main": "index.js" }`,
      "app/node_modules/finder/index.js": `module.exports = require("./find");`,
      "app/node_modules/finder/find.js": `const fs = require("node:fs"), path = require("node:path");
exports.find = folder => {
  for (const name of ["settings.json5", "package.json5", "package.json"]) {
    const file = path.join(folder, name);
    if (fs.existsSync(file)) return name + " " + fs.readFileSync(file, "utf8").length;
  }
  return "nothing";
};
`,
      "app/node_modules/pkg/package.json": `{ "name": "pkg", "main": "lib/index.js" }`,
      "app/node_modules/pkg/package.json5": `{ name: "pkg", json5: true }`,
      "app/node_modules/pkg/lib/index.js": `const finder = require("finder"), path = require("node:path");
exports.run = () => console.log(finder.find(path.dirname(__dirname)), finder.find(__dirname));
`,
    });
    const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs");
    expect(plain.stdout).toBe("package.json5 28 nothing\n");
    expect(warnings(built)).toEqual([]);
    expect(compiled).toEqual({ stdout: "package.json5 28 nothing\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test.skipIf(isWindows)(
    "a folder that nobody named is gone where a child process removed it beside the sources",
    async () => {
      const at = (name: string) => `path.join(__dirname, ${JSON.stringify(name)})`;
      using dir = tempDir("aot-unnamed-folder-removed-by-child", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
import own from "own";
keeper.run();
own.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process");
${say}
exports.run = () => {
  const tell = label => say(label, () => fs.readFileSync(${at("data/a.txt")}, "utf8"));
  tell("a folder");
  execFileSync("rm", ["-r", ${at("data")}]);
  tell("a folder");
  say("itself", () => fs.existsSync(${at("data")}) + " " + fs.readdirSync(__dirname).includes("data"));
  say("made again", () => {
    fs.mkdirSync(${at("data")});
    return fs.readdirSync(${at("data")}).length;
  });
  say("named by --asset", () => fs.readFileSync(${at("assets/c.txt")}, "utf8"));
  execFileSync("rm", ["-r", ${at("assets")}]);
  say("named by --asset", () => fs.readFileSync(${at("assets/c.txt")}, "utf8") + " " + fs.existsSync(${at("assets")}));
};
`,
        "app/node_modules/keeper/data/a.txt": "first",
        "app/node_modules/keeper/assets/c.txt": "first",
        "app/node_modules/own/package.json": `{ "name": "own", "main": "index.cjs" }`,
        "app/node_modules/own/index.cjs": `const fs = require("node:fs"), path = require("node:path"), { execFileSync } = require("node:child_process");
${say}
exports.run = () => {
  const tell = label => {
    say(label + " file", () => fs.readFileSync(${at("a.txt")}, "utf8"));
    say(label + " folder", () => fs.statSync(__dirname).isDirectory());
    say(label + " code", () => fs.existsSync(__filename));
  };
  tell("before");
  execFileSync("rm", ["-r", __dirname]);
  tell("after");
};
`,
        "app/node_modules/own/a.txt": "first",
      });
      const cwd = join(String(dir), "app");
      const asset = ["--asset", "node_modules/keeper/assets/c.txt"];
      const built = await run(cwd, [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "./main.mjs",
        ...asset,
        "--outfile",
        "../built.exe",
      ]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout: `a folder first
a folder ENOENT
itself false false
made again 0
named by --asset first
named by --asset first true
before file first
before folder true
before code true
after file ENOENT
after folder ENOENT
after code false
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test("a container that has the folder of the build with the executable alone in it finds what was embedded", async () => {
    using dir = tempDir("aot-executable-alone-in-build-folder", {
      "app/package.json": `{ "name": "server", "version": "1.2.3" }`,
      "app/main.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
say("beside the entry point", () => JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version);
say("from a folder below", () => require("./lib/version.cjs"));
`,
      "app/lib/version.cjs": `module.exports = JSON.parse(require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "package.json"), "utf8")).version;
`,
    });
    const cwd = join(String(dir), "app");
    const built = await run(cwd, [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", "../built.exe"]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    renameSync(cwd, join(String(dir), "away"));
    // As a second build stage does: the same folder, a folder of packages for native addons, and the executable.
    mkdirSync(join(cwd, "node_modules"), { recursive: true });
    renameSync(join(String(dir), "built.exe"), join(cwd, "built.exe"));
    const compiled = await run(cwd, ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(compiled).toEqual({
      stdout: "beside the entry point 1.2.3\nfrom a folder below 1.2.3\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test.each([
    [[]],
    [
      [
        "--asset",
        "node_modules/keeper/a.txt",
        "--asset",
        "node_modules/keeper/b.txt",
        "--asset",
        "node_modules/keeper/cache",
      ],
    ],
  ])(
    "what the shell's own rm and mv take away is gone for the program %j",
    async flags => {
      const at = (name: string) => `path.join(__dirname, ${JSON.stringify(name)})`;
      using dir = tempDir("aot-shell-removes-embedded-file", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = async () => {
  say("rm", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  await Bun.$\`rm \${${at("a.txt")}}\`;
  say("rm", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  say("mv of a relative path", () => fs.readFileSync(${at("b.txt")}, "utf8"));
  await Bun.$\`mv b.txt b.old\`.cwd(__dirname);
  say("mv of a relative path", () => fs.readFileSync(${at("b.txt")}, "utf8"));
  say("rm -rf of its folder", () => fs.readFileSync(${at("cache/c.txt")}, "utf8"));
  await Bun.$\`rm -rf \${${at("cache")}}\`;
  say("rm -rf of its folder", () => fs.readFileSync(${at("cache/c.txt")}, "utf8") + " " + fs.existsSync(${at("cache/c.txt")}));
  say("an rm that fails", () => fs.readFileSync(${at("d.txt")}, "utf8"));
  await Bun.$\`rm \${${at("d.txt")}}/below\`.nothrow().quiet();
  say("an rm that fails", () => fs.readFileSync(${at("d.txt")}, "utf8"));
};
`,
        "app/node_modules/keeper/a.txt": "first",
        "app/node_modules/keeper/b.txt": "first",
        "app/node_modules/keeper/cache/c.txt": "first",
        "app/node_modules/keeper/d.txt": "first",
      });
      const cwd = join(String(dir), "app");
      const built = await run(cwd, [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "./main.mjs",
        ...flags,
        "--outfile",
        "../built.exe",
      ]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout: `rm first
rm ENOENT
mv of a relative path first
mv of a relative path ENOENT
rm -rf of its folder first
rm -rf of its folder ENOENT
an rm that fails first
an rm that fails first
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  const readsThreeFiles = {
    "app/package.json": `{ "name": "server" }`,
    "app/main.mjs": `import keeper from "keeper";
keeper.run();
`,
    "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
    "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = () => {
  if (process.argv[2]) require("node:child_process").execFileSync("rm", [path.join(__dirname, process.argv[2])]);
  say("data.txt", () => fs.readFileSync(path.join(__dirname, "data.txt"), "utf8"));
  say("other.txt", () => fs.readFileSync(path.join(__dirname, "other.txt"), "utf8"));
  say("deep.txt", () => fs.readFileSync(path.join(__dirname, "data/deep.txt"), "utf8"));
};
`,
    "app/node_modules/keeper/data.txt": "first",
    "app/node_modules/keeper/other.txt": "first",
    "app/node_modules/keeper/data/deep.txt": "first",
  };

  test.each([
    ["a file", (path: string) => writeFileSync(path, "laid"), "laid"],
    ["a folder", (path: string) => mkdirSync(path), "EISDIR"],
  ])(
    "%s laid at the old place of one embedded file leaves the others",
    async (_, lay, answer) => {
      using dir = tempDir("aot-one-file-laid-at-old-place", readsThreeFiles);
      const cwd = join(String(dir), "app");
      const built = await run(cwd, [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "./main.mjs",
        "--outfile",
        "../built.exe",
      ]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      renameSync(cwd, join(String(dir), "away"));
      mkdirSync(join(cwd, "node_modules/keeper"), { recursive: true });
      lay(join(cwd, "node_modules/keeper/other.txt"));
      const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout: `data.txt first\nother.txt ${answer}\ndeep.txt first\n`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "a file alone in its folder is gone where something else removed it beside the sources",
    async () => {
      using dir = tempDir("aot-file-alone-in-folder-removed", readsThreeFiles);
      const cwd = join(String(dir), "app");
      const built = await run(cwd, [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "./main.mjs",
        "--outfile",
        "../built.exe",
      ]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const compiled = await run(String(dir), ["./built.exe", "data/deep.txt"], {
        ...bunEnv,
        BUN_JSC_crashIfInterpreterIsUsed: "1",
      });
      expect(compiled).toEqual({
        stdout: "data.txt first\nother.txt first\ndeep.txt ENOENT\n",
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.each([[[]], [["--asset", "node_modules/keeper/state.txt", "--asset", "node_modules/keeper/large.txt"]]])(
    "Bun.write() to the path of an embedded file writes it, away from the sources %j",
    async flags => {
      const at = (name: string) => `path.join(__dirname, ${JSON.stringify(name)})`;
      using dir = tempDir("aot-write-over-embedded-file", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = async () => {
  say("a short text", () => fs.readFileSync(${at("state.txt")}, "utf8"));
  fs.mkdirSync(__dirname, { recursive: true });
  console.log("written", await Bun.write(${at("state.txt")}, "second"));
  say("a short text", () => fs.readFileSync(${at("state.txt")}, "utf8"));
  console.log("by Bun.file()", await Bun.file(${at("state.txt")}).text());
  say("a blob", () => fs.readFileSync(${at("large.txt")}, "utf8"));
  console.log("written", await Bun.write(${at("large.txt")}, new Blob(["third"])));
  say("a blob", () => fs.readFileSync(${at("large.txt")}, "utf8"));
};
`,
        "app/node_modules/keeper/state.txt": "first",
        "app/node_modules/keeper/large.txt": "first",
      });
      const cwd = join(String(dir), "app");
      const built = await run(cwd, [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "./main.mjs",
        ...flags,
        "--outfile",
        "../built.exe",
      ]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      renameSync(cwd, join(String(dir), "away"));
      const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout: `a short text first
written 6
a short text second
by Bun.file() second
a blob first
written 5
a blob third
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test("a path that is passed on is warned of, also where a read of it is ruled out", async () => {
    using dir = tempDir("aot-path-passed-on", {
      "app/package.json": `{ "name": "app" }`,
      "app/big.bin": "big",
      "app/other.txt": "other",
      "app/main.cjs": `const fs = require("node:fs"), path = require("node:path");
const { load } = require("loader");
const o = { file: path.join(__dirname, "big.bin") };
console.log(load(path.join(__dirname, "big.bin")));
Object.assign(o, { file: path.join(__dirname, "other.txt") });
console.log(fs.readFileSync(o.file, "utf8"));
`,
      "app/node_modules/loader/package.json": `{ "name": "loader", "version": "1.0.0", "main": "./index.cjs" }`,
      "app/node_modules/loader/index.cjs": `const fs = require("node:fs");
exports.load = file => fs.existsSync(file);
`,
    });
    const { plain, built } = await bothWays(String(dir), "./main.cjs");
    expect(plain).toEqual({ stdout: "true\nother\n", stderr: "", exitCode: 0 });
    expect(warnings(built)).toEqual(["warn TS100098 other.txt", "warn TS100172 big.bin"]);
  }, 120_000);

  test("a package reads with what its caller passes in place of a function that writes", async () => {
    using dir = tempDir("aot-functions-passed-for-defaults", {
      "app/package.json": `{ "name": "app" }`,
      "app/main.cjs": `const fs = require("node:fs");
const passed = require("passed");
const read = file => fs.readFileSync(file, "utf8");
console.log(passed.one(read), passed.two(read), passed.three(), passed.four(), passed.five(read));
`,
      "app/node_modules/passed/package.json": `{ "name": "passed", "version": "1.0.0", "main": "./index.cjs" }`,
      "app/node_modules/passed/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.one = (write = Bun.write) => write(path.join(__dirname, "one.txt"));
exports.two = function (write = fs.writeFileSync) { return write(path.join(__dirname, "two.txt")); };
exports.three = (read = fs.readFileSync) => read(path.join(__dirname, "three.txt"), "utf8");
exports.four = () => ((write = fs.writeFileSync) => write(path.join(__dirname, "four.txt"), "utf8"))(fs.readFileSync);
exports.five = use => use(path.join(__dirname, "five.txt"));
`,
      ...Object.fromEntries(
        ["one", "two", "three", "four", "five"].map(name => [`app/node_modules/passed/${name}.txt`, name]),
      ),
    });
    const { plain, compiled } = await bothWays(String(dir), "./main.cjs");
    expect(plain).toEqual({ stdout: "one two three four five\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("a package chooses its file by what JavaScript answers", async () => {
    const rows = {
      "added numbers": `let v = 0; if (process.env.A) v += 1;`,
      "a sum of numbers": `let v = 0; if (process.env.A) v = v + 1 + 1;`,
      "steps up": `let v = 0; if (process.env.A) v++;`,
      "steps down": `let v = 0; if (process.env.A) --v;`,
      "subtracted": `let v = 2; if (process.env.A) v -= 1;`,
      "booleans": `let v = false; if (process.env.A) v = true;`,
      "nothing": `let v; if (process.env.A) v = null;`,
      "a number and a string": `let v = 1; if (process.env.A) v = "a"; v = v + 1;`,
      "added booleans": `let v = true; if (process.env.A) v += true;`,
      "minus zero": `let v = -0; if (process.env.A) v = 1;`,
      "no number": `let v = NaN; if (process.env.A) v = Infinity;`,
      "fractions": `let v = 0.5; if (process.env.A) v += 1;`,
      "a large number": `let v = 1e21; if (process.env.A) v = 1;`,
      "bigints": `let v = 1n; if (process.env.A) v += 1n;`,
      "compared bigints": `let n = 16n, v = "a"; if (process.env.A) n = 0x10n; if (n === 0x10n) v = "b";`,
      "or": `let v = ""; if (process.env.A) v = "b"; v ||= "a";`,
      "and": `let v = ""; if (process.env.A) v = "b"; v &&= "a"; v ||= "c";`,
      "missing": `let v = null; if (process.env.A) v = ""; v ??= "a"; v ||= "b";`,
      "zero as a string": `let v = "a"; const zero = process.env.A ? "0" : ""; if (zero) v = "b";`,
      "a default of a pattern": `const { A = "a" } = process.env; let v = "b"; if (A === "a") v = "c";`,
      "a default of a parameter": `function choose(x = "a") { return x === "a" ? "b" : "c"; } let v = choose(process.env.A);`,
      "a thrown error": `let v = "a"; try { if (process.env.A) null.x; v = "b"; } catch { v = "c"; }`,
      "an error of a call": `let v = "a"; try { v = "b"; JSON.parse(process.env.A ? "{" : "{}"); v = "ab"; } catch { v += "c"; }`,
      "an error after a store": `let v = "a"; try { v = "b"; process.env.A.x.y; } catch { v += "c"; }`,
      "finally": `let v = "a"; function f() { try { if (process.env.A) throw 1; v = "b"; } finally { v += "c"; } } try { f(); } catch {}`,
      "thrown in catch": `let v = "a"; try { try { throw 1; } catch { v = "b"; if (process.env.A) throw 2; } } catch { v = "c"; }`,
      "a variable of each iteration": `let v = "a"; for (const x of ["one", "two"]) { let y; if (x === "one") y = "b"; y ??= "c"; v = y; }`,
      "a constant of each iteration": `let v = "a"; for (const x of JSON.parse("[1,0]")) { if (x) v = "b"; else if (v === "b") v = "c"; }`,
      "closures of calls": `function make(n) { return () => n; } const one = make("a"), two = make("b"); let v = one();`,
      "closures of a loop": `const all = []; for (const n of ["a", "b"]) all.push(() => n); let v = all[0]();`,
      "methods of classes of calls": `function make(n) { return class { get() { return n; } }; } const One = make("a"), Two = make("b"); let v = new One().get();`,
      "a variable of an earlier call": `function pick(flag) { var f; if (flag) f = "b"; return f || "a"; } pick(true); let v = pick(false);`,
      "this": `function f() { return this ? "a" : "b"; } let v = f();`,
      "this of an arrow": `class A { constructor() { this.n = "a"; this.get = () => this.n; } } class B { constructor(run) { this.n = "b"; this.run = run; } call() { return this.run(); } } let v = new B(new A().get).call();`,
      "an optional call": `let v = "a"; const o = process.env.A ? { set() {} } : undefined; o?.set((v = "b"));`,
      "an inherited name": `let v = "b"; const o = {}; if (o.toString) v = "a";`,
      "super": `class P { get() { return "a"; } } class C extends P { get() { return super.get(); } } let v = new C().get();`,
      "the order of a store": `let o = { n: "a" }; const p = o; o.n = (o = { n: "c" }, "b"); let v = p.n;`,
      "new of a function": `let v = "c"; function F(n) { v = n; } F("a"); new F("b");`,
      "a switch": `let v; switch (process.env.A) { default: v = "a"; case "2": v = (v ?? "") + "b"; break; case "1": v = "c"; }`,
      "a label": `let v = "a"; outer: for (;;) { for (;;) { v = "b"; break outer; } }`,
      "the kind of a value": `let v = "a"; if (typeof process.env.A === "string") v = "b";`,
      "an order of numbers": `let v = "a"; if (process.env.A < 2) v = "b";`,
      "a getter": `const o = { get n() { return process.env.A ? "a" : "b"; } }; let v = o.n;`,
      "a spread object": `const o = { n: "a", ...(process.env.A && { n: "b" }) }; let v = o.n;`,
      "a joined list": `let v = ["a", process.env.A ? "b" : "c"].join("");`,
      "a method of a string": `let v = (process.env.A ? "A" : "B").toLowerCase();`,
      "a deleted field": `const o = { n: "a" }; if (process.env.A) delete o.n; let v = o.n ?? "b";`,
      "a converted object": `let v = "a"; const o = { valueOf() { v = "b"; return 1; } }; if (process.env.A) +o;`,
      "a loop": `let v = 0; while (v < 2) v += 1;`,
      "a variable that is set": `let v = "a"; const key = "SET_" + "LATER"; if (!process.env.SET_LATER) { process.env[key] = "1"; v = "b"; } if (process.env.SET_LATER) v += "c";`,
    };
    const values = [
      "0",
      "1",
      "2",
      "-1",
      "0.5",
      "1.5",
      "01",
      "true",
      "false",
      "null",
      "undefined",
      "NaN",
      "Infinity",
      "1e+21",
    ];
    values.push("a", "b", "c", "ab", "ac", "bc", "a1");
    const names = Object.keys(rows);
    using dir = tempDir("aot-executed-choices", {
      "app/package.json": `{ "name": "app" }`,
      "app/main.cjs": `const { read } = require("chooser");\nfor (const line of read()) console.log(line);\n`,
      "app/node_modules/chooser/package.json": `{ "name": "chooser", "version": "1.0.0", "main": "./index.cjs" }`,
      "app/node_modules/chooser/index.cjs": `const attempt = (name, load) => {
  try { return name + ": " + load(); } catch (error) { return name + ": " + error.code; }
};
exports.read = () => [
${names.map((name, index) => `  attempt(${JSON.stringify(name)}, () => require("./${index}.cjs")),`).join("\n")}
];
`,
      ...Object.fromEntries(
        Object.values(rows).flatMap((code, index) => [
          [
            `app/node_modules/chooser/${index}.cjs`,
            `const fs = require("node:fs"), path = require("node:path");
${code}
module.exports = fs.readFileSync(path.join(__dirname, \`files/${index}/\${v}.txt\`), "utf8");
`,
          ],
          ...values.map(value => [`app/node_modules/chooser/files/${index}/${value}.txt`, value]),
        ]),
      ),
    });
    const [app, outfile] = ["app", "built.exe"].map(it => join(String(dir), it));
    const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const environments = [{ A: "1" }, { A: "2" }, { A: undefined }];
    const all = environments.map(it => ({ ...bunEnv, SET_LATER: undefined, ...it }));
    const plain = await Promise.all(all.map(env => run(app, [bunExe(), "run", "./main.cjs"], env)));
    renameSync(app, join(String(dir), "moved-away"));
    const compiled = await Promise.all(all.map(env => run(String(dir), [outfile], env)));
    for (const { stdout, exitCode } of plain) {
      expect({ lines: stdout.split("\n").length, exitCode }).toEqual({ lines: names.length + 1, exitCode: 0 });
    }
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("a package chooses its file by a variable of the environment that it compares loosely", async () => {
    const rows = {
      "one": "process.env.CHOSEN == 1",
      "one first": "1 == process.env.CHOSEN",
      "a boolean": "process.env.CHOSEN == true",
      "not one": "!(process.env.CHOSEN != 1)",
      "zero": "process.env.EMPTY == 0",
      "no truth": "process.env.EMPTY == false",
      "null": "process.env.UNSET == null",
      "undefined": "process.env.UNSET == undefined",
      "not null": "process.env.CHOSEN != null",
      "a number and a boolean": "one == true",
      "nothing": "nothing == undefined",
      "a string": "process.env.CHOSEN == '1'",
    };
    const names = Object.keys(rows);
    using dir = tempDir("aot-loosely-compared-environment", {
      "app/package.json": `{ "name": "app" }`,
      "app/main.cjs": `const { read } = require("chooser");\nfor (const line of read()) console.log(line);\n`,
      "app/node_modules/chooser/package.json": `{ "name": "chooser", "version": "1.0.0", "main": "./index.cjs" }`,
      "app/node_modules/chooser/index.cjs": `exports.read = () => [
${names.map((_, index) => `  require("./${index}.cjs"),`).join("\n")}
];
`,
      ...Object.fromEntries(
        Object.entries(rows).flatMap(([name, test], index) => [
          [
            `app/node_modules/chooser/${index}.cjs`,
            `const fs = require("node:fs"), path = require("node:path");
let one = 1, nothing = null;
let file = path.join(__dirname, "files/${index}-first.txt");
if (${test}) file = path.join(__dirname, "files/${index}-chosen.txt");
module.exports = fs.readFileSync(file, "utf8");
`,
          ],
          [`app/node_modules/chooser/files/${index}-first.txt`, `${name}: first`],
          [`app/node_modules/chooser/files/${index}-chosen.txt`, `${name}: chosen`],
        ]),
      ),
    });
    const [app, outfile] = ["app", "built.exe"].map(it => join(String(dir), it));
    const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const environments = [{ CHOSEN: "1", EMPTY: "" }, { CHOSEN: "2", EMPTY: "some", UNSET: "set" }, {}];
    const all = environments.map(it => ({ ...bunEnv, CHOSEN: undefined, EMPTY: undefined, UNSET: undefined, ...it }));
    const plain = await Promise.all(all.map(env => run(app, [bunExe(), "run", "./main.cjs"], env)));
    renameSync(app, join(String(dir), "moved-away"));
    const compiled = await Promise.all(
      all.map(env => run(String(dir), [outfile], { ...env, BUN_JSC_crashIfInterpreterIsUsed: "1" })),
    );
    expect(plain[0]).toEqual({ stdout: names.map(it => `${it}: chosen\n`).join(""), stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("a route of Bun.serve() may be a file that --asset embeds", async () => {
    using dir = tempDir("aot-route-of-embedded-file", {
      "app/package.json": `{ "name": "server" }`,
      "app/favicon.ico": "an icon",
      "app/page.html": "a page",
      "app/main.mjs": `import path from "node:path";
const at = name => Bun.file(path.join(import.meta.dir, name));
using server = Bun.serve({
  port: 0,
  routes: { "/favicon.ico": at("favicon.ico"), "/page": at("page.html"), "/response": new Response(at("page.html")) },
  fetch: () => new Response("no route"),
});
for (const route of ["/favicon.ico", "/page", "/response", "/other"]) {
  const answer = await fetch(new URL(route, server.url));
  console.log(route, answer.status, answer.headers.get("content-type"), await answer.text());
}
const head = await fetch(new URL("/favicon.ico", server.url), { method: "HEAD" });
console.log("HEAD", head.status, head.headers.get("content-length"));
`,
    });
    const { plain, compiled } = await bothWays(
      String(dir),
      "./main.mjs",
      "--asset",
      "./favicon.ico",
      "--asset",
      "./page.html",
    );
    expect(plain).toEqual({
      stdout: `/favicon.ico 200 image/x-icon an icon
/page 200 text/html;charset=utf-8 a page
/response 200 text/html;charset=utf-8 a page
/other 200 text/plain;charset=utf-8 no route
HEAD 200 7
`,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.skipIf(!isLinux)(
    "an embedded folder is opened where no temporary folder can be made",
    async () => {
      using dir = tempDir("aot-embedded-folder-without-temporary-one", {
        "app/data/a.txt": "a file",
        "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
const data = path.join(import.meta.dirname, "data");
const fd = fs.openSync(data, "r");
console.log(fs.fstatSync(fd).isDirectory(), fs.readdirSync(data).join());
try { fs.readSync(fd, Buffer.alloc(1)); } catch (error) { console.log(error.code); }
fs.closeSync(fd);
`,
      });
      const cwd = join(String(dir), "app");
      const outfile = join(String(dir), "built.exe");
      const build = [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--asset", "./data", "--outfile", outfile];
      const built = await run(cwd, build);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      for (const folder of ["/proc", join(String(dir), "missing")]) {
        const compiled = await run(String(dir), [outfile], { ...bunEnv, TMPDIR: folder, BUN_TMPDIR: folder });
        expect(compiled).toEqual({ stdout: "true a.txt\nEISDIR\n", stderr: "", exitCode: 0 });
      }
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "the shell's < reads an embedded file, away from the sources",
    async () => {
      const at = (name: string) => `path.join(__dirname, "data", ${JSON.stringify(name)})`;
      using dir = tempDir("aot-shell-reads-embedded-file", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.run = async () => {
  console.log("embedded", fs.readFileSync(${at("a.txt")}, "utf8"), fs.readFileSync(${at("b.txt")}, "utf8"), fs.readFileSync(${at("c.txt")}, "utf8"));
  console.log("a started command", await Bun.$\`cat < \${${at("a.txt")}}\`.text());
  console.log("by a relative path", await Bun.$\`cat < data/b.txt\`.cwd(__dirname).text());
  console.log("a built-in command", (await Bun.$\`echo said < \${${at("c.txt")}}\`.text()).trim());
  console.log("what is nowhere", (await Bun.$\`cat < \${${at("nowhere.txt")}}\`.nothrow().quiet()).exitCode, (await Bun.$\`echo said < \${${at("nowhere.txt")}}\`.nothrow().quiet()).exitCode);
};
`,
        "app/node_modules/keeper/data/a.txt": "first",
        "app/node_modules/keeper/data/b.txt": "second",
        "app/node_modules/keeper/data/c.txt": "third",
      });
      const cwd = join(String(dir), "app");
      const built = await run(cwd, [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "./main.mjs",
        "--outfile",
        "../built.exe",
      ]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      renameSync(cwd, join(String(dir), "away"));
      mkdirSync(join(cwd, "node_modules", "keeper"), { recursive: true });
      const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout: `embedded first second third
a started command first
by a relative path second
a built-in command said
what is nowhere 1 1
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  const finder = {
    "app/node_modules/finder/package.json": `{ "name": "finder", "main": "index.js" }`,
    "app/node_modules/finder/index.js": `const fs = require("node:fs"), path = require("node:path");
exports.up = start => {
  for (let folder = start, steps = 0; steps < 8; folder = path.dirname(folder), steps++) {
    const file = path.join(folder, "package.json");
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")).name;
  }
  return "none";
};
`,
  };
  const waysToHandOn = {
    argument: `require("finder").up(__dirname)`,
    variable: `up(here)`,
    joined: `up(require("node:path").join(__dirname, "lib"))`,
    pattern: `up(__dirname)`,
    member: `look(__dirname)`,
    ownFunction: `own(__dirname)`,
    field: `up({ from: __dirname }.from)`,
    options: `upBy({ cwd: __dirname })`,
    classField: `up(new (class { here = __dirname; })().here)`,
    list: `[__dirname].map(up)[0]`,
    apply: `up.apply(null, [__dirname])`,
    spread: `up(...[__dirname])`,
    defaultValue: `((start = __dirname) => up(start))()`,
    result: `up((() => __dirname)())`,
  };
  const packagesThatHandOn = Object.fromEntries(
    Object.entries(waysToHandOn).flatMap(([name, way]) => [
      [`app/node_modules/by-${name.toLowerCase()}/package.json`, `{ "name": "${name}", "main": "index.js" }`],
      [
        `app/node_modules/by-${name.toLowerCase()}/index.js`,
        `const { up } = require("finder");
const look = require("finder").up, here = __dirname;
function own(from) { return require("finder").up(from); }
const upBy = options => up(options.cwd);
module.exports = () => ${way};
`,
      ],
    ]),
  );
  const askAll = `${Object.keys(waysToHandOn)
    .map(name => `import ${name} from "by-${name.toLowerCase()}";`)
    .join("\n")}
console.log([${Object.keys(waysToHandOn)}].map(find => find()).join(" "));
`;

  test("a package that hands its folder to another package's search finds its own package.json", async () => {
    using dir = tempDir("aot-folder-handed-to-a-search", { "app/main.mjs": askAll, ...packagesThatHandOn, ...finder });
    const { plain, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
    expect(plain.stdout).toBe(Object.keys(waysToHandOn).join(" ") + "\n");
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("such a search does not find the application's package.json where that is embedded", async () => {
    using dir = tempDir("aot-folder-handed-on-below-a-manifest", {
      "app/package.json": `{ "name": "server", "version": "1.2.3" }`,
      "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
console.log(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "package.json"), "utf8")).version);
${askAll}`,
      ...packagesThatHandOn,
      ...finder,
    });
    const { plain, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
    expect(plain.stdout).toBe("1.2.3\n" + Object.keys(waysToHandOn).join(" ") + "\n");
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an ES module that hands its folder to another package's search finds its own package.json", async () => {
    using dir = tempDir("aot-module-hands-its-folder-on", {
      "app/main.mjs": `import byFolder, { byUrl } from "asks";
console.log(byFolder(), byUrl());
`,
      "app/node_modules/asks/package.json": `{ "name": "asks", "type": "module", "main": "index.js" }`,
      "app/node_modules/asks/index.js": `import { fileURLToPath } from "node:url";
import path from "node:path";
import { up } from "finder";
export default () => up(import.meta.dirname);
export const byUrl = () => up(path.dirname(fileURLToPath(import.meta.url)));
`,
      ...finder,
    });
    const { plain, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
    expect(plain.stdout).toBe("asks asks\n");
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.each([[""], [`{ "name": "server", "version": "1.2.3" }`]])(
    "a search from a folder of a package that holds a package.json and no code finds that one %j",
    async own => {
      using dir = tempDir("aot-search-from-a-folder-without-code", {
        ...(own && { "app/package.json": own }),
        "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import asks from "asks";
${own && `console.log(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "package.json"), "utf8")).version);`}
console.log(asks.beside(), asks.below(), asks.own());
`,
        "app/node_modules/asks/package.json": `{ "name": "asks", "main": "index.js" }`,
        "app/node_modules/asks/index.js": `const path = require("node:path");
const { up } = require("finder");
exports.beside = () => up(path.join(__dirname, "esm"));
exports.below = () => up(path.join(__dirname, "dist", "cjs"));
exports.own = () => up(__dirname);
`,
        "app/node_modules/asks/esm/package.json": `{ "name": "asks-esm", "type": "module" }`,
        "app/node_modules/asks/dist/package.json": `{ "name": "asks-dist" }`,
        "app/node_modules/asks/dist/cjs/notes.txt": "no code here",
        ...finder,
      });
      const { plain, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
      expect(plain.stdout).toBe(`${own && "1.2.3\n"}asks-esm asks-dist asks\n`);
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test.each([[false], [true]])(
    "a warning names a folder outside its package that a package hands to a search, package.json read: %j",
    async own => {
      using dir = tempDir("aot-search-starts-outside-the-package", {
        "app/package.json": `{ "name": "server", "version": "1.2.3" }`,
        "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import asks from "asks";
${!own ? "" : `console.log(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "package.json"), "utf8")).version);`}
console.log(asks.above(), asks.own());
`,
        "app/node_modules/asks/package.json": `{ "name": "asks", "main": "index.js" }`,
        "app/node_modules/asks/index.js": `const path = require("node:path");
const { up } = require("finder");
exports.above = () => up(path.join(__dirname, "..", ".."));
exports.own = () => up(__dirname);
`,
        ...finder,
      });
      const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
      expect(warnings(built)).toEqual(own ? [] : ["warn TS100174 ."]);
      if (own) expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("no warning where a folder outside its package goes to the language or a loop's next step", async () => {
    using dir = tempDir("aot-folder-outside-goes-to-the-language", {
      "app/package.json": `{ "name": "server" }`,
      "app/main.mjs": `import tells from "tells";
import asks from "asks";
import climbs from "climbs";
console.log(tells(), asks(), climbs());
`,
      "app/node_modules/climbs/package.json": `{ "name": "climbs", "main": "index.js" }`,
      "app/node_modules/climbs/index.js": `const fs = require("node:fs"), path = require("node:path");
module.exports = () => {
  let folder = __dirname;
  for (let i = 0; i < 8; i++) {
    const manifest = path.join(folder, "package.json");
    if (fs.existsSync(manifest)) return JSON.parse(fs.readFileSync(manifest, "utf8")).name;
    const above = path.dirname(folder);
    if (above === folder) break;
    folder = above;
  }
  return "none";
};
`,
      "app/node_modules/tells/package.json": `{ "name": "tells", "main": "index.js" }`,
      "app/node_modules/tells/index.js": `const path = require("node:path"), util = require("node:util");
module.exports = () => {
  const map = new Map(), set = new Set(), list = [];
  map.set(path.join(__dirname, ".."), 1);
  set.add(path.join(__dirname, ".."));
  list.push(path.join(__dirname, ".."));
  const texts = [
    util.inspect(path.join(__dirname, "..")),
    JSON.stringify(path.join(__dirname, "..")),
    new Error(path.join(__dirname, "..")).message,
  ];
  return map.size + set.size + list.length + texts.length + Number("abc".startsWith(path.join(__dirname, "..")));
};
`,
      "app/node_modules/asks/package.json": `{ "name": "asks", "main": "index.js" }`,
      "app/node_modules/asks/index.js": `const path = require("node:path");
module.exports = () => require("finder").up(path.join(__dirname, ".."));
`,
      ...finder,
    });
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
    expect(plain.stdout).toBe("6 server climbs\n");
    expect(compiled).toEqual({ ...plain, stdout: "6 none climbs\n" });
    expect(
      [...(built.stdout + built.stderr).matchAll(/TS100174[^\n]*\n\s+at [^\n]*node_modules[\\/](\w+)[\\/]/g)].map(
        it => it[1],
      ),
    ).toEqual(["asks"]);
  }, 120_000);

  test("a search from a folder without code finds its package.json in a package inside another package too", async () => {
    using dir = tempDir("aot-search-in-an-inner-package", {
      "app/main.mjs": `import asks from "asks";
console.log(asks.own(), asks.inner());
`,
      "app/node_modules/asks/package.json": `{ "name": "asks", "main": "index.js" }`,
      "app/node_modules/asks/index.js": `const { up } = require("finder");
exports.own = () => up(__dirname);
exports.inner = require("inner").beside;
`,
      "app/node_modules/asks/node_modules/inner/package.json": `{ "name": "inner", "main": "index.js" }`,
      "app/node_modules/asks/node_modules/inner/index.js": `const path = require("node:path");
const { up } = require("finder");
exports.beside = () => up(path.join(__dirname, "esm"));
`,
      "app/node_modules/asks/node_modules/inner/esm/package.json": `{ "name": "inner-esm", "type": "module" }`,
      ...finder,
    });
    const { plain, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
    expect(plain.stdout).toBe("asks inner-esm\n");
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.each([
    ["a link", "shut"],
    ["a folder that is a link", "linked"],
    ["a folder named package.json", "odd"],
    ["another package", "node_modules/inner"],
  ])(
    "a warning names a folder whose package.json can't be embedded: %s",
    async (kind, folder) => {
      using dir = tempDir("aot-nearest-package-json-stays-out", {
        "app/main.mjs": `import asks from "asks";
console.log(asks());
`,
        "app/node_modules/asks/package.json": `{ "name": "asks", "main": "index.js" }`,
        "app/node_modules/asks/manifest.json": `{ "name": "linked" }`,
        "app/node_modules/asks/real/package.json": `{ "name": "real" }`,
        "app/node_modules/asks/shut/notes.txt": "no code here",
        "app/node_modules/asks/odd/package.json/notes.txt": "a folder",
        "app/node_modules/asks/node_modules/inner/package.json": `{ "name": "inner" }`,
        "app/node_modules/asks/index.js": `const path = require("node:path");
const { up } = require("finder");
module.exports = () => { try { return up(path.join(__dirname, ${JSON.stringify(folder)})); } catch (error) { return error.code; } };
`,
        ...finder,
      });
      const asks = join(String(dir), "app", "node_modules", "asks");
      symlinkSync(join(asks, "manifest.json"), join(asks, "shut", "package.json"));
      symlinkSync(join(asks, "real"), join(asks, "linked"), "junction");
      const { built } = await bothWaysIn(String(dir), "app", "./main.mjs");
      expect(warnings(built)).toEqual([`warn TS100174 node_modules/asks/${folder}`]);
    },
    120_000,
  );

  test.each([["none above"], ["its own"]])(
    "no warning where a search finds %s in the executable too",
    async kind => {
      using dir = tempDir("aot-search-finds-the-same", {
        "app/main.mjs": `import asks from "asks";
console.log(asks());
`,
        "app/node_modules/asks/package.json": `{ "name": "asks", "main": "index.js" }`,
        "app/node_modules/asks/esm/package.json": `{ "name": "esm" }`,
        "app/node_modules/asks/index.js": `const path = require("node:path");
const { up } = require("finder");
module.exports = () => up(path.join(__dirname, ${kind === "its own" ? `"esm"` : `".."`}));
`,
        ...finder,
      });
      const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
      expect(warnings(built)).toEqual([]);
      expect(plain.stdout).toBe(kind === "its own" ? "esm\n" : "none\n");
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test.each([
    ["its own folder", "__dirname", "node_modules/asks"],
    ["a folder below", `path.join(__dirname, "lib")`, "node_modules/asks/lib"],
    ["a folder that is there whole", `path.join(__dirname, "whole")`, ""],
  ])(
    "a warning names a folder that a package hands to code that lists it: %s",
    async (kind, folder, named) => {
      using dir = tempDir("aot-folder-listed-in-part", {
        "app/main.mjs": `import asks from "asks";
console.log(asks());
`,
        "app/node_modules/asks/package.json": `{ "name": "asks", "main": "index.js" }`,
        "app/node_modules/asks/notes.txt": "nobody reads it",
        "app/node_modules/asks/lib/part.js": `module.exports = 1;`,
        "app/node_modules/asks/lib/notes.txt": "nobody reads it",
        "app/node_modules/asks/whole/part.js": `module.exports = 1;`,
        "app/node_modules/asks/index.js": `const path = require("node:path");
require("./lib/part.js");
require("./whole/part.js");
module.exports = () => require("lists")(${folder});
`,
        "app/node_modules/lists/package.json": `{ "name": "lists", "main": "index.js" }`,
        "app/node_modules/lists/index.js": `const fs = require("node:fs");
module.exports = folder => fs.readdirSync(folder).length;
`,
      });
      const { built } = await bothWaysIn(String(dir), "app", "./main.mjs");
      expect(warnings(built)).toEqual(named ? [`warn TS100175 ${named}`] : []);
    },
    120_000,
  );

  const partOfProgram = (parts: string) => ({
    ...helper,
    [`app/${parts}/lib/index.cjs`]: asksHelper,
    "app/main.mjs": `${readsOwnName}import part from "./${parts}/lib/index.cjs";
say("a folder of the program with a package.json of its own", part.ownName);
// The build cannot see these names, so they are no reads that it knows.
const made = name => path.join(import.meta.dirname, Buffer.from(name).toString());
say("a file beside that package.json", () => fs.existsSync(made("${parts}/lib/notes.txt")));
say("a package.json with no code beside or below it", () => fs.existsSync(made("${parts}/idle/package.json")));
`,
  });
  const withdrawn = {
    stdout: `the program's own ENOENT\na folder of the program with a package.json of its own none\na file beside that package.json false\na package.json with no code beside or below it false\n`,
    stderr: "",
    exitCode: 0,
  };

  test("a package.json in a folder of the program is embedded where a search would find the one above it", async () => {
    using dir = tempDir("aot-own-nearer-package-json", {
      ...partOfProgram("parts"),
      "app/parts/lib/package.json": `{ "name": "part" }`,
      "app/parts/lib/notes.txt": "notes",
      "app/parts/idle/package.json": `{ "name": "idle" }`,
    });
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs", "--explain");
    expect(plain.stdout).toBe(
      `the program's own application\na folder of the program with a package.json of its own part\na file beside that package.json true\na package.json with no code beside or below it true\n`,
    );
    expect(compiled).toEqual({
      stdout: `the program's own application\na folder of the program with a package.json of its own part\na file beside that package.json false\na package.json with no code beside or below it false\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(warnings(built).filter(it => /TS100098|TS100166|TS10017\d/.test(it))).toEqual([
      "note TS100166 package.json",
      "note TS100170 node_modules/helper/package.json",
      "note TS100171 parts/lib/package.json",
    ]);
  }, 120_000);

  test("where a nearer package.json stays out, the one above it stays out too", async () => {
    using dir = tempDir("aot-nearer-package-json-stays-out", {
      ...partOfProgram(".parts"),
      "app/.parts/lib/package.json": `{ "name": "part" }`,
    });
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
    expect(plain.stdout).toBe(
      `the program's own application\na folder of the program with a package.json of its own part\na file beside that package.json false\na package.json with no code beside or below it false\n`,
    );
    expect(compiled).toEqual(withdrawn);
    expect(warnings(built)).toEqual(["warn TS100098 package.json"]);
  }, 120_000);

  test.skipIf(isWindows)(
    "a nearer package.json that is a link stays out",
    async () => {
      using dir = tempDir("aot-nearer-package-json-is-a-link", {
        ...partOfProgram("parts"),
        "app/elsewhere/package.json": `{ "name": "part" }`,
      });
      symlinkSync("../../elsewhere/package.json", join(String(dir), "app/parts/lib/package.json"));
      const { built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
      expect(compiled).toEqual(withdrawn);
      expect(warnings(built)).toEqual(["warn TS100098 package.json"]);
    },
    120_000,
  );

  test("a package.json that is only asked about has its bytes", async () => {
    using dir = tempDir("aot-package-json-only-asked-about", {
      ...helper,
      "app/node_modules/asker/package.json": `{ "name": "asker", "main": "index.cjs" }`,
      "app/node_modules/asker/index.cjs": asksHelper,
      "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import asker from "asker";
${say}
say("is the program's own there", () => fs.existsSync(path.join(import.meta.dirname, "package.json")));
say("a package below the program", asker.ownName);
`,
    });
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs");
    expect(plain.stdout).toBe(`is the program's own there true\na package below the program asker\n`);
    expect(compiled).toEqual(plain);
    expect(warnings(built)).toEqual([]);
  }, 120_000);
});
