import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { chmodSync, cpSync, mkdirSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { without } from "./harness/capabilities";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

async function run(cwd: string, cmd: string[], env = bunEnv) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, env);
  return { stdout, stderr, exitCode };
}

function bothWays(dir: string, entryPoint: string, ...flags: string[]) {
  return bothWaysIn(dir, "app", entryPoint, ...flags);
}

/** Builds in `folder`, which is `app` or lies below it. All of `app` is moved away before the executable runs. */
async function bothWaysIn(dir: string, folder: string, entryPoint: string, ...flags: string[]) {
  const cwd = join(dir, folder);
  const plain = await run(cwd, [bunExe(), "run", entryPoint]);
  const built = await run(cwd, [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    entryPoint,
    ...flags,
    "--outfile",
    join(dir, "built.exe"),
  ]);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  renameSync(join(dir, "app"), join(dir, "moved-away"));
  const compiled = await run(dir, ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  return { plain, built, compiled };
}

/** Plain Bun runs behind the build, because the program changes its files. Then they are moved away, and `folders` are there without them. */
async function plainAfterBuild(dir: string, ...folders: string[]) {
  const app = join(dir, "app");
  const outfile = join(dir, "built.exe");
  const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", outfile]);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const plain = await run(app, [bunExe(), "run", "./main.mjs"]);
  renameSync(app, join(dir, "moved-away"));
  for (const folder of folders) mkdirSync(join(app, folder), { recursive: true });
  const compiled = await run(dir, [outfile], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  return { plain, built, compiled };
}

/** The executable runs beside its sources, and plain Bun over a copy of them, because the program changes its files. */
async function plainAndBeside(dir: string, ...flags: string[]) {
  const [app, copy, outfile] = ["app", "copy", "built.exe"].map(it => join(dir, it));
  cpSync(app, copy, { recursive: true });
  const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", ...flags, "--outfile", outfile]);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const plain = await run(copy, [bunExe(), "run", "./main.mjs"]);
  const compiled = await run(dir, [outfile], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  return { plain, built, compiled };
}

describe.concurrent("files that are embedded without --asset", () => {
  const say = `const say = (label, read) => {
  try {
    console.log(label, read());
  } catch (error) {
    console.log(label, error.code);
  }
};`;
  const packages = (below: string) => ({
    [`${below}/node_modules/tool/package.json`]: `{ "name": "tool", "version": "1.2.3", "main": "lib/index.cjs" }`,
    [`${below}/node_modules/tool/lib/index.cjs`]: `const fs = require("node:fs"), path = require("node:path");
exports.version = () => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8")).version;
exports.font = () => fs.readFileSync(path.join(__dirname, "../fonts/standard.flf"), "utf8");
exports.has = () => fs.existsSync(__dirname + "/../fonts/standard.flf");
`,
    [`${below}/node_modules/tool/fonts/standard.flf`]: "a font",
    [`${below}/node_modules/tool/fonts/unread.flf`]: "nobody reads it",
    [`${below}/node_modules/@scope/kit/package.json`]: `{ "name": "@scope/kit", "version": "4.5.6", "exports": "./index.mjs" }`,
    [`${below}/node_modules/@scope/kit/index.mjs`]: `import fs from "node:fs";
export const version = () => JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
`,
  });
  const main = `import fs from "node:fs";
import path from "node:path";
import tool from "tool";
import { version } from "@scope/kit";
${say}
say("a CommonJS package's manifest", () => tool.version());
say("its data file", () => tool.font());
say("its data file is there", () => tool.has());
say("an ES package's manifest", () => version());
say("Bun.embeddedFiles", () => Bun.embeddedFiles.map(it => it.name).sort().join());
`;
  const warnings = (built: { stdout: string; stderr: string }) =>
    [...(built.stdout + built.stderr).matchAll(/(warn|note): (TS\d+): [^\n"]*"([^"]+)"/g)]
      .map(it => `${it[1]} ${it[2]} ${it[3].replaceAll("\\", "/")}`)
      .sort();

  const passedOn = {
    "app/node_modules/serve/package.json": `{ "name": "serve", "version": "1.0.0", "main": "index.cjs" }`,
    "app/node_modules/serve/index.cjs": `const fs = require("node:fs"), path = require("node:path");
const read = file => { try { return fs.readFileSync(file, "utf8"); } catch (error) { return error.code; } };
exports.folder = root => name => read(path.join(root, name));
exports.app = () => ({ settings: {}, set(key, value) { this.settings[key] = value; }, render(name) { return read(path.join(this.settings.views, name)); } });
exports.open = options => read(options.file);
exports.own = exports.folder(path.join(__dirname, "pages"));
`,
    "app/node_modules/serve/pages/home.html": "home",
    "app/public/index.html": "index",
    "app/views/page.ejs": "page",
    "app/config.toml": "config",
    "app/commands/one.cjs": "exports.one = 1;",
    "app/notes.txt": "only a function of the project gets it",
    "app/uploads/photo.txt": "photo",
    "app/logs/app.log": "line",
    "app/shared.json": "{}",
    "app/app.sqlite": "",
    "app/read.sqlite": "",
    "app/main.cjs": `const fs = require("node:fs"), path = require("node:path"), { Database } = require("bun:sqlite");
const serve = require("serve");
require("./commands/one.cjs");
const app = serve.app();
app.set("views", path.join(__dirname, "views"));
app.set("root", __dirname);
app.set("root", path.join(__dirname, ".."));
app.set("commands", path.join(__dirname, "commands"));
app.set("missing", path.join(__dirname, "missing"));
const own = folder => folder.length;
own(path.join(__dirname, "notes.txt"));
fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
app.set("uploads", path.join(__dirname, "uploads"));
app.set("log", path.join(__dirname, "logs/app.log"));
app.set("shared", [require("./shared.json"), path.join(__dirname, "shared.json")]);
const report = name => fs.writeFileSync(path.join(__dirname, "logs", name), "");
const open = () => [new Database(path.join(__dirname, "app.sqlite")), new Database(path.join(__dirname, "read.sqlite"), { readonly: true })];
if (process.argv.length > 9) report(String(open()));
console.log(serve.folder(path.join(__dirname, "public"))("index.html"), app.render("page.ejs"), serve.open({ file: path.join(__dirname, "config.toml") }));
`,
  };

  test.each([
    [
      [],
      [
        "warn TS100098 read.sqlite",
        "warn TS100172 config.toml",
        "warn TS100172 public",
        "warn TS100172 shared.json",
        "warn TS100172 views",
      ],
      "ENOENT ENOENT ENOENT\n",
    ],
    [
      ["./public", "./views", "./config.toml", "./shared.json", "./read.sqlite"].flatMap(it => ["--asset", it]),
      [],
      "index page config\n",
    ],
  ])(
    "a warning names what a project passes to a package %j",
    async (flags, expected, stdout) => {
      using dir = tempDir("aot-paths-passed-to-a-package", passedOn);
      const { plain, built, compiled } = await bothWays(String(dir), "./main.cjs", ...flags);
      expect(plain).toEqual({ stdout: "index page config\n", stderr: "", exitCode: 0 });
      expect(warnings(built)).toEqual(expected);
      expect(compiled).toEqual({ stdout, stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test("a package removes by __dirname what its ES module reads", async () => {
    using dir = tempDir("aot-module-reads-removed-file", {
      "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
      "app/node_modules/store/index.mjs": `import fs from "node:fs";
import path from "node:path";
import { change } from "./change.cjs";
const below = name => path.join(import.meta.dirname, name);
const read = name => {
  try {
    return fs.readFileSync(below(name), "utf8");
  } catch (error) {
    return error.code;
  }
};
export const start = () => {
  const kept = [read("kept/a.txt"), read("one.txt"), read("two.txt"), read("same.txt"), read("parts/a.txt")];
  change();
  return kept.concat(
    read("one.txt"),
    read("two.txt"),
    read("same.txt"),
    read("parts/a.txt"),
    read("kept/a.txt"),
    String(fs.existsSync(below("parts"))),
    fs.readdirSync(import.meta.dirname).filter(name => /\\.txt$|parts/.test(name)),
  ).join();
};
`,
      "app/node_modules/store/change.cjs": `const fs = require("node:fs");
const path = require("node:path");
const below = name => path.join(__dirname, name);
exports.change = () => {
  fs.rmSync(below("one.txt"), { force: true });
  fs.renameSync(below("same.txt"), __dirname + "/parts/../same.txt");
  fs.renameSync(below("kept/a.txt"), below("two.txt"));
  fs.rmSync(below("parts"), { recursive: true, force: true });
};
`,
      "app/node_modules/store/one.txt": "1",
      "app/node_modules/store/two.txt": "2",
      "app/node_modules/store/same.txt": "s",
      "app/node_modules/store/kept/a.txt": "k",
      "app/node_modules/store/parts/a.txt": "p",
      "app/main.mjs": `import { start } from "store"; console.log(start());`,
    });
    const app = join(String(dir), "app");
    const outfile = join(String(dir), "built.exe");
    const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const compiled = await run(String(dir), [outfile], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(compiled).toEqual({
      stdout: "k,1,2,s,p,ENOENT,k,s,ENOENT,ENOENT,false,same.txt,two.txt\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  describe.each(["__dirname"])("a package changes its own files by %s", own => {
    const isModule = own !== "__dirname";
    test("beside its sources", async () => {
      using dir = tempDir("aot-package-changes-embedded-files", {
        "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.${isModule ? "mjs" : "cjs"}" }`,
        [`app/node_modules/store/index.${isModule ? "mjs" : "cjs"}`]: `${
          isModule
            ? `import fs from "node:fs"; import os from "node:os"; import path from "node:path";`
            : `const fs = require("node:fs"), os = require("node:os"), path = require("node:path");`
        }
const below = name => path.join(${own}, name);
const start = async () => {
  const said = [];
  const say = (name, run) => {
    try {
      said.push(name + " " + run());
    } catch (error) {
      said.push(name + " " + error.code + " " + error.syscall);
    }
  };
  const read = name => fs.readFileSync(below(name), "utf8");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "store-"));
  say("kept", () => ["one.txt", "log.txt", "run.sh", "moved/a.txt", "same.txt", "other.txt"].map(read).join());
  if (fs.existsSync(below("one.txt"))) say("unlink", () => fs.unlinkSync(below("one.txt")));
  say("again", () => fs.unlinkSync(below("one.txt")));
  if (fs.existsSync(below("run.sh"))) say("chmod", () => fs.chmodSync(below("run.sh"), 0o750));
  say("mode", () => process.platform === "win32" || (fs.statSync(below("run.sh")).mode & 0o777) === 0o750);
  say("utimes", () => fs.utimesSync(below("run.sh"), 5, 7));
  say("times", () => fs.statSync(below("run.sh")).atimeMs + " " + fs.statSync(below("run.sh")).mtimeMs);
  say("out", () => fs.renameSync(below("log.txt"), path.join(temporary, "log.txt")));
  say("there", () => fs.readFileSync(path.join(temporary, "log.txt"), "utf8") + fs.existsSync(below("log.txt")));
  say("nowhere", () => fs.renameSync(below("run.sh"), path.join(temporary, "none", "run.sh")));
  say("left", () => read("run.sh"));
  say("rename", () => fs.renameSync(below("same.txt"), below("same.old")));
  say("over", () => fs.renameSync(below("same.old"), below("other.txt")));
  say("same", () => fs.readFileSync(below("other.txt"), "utf8") + fs.existsSync(below("same.txt")) + fs.existsSync(below("same.old")));
  if (fs.existsSync(below("asked.txt"))) say("asked", () => fs.renameSync(below("asked.txt"), below("asked.old")));
  say("asked", () => fs.existsSync(below("asked.txt")) + " " + fs.existsSync(below("asked.old")));
  say("cp", () => fs.cpSync(below("other.txt"), path.join(temporary, "copy.txt")));
  say("copy", () => fs.readFileSync(path.join(temporary, "copy.txt"), "utf8"));
  say("rm", () => fs.rmSync(below("moved"), { recursive: true }));
  say("gone", () => fs.existsSync(below("moved/a.txt")));
  await fs.promises.unlink(below("run.sh"));
  say("end", () => fs.existsSync(below("run.sh")));
  fs.rmSync(temporary, { recursive: true });
  return said.join("\\n").replaceAll(path.sep, "/");
};
${isModule ? "export { start };" : "exports.start = start;"}
`,
        "app/node_modules/store/one.txt": "1",
        "app/node_modules/store/log.txt": "l",
        "app/node_modules/store/run.sh": "r",
        "app/node_modules/store/moved/a.txt": "m",
        "app/node_modules/store/same.txt": "s",
        "app/node_modules/store/other.txt": "o",
        "app/node_modules/store/asked.txt": "asked",
        "app/main.mjs": `import { start } from "store"; console.log(await start());`,
      });
      const { plain, built, compiled } = await plainAndBeside(String(dir));
      expect(warnings(built)).toEqual([]);
      const expected = `kept 1,l,r,m,s,o
unlink undefined
again ENOENT unlink
chmod undefined
mode true
utimes undefined
times 5000 7000
out undefined
there lfalse
nowhere ENOENT rename
left r
rename undefined
over undefined
same sfalsefalse
asked undefined
asked false true
cp undefined
copy s
rm undefined
gone false
end false
`;
      expect(plain.stdout).toBe(expected);
      expect(compiled).toEqual(plain);
    }, 120_000);
  });

  test.each(["__dirname"])(
    "a package renames a folder of its own files by %s",
    async own => {
      const isModule = own !== "__dirname";
      const index = isModule ? "index.mjs" : "index.cjs";
      using dir = tempDir("aot-module-renames-embedded-folder", {
        "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./${index}" }`,
        [`app/node_modules/store/${index}`]: `${
          isModule
            ? `import fs from "node:fs"; import os from "node:os"; import path from "node:path";`
            : `const fs = require("node:fs"), os = require("node:os"), path = require("node:path");`
        }
const below = name => path.join(${own}, name);
const list = folder => fs.readdirSync(folder, { recursive: true }).sort().join();
const start = () => {
  const said = [list(path.join(${own}, "data"))];
  fs.renameSync(below("data"), below("old"));
  said.push(fs.existsSync(below("data")), list(below("old")), fs.readFileSync(below("old/sub/b.txt"), "utf8"));
  fs.renameSync(below("old/sub"), below("data"));
  said.push(list(below("data")), list(below("old")), fs.statSync(below("data")).isDirectory());
  try {
    fs.rmdirSync(below("data"));
  } catch (error) {
    said.push(error.code);
  }
  fs.rmSync(below("old"), { recursive: true });
  said.push(fs.existsSync(below("old")), fs.readdirSync(${own}).filter(name => /data|old/.test(name)));
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "store-"));
  fs.renameSync(below("data"), path.join(temporary, "data"));
  said.push(list(temporary), fs.readFileSync(path.join(temporary, "data/b.txt"), "utf8"), fs.existsSync(below("data")));
  fs.rmSync(temporary, { recursive: true });
  return said.join(" ").replaceAll(path.sep, "/");
};
${isModule ? "export { start };" : "exports.start = start;"}
`,
        "app/node_modules/store/data/a.txt": "a",
        "app/node_modules/store/data/sub/b.txt": "b",
        "app/main.mjs": `import { start } from "store"; console.log(start());`,
      });
      const { plain, built, compiled } = await plainAndBeside(String(dir));
      expect(warnings(built)).toEqual([]);
      expect(plain.stdout).toBe(
        "a.txt,sub,sub/b.txt false a.txt,sub,sub/b.txt b b.txt a.txt true ENOTEMPTY false data data,data/b.txt b false\n",
      );
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test.each([
    ["__dirname"],
    ["import.meta.dirname"],
    ["__dirname", "--asset", "./node_modules/store/data"],
    ["import.meta.dirname", "--asset", "./node_modules/store/data"],
  ])(
    "a program reads what is embedded and is refused what would change it, away from its sources, by %s %s",
    async (own, ...flags) => {
      const index = own === "__dirname" ? "index.cjs" : "index.mjs";
      const refused: Record<string, string> = {
        "writeFileSync": `fs.writeFileSync(a, "x")`,
        "appendFileSync": `fs.appendFileSync(a, "x")`,
        "promises.writeFile": `await fs.promises.writeFile(a, "x")`,
        "Bun.write": `await Bun.write(a, "x")`,
        "a new file": `fs.writeFileSync(at("new.txt"), "x")`,
        "open r+": `fs.openSync(a, "r+")`,
        "truncate": `fs.truncateSync(a, 1)`,
        "copy onto": `fs.copyFileSync(at("b.txt"), a)`,
        "unlink": `fs.unlinkSync(a)`,
        "promises.unlink": `await fs.promises.unlink(a)`,
        "rm": `fs.rmSync(a)`,
        "rm of the folder": `fs.rmSync(data, { recursive: true })`,
        "rmdir": `fs.rmdirSync(at("below"))`,
        "rename": `fs.renameSync(a, at("c.txt"))`,
        "rename out": `fs.renameSync(a, path.join(os.tmpdir(), "aot-none", "a.txt"))`,
        "rename of the folder": `fs.renameSync(data, data + "-moved")`,
        "rename onto itself": `fs.renameSync(a, a)`,
        "mkdir": `fs.mkdirSync(at("logs"))`,
        "mkdtemp": `fs.mkdtempSync(at("t-"))`,
        "chmod": `fs.chmodSync(a, 0o600)`,
        "chmod of the folder": `fs.chmodSync(data, 0o700)`,
        "utimes": `fs.utimesSync(a, 1, 2)`,
      };
      using dir = tempDir("aot-changes-are-refused", {
        "app/main.mjs": `import { start } from "store"; await start();`,
        "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./${index}" }`,
        [`app/node_modules/store/${index}`]: `${
          index === "index.mjs"
            ? `import fs from "node:fs"; import os from "node:os"; import path from "node:path";`
            : `const fs = require("node:fs"), os = require("node:os"), path = require("node:path");`
        }
const data = path.join(${own}, "data"), at = name => path.join(data, name), a = at("a.txt");
const read = () => [
  ["a.txt", "b.txt", "below/d.txt"].map(name => fs.readFileSync(path.join(${own}, "data", name), "utf8")),
  fs.readdirSync(data).sort(),
  fs.readdirSync(data, { recursive: true }).length,
  [...new Bun.Glob("**/*").scanSync({ cwd: data })].length,
  fs.existsSync(a), fs.statSync(a).size, fs.existsSync(at("new.txt")),
].join(" ");
const start = async () => {
  const before = read();
  console.log(before);
  const say = async (name, change) => {
    let said = "done";
    try { await change(); } catch (error) { said = ["ENOENT", "ENOTEMPTY", "EROFS"].includes(error.code) ? "refused" : error.code; }
    console.log(name, said, read() === before ? "" : read());
  };
${Object.entries(refused)
  .map(([name, change]) => `  await say(${JSON.stringify(name)}, async () => { ${change}; });`)
  .join("\n")}
};
${index === "index.mjs" ? "export { start };" : "exports.start = start;"}
`,
        ...Object.fromEntries(
          ["a.txt", "b.txt", "below/d.txt"].map(name => [`app/node_modules/store/data/${name}`, name.at(-5)!]),
        ),
      });
      const app = join(String(dir), "app");
      const outfile = join(String(dir), "built.exe");
      const built = await run(app, [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "./main.mjs",
        ...flags,
        "--outfile",
        outfile,
      ]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      renameSync(app, join(String(dir), "moved-away"));
      const lines = Object.keys(refused).map(name => `${name} refused \n`);
      expect(await run(String(dir), [outfile], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual({
        stdout: `a,b,d a.txt,b.txt,below 4 3 true 1 false\n${lines.join("")}`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.each([[], ["--asset", "./node_modules/store/data"]])(
    "a package scans a folder with a glob and opens a database for reading %j",
    async (...flags) => {
      using dir = tempDir("aot-globs-and-databases", {
        "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
        "app/node_modules/store/index.mjs": `import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
const data = path.join(import.meta.dirname, "data");
const open = name => {
  const database = new Database(path.join(import.meta.dirname, "data", name), { readonly: true });
  const { word } = database.query("select word from words").get();
  let written;
  try {
    database.run("insert into words values ('b')");
    written = "written";
  } catch {
    written = "read-only";
  }
  database.close();
  return word + " " + written;
};
export const start = () => [
  [...new Bun.Glob("*.txt").scanSync(path.join(import.meta.dirname, "data"))].sort().join(),
  fs.globSync("*.txt", { cwd: path.join(import.meta.dirname, "data") }).sort().join(),
  open("plain.sqlite"),
  open("ahead.sqlite"),
  open("busy.sqlite"),
].join(" ");
`,
        "app/node_modules/store/data/a.txt": "a",
        "app/node_modules/store/data/b.txt": "b",
        "app/make.mjs": `import { Database } from "bun:sqlite";
import fs from "node:fs";
for (const [name, mode] of [["plain", "delete"], ["ahead", "wal"]]) {
  const database = new Database("./node_modules/store/data/" + name + ".sqlite");
  database.run("pragma journal_mode = " + mode);
  database.run("create table words (word)");
  database.run("insert into words values ('a')");
  database.run("pragma wal_checkpoint(truncate)");
  database.close();
}
// Its commits are in the log alone.
const busy = new Database("./busy.sqlite");
busy.run("pragma journal_mode = wal");
busy.run("create table words (word)");
busy.run("insert into words values ('a')");
for (const end of ["", "-wal"]) fs.copyFileSync("./busy.sqlite" + end, "./node_modules/store/data/busy.sqlite" + end);
busy.close();
`,
        "app/main.mjs": `import { start } from "store"; console.log(start());`,
      });
      const app = join(String(dir), "app");
      expect(await run(app, [bunExe(), "run", "./make.mjs"])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs", ...flags);
      expect(warnings(built)).toEqual([]);
      expect(plain).toEqual({
        stdout: "a.txt,b.txt a.txt,b.txt a read-only a read-only a read-only\n",
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("the asynchronous forms of node:fs answer as the synchronous ones", async () => {
    using dir = tempDir("aot-asynchronous-forms-of-fs", {
      "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.cjs" }`,
      "app/node_modules/store/index.cjs": `const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const data = path.join(__dirname, "data");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "aot-forms-"));
const answer = async ask => {
  try {
    return JSON.stringify(await ask());
  } catch (error) {
    return error.code;
  }
};
const both = async (label, ask) => {
  const answers = [await answer(() => ask(false)), await answer(() => ask(true))];
  console.log(label, ...new Set(answers));
};
let count = 0;
const cp = (from, options) => async isAsynchronous => {
  const to = path.join(temporary, options ? "0" : String(count++));
  await (isAsynchronous ? fs.promises.cp(from, to, options) : fs.cpSync(from, to, options));
  return fs.readFileSync(to, "utf8");
};
const list = options => async isAsynchronous => {
  const entries = isAsynchronous ? await fs.promises.readdir(data, options) : fs.readdirSync(data, options);
  return entries.map(it => (it.name ? path.relative(__dirname, path.join(it.parentPath, it.name)) : String(it)).replaceAll(path.sep, "/")).sort();
};
exports.start = async () => {
  fs.readFileSync(path.join(__dirname, "data/a.txt"), "utf8");
  fs.readdirSync(path.join(__dirname, "data"), { recursive: true });
  await both("cp", cp(path.join(data, "a.txt")));
  await both("cp over", cp(path.join(data, "below/b.txt"), { force: false }));
  await both("cp over, told", cp(path.join(data, "a.txt"), { force: false, errorOnExist: true }));
  await both("cp of nothing", cp(path.join(data, "absent.txt")));
  fs.mkdirSync(path.join(data, "below"), { recursive: true });
  fs.writeFileSync(path.join(data, "below/made.txt"), "made");
  await both("list", list({ recursive: true }));
  await both("list with types", list({ recursive: true, withFileTypes: true }));
  await both("list in bytes", list({ recursive: true, encoding: "buffer" }));
  if (process.getuid) {
    const file = path.join(data, "a.txt"), { uid } = fs.statSync(file);
    fs.chownSync(file, -1, process.getgid());
    console.log("group", fs.statSync(file).uid === uid, fs.statSync(file).gid === process.getgid());
    fs.chownSync(file, process.getuid(), -1);
    console.log("user", fs.statSync(file).uid === process.getuid(), fs.statSync(file).gid === process.getgid());
  }
  fs.rmSync(temporary, { recursive: true });
};
`,
      "app/node_modules/store/data/a.txt": "a",
      "app/node_modules/store/data/below/b.txt": "b",
      "app/main.mjs": `import { start } from "store"; await start();`,
    });
    const { plain, compiled } = await plainAndBeside(String(dir));
    const list = `["a.txt","below","below/b.txt","below/made.txt"]`;
    const listBelowData = `["data/a.txt","data/below","data/below/b.txt","data/below/made.txt"]`;
    const owner = isWindows ? "" : "group true true\nuser true true\n";
    expect(plain).toEqual({
      stdout: `cp "a"\ncp over "a"\ncp over, told ERR_FS_CP_EEXIST\ncp of nothing ENOENT\nlist ${list}\nlist with types ${listBelowData}\nlist in bytes ${list}\n${owner}`,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  });

  test("a file that a package has written is the one on the disk for every reader", async () => {
    using dir = tempDir("aot-written-file-by-every-reader", {
      "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
      "app/node_modules/store/below.cjs": `exports.below = name => require("node:path").join(__dirname, name);`,
      "app/node_modules/store/index.mjs": `import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { $ } from "bun";
import { below } from "./below.cjs";
const own = name => path.join(import.meta.dirname, name);
const readers = {
  mmap: file => (process.platform === "win32" ? fs.readFileSync(file, "utf8") : new TextDecoder().decode(Bun.mmap(file))),
  "the shell": async file => (await $\`cat < \${file}\`.text()).trim(),
  open: file => {
    const descriptor = fs.openSync(file);
    try {
      return fs.readFileSync(descriptor, "utf8");
    } finally {
      fs.closeSync(descriptor);
    }
  },
  "a file object": file => Bun.file(file).text(),
};
export const start = async () => {
  const said = [];
  const read = async (label, name) => {
    for (const [reader, text] of Object.entries(readers)) said.push(label + " " + reader + " " + (await text(own(name))));
  };
  for (const name of ["a", "b", "c", "d", "e", "f", "g"]) said.push(fs.readFileSync(own("data/" + name + ".txt"), "utf8"));
  await read("embedded", "data/a.txt");
  fs.writeFileSync(below("data/a.txt"), "written");
  await read("written", "data/a.txt");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "store-"));
  const made = name => (fs.writeFileSync(path.join(temporary, name), name), path.join(temporary, name));
  fs.mkdirSync(below("data"), { recursive: true });
  fs.cpSync(made("cpSync"), below("data/b.txt"));
  await fs.promises.cp(made("cp"), below("data/c.txt"));
  await $\`mv \${made("mv")} \${below("data/d.txt")}\`;
  await Bun.write(below("data/e.txt"), "Bun.write");
  for (const name of ["b", "c", "d", "e"]) said.push(fs.readFileSync(own("data/" + name + ".txt"), "utf8"));
  fs.rmSync(below("data/a.txt"));
  fs.writeFileSync(below("data/a.txt"), "again");
  await read("again", "data/a.txt");
  fs.rmSync(temporary, { recursive: true });
  return said.join("\\n");
};
`,
      ...Object.fromEntries(
        ["a", "b", "c", "d", "e", "f", "g"].map(it => [`app/node_modules/store/data/${it}.txt`, "first"]),
      ),
      "app/main.mjs": `import { start } from "store"; console.log(await start());`,
    });
    const { plain, compiled } = await plainAfterBuild(String(dir), "node_modules/store", "node_modules/store/data");
    const readers = ["mmap", "the shell", "open", "a file object"];
    expect(plain).toEqual({
      stdout: [
        ...Array(7).fill("first"),
        ...readers.map(it => `embedded ${it} first`),
        ...readers.map(it => `written ${it} written`),
        ...["cpSync", "cp", "mv", "Bun.write"],
        ...readers.map(it => `again ${it} again`),
        "",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.each([
    ["removes a folder", ["remove"], "first"],
    ["starts a process", ["start"], "changed"],
    ["removes a folder, and starts a process later", ["remove", "start later"], "first"],
  ])(
    "another process writes a file of a package after the program %s",
    async (_, deeds, expected) => {
      using dir = tempDir("aot-files-of-a-package-changed-by-others", {
        "app/package.json": `{ "name": "app" }`,
        "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
        "app/node_modules/store/below.cjs": `exports.below = name => require("node:path").join(__dirname, name);`,
        "app/node_modules/store/index.mjs": `import fs from "node:fs";
import path from "node:path";
export { below } from "./below.cjs";
export const read = () => fs.readFileSync(path.join(import.meta.dirname, "a.txt"), "utf8");
`,
        "app/node_modules/store/a.txt": "first",
        "app/main.mjs": `import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { below, read } from "store";
const deeds = process.argv.slice(2);
const start = () => Bun.spawnSync({ cmd: [process.env.BUN_OF_TEST, "--version"], stdout: "ignore" });
if (deeds.includes("start")) start();
if (deeds.includes("remove")) fs.rmSync(fs.mkdtempSync(path.join(os.tmpdir(), "store-")), { recursive: true });
console.log("ready");
for await (const _ of console) break;
if (deeds.includes("start later")) start();
console.log(read(), path.basename(below("a.txt")));
`,
      });
      const app = join(String(dir), "app");
      const outfile = join(String(dir), "built.exe");
      const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", outfile]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      const env = { ...bunEnv, BUN_OF_TEST: bunExe() };
      await using program = Bun.spawn({ cmd: [outfile, ...deeds], cwd: app, env, stdin: "pipe", stdout: "pipe" });
      let said = "";
      for await (const bytes of program.stdout) {
        said += new TextDecoder().decode(bytes);
        if (said.trim() !== "ready") continue;
        writeFileSync(join(app, "node_modules/store/a.txt"), "changed");
        program.stdin.write("go\n");
        program.stdin.end();
      }
      expect(said.split(/\r?\n/)).toEqual(["ready", expected + " a.txt", ""]);
      expect(await program.exited).toBe(0);
    },
    120_000,
  );

  test("a data file that a package has written is loaded as it is on the disk", async () => {
    using dir = tempDir("aot-written-data-file", {
      "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
      "app/node_modules/store/below.cjs": `exports.below = name => require("node:path").join(__dirname, name); exports.load = name => require(name);`,
      "app/node_modules/store/index.mjs": `import fs from "node:fs";
import path from "node:path";
import { below, load } from "./below.cjs";
const ways = { own: name => path.join(import.meta.dirname, name), below };
const made = name => Buffer.from(name).toString();
export const start = async () => {
  const said = [];
  for (const name of ["a", "b", "c", "d", "e"]) said.push(JSON.parse(fs.readFileSync(ways.own(name + ".json"), "utf8")).word);
  fs.mkdirSync(below(""), { recursive: true });
  for (const [way, at] of Object.entries(ways)) {
    const [required, imported] = way === "own" ? ["a", "b"] : ["c", "d"];
    for (const name of [required, imported]) fs.writeFileSync(below(name + ".json"), '{ "word": "written" }');
    said.push(way, load(at(made(required + ".json"))).word, (await import(at(made(imported + ".json")))).default.word);
  }
  const loaded = load(ways.own(made("e.json")));
  fs.writeFileSync(below("e.json"), '{ "word": "written" }');
  said.push(loaded.word, load(ways.own(made("e.json"))) === loaded);
  return said.join();
};
`,
      ...Object.fromEntries(
        ["a", "b", "c", "d", "e"].map(it => [`app/node_modules/store/${it}.json`, `{ "word": "first" }`]),
      ),
      "app/main.mjs": `import { start } from "store"; console.log(await start());`,
    });
    const { plain, compiled } = await plainAfterBuild(String(dir));
    expect(plain).toEqual({
      stdout: "first,first,first,first,first,own,written,written,below,written,written,first,true\n",
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("a file that a package has written is read by every form of its path", async () => {
    using dir = tempDir("aot-written-file-by-every-path-form", {
      "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./index.mjs" }`,
      "app/node_modules/store/below.cjs": `exports.below = name => require("node:path").join(__dirname, name);`,
      "app/node_modules/store/index.mjs": `import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { below } from "./below.cjs";
const file = path.join(import.meta.dirname, "a.txt");
const bytes = text => new TextEncoder().encode(text);
const forms = {
  string: file,
  Buffer: Buffer.from(file),
  Uint8Array: bytes(file),
  URL: pathToFileURL(file),
  "not normalized": import.meta.dirname + "/./a.txt",
  "Buffer, not normalized": Buffer.from(import.meta.dirname + "/./a.txt"),
};
export const start = async () => {
  const said = [fs.readFileSync(file, "utf8"), fs.readFileSync(Buffer.from(file), "utf8")];
  fs.writeFileSync(below("a.txt"), "written");
  for (const [name, form] of Object.entries(forms)) {
    const texts = [fs.readFileSync(form, "utf8"), await fs.promises.readFile(form, "utf8"), fs.statSync(form).size];
    said.push(name + ": " + texts.join());
  }
  said.push(await Bun.file(Buffer.from(file)).text());
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "store-"));
  if (process.platform !== "win32") {
    fs.symlinkSync(Buffer.from(file), path.join(temporary, "link"));
    said.push(fs.readFileSync(path.join(temporary, "link"), "utf8"));
  }
  fs.copyFileSync(Buffer.from(file), path.join(temporary, "copy.txt"));
  said.push(fs.readFileSync(path.join(temporary, "copy.txt"), "utf8"));
  const before = process.cwd();
  process.chdir(import.meta.dirname);
  said.push(fs.readFileSync("a.txt", "utf8"), fs.readFileSync(Buffer.from("a.txt"), "utf8"));
  process.chdir(before);
  fs.rmSync(temporary, { recursive: true });
  return said.join("\\n");
};
`,
      "app/node_modules/store/a.txt": "first",
      "app/main.mjs": `import { start } from "store"; console.log(await start());`,
    });
    const { plain, compiled } = await plainAfterBuild(String(dir), "node_modules/store");
    const forms = ["string", "Buffer", "Uint8Array", "URL", "not normalized", "Buffer, not normalized"];
    const texts = Array(isWindows ? 4 : 5).fill("written");
    expect(plain).toEqual({
      stdout: ["first", "first", ...forms.map(it => `${it}: written,written,7`), ...texts, ""].join("\n"),
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  // On Windows a file that was opened keeps its bytes.
  test.skipIf(isWindows).each(["__dirname", "import.meta.dirname"])(
    "a package writes a file of its own that it has open by %s",
    async own => {
      const isModule = own !== "__dirname";
      const index = isModule ? "index.mjs" : "index.cjs";
      using dir = tempDir("aot-writes-open-embedded-file", {
        "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "exports": "./${index}" }`,
        "app/node_modules/store/below.cjs": `exports.below = name => require("node:path").join(__dirname, name);`,
        [`app/node_modules/store/${index}`]: `${isModule ? `import fs from "node:fs"; import path from "node:path"; import { below } from "./below.cjs";` : `const fs = require("node:fs"), path = require("node:path"), { below } = require("./below.cjs");`}
const start = async () => {
  const said = [];
  const handle = await fs.promises.open(path.join(${own}, "a.txt"));
  const begun = fs.openSync(path.join(${own}, "b.txt"));
  said.push(String((await handle.read(Buffer.alloc(2), 0, 2, 0)).buffer), fs.readSync(begun, Buffer.alloc(2)));
  fs.writeFileSync(below("a.txt"), "written");
  fs.writeFileSync(below("b.txt"), "first and more");
  said.push(await handle.readFile("utf8"), (await handle.stat()).size, fs.readFileSync(begun, "utf8"), fs.fstatSync(begun).size);
  fs.writeFileSync(below("a.txt"), "again");
  said.push((await handle.stat()).size, fs.readFileSync(below("a.txt"), "utf8"));
  fs.unlinkSync(below("a.txt"));
  said.push((await handle.stat()).size, fs.existsSync(below("a.txt")));
  await handle.close();
  fs.closeSync(begun);
  const streamed = fs.openSync(path.join(${own}, "d.txt"));
  await Bun.write(below("d.txt"), new Response(new ReadableStream({ start(it) { it.enqueue("streamed"); it.close(); } })));
  said.push(fs.readFileSync(streamed, "utf8"));
  fs.closeSync(streamed);
  const later = fs.openSync(path.join(${own}, "c.txt"));
  fs.closeSync(later);
  const other = fs.openSync(process.execPath);
  fs.writeFileSync(below("c.txt"), "c");
  said.push(fs.fstatSync(other).size > 1000);
  return said.join();
};
${isModule ? "export { start };" : "exports.start = start;"}
`,
        "app/node_modules/store/a.txt": "first",
        "app/node_modules/store/b.txt": "first",
        "app/node_modules/store/c.txt": "first",
        "app/node_modules/store/d.txt": "first",
        "app/main.mjs": `import { start } from "store"; console.log(await start());`,
      });
      const { plain, compiled } = await plainAfterBuild(String(dir), "node_modules/store");
      expect(plain).toEqual({
        stdout: "fi,2,written,7,rst and more,14,5,again,5,false,streamed,true\n",
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("what a package reads by a known path, and the program's own package.json", async () => {
    using dir = tempDir("aot-package-files-embedded-unasked", {
      ...packages("app/server"),
      "app/server/package.json": `{ "name": "server", "version": "7.8.9" }`,
      "app/server/src/main.mjs": `${main}
const here = import.meta.dirname;
say("the program's manifest", () => JSON.parse(fs.readFileSync(path.join(here, "..", "package.json"), "utf8")).version);
say("the program's data", () => fs.readFileSync(path.join(here, "data.txt"), "utf8"));
say("the program's secrets", () => fs.readFileSync(path.join(here, "..", ".env"), "utf8"));
// The build cannot see this name, so it is no read that it knows.
const made = Buffer.from("fonts/unread.flf").toString();
say("what nobody reads", () => fs.existsSync(path.join(here, "..", "node_modules", "tool", made)));
`,
      "app/server/src/data.txt": "data",
      "app/server/.env": "SECRET=1",
    });
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app/server", "./src/main.mjs");
    const embedded = `a CommonJS package's manifest 1.2.3
its data file a font
its data file is there true
an ES package's manifest 4.5.6
Bun.embeddedFiles 
the program's manifest 7.8.9
`;
    expect(plain.stdout).toBe(
      `${embedded}the program's data data\nthe program's secrets SECRET=1\nwhat nobody reads true\n`,
    );
    expect(compiled).toEqual({
      stdout: `${embedded}the program's data ENOENT\nthe program's secrets ENOENT\nwhat nobody reads false\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(warnings(built)).toEqual(["warn TS100098 .env", "warn TS100098 src/data.txt"]);
  }, 120_000);

  test("--explain lists them", async () => {
    using dir = tempDir("aot-package-files-listed", {
      ...packages("app/server"),
      "app/server/package.json": `{ "name": "server" }`,
      "app/server/main.mjs": main,
    });
    const { built } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--explain");
    expect(warnings(built).filter(it => it.includes("TS100166"))).toEqual([
      "note TS100166 node_modules/@scope/kit/package.json",
      "note TS100166 node_modules/tool/fonts/standard.flf",
      "note TS100166 node_modules/tool/package.json",
    ]);
  }, 120_000);

  test("packages that are installed above the root", async () => {
    using dir = tempDir("aot-package-files-above-the-root", {
      ...packages("app"),
      "app/package.json": `{ "name": "workspace" }`,
      "app/packages/server/package.json": `{ "name": "server" }`,
      "app/packages/server/main.mjs": main,
    });
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app/packages/server", "./main.mjs");
    expect(compiled).toEqual(plain);
    expect(plain.stdout).toContain("an ES package's manifest 4.5.6\n");
    expect(warnings(built)).toEqual([]);
  }, 120_000);

  test("an asset that holds the file, and a large file", async () => {
    using dir = tempDir("aot-package-files-given-or-large", {
      ...packages("app/server"),
      "app/server/package.json": `{ "name": "server" }`,
      "app/server/node_modules/big/package.json": `{ "name": "big", "main": "index.cjs" }`,
      "app/server/node_modules/big/index.cjs": `module.exports = () => require("node:fs").readFileSync(__dirname + "/table.bin").length;`,
      "app/server/node_modules/big/table.bin": Buffer.alloc(11 * 1024 * 1024, 1),
      "app/server/main.mjs": `${main}
import size from "big";
say("a large file", () => size());
`,
    });
    const flags = ["--asset", "node_modules/tool"];
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    const list = /^Bun\.embeddedFiles (.*)\n/m;
    expect(compiled.stdout.replace(list, "")).toBe(plain.stdout.replace(list, ""));
    expect(plain.stdout).toContain(`a large file ${11 * 1024 * 1024}\n`);
    // What was asked for is listed, and nothing else.
    const listed = list.exec(compiled.stdout)![1].replaceAll("\\", "/").split(",");
    expect(listed).toContain("node_modules/tool/package.json");
    expect(listed.filter(name => !name.startsWith("node_modules/tool/"))).toEqual([]);
    expect((built.stdout + built.stderr).replaceAll("\\", "/")).toContain(
      `warn: the executable embeds "node_modules/big/table.bin", which a package reads: 11 MB`,
    );
  }, 120_000);

  test.skipIf(isWindows)(
    "a read through a link in node_modules keeps its warning",
    async () => {
      const store = "app/node_modules/.store/stored@1.0.0/node_modules";
      using dir = tempDir("aot-package-files-behind-links", {
        [`${store}/stored/package.json`]: `{ "name": "stored", "version": "1.0.0", "type": "module", "exports": "./index.js" }`,
        [`${store}/stored/index.js`]: `import fs from "node:fs";
export const own = () => JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
export const ofDependency = () => fs.readFileSync(new URL("../needed/data.txt", import.meta.url), "utf8");
export const throughLink = () => fs.readFileSync(new URL("./outward/secret.txt", import.meta.url), "utf8");
`,
        "app/node_modules/.store/needed@2.0.0/node_modules/needed/package.json": `{ "name": "needed", "version": "2.0.0" }`,
        "app/node_modules/.store/needed@2.0.0/node_modules/needed/data.txt": "needed",
        "app/packages/member/package.json": `{ "name": "member", "version": "3.0.0" }`,
        "app/packages/member/data.txt": "member",
        "app/private/secret.txt": "secret",
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import { own, ofDependency, throughLink } from "stored";
${say}
const here = import.meta.dirname;
say("a stored package's own manifest", () => own());
say("by the link in node_modules", () => fs.readFileSync(path.join(here, "node_modules/stored/package.json"), "utf8").length > 0);
say("is it there", () => fs.existsSync(path.join(here, "node_modules/stored/package.json")));
say("a dependency by its sibling link", () => ofDependency());
say("a workspace member by its link", () => fs.readFileSync(path.join(here, "node_modules/member/data.txt"), "utf8"));
say("the application's file by a link in a package", () => throughLink());
`,
      });
      symlinkSync(".store/stored@1.0.0/node_modules/stored", join(String(dir), "app/node_modules/stored"));
      symlinkSync("../../needed@2.0.0/node_modules/needed", join(String(dir), store, "needed"));
      symlinkSync("../packages/member", join(String(dir), "app/node_modules/member"));
      symlinkSync("../../../../../private", join(String(dir), store, "stored/outward"));
      const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs");
      expect(plain.stdout).toBe(`a stored package's own manifest 1.0.0
by the link in node_modules true
is it there true
a dependency by its sibling link needed
a workspace member by its link member
the application's file by a link in a package secret
`);
      expect(compiled).toEqual({
        stdout: `a stored package's own manifest 1.0.0
by the link in node_modules ENOENT
is it there false
a dependency by its sibling link ENOENT
a workspace member by its link ENOENT
the application's file by a link in a package ENOENT
`,
        stderr: "",
        exitCode: 0,
      });
      // Each read that fails is warned of.
      expect(warnings(built)).toEqual([
        "warn TS100098 node_modules/.store/stored@1.0.0/node_modules/needed/data.txt",
        "warn TS100098 node_modules/.store/stored@1.0.0/node_modules/stored/outward/secret.txt",
        "warn TS100098 node_modules/member/data.txt",
        "warn TS100098 node_modules/stored/package.json",
        "warn TS100098 node_modules/stored/package.json",
      ]);
    },
    120_000,
  );

  test("a file that is only asked about has its bytes where a path is unknown, and one read on another platform is not there", async () => {
    const elsewhere = isWindows ? "linux" : "win32";
    using dir = tempDir("aot-package-files-only-asked-about", {
      "app/node_modules/starter/package.json": `{ "name": "starter", "main": "index.cjs" }`,
      "app/node_modules/starter/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.asks = {
  "a program that is tested for": () => fs.existsSync(path.join(__dirname, "vendor", "helper.bin")),
  "its size": () => fs.statSync(path.join(__dirname, "vendor", "helper.bin")).size,
  "may it be read": () => (fs.accessSync(path.join(__dirname, "vendor", "helper.bin")), "yes"),
  "a script that is tested for": () => fs.existsSync(path.join(__dirname, "client.txt")),
  "a library asked about in front of the read": () => fs.existsSync(path.join(__dirname, "both.bin")),
  "and read": () => fs.readFileSync(path.join(__dirname, "both.bin")).length,
  "opened": () => (fs.closeSync(fs.openSync(path.join(__dirname, "opened.txt"), "r")), "yes"),
};
exports.elsewhere = () => {
  if (process.platform === "${elsewhere}") return fs.readFileSync(path.join(__dirname, "elsewhere.txt"), "utf8");
  return "not here";
};
`,
      "app/node_modules/starter/vendor/helper.bin": "MZ a program",
      "app/node_modules/starter/client.txt": "a script",
      "app/node_modules/starter/both.bin": "\x7fELF a library",
      "app/node_modules/starter/opened.txt": "opened",
      "app/node_modules/starter/elsewhere.txt": "elsewhere",
      "app/package.json": `{ "name": "server" }`,
      "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import starter from "starter";
${say}
for (const [label, ask] of Object.entries(starter.asks)) say(label, ask);
say("read on another platform", starter.elsewhere);
// The build cannot see these names, so they are no reads that it knows.
const made = (...names) => path.join(import.meta.dirname, "node_modules", "starter", ...names.map(name => Buffer.from(name).toString()));
say("is that file there", () => fs.existsSync(made("elsewhere.txt")));
say("the program's bytes", () => fs.readFileSync(made("vendor", "helper.bin"), "utf8"));
say("the script's bytes", () => fs.readFileSync(made("client.txt"), "utf8"));
say("the program, mapped", () => Bun.mmap(made("vendor", "helper.bin")).length);
say("it is listed", () => fs.readdirSync(made("vendor")).join());
// A path whose first folders the build knows is a pattern, which brings every file below them.
const load = name => import(Buffer.from(made(name)).toString()).then(it => it.default, error => error.code);
console.log("imported, it answers as a file that is left out", (await load("client.txt")) === (await load("elsewhere.txt")));
`,
    });
    const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs");
    const read = `a script that is tested for true\na library asked about in front of the read true\nand read 14\nopened yes\nread on another platform not here\n`;
    const asked = `a program that is tested for true\nits size 12\nmay it be read yes\n${read}`;
    // Windows has no Bun.mmap(), whose error has no code.
    const mapped = (answer: string) => `the program, mapped ${isWindows ? undefined : answer}`;
    expect(plain.stdout).toBe(
      `${asked}is that file there true\nthe program's bytes MZ a program\nthe script's bytes a script\n${mapped("12")}\nit is listed helper.bin\nimported, it answers as a file that is left out false\n`,
    );
    // The program reads paths that aren't known, so what it finds there can be read. A program of machine code isn't there, and that is told.
    expect(compiled).toEqual({
      stdout: `a program that is tested for false\nits size ENOENT\nmay it be read ENOENT\n${read}is that file there false\nthe program's bytes ENOENT\nthe script's bytes a script\n${mapped("ENOENT")}\nit is listed ENOENT\nimported, it answers as a file that is left out false\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(warnings(built)).toEqual(Array(3).fill("warn TS100098 node_modules/starter/vendor/helper.bin"));
  }, 120_000);

  // Whoever may open every file sees no difference.
  test.skipIf(!!without("an unprivileged user") || isWindows)(
    "a read of a file that cannot be opened keeps its warning",
    async () => {
      using dir = tempDir("aot-package-files-that-cannot-be-opened", {
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.isThere = () => fs.existsSync(path.join(__dirname, "asked.txt"));
exports.read = () => fs.readFileSync(path.join(__dirname, "read.txt"), "utf8");
exports.isOtherThere = () => fs.existsSync(path.join(__dirname, "both.txt"));
exports.readOther = () => fs.readFileSync(path.join(__dirname, "both.txt"), "utf8");
`,
        "app/node_modules/keeper/asked.txt": "asked",
        "app/node_modules/keeper/read.txt": "read",
        "app/node_modules/keeper/both.txt": "both",
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
${say}
say("asked about", keeper.isThere);
say("read", keeper.read);
say("another asked about", keeper.isOtherThere);
say("and read", keeper.readOther);
`,
      });
      for (const name of ["asked.txt", "read.txt", "both.txt"])
        chmodSync(join(String(dir), "app/node_modules/keeper", name), 0);
      const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs");
      expect(plain.stdout).toBe("asked about true\nread EACCES\nanother asked about true\nand read EACCES\n");
      expect(compiled).toEqual({
        stdout: "asked about true\nread ENOENT\nanother asked about true\nand read ENOENT\n",
        stderr: "",
        exitCode: 0,
      });
      expect(warnings(built).toSorted()).toEqual([
        "warn TS100098 node_modules/keeper/both.txt",
        "warn TS100098 node_modules/keeper/read.txt",
      ]);
    },
    120_000,
  );

  test("a path that an object holds", async () => {
    using dir = tempDir("aot-paths-in-fields", {
      "app/node_modules/served/package.json": `{ "name": "served", "main": "index.cjs" }`,
      "app/node_modules/served/index.cjs": `const fs = require("node:fs"), path = require("node:path");
const read = file => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "none");
class Field {
  file = path.join(__dirname, "field.txt");
  has() {
    return fs.existsSync(this.file);
  }
  load() {
    return this.has() ? fs.readFileSync(this.file, "utf8") : "none";
  }
}
class Private {
  #path = path.join(__dirname, "private.txt");
  load() {
    return fs.readFileSync(this.#path, "utf8");
  }
}
class Stored {
  constructor() {
    this.stored = path.join(__dirname, "stored.txt");
  }
  load() {
    return fs.promises.readFile(this.stored, "utf8");
  }
}
class Argument {
  constructor(given) {
    this.given = given;
  }
  load() {
    return Bun.file(this.given).text();
  }
}
class Folder {
  constructor(folder = path.join(__dirname, "folder")) {
    this.folder = folder;
  }
  load(name) {
    return fs.readFileSync(path.join(this.folder, name + ".txt"), "utf8");
  }
}
class Static {
  static place = path.join(__dirname, "static.txt");
  static load() {
    return fs.readFileSync(Static.place, "utf8");
  }
}
function Old() {
  this.old = path.join(__dirname, "old.txt");
}
Old.prototype.load = function () {
  return fs.readFileSync(this.old, "utf8");
};
const literal = {
  literal: path.join(__dirname, "literal.txt"),
  load() {
    return fs.readFileSync(this.literal, "utf8");
  },
};
exports.asks = {
  "a field": () => new Field().load(),
  "a private field": () => new Private().load(),
  "a field that the constructor stores": () => new Stored().load(),
  "an argument of the constructor": () => new Argument(path.join(__dirname, "argument.txt")).load(),
  "a folder": () => new Folder().load("inner"),
  "a static field": () => Static.load(),
  "a constructor function": () => new Old().load(),
  "an object literal": () => literal.load(),
};
`,
      "app/node_modules/served/field.txt": "field",
      "app/node_modules/served/private.txt": "private",
      "app/node_modules/served/stored.txt": "stored",
      "app/node_modules/served/argument.txt": "argument",
      "app/node_modules/served/folder/inner.txt": "inner",
      "app/node_modules/served/static.txt": "static",
      "app/node_modules/served/old.txt": "old",
      "app/node_modules/served/literal.txt": "literal",
      "app/package.json": `{ "name": "server" }`,
      "app/own.txt": "own",
      "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import served from "served";
for (const [label, ask] of Object.entries(served.asks)) console.log(label, await Promise.try(ask).catch(error => error.code));
class Own {
  file = path.join(import.meta.dirname, "own.txt");
  load() {
    return fs.existsSync(this.file) ? fs.readFileSync(this.file, "utf8") : "none";
  }
}
console.log("the program's own", new Own().load());
`,
    });
    const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs");
    const asked = `a field field\na private field private\na field that the constructor stores stored\nan argument of the constructor argument\na folder inner\na static field static\na constructor function old\nan object literal literal\n`;
    expect(plain.stdout).toBe(`${asked}the program's own own\n`);
    expect(compiled).toEqual({ stdout: `${asked}the program's own none\n`, stderr: "", exitCode: 0 });
    expect(warnings(built)).toEqual(["warn TS100098 own.txt", "warn TS100098 own.txt"]);
  }, 120_000);

  test("a folder that is listed or copied", async () => {
    using dir = tempDir("aot-listed-folders", {
      "app/node_modules/served/package.json": `{ "name": "served", "main": "lib/index.cjs" }`,
      "app/node_modules/served/lib/index.cjs": `const fs = require("node:fs"), path = require("node:path");
const texts = path.join(__dirname, "..", "texts"), words = path.join(__dirname, "../words");
const load = name => fs.readFileSync(path.join(words, process.argv[2] ?? name) + ".txt", "utf8");
exports.asks = to => ({
  "read one by one": () => fs.readdirSync(texts).sort().map(name => fs.readFileSync(path.join(texts, name), "utf8")).join(),
  "read by name": () => [load("one"), load("two")].join(),
  "copied": () => {
    fs.cpSync(path.join(__dirname, "../template"), to, { recursive: true });
    return fs.readdirSync(to, { recursive: true }).map(name => name.replaceAll("\\\\", "/")).sort().join();
  },
});
`,
      "app/node_modules/served/texts/one.txt": "1",
      "app/node_modules/served/texts/two.txt": "2",
      "app/node_modules/served/words/one.txt": "first",
      "app/node_modules/served/words/two.txt": "second",
      "app/node_modules/served/template/package.json": "{}",
      "app/node_modules/served/template/inner/page.html": "<p>",
      "app/node_modules/served/unread/other.txt": "nobody lists it",
      "app/package.json": `{ "name": "server" }`,
      "app/views/page.txt": "page",
      "app/texts/own.txt": "own text",
      "app/routes/a.mjs": "export const route = 'a';",
      "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import served from "served";
const to = fs.mkdtempSync(path.join(os.tmpdir(), "aot-copied-"));
for (const [label, ask] of Object.entries(served.asks(to))) console.log(label, ask());
fs.rmSync(to, { recursive: true });
const count = folder => {
  try {
    return fs.readdirSync(folder).length;
  } catch (error) {
    return error.code;
  }
};
console.log(count(path.join(import.meta.dirname, "views")), count(new URL("./routes", import.meta.url)));
await import("./routes/a.mjs");
const text = name => fs.readFileSync(path.join(import.meta.dirname, "texts", (process.argv[2] ?? name) + ".txt"), "utf8");
try {
  console.log(text("own"));
} catch (error) {
  console.log(error.code);
}
`,
    });
    const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs");
    const asked = "read one by one 1,2\nread by name first,second\ncopied inner,inner/page.html,package.json\n";
    expect(plain.stdout).toBe(`${asked}1 1\nown text\n`);
    expect(compiled).toEqual({ stdout: `${asked}ENOENT 1\nENOENT\n`, stderr: "", exitCode: 0 });
    expect(warnings(built)).toEqual(["warn TS100098 texts/own.txt", "warn TS100098 views"]);
  }, 120_000);

  test.skipIf(isWindows)(
    "links and hidden files in a folder that a package lists stay out",
    async () => {
      const reader = `const fs = require("node:fs"), path = require("node:path"), name = process.argv[2] ?? "plain";
exports.run = load => {
  const ask = read => {
    try {
      return String(read());
    } catch (error) {
      return error.code;
    }
  };
  return [
    ask(() => fs.readdirSync(path.join(__dirname, "data")).sort()),
    ask(() => fs.readFileSync(path.join(__dirname, "data", name + ".txt"), "utf8")),
    ask(() => fs.readFileSync(path.join(__dirname, "data/folder", name + ".txt"), "utf8")),
    ask(() => fs.readdirSync(path.join(__dirname, ".hidden"))),
    ask(() => fs.readdirSync(path.join(__dirname, "../../config"))),
    ask(() => load(path.join(__dirname, "data/out.txt"))),
    ask(() => load(path.join(__dirname, ".env"))),
    ask(() => load(path.join(__dirname, "../../config/plain.txt"))),
  ].join(" ");
};
`;
      const inFolder = (folder: string, label: string) => ({
        [`${folder}/package.json`]: `{ "name": "${label}", "main": "index.cjs" }`,
        [`${folder}/index.cjs`]: reader,
        [`${folder}/.env`]: `${label}:hidden`,
        [`${folder}/.hidden/plain.txt`]: `${label}:hidden`,
        [`${folder}/data/plain.txt`]: `${label}:plain`,
        [`${folder}/data/.env`]: `${label}:hidden`,
        [`${folder}/data/.git/config`]: `${label}:hidden`,
        [`${folder}/data/package-lock.json`]: `${label}:hidden`,
      });
      using dir = tempDir("aot-links-and-hidden-files", {
        ...inFolder("app/node_modules/served", "served"),
        ...inFolder("app/workspace/linked", "linked"),
        "app/package.json": `{ "name": "server" }`,
        "app/.env": "application:hidden",
        "app/config/plain.txt": "application:outside",
        "app/load.cjs": `exports.load = file => require("node:fs").readFileSync(file, "utf8");`,
        "app/main.mjs": `import served from "served";
import linked from "linked";
import { load } from "./load.cjs";
console.log(served.run(load));
console.log(linked.run(load));
`,
      });
      const app = join(String(dir), "app");
      symlinkSync("../workspace/linked", join(app, "node_modules/linked"));
      symlinkSync("../../../.env", join(app, "node_modules/served/data/out.txt"));
      symlinkSync("../../../config", join(app, "node_modules/served/data/folder"));
      const { plain, compiled } = await bothWays(String(dir), "./main.mjs");
      expect(plain.stdout.split("\n")[0]).toBe(
        ".env,.git,folder,out.txt,package-lock.json,plain.txt served:plain application:outside plain.txt plain.txt application:hidden served:hidden application:outside",
      );
      const missing = Array(6).fill("ENOENT").join(" ");
      expect(compiled).toEqual({
        stdout: `plain.txt served:plain ${missing}\nENOENT ENOENT ${missing}\n`,
        stderr: "",
        exitCode: 0,
      });
      const executable = Buffer.from(await Bun.file(join(String(dir), "built.exe")).arrayBuffer());
      const texts = [
        "served:plain",
        "served:hidden",
        "linked:plain",
        "linked:hidden",
        "application:hidden",
        "application:outside",
      ];
      expect(texts.filter(text => executable.includes(text))).toEqual(["served:plain"]);
    },
    120_000,
  );

  test("a path that one file names and another one reads", async () => {
    using dir = tempDir("aot-paths-read-elsewhere", {
      "app/node_modules/reader/package.json": `{ "name": "reader", "main": "index.cjs" }`,
      "app/node_modules/reader/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.load = file => fs.readFileSync(file, "utf8");
exports.loadBeside = (name, folder) => fs.readFileSync(path.join(folder, name), "utf8");
exports.Reader = class {
  constructor(file) {
    this.file = file;
  }
  load() {
    return fs.readFileSync(this.file, "utf8");
  }
};
`,
      "app/node_modules/served/package.json": `{ "name": "served", "main": "index.cjs" }`,
      "app/node_modules/served/index.cjs": `const path = require("node:path"), reader = require("reader"), own = require("./own.cjs");
const files = new Map([["entry", path.join(__dirname, "entry.txt")]]);
exports.asks = {
  "another package": () => reader.load(path.join(__dirname, "given.txt")),
  "its class": () => new reader.Reader(path.resolve(__dirname, "class.txt")).load(),
  "another file": () => own.load(__dirname + "/own.txt"),
  "a name and a folder": () => reader.loadBeside("beside.txt", __dirname),
  "an entry of a map": () => own.load(files.get("entry")),
};
`,
      "app/node_modules/served/own.cjs": `exports.load = file => require("node:fs").readFileSync(file, "utf8");`,
      "app/node_modules/served/given.txt": "given",
      "app/node_modules/served/class.txt": "class",
      "app/node_modules/served/own.txt": "own",
      "app/node_modules/served/beside.txt": "beside",
      "app/node_modules/served/entry.txt": "entry",
      "app/node_modules/modules/package.json": `{ "name": "modules", "type": "module", "main": "index.js" }`,
      "app/node_modules/modules/index.js": `import { load } from "./load.js";
export const asks = { "a name and a URL": () => load("./named.txt", import.meta.url) };
`,
      "app/node_modules/modules/load.js": `import fs from "node:fs";
export const load = (name, base) => fs.readFileSync(new URL(name, base), "utf8");
`,
      "app/node_modules/modules/named.txt": "named",
      "app/package.json": `{ "name": "server" }`,
      "app/own.txt": "own",
      "app/beside.txt": "beside",
      "app/written.txt": "written",
      "app/lib/load.mjs": `import fs from "node:fs";
export const load = file => (fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "none");
export const loadBeside = (name, base) => load(new URL(name, base));
export const name = file => file.length > 0;
`,
      "app/main.mjs": `import path from "node:path";
import served from "served";
import { asks } from "modules";
import { load, name } from "./lib/load.mjs";
import * as lib from "./lib/load.mjs";
for (const [label, ask] of Object.entries({ ...served.asks, ...asks })) {
  try {
    console.log(label, ask());
  } catch (error) {
    console.log(label, error.code);
  }
}
console.log(load(path.join(import.meta.dirname, "own.txt")), lib.loadBeside("./beside.txt", import.meta.url));
console.log(name(path.join(import.meta.dirname, "written.txt")));
`,
    });
    const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs");
    const asked = `another package given\nits class class\nanother file own\na name and a folder beside\nan entry of a map entry\na name and a URL named\n`;
    expect(plain.stdout).toBe(`${asked}own beside\ntrue\n`);
    expect(compiled).toEqual({ stdout: `${asked}none none\ntrue\n`, stderr: "", exitCode: 0 });
    expect(warnings(built)).toEqual(["warn TS100098 beside.txt", "warn TS100098 own.txt"]);
  }, 120_000);

  test("what compilers make of an import of node:fs", async () => {
    const compiled = {
      "tsc-named": `const fs_1 = require("fs"), path_1 = require("path");
module.exports = () => (0, fs_1.readFileSync)((0, path_1.join)(__dirname, "FILE"), "utf8");`,
      "tsc-default": `var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const fs_1 = __importDefault(require("fs")), path_1 = __importDefault(require("path"));
module.exports = () => fs_1.default.readFileSync(path_1.default.join(__dirname, "FILE"), "utf8");`,
      "tsc-promises": `var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const promises_1 = __importDefault(require("node:fs/promises")), path_1 = require("path");
module.exports = () => promises_1.default.readFile((0, path_1.resolve)(__dirname, "FILE"), "utf8");`,
      "babel": `function _interopRequireDefault(e) { return e && e.__esModule ? e : { default: e }; }
var _fs = _interopRequireDefault(require("fs")), _path = _interopRequireDefault(require("path"));
module.exports = () => _fs.default.readFileSync(_path.default.join(__dirname, "FILE"), "utf8");`,
      "esbuild": `var __create = Object.create, __defProp = Object.defineProperty, __getOwnPropNames = Object.getOwnPropertyNames, __getProtoOf = Object.getPrototypeOf;
var __copyProps = (to, from) => { for (let key of __getOwnPropNames(from)) if (!Object.hasOwn(to, key)) __defProp(to, key, { get: () => from[key], enumerable: true }); return to; };
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target, mod));
var import_fs = __toESM(require("fs"), 1), path = __toESM(require("path"));
module.exports = () => import_fs.default.readFileSync(path.join(__dirname, "FILE"), "utf8");`,
      "webpack": `var __webpack_require__ = {};
__webpack_require__.n = (module) => { var getter = module && module.__esModule ? () => (module["default"]) : () => (module); return getter; };
const external_fs = require("fs"); var external_fs_default = /*#__PURE__*/__webpack_require__.n(external_fs);
const external_path = require("path"); var external_path_default = /*#__PURE__*/__webpack_require__.n(external_path);
module.exports = () => external_fs_default().readFileSync(external_path_default().join(__dirname, "FILE"), "utf8");`,
      "promisified": `const path = require("path"), { promisify } = require("util"), read = promisify(require("fs").readFile);
module.exports = () => read(path.join(__dirname, "FILE"), "utf8");`,
      "tsc-require": `var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const path_1 = __importDefault(require("path"));
module.exports = () => require(path_1.default.join(__dirname, "tsc-require.json")).text;`,
    };
    const files: Record<string, string> = { "app/node_modules/served/tsc-require.json": `{ "text": "tsc-require" }` };
    for (const [name, text] of Object.entries(compiled)) {
      files[`app/node_modules/served/${name}.cjs`] = text.replaceAll("FILE", `${name}.txt`);
      files[`app/node_modules/served/${name}.txt`] = name;
    }
    using dir = tempDir("aot-compiled-imports-of-fs", {
      ...files,
      "app/node_modules/served/package.json": `{ "name": "served", "main": "index.cjs" }`,
      "app/node_modules/served/index.cjs": Object.keys(compiled)
        .map(name => `exports[${JSON.stringify(name)}] = require("./${name}.cjs");\n`)
        .join(""),
      "app/package.json": `{ "name": "server" }`,
      "app/main.mjs": `import served from "served";
for (const [label, load] of Object.entries(served)) console.log(label, await Promise.try(load).catch(error => error.code));
`,
    });
    const { plain, built, compiled: executable } = await bothWays(String(dir), "./main.mjs");
    const expected = Object.keys(compiled)
      .map(name => `${name} ${name}\n`)
      .join("");
    expect(plain.stdout).toBe(expected);
    expect(executable).toEqual({ stdout: expected, stderr: "", exitCode: 0 });
    expect(warnings(built)).toEqual([]);
  }, 120_000);

  test("a file object that is handed on, and the real path of a file", async () => {
    using dir = tempDir("aot-file-objects-handed-on", {
      "app/node_modules/served/package.json": `{ "name": "served", "main": "index.cjs" }`,
      "app/node_modules/served/index.cjs": `const fs = require("node:fs"), path = require("node:path");
const candidates = [path.join(__dirname, "absent.txt"), path.join(__dirname, "named.txt")];
const grown = [path.join(__dirname, "absent.txt")];
grown.push(path.join(__dirname, "pushed.txt"));
exports.asks = {
  "the size of a file object": () => Bun.file(path.join(__dirname, "sized.txt")).size,
  "a slice of one": () => Bun.file(path.join(__dirname, "sliced.txt")).slice(0, 4).text(),
  "a response made of one": () => new Response(Bun.file(path.join(__dirname, "sent.txt"))).text(),
  "the real path": () => path.basename(fs.realpathSync(path.join(__dirname, "real.txt"))),
  "the first of two that is there": () =>
    path.basename([path.join(__dirname, "absent.txt"), path.join(__dirname, "present.txt")].find(fs.existsSync) ?? "none"),
  "the first of a named list": () => path.basename(candidates.find(fs.existsSync) ?? "none"),
  "the first of a list that grows": () => path.basename(grown.find(fs.existsSync) ?? "none"),
  "a read of the first that is there": () =>
    fs.readFileSync([path.join(__dirname, "absent.txt"), path.join(__dirname, "first.txt")].find(fs.existsSync), "utf8"),
  "reads of all that are there": () =>
    [path.join(__dirname, "absent.txt"), path.join(__dirname, "every.txt")]
      .filter(fs.existsSync)
      .map(file => fs.readFileSync(file, "utf8"))
      .join(),
  "the first of a list of joined names": () =>
    path.basename(["absent.txt", "joined.txt"].map(name => path.join(__dirname, name)).find(fs.existsSync) ?? "none"),
  "a read of the real path": () => fs.readFileSync(fs.realpathSync(path.join(__dirname, "resolved.txt")), "utf8"),
  "of one asked for as text": () => fs.readFileSync(fs.realpathSync(path.join(__dirname, "as-text.txt"), "utf8"), "utf8"),
  "of the native one": () => fs.readFileSync(fs.realpathSync.native(path.join(__dirname, "native.txt")), "utf8"),
  "of a URL's": () => fs.readFileSync(fs.realpathSync(require("node:url").pathToFileURL(path.join(__dirname, "url.txt"))), "utf8"),
};
exports.save = text => Bun.write(Bun.file(path.join(__dirname, "saved.txt")), text);
`,
      "app/node_modules/served/sized.txt": "sized",
      "app/node_modules/served/sliced.txt": "sliced",
      "app/node_modules/served/sent.txt": "sent",
      "app/node_modules/served/real.txt": "real",
      "app/node_modules/served/present.txt": "present",
      "app/node_modules/served/named.txt": "named",
      "app/node_modules/served/pushed.txt": "pushed",
      "app/node_modules/served/first.txt": "first",
      "app/node_modules/served/every.txt": "every",
      "app/node_modules/served/joined.txt": "joined",
      "app/node_modules/served/resolved.txt": "resolved",
      "app/node_modules/served/as-text.txt": "as text",
      "app/node_modules/served/native.txt": "native",
      "app/node_modules/served/url.txt": "url",
      "app/own.txt": "own",
      "app/node_modules/served/saved.txt": "saved",
      "app/package.json": `{ "name": "server" }`,
      "app/page.html": "a page",
      "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import served from "served";
${say}
for (const [label, ask] of Object.entries(served.asks)) console.log(label, await ask());
const page = new Response(Bun.file(path.join(import.meta.dirname, "page.html")));
console.log("the program's own page", await page.text().catch(error => error.code));
// The build cannot see these names, so they are no reads that it knows.
const made = name => path.join(import.meta.dirname, "node_modules", "served", Buffer.from(name).toString());
say("is what is only written there", () => fs.existsSync(made("saved.txt")));
say("the bytes of what is only asked about", () => fs.readFileSync(made("real.txt"), "utf8"));
say("it can save", () => typeof served.save);
say("the program's own file by its real path", () => fs.readFileSync(fs.realpathSync(path.join(import.meta.dirname, "own.txt")), "utf8"));
`,
    });
    const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs");
    const asked = `the size of a file object 5\na slice of one slic\na response made of one sent\nthe real path real.txt\nthe first of two that is there present.txt\nthe first of a named list named.txt\nthe first of a list that grows pushed.txt\na read of the first that is there first\nreads of all that are there every\nthe first of a list of joined names joined.txt\na read of the real path resolved\nof one asked for as text as text\nof the native one native\nof a URL's url\n`;
    expect(plain.stdout).toBe(
      `${asked}the program's own page a page\nis what is only written there true\nthe bytes of what is only asked about real\nit can save function\nthe program's own file by its real path own\n`,
    );
    expect(compiled).toEqual({
      stdout: `${asked}the program's own page ENOENT\nis what is only written there false\nthe bytes of what is only asked about real\nit can save function\nthe program's own file by its real path ENOENT\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(warnings(built)).toEqual(["warn TS100098 own.txt", "warn TS100098 page.html"]);
  }, 120_000);

  test("a project reads files of unknown names beside its code", async () => {
    using dir = tempDir("aot-files-beside-code", {
      "app/page.html": "a page",
      "app/notes.md": "nothing reads it",
      "app/lib/1.sql": "one",
      "app/lib/2.sql": "two",
      "app/lib/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.queries = () => fs.readdirSync(__dirname).filter(it => it.endsWith(".sql")).sort().map(it => fs.readFileSync(path.join(__dirname, it), "utf8")).join();
`,
      "app/pages/en.txt": "hello",
      "app/notes/en.txt": "a note",
      "app/parts/head.html": "a head",
      "app/parts/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.read = name => fs.readFileSync(path.join(__dirname, name), "utf8");
exports.has = name => fs.existsSync(path.join(__dirname, name + ".html"));
`,
      "app/main.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
const name = Buffer.from("page").toString();
say("a name without its end", () => fs.readFileSync(path.join(__dirname, name + ".html"), "utf8"));
say("the files that are listed", () => require("./lib/index.cjs").queries());
say("a whole name", () => require("./parts/index.cjs").read(name.replace("page", "head.html")));
const language = Buffer.from("en").toString();
say("a name in the place of another", () => fs.readFileSync(path.join(__dirname, "pages/LANGUAGE.txt".replace("LANGUAGE", language)), "utf8"));
say("a name between two texts", () => fs.readFileSync(__dirname.concat("/notes/", language, ".txt"), "utf8"));
`,
    });
    const { plain, built, compiled } = await bothWays(String(dir), "./main.cjs");
    expect(plain.stdout).toBe(
      "a name without its end a page\nthe files that are listed one,two\na whole name a head\na name in the place of another hello\na name between two texts a note\n",
    );
    expect(compiled).toEqual({
      stdout:
        "a name without its end ENOENT\nthe files that are listed \na whole name ENOENT\na name in the place of another ENOENT\na name between two texts ENOENT\n",
      stderr: "",
      exitCode: 0,
    });
    expect(warnings(built)).toEqual([
      "warn TS100098 lib/1.sql",
      "warn TS100098 lib/2.sql",
      "warn TS100098 notes",
      "warn TS100098 page.html",
      "warn TS100098 pages",
    ]);
  }, 120_000);

  test.each([
    [[], ["warn TS100098 a.txt", "warn TS100098 b.txt", "warn TS100098 vars.txt"], "ENOENT"],
    [["a.txt", "b.txt", "vars.txt"].flatMap(it => ["--asset", it]), [], undefined],
  ])(
    "a project fetches a file, makes a blob of one and loads variables %j",
    async (flags, expected, failure) => {
      using dir = tempDir("aot-files-read-by-fetch", {
        "app/a.txt": "fetched",
        "app/b.txt": "a blob",
        "app/vars.txt": "FROM_FILE=a variable",
        "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
const tell = async read => console.log(await read().catch(error => error.code));
await tell(async () => (await fetch(new URL("./a.txt", import.meta.url))).text());
await tell(async () => (await fs.openAsBlob(path.join(import.meta.dirname, "b.txt"))).text());
await tell(async () => (process.loadEnvFile(path.join(import.meta.dirname, "vars.txt")), process.env.FROM_FILE));
await tell(async () => typeof (await fetch("data:text/plain,none")).text);
`,
      });
      const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs", ...flags);
      const said = ["fetched", "a blob", "a variable"];
      expect(plain.stdout).toBe([...said, "function", ""].join("\n"));
      expect(warnings(built)).toEqual(expected);
      expect(compiled).toEqual({
        stdout: [...said.map(it => failure ?? it), "function", ""].join("\n"),
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.each([
    [
      [],
      [
        "warn TS100098 config/a.txt",
        "warn TS100098 config/data/b.txt",
        "warn TS100098 config/lists",
        "warn TS100098 config/views",
      ],
      "ENOENT",
    ],
    [["config/a.txt", "config/data", "config/lists", "config/views"].flatMap(it => ["--asset", it]), [], undefined],
  ])(
    "a project reads at paths that another of its files exports %j",
    async (flags, expected, failure) => {
      using dir = tempDir("aot-paths-of-another-file", {
        "app/config/a.txt": "a file",
        "app/config/unread.txt": "nothing reads it",
        "app/config/data/b.txt": "a file below a folder",
        "app/config/views/page.html": "a view",
        "app/config/lists/one.txt": "",
        "app/config/code.cjs": "exports.x = 1;",
        "app/config/paths.cjs": `const path = require("node:path");
exports.root = __dirname;
exports.file = path.join(__dirname, "a.txt");
exports.unread = path.join(__dirname, "unread.txt");
exports.code = path.join(__dirname, "code.cjs");
exports.folders = { views: path.join(__dirname, "views"), lists: path.join(__dirname, "lists") };
`,
        "app/reader.mjs": `import fs from "node:fs";
import path from "node:path";
import paths, { root } from "./config/paths.cjs";
export const reads = [
  () => fs.readFileSync(path.join(root, "data", "b.txt"), "utf8"),
  () => fs.readdirSync(paths.folders.lists).join(),
];
`,
        "app/main.cjs": `const fs = require("node:fs"), path = require("node:path"), paths = require("./config/paths.cjs");
const { views } = paths.folders;
const say = read => { try { console.log(read()); } catch (error) { console.log(error.code); } };
say(() => fs.readFileSync(paths.file, "utf8"));
say(() => fs.readFileSync(path.join(views, Buffer.from("page") + ".html"), "utf8"));
require("./reader.mjs").reads.forEach(say);
console.log(require("./config/code.cjs").x, typeof paths.code);
`,
      });
      const { plain, built, compiled } = await bothWays(String(dir), "./main.cjs", ...flags);
      const said = ["a file", "a view", "a file below a folder", "one.txt"];
      expect(plain.stdout).toBe([...said, "1 string", ""].join("\n"));
      expect(warnings(built)).toEqual(expected);
      expect(compiled).toEqual({
        stdout: [...said.map(it => failure ?? it), "1 string", ""].join("\n"),
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "a warning names what only the disk can hold",
    async () => {
      using dir = tempDir("aot-paths-needed-on-disk", {
        "app/tool.sh": "echo a tool",
        "app/input.txt": "an input",
        "app/shell.txt": "a shell",
        "app/watched.txt": "",
        "app/built.mjs": "export default 1;",
        "app/data/inner.txt": "inner",
        "app/lib/own.cjs": `const { spawnSync } = require("node:child_process");
exports.own = () => spawnSync("cat", ["own.cjs"], { cwd: __dirname }).error?.code ?? "own";
`,
        "app/worker.cjs": `exports.name = "compiled";`,
        "app/node_modules/tool/package.json": `{ "name": "tool", "main": "index.cjs" }`,
        "app/node_modules/tool/run.sh": "echo a package",
        "app/node_modules/tool/index.cjs": `const { spawnSync } = require("node:child_process"), path = require("node:path");
exports.run = () => String(spawnSync("sh", [path.join(__dirname, "run.sh")]).stdout).trim() || "none";
`,
        "app/main.cjs": `const { execFileSync, spawnSync } = require("node:child_process"), fs = require("node:fs"), path = require("node:path");
const input = path.join(__dirname, "input.txt");
console.log(String(spawnSync("sh", [path.join(__dirname, "tool.sh")]).stdout).trim() || "none");
console.log(String(Bun.spawnSync(["cat", input]).stdout).trim() || "none");
console.log(spawnSync("cat", ["inner.txt"], { cwd: path.join(__dirname, "data") }).error?.code ?? "inner");
console.log(require("./lib/own.cjs").own(), require("tool").run());
if (process.argv.length > 9) execFileSync(process.execPath, [path.join(__dirname, "worker.cjs")]);
console.log(require("./worker.cjs").name);
const none = async read => console.log((await read().catch(() => "none")).trim() || "none");
(async () => {
  await none(() => Bun.$\`cat \${path.join(__dirname, "shell.txt")}\`.quiet().text());
  await none(async () => (await Bun.build({ entrypoints: [path.join(__dirname, "built.mjs")] })).success ? "built" : "none");
  await none(async () => (fs.watch(path.join(__dirname, "watched.txt")).close(), "watched"));
})();
`,
      });
      const { plain, built, compiled } = await bothWays(String(dir), "./main.cjs");
      expect(plain.stdout).toBe("a tool\nan input\ninner\nown a package\ncompiled\na shell\nbuilt\nwatched\n");
      expect(compiled).toEqual({
        stdout: "none\nnone\nENOENT\nENOENT none\ncompiled\nnone\nnone\nnone\n",
        stderr: "",
        exitCode: 0,
      });
      expect(warnings(built)).toEqual([
        "warn TS100173 built.mjs",
        "warn TS100173 data",
        "warn TS100173 input.txt",
        "warn TS100173 lib",
        "warn TS100173 node_modules/tool/run.sh",
        "warn TS100173 shell.txt",
        "warn TS100173 tool.sh",
        "warn TS100173 watched.txt",
      ]);
    },
    120_000,
  );

  test.each([
    [
      [],
      ["a.txt", "data", "data", "data/inner.txt", "lib/b.txt"].map(it => `warn TS100098 ${it}`),
      ["ENOENT", "ENOENT", "ENOENT", "ENOENT"],
    ],
    [
      ["a.txt", "data", "lib/b.txt"].flatMap(it => ["--asset", it]),
      [],
      ["a file", "a file beside another module", "below", "inner.txt"],
    ],
  ])(
    "a project makes its own folder the working directory %j",
    async (flags, expected, said) => {
      using dir = tempDir("aot-own-folder-entered", {
        "app/a.txt": "a file",
        "app/data/inner.txt": "below",
        "app/lib/b.txt": "a file beside another module",
        "app/lib/reader.mjs": `import fs from "node:fs";
export const read = () => fs.readFileSync("lib/b.txt", "utf8");
export const written = () => fs.existsSync("nothing.txt");
`,
        "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import { read, written } from "./lib/reader.mjs";
process.chdir(import.meta.dirname);
const tell = read => { try { console.log(read()); } catch (error) { console.log(error.code); } };
tell(() => fs.readFileSync("a.txt", "utf8"));
tell(read);
tell(() => (process.chdir(path.join(import.meta.dirname, "data")), fs.readFileSync("inner.txt", "utf8")));
tell(() => fs.readdirSync(path.join(import.meta.dirname, "data")).join());
tell(written);
`,
      });
      const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs", ...flags);
      expect(plain.stdout).toBe("a file\na file beside another module\nbelow\ninner.txt\nfalse\n");
      expect(warnings(built)).toEqual(expected);
      expect(compiled).toEqual({ stdout: [...said, "false", ""].join("\n"), stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test.each([
    [[], "abcdefgh".split("").map(it => `warn TS100098 ${it}.txt`), "ENOENT"],
    ["abcdefgh".split("").flatMap(it => ["--asset", `${it}.txt`]), [], undefined],
  ])(
    "a project reads by functions made of those of node:fs %j",
    async (flags, expected, failure) => {
      const names = "abcdefgh".split("");
      using dir = tempDir("aot-reads-by-functions-made", {
        ...Object.fromEntries(names.map(it => [`app/${it}.txt`, `file ${it}`])),
        "app/main.mjs": `import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
const at = name => path.join(import.meta.dirname, name);
const tell = async read => console.log(await read().catch(error => (error.code === "ERR_MODULE_NOT_FOUND" ? "ENOENT" : error.code)));
const bound = fs.readFileSync.bind(fs);
await tell(async () => promisify(fs.readFile)(path.join(import.meta.dirname, "a.txt"), "utf8"));
await tell(async () => bound(path.join(import.meta.dirname, "b.txt"), "utf8"));
await tell(async () => fs.readFileSync.call(fs, path.join(import.meta.dirname, "c.txt"), "utf8"));
await tell(async () => fs.readFileSync.apply(fs, [path.join(import.meta.dirname, "d.txt"), "utf8"]));
await tell(async () => ((...parts) => fs.readFileSync(path.join(import.meta.dirname, ...parts), "utf8"))("e.txt"));
await tell(async () => fs.readFileSync(path.relative(process.cwd(), at("f.txt")), "utf8"));
await tell(async () => fs.readFileSync(Buffer.from(at("g.txt")), "utf8"));
await tell(async () => fs.readFileSync(Bun.resolveSync("./h.txt", import.meta.dir), "utf8"));
`,
      });
      const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs", ...flags);
      const said = names.map(it => `file ${it}`);
      expect(plain.stdout).toBe([...said, ""].join("\n"));
      expect(warnings(built)).toEqual(expected);
      expect(compiled).toEqual({
        stdout: [...said.map(it => failure ?? it), ""].join("\n"),
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

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

describe.concurrent("--asset", () => {
  test("a folder is as new as the newest file in it, and above the entry point it has no time", async () => {
    using dir = tempDir("aot-times-of-embedded-folders", {
      "app/src/main.cjs": `const fs = require("node:fs");
const { basename, join } = require("node:path");
for (const path of ["data", "data/deep", "data/old.txt", "data/deep/new.txt", "other", "..", "../shared", "../shared/deep", "../shared/deep/one.txt"]) {
  const found = fs.statSync(join(__dirname, path));
  fs.accessSync(join(__dirname, path));
  const listed = path === ".." ? "-" : found.isDirectory() ? fs.readdirSync(join(__dirname, path)).sort().join() : fs.readFileSync(join(__dirname, path), "utf8");
  console.log(path, found.mtimeMs, fs.existsSync(join(__dirname, path)), basename(fs.realpathSync(join(__dirname, path))) === basename(join(__dirname, path)), listed);
}
`,
      "app/src/data/old.txt": "old",
      "app/src/data/deep/new.txt": "new",
      "app/src/other/one.txt": "other",
      "app/shared/deep/one.txt": "one",
    });
    const times = {
      "src/data/old.txt": 1_000_000,
      "src/data/deep/new.txt": 2_000_000,
      "src/other/one.txt": 1_500_000,
      "shared/deep/one.txt": 1_700_000,
      "src/data/deep": 500_000,
      "src/data": 3_000_000,
      "src/other": 4_000_000,
      "shared/deep": 5_000_000,
      "shared": 6_000_000,
      "": 7_000_000,
    };
    for (const [path, time] of Object.entries(times)) utimesSync(join(String(dir), "app", path), time, time);
    const flags = ["data", "other/one.txt", "../shared/deep/one.txt"].flatMap(path => ["--asset", path]);
    const { compiled } = await bothWaysIn(String(dir), "app/src", "./main.cjs", ...flags);
    expect(compiled).toEqual({
      stdout: `data 2000000000 true true deep,old.txt
data/deep 2000000000 true true new.txt
data/old.txt 1000000000 true true old
data/deep/new.txt 2000000000 true true new
other 1500000000 true true one.txt
.. 0 true true -
../shared 0 true true deep
../shared/deep 0 true true one.txt
../shared/deep/one.txt 0 true true one
`,
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);

  test("an asset in a folder of a folder keeps its path", async () => {
    using dir = tempDir("aot-asset-in-a-folder-of-a-folder", {
      "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
for (const name of ["outer/inner/note.txt", "inner/note.txt", "outer/other.txt"]) console.log(name, fs.existsSync(path.join(__dirname, name)));
console.log(fs.readdirSync(path.join(__dirname, "outer")).join(), fs.readFileSync(path.join(__dirname, "outer", "inner", "note.txt"), "utf8"), fs.readFileSync(path.join(__dirname, "deep", "down", "one.txt"), "utf8"));
`,
      "app/outer/inner/note.txt": "a note",
      "app/deep/down/one.txt": "one file",
    });
    const { plain, compiled } = await bothWays(
      String(dir),
      "./main.cjs",
      "--asset",
      "./outer/inner",
      "--asset",
      "deep/down/one.txt",
    );
    expect(plain).toEqual({
      stdout: "outer/inner/note.txt true\ninner/note.txt false\nouter/other.txt false\ninner a note one file\n",
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.skipIf(isWindows)(
    "opened asset matches lstat",
    async () => {
      using dir = tempDir("aot-opened-asset-matches-lstat", {
        "app/main.cjs": `const fs = require("node:fs");
const { join } = require("node:path");
const at = path => join(__dirname, path);
const same = (a, b) => [a.dev === b.dev, a.ino === b.ino, a.mode === b.mode, a.mtimeNs === b.mtimeNs, a.nlink === b.nlink, a.isFile() === b.isFile()].join();
const { O_RDONLY, O_DIRECTORY, O_NOFOLLOW } = fs.constants;
const big = { bigint: true };
const said = read => { try { return String(read()); } catch (error) { return error.code; } };
for (const [path, flags] of [["data/note.txt", O_RDONLY | O_NOFOLLOW], ["one.txt", O_RDONLY], ["data/deep/empty.txt", O_RDONLY], ["data", O_RDONLY | O_DIRECTORY], ["data/deep", O_RDONLY]]) {
  const before = fs.lstatSync(at(path), big);
  const fd = fs.openSync(at(path), flags);
  const opened = fs.fstatSync(fd, big);
  fs.closeSync(fd);
  console.log(path, same(before, opened), same(opened, fs.lstatSync(at(path), big)), before.dev > 0n, before.ino > 0n, before.nlink > 0n, before.mtimeNs > 0n);
}
console.log(new Set(["data/note.txt", "one.txt", "data/deep/empty.txt", "data", "data/deep"].map(path => fs.lstatSync(at(path)).ino)).size);
console.log(said(() => fs.openSync(at("one.txt"), O_RDONLY | O_DIRECTORY)), said(() => fs.openSync(at("data/nothing"), "r")));
(async () => {
  const handle = await fs.promises.open(at("data/note.txt"));
  console.log(same(await handle.stat(big), await fs.promises.lstat(at("data/note.txt"), big)), await handle.readFile("utf8"));
  await handle.close();
})();
`,
        "app/data/note.txt": "a note",
        "app/data/deep/empty.txt": "",
        "app/one.txt": "one file",
      });
      const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "data", "--asset", "one.txt");
      const all = "true,true,true,true,true,true";
      const line = (path: string) => `${path} ${all} ${all} true true true true\n`;
      expect(plain).toEqual({
        stdout: `${["data/note.txt", "one.txt", "data/deep/empty.txt", "data", "data/deep"].map(line).join("")}5\nENOTDIR ENOENT\n${all} a note\n`,
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test.skipIf(!isLinux)(
    "reused descriptor reports its file",
    async () => {
      using dir = tempDir("aot-reused-asset-descriptor", {
        "app/main.cjs": `const fs = require("node:fs");
const { join } = require("node:path");
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.mtimeMs === b.mtimeMs && a.size === b.size;
const asset = join(__dirname, "data", "note.txt");
let usedAgain = 0, wrong = 0;
for (let i = 0; i < 40; i++) {
  const path = i % 2 ? asset : join(asset, "..");
  const fd = fs.openSync(path, "r");
  if (!same({ ...fs.fstatSync(fd), size: 0 }, { ...fs.lstatSync(path), size: 0 })) wrong++;
  const held = [];
  do held.push(fs.openSync("/dev/null", "r")); while (held.at(-1) < fd);
  fs.closeSync(fd);
  const real = i % 3 ? process.cwd() : process.execPath;
  const next = fs.openSync(real, "r");
  if (next === fd) usedAgain++;
  if (!same(fs.fstatSync(next), fs.statSync(real))) wrong++;
  for (const each of [next, ...held]) fs.closeSync(each);
}
console.log(usedAgain, wrong);
`,
        "app/data/note.txt": "a note",
      });
      const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "data");
      expect(plain).toEqual({ stdout: "40 0\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "descriptor changes show at once",
    async () => {
      using dir = tempDir("aot-asset-descriptor-changes", {
        "app/main.cjs": `const fs = require("node:fs");
const { join } = require("node:path");
const asset = join(__dirname, "data", "note.txt");
const isSameFile = fd => { const [a, b] = [fs.fstatSync(fd), fs.lstatSync(asset)]; return a.dev === b.dev && a.ino === b.ino && a.nlink === b.nlink; };
for (let i = 0; i < 20; i++) {
  const fd = fs.openSync(asset, "r");
  const before = fs.fstatSync(fd);
  fs.futimesSync(fd, 1000 + i, 2000 + i);
  const timed = fs.fstatSync(fd);
  fs.fchmodSync(fd, 0o640);
  const moded = fs.fstatSync(fd);
  console.log(timed.atimeMs, timed.mtimeMs, timed.mode === before.mode, timed.size, (moded.mode & 0o777).toString(8), moded.mtimeMs, isSameFile(fd));
  fs.fchmodSync(fd, before.mode & 0o777);
  fs.closeSync(fd);
}
`,
        "app/data/note.txt": "a note",
      });
      const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "data");
      const line = (i: number) => `${(1000 + i) * 1000} ${(2000 + i) * 1000} true 6 640 ${(2000 + i) * 1000} true\n`;
      expect(plain).toEqual({
        stdout: Array.from({ length: 20 }, (_, i) => line(i)).join(""),
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("the bytes of a large embedded file are aligned as an allocator's", async () => {
    using dir = tempDir("aot-asset-bytes-aligned", {
      "app/main.cjs": `const fs = require("node:fs");
const { join } = require("node:path");
const { ptr } = require("bun:ffi");
const buf = fs.readFileSync(join(__dirname, "data", "b-large.bin"));
console.log(fs.readFileSync(join(__dirname, "data", "a-small.bin")).length, buf.length, new Uint8Array(buf.buffer, buf.byteOffset).length);
console.log(ptr(buf) % 16);
const words = new Int32Array(buf.buffer, 0, 4);
console.log(Atomics.add(words, 1, 5), words[1]);
const wide = new BigInt64Array(buf.buffer, 0, 2);
console.log(String(Atomics.add(wide, 1, 7n)), String(wide[1]));
buf.fill(9);
const again = fs.readFileSync(join(__dirname, "data", "b-large.bin"));
const other = fs.readFileSync(join(__dirname, "data", "c-large.bin"));
console.log(again[0], again[again.length - 1], ptr(again) % 16, other[0], other[other.length - 1], other.length, ptr(other) % 16);
`,
      "app/data/a-small.bin": "abc",
      "app/data/b-large.bin": Buffer.alloc((1 << 20) + 1, 1),
      "app/data/c-large.bin": Buffer.alloc((1 << 20) + 3, 2),
    });
    const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "data");
    expect(plain).toEqual({
      stdout: `3 1048577 1048577\n0\n16843009 16843014\n72340172838076673 72340172838076680\n1 1 0 2 2 1048579 0\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an asset is found through folders of which the disk has only some", async () => {
    using dir = tempDir("aot-asset-through-folders-partly-on-disk", {
      "app/main.cjs": `require("./src/deep/lib.cjs");
`,
      "app/src/deep/lib.cjs": `const fs = require("node:fs");
for (const up of ["/../..", "/../../../app"]) {
  const file = __dirname + up + "/shared/config.json";
  console.log(up, fs.existsSync(file), fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).limit);
}
console.log(fs.existsSync(__dirname + "/absent/../../../shared/config.json"));
`,
      "app/shared/config.json": `{ "limit": 99 }`,
    });
    const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "shared");
    expect(plain).toEqual({
      stdout: `/../.. true 99\n/../../../app true 99\n${isWindows}\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
    for (const folder of ["app", "app/src", "app/src/deep"]) {
      mkdirSync(join(String(dir), folder));
      const again = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect({ folder, ...again }).toEqual({ folder, ...plain });
    }
  }, 120_000);

  test.skipIf(isWindows)(
    "an asset is not found past a link on the disk, whose parent is another folder",
    async () => {
      using dir = tempDir("aot-asset-past-a-link-on-disk", {
        "app/main.cjs": `require("./src/deep/lib.cjs");
`,
        "app/src/deep/lib.cjs": `const fs = require("node:fs");
const file = __dirname + "/../../link/../shared/config.json";
console.log(fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).limit);
`,
        "app/shared/config.json": `{ "limit": 99 }`,
        "elsewhere/dir/note.txt": "a note",
        "elsewhere/shared/config.json": `{ "limit": 7 }`,
      });
      symlinkSync("../elsewhere/dir", join(String(dir), "app/link"));
      const { plain } = await bothWays(String(dir), "./main.cjs", "--asset", "shared");
      expect(plain).toEqual({ stdout: "7\n", stderr: "", exitCode: 0 });
      mkdirSync(join(String(dir), "app/src"), { recursive: true });
      symlinkSync("../elsewhere/dir", join(String(dir), "app/link"));
      // The disk cannot follow the path, which runs through a folder of the executable alone. The asset is another file than the one that is asked for.
      const again = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(again).toEqual({ stdout: "false\n", stderr: "", exitCode: 0 });
    },
    120_000,
  );

  test("an asset beside the entry point leaves the entry point at the root", async () => {
    using dir = tempDir("aot-asset-beside-the-entry-point-itself", {
      "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(path.basename(__dirname), fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8"), fs.readFileSync(path.join(__dirname, "data.json"), "utf8"));
`,
      "app/public/index.html": "<p>a page</p>",
      "app/data.json": "{}",
    });
    const { plain, compiled } = await bothWays(
      String(dir),
      "./main.cjs",
      "--asset",
      "./public",
      "--asset",
      "./data.json",
    );
    expect(plain).toEqual({ stdout: "app <p>a page</p> {}\n", stderr: "", exitCode: 0 });
    // `__dirname` is the folder of the build, as with `bun build --compile`. That folder is gone, and the executable answers for what it holds of it.
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an asset beside the folder of the entry point is beside it in the executable", async () => {
    using dir = tempDir("aot-asset-beside-the-entry-point", {
      "app/dist/server/entry.mjs": `import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { name } from "./chunks/part.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
console.log(path.basename(here), name, import.meta.dir === here, path.basename(process.argv[1]), Bun.main === fileURLToPath(import.meta.url));
console.log(fs.readFileSync(path.join(here, "..", "client", "index.html"), "utf8"), fs.readdirSync(path.join(here, "..")).sort().join());
`,
      "app/dist/server/chunks/part.mjs": `export const name = "a part";\n`,
      "app/dist/client/index.html": "<p>a page</p>",
    });
    const { plain, compiled } = await bothWays(String(dir), "./dist/server/entry.mjs", "--asset", "dist/client");
    expect(plain).toEqual({
      stdout: "server a part true entry.mjs true\n<p>a page</p> client,server\n",
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("the folder of the entry point itself is an asset", async () => {
    using dir = tempDir("aot-asset-holds-the-entry-point", {
      "app/server/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(path.basename(__dirname), fs.readFileSync(__filename, "utf8").split("\\n")[0], fs.readFileSync(path.join(__dirname, "note.txt"), "utf8"), fs.readdirSync(__dirname).sort().join());
`,
      "app/server/note.txt": "a note",
    });
    const { plain, compiled } = await bothWays(String(dir), "./server/start.cjs", "--asset", "server");
    expect(plain).toEqual({
      stdout: `server const fs = require("node:fs"); a note note.txt,start.cjs\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("only an asset at the top has to differ from the name of the executable", async () => {
    using dir = tempDir("aot-asset-named-like-the-executable", {
      "app/main.cjs": `console.log(require("node:fs").readFileSync(require("node:path").join(__dirname, "outer", "built.exe", "note.txt"), "utf8"));\n`,
      "app/outer/built.exe/note.txt": "a note",
      "app/built.exe/note.txt": "another",
    });
    const refused = await run(join(String(dir), "app"), [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "./main.cjs",
      "--asset",
      "./built.exe",
      "--outfile",
      "../built.exe",
    ]);
    expect({
      stderr: refused.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: refused.exitCode,
    }).toEqual({
      stderr: [`error: asset "./built.exe" would embed at the same path as the entry point; use a different outfile`],
      exitCode: 1,
    });
    const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "./outer/built.exe");
    expect(plain).toEqual({ stdout: "a note\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("--root decides what the paths start from", async () => {
    using dir = tempDir("aot-asset-under-a-written-root", {
      "app/packages/site/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(path.basename(__dirname), path.basename(path.dirname(__dirname)), fs.readFileSync(path.join(__dirname, "..", "..", "shared", "data", "note.txt"), "utf8"));
`,
      "app/shared/data/note.txt": "a note",
    });
    const { plain, compiled } = await bothWays(
      String(dir),
      "./packages/site/main.cjs",
      "--root",
      ".",
      "--asset",
      "shared/data",
    );
    expect(plain).toEqual({ stdout: "site packages a note\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an asset from outside of the working directory lies beside the entry point by its name", async () => {
    using dir = tempDir("aot-asset-from-elsewhere", {
      "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(fs.existsSync(path.join(__dirname, "..", "elsewhere", "note.txt")), fs.existsSync(path.join(__dirname, "elsewhere", "note.txt")));
`,
      "elsewhere/note.txt": "a note",
    });
    const { plain, compiled } = await bothWays(String(dir), "./main.cjs", "--asset", "../elsewhere");
    expect(plain).toEqual({ stdout: "true false\n", stderr: "", exitCode: 0 });
    // The first is the file on disk, beside the folder of the build, which `__dirname` names. The second is the one in the executable.
    expect(compiled).toEqual({ ...plain, stdout: "true true\n" });
  }, 120_000);

  test.each(["main.mjs", "main.cjs"])(
    "an outside asset is also found by its base name from %s",
    async entryPoint => {
      const body = `const at = (...names) => fs.existsSync(path.join(here, ...names));
console.log(at("data.txt"), at("elsewhere"), at("elsewhere", "sub", "note.txt"), at("sub"), at("note.txt"));
if (at("elsewhere")) console.log(fs.readdirSync(path.join(here, "elsewhere")).join(), fs.readFileSync(path.join(here, "elsewhere", "sub", "note.txt"), "utf8"));
`;
      using dir = tempDir("aot-outside-asset-base-names", {
        "app/server/main.mjs": `import fs from "node:fs";\nimport path from "node:path";\nconst here = import.meta.dirname;\n${body}`,
        "app/server/main.cjs": `const fs = require("node:fs");\nconst path = require("node:path");\nconst here = __dirname;\n${body}`,
        "app/lib/data.txt": "the text",
        "app/elsewhere/sub/note.txt": "a note",
      });
      const flags = ["--asset", "../lib/data.txt", "--asset", "../elsewhere"];
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", `./${entryPoint}`, ...flags);
      expect(plain).toEqual({ stdout: "false false false false false\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual({ ...plain, stdout: "true true true false false\nsub a note\n" });
    },
    120_000,
  );

  test.each(["main.mjs", "main.cjs"])(
    "an outside asset is mounted outside the root of %s",
    async entryPoint => {
      const body = `console.log(fs.readdirSync(here).sort().join(), fs.readFileSync(path.join(here, "..", "data.txt"), "utf8"));\n`;
      using dir = tempDir("aot-outside-asset-mount", {
        "app/server/main.mjs": `import fs from "node:fs";\nimport path from "node:path";\nconst here = import.meta.dirname;\n${body}`,
        "app/server/main.cjs": `const fs = require("node:fs");\nconst path = require("node:path");\nconst here = __dirname;\n${body}`,
        "app/data.txt": "the text",
      });
      const { plain, compiled } = await bothWaysIn(
        String(dir),
        "app/server",
        `./${entryPoint}`,
        "--asset",
        "../data.txt",
      );
      expect(plain).toEqual({ stdout: "main.cjs,main.mjs the text\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual({ ...plain, stdout: `data.txt,${entryPoint} the text\n` });
    },
    120_000,
  );

  test("outside folders may share a base name", async () => {
    using dir = tempDir("aot-outside-folders-share-base-name", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const at = (...names) => fs.existsSync(path.join(import.meta.dirname, ...names));
console.log(at("..", "one", "pub", "a.txt"), at("..", "two", "pub", "b.txt"), at("pub", "a.txt"), at("pub", "b.txt"), at("pub", "c.txt"));
`,
      "app/one/pub/a.txt": "a",
      "app/two/pub/b.txt": "b",
    });
    const flags = ["--asset", "../one/pub", "--asset", "../two/pub"];
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect(plain).toEqual({ stdout: "true true false false false\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual({ ...plain, stdout: "true true true true false\n" });
  }, 120_000);

  test("a shared base name lists every folder", async () => {
    using dir = tempDir("aot-shared-base-name-lists-all", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const attempt = run => {
  try {
    return run().sort().join();
  } catch (error) {
    return error.code;
  }
};
const at = (...names) => path.join(import.meta.dirname, ...names);
for (const folder of [at("pub"), at("pub", "deep"), at("..", "one", "pub"), at("..", "two", "pub")]) {
  console.log(attempt(() => fs.readdirSync(folder)));
}
console.log(attempt(() => (fs.existsSync(at("pub")) ? [...new Bun.Glob("*.txt").scanSync({ cwd: at("pub") })] : [])));
`,
      "app/one/pub/a.txt": "a",
      "app/one/pub/deep/c.txt": "c",
      "app/two/pub/b.txt": "b",
      "app/two/pub/deep/d.txt": "d",
    });
    const flags = ["--asset", "../one/pub", "--asset", "../two/pub"];
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect(built.stdout + built.stderr).not.toContain("share the path");
    const byOwnPlace = "a.txt,deep\nb.txt,deep\n";
    expect(plain).toEqual({ stdout: `ENOENT\nENOENT\n${byOwnPlace}\n`, stderr: "", exitCode: 0 });
    expect(compiled).toEqual({
      ...plain,
      stdout: `a.txt,b.txt,deep\nc.txt,d.txt\n${byOwnPlace}a.txt,b.txt\n`,
    });
  }, 120_000);

  test("a file name in two folders of one base name is warned of", async () => {
    using dir = tempDir("aot-asset-name-in-two-folders", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const read = (...names) => {
  try {
    return fs.readFileSync(path.join(import.meta.dirname, ...names), "utf8");
  } catch (error) {
    return error.code;
  }
};
console.log(read("..", "one", "pub", "same.txt"), read("..", "two", "pub", "same.txt"), read("..", "two", "pub", "only.txt"));
console.log(read("pub", "same.txt"), read("pub", "only.txt"));
`,
      "app/one/pub/same.txt": "of-one",
      "app/two/pub/same.txt": "of-two",
      "app/two/pub/only.txt": "only-in-two",
    });
    const flags = ["--asset", "../one/pub", "--asset", "../two/pub"];
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect((built.stdout + built.stderr).split("\n").filter(line => line.includes("share the path"))).toEqual([
      `warn: assets "../one/pub/same.txt" and "../two/pub/same.txt" share the path "pub/same.txt" in the executable. That path reads "../one/pub/same.txt". Each asset is also at its own path`,
    ]);
    expect(plain).toEqual({ stdout: "of-one of-two only-in-two\nENOENT ENOENT\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual({ stdout: "of-one of-two only-in-two\nof-one only-in-two\n", stderr: "", exitCode: 0 });
  }, 120_000);

  test("an asset that import.meta cannot reach is warned of", async () => {
    const say = `const say = (label, at) => {
  try {
    console.log(label, fs.readFileSync(at, "utf8"));
  } catch (error) {
    console.log(label, error.code);
  }
};`;
    const head = `import fs from "node:fs";\nimport path from "node:path";\n${say}`;
    using dir = tempDir("aot-asset-out-of-reach", {
      "app/middle/server/main.mjs": `${head}
import "./sub/below.mjs";
import "./build-path.mjs";
import "./own-dirname.mjs";
import "../beside/above.mjs";
import { createRequire } from "node:module";
say("entry", path.join(import.meta.dirname, "..", "..", "far", "a.txt"));
say("one folder up", path.join(import.meta.dirname, "..", "near", "b.txt"));
createRequire(import.meta.url)("./common.cjs");
`,
      "app/middle/server/sub/below.mjs": `${head}
say("below the root", path.join(import.meta.dirname, "..", "..", "..", "far", "a.txt"));
`,
      "app/middle/server/build-path.mjs": `${head}
say("__dirname", path.join(__dirname, "..", "..", "far", "a.txt"));
`,
      "app/middle/server/own-dirname.mjs": `${head}
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
say("a __dirname of its own", path.join(__dirname, "..", "..", "far", "a.txt"));
`,
      "app/middle/beside/above.mjs": `${head}
say("above the root", path.join(import.meta.dirname, "..", "..", "far", "a.txt"));
`,
      "app/middle/server/common.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
say("CommonJS", path.join(__dirname, "..", "..", "far", "a.txt"));
`,
      "app/far/a.txt": "far",
      "app/middle/near/b.txt": "near",
    });
    const flags = ["--asset", "../../far", "--asset", "../near"];
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app/middle/server", "./main.mjs", ...flags);
    const imported = ["below the root", "__dirname", "a __dirname of its own", "above the root"];
    const order = [...imported, "entry", "one folder up", "CommonJS"];
    const text = (label: string) => (label === "one folder up" ? "near" : "far");
    expect(plain.stdout).toBe(order.map(label => `${label} ${text(label)}\n`).join(""));
    const isOutOfReach = (label: string) => ["entry", "below the root", "a __dirname of its own"].includes(label);
    expect(compiled).toEqual({
      stdout: order.map(label => `${label} ${isOutOfReach(label) ? "ENOENT" : text(label)}\n`).join(""),
      stderr: "",
      exitCode: 0,
    });
    const output = (built.stdout + built.stderr).replaceAll("\\", "/");
    const warned = [...output.matchAll(/TS100087[^\n]*\n[^\n]*?at ([^\n:]+):(\d+)/g)].map(it => `${it[1]}:${it[2]}`);
    expect({ warnings: output.split("TS100087").length - 1, others: output.split("TS100098").length - 1 }).toEqual({
      warnings: 3,
      others: 0,
    });
    expect(output).toContain(
      `This reads "../../far/a.txt", which is in the executable, but this path doesn't lead there`,
    );
    expect(warned.length === 0 || warned.every(it => /main\.mjs|below\.mjs|own-dirname\.mjs/.test(it))).toBe(true);
  }, 120_000);

  test.skipIf(isWindows)(
    "the written path decides whether import.meta reaches an asset",
    async () => {
      using dir = tempDir("aot-asset-reach-through-links", {
        "app/middle/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const say = (label, ask) => {
  try {
    console.log(label, String(ask()));
  } catch (error) {
    console.log(label, error.code);
  }
};
say("a link one up", () => fs.readFileSync(path.join(import.meta.dirname, "..", "near-link", "a.txt"), "utf8"));
say("a link two up", () => fs.readFileSync(path.join(import.meta.dirname, "..", "..", "far-link", "b.txt"), "utf8"));
say("a folder two up", () => fs.existsSync(path.join(import.meta.dirname, "..", "..", "far")));
say("its listing", () => fs.readdirSync(path.join(import.meta.dirname, "..", "..", "far")));
`,
        "app/far/a.txt": "far",
        "app/middle/near/b.txt": "near",
      });
      symlinkSync("../far", join(String(dir), "app/middle/near-link"));
      symlinkSync("middle/near", join(String(dir), "app/far-link"));
      const flags = ["../near-link", "../../far-link", "../../far"].flatMap(asset => ["--asset", asset]);
      const { plain, built, compiled } = await bothWaysIn(String(dir), "app/middle/server", "./main.mjs", ...flags);
      expect(plain.stdout).toBe("a link one up far\na link two up near\na folder two up true\nits listing a.txt\n");
      expect(compiled).toEqual({
        stdout: "a link one up far\na link two up ENOENT\na folder two up false\nits listing ENOENT\n",
        stderr: "",
        exitCode: 0,
      });
      const output = built.stdout + built.stderr;
      const warned = [...output.matchAll(/TS100087: This reads "([^"]+)"/g)].map(it => it[1]).sort();
      expect(warned).toEqual(["../../far", "../../far", "../../far-link/b.txt"]);
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "a read through a link inside an asset folder is warned of",
    async () => {
      const files = {
        "app/middle/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const here = import.meta.dirname;
const say = (label, read) => {
  try {
    console.log(label, read());
  } catch (error) {
    console.log(label, error.code);
  }
};
say("through a folder link", () => fs.readFileSync(path.join(here, "..", "box", "inner", "a.txt"), "utf8"));
say("through a file link", () => fs.readFileSync(path.join(here, "..", "box", "file-link.txt"), "utf8"));
say("beside them", () => fs.readFileSync(path.join(here, "..", "box", "own.txt"), "utf8"));
say("below the root", () => fs.readFileSync(path.join(here, "held", "inner", "a.txt"), "utf8"));
`,
        "app/far/a.txt": "far",
        "app/middle/box/own.txt": "own",
        "app/middle/server/held/own.txt": "own",
      };
      const links = (dir: string) => {
        symlinkSync("../../far", join(dir, "app/middle/box/inner"));
        symlinkSync("../../far/a.txt", join(dir, "app/middle/box/file-link.txt"));
        symlinkSync("../../../far", join(dir, "app/middle/server/held/inner"));
      };
      const asked = "through a folder link far\nthrough a file link far\nbeside them own\nbelow the root far\n";
      const given = ["--asset", "../box", "--asset", "held"];
      let advised: string[];
      {
        using dir = tempDir("aot-links-inside-assets", files);
        links(String(dir));
        const { plain, built, compiled } = await bothWaysIn(String(dir), "app/middle/server", "./main.mjs", ...given);
        expect(plain.stdout).toBe(asked);
        expect(compiled.stdout).toBe(
          "through a folder link ENOENT\nthrough a file link ENOENT\nbeside them own\nbelow the root ENOENT\n",
        );
        const warnings = /(TS\d+): This reads "([^"]+)"[^\n]*? Embed it with --asset (\S+)/g;
        const found = [...(built.stdout + built.stderr).matchAll(warnings)];
        expect(found.map(it => `${it[1]} ${it[2]} > ${it[3]}`).sort()).toEqual([
          "TS100165 ../box/file-link.txt > ../box/file-link.txt",
          "TS100165 ../box/inner/a.txt > ../box/inner",
          "TS100165 held/inner/a.txt > held/inner",
        ]);
        advised = found.map(it => it[3]);
      }
      {
        // What the messages advise, word for word.
        using dir = tempDir("aot-links-given-as-assets", files);
        links(String(dir));
        const flags = [...given, ...advised.flatMap(asset => ["--asset", asset])];
        const { built, compiled } = await bothWaysIn(String(dir), "app/middle/server", "./main.mjs", ...flags);
        expect(compiled.stdout).toBe(asked);
        expect(built.stdout + built.stderr).not.toContain("This reads");
      }
    },
    240_000,
  );

  test("an outside folder without files gets no name in the root", async () => {
    using dir = tempDir("aot-outside-folder-without-files", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
console.log(fs.readdirSync(import.meta.dirname).join(), fs.existsSync(path.join(import.meta.dirname, "empty")));
`,
    });
    mkdirSync(join(String(dir), "app/empty"));
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "../empty");
    expect(plain).toEqual({ stdout: "main.mjs false\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.each(["mjs", "cjs"] as const)(
    "in %s a folder below the root shares its base name with one outside",
    async kind => {
      const head =
        kind === "mjs"
          ? `import fs from "node:fs"; import path from "node:path"; const here = import.meta.dirname;`
          : `const fs = require("node:fs"), path = require("node:path"), here = __dirname;`;
      using dir = tempDir("aot-own-folder-shares-base-name", {
        [`app/server/main.${kind}`]: `${head}
const read = (...names) => {
  try {
    return fs.readFileSync(path.join(here, ...names), "utf8");
  } catch (error) {
    return error.code;
  }
};
const tidy = it => it.replaceAll("\\\\", "/");
console.log("own place", read("pub", "in.txt"), read("pub", "same.txt"), read("..", "one", "pub", "out.txt"), read("..", "one", "pub", "same.txt"));
console.log("base name", read("pub", "out.txt"), read("pub", "deep", "far.txt"), read("pub", "absent.txt"));
console.log("outside", fs.readdirSync(path.join(here, "..", "one", "pub")).sort().join());
console.log("listed", fs.readdirSync(path.join(here, "pub")).sort().join());
console.log("below", fs.readdirSync(path.join(here, "pub"), { recursive: true }).map(tidy).sort().join());
console.log("glob", [...new Bun.Glob("pub/**/*.txt").scanSync({ cwd: here })].map(tidy).sort().join());
console.log("embedded", Bun.embeddedFiles.map(it => tidy(it.name)).filter(it => !it.startsWith("main")).sort().join());
`,
        "app/server/pub/in.txt": "in",
        "app/server/pub/same.txt": "own",
        "app/one/pub/out.txt": "out",
        "app/one/pub/same.txt": "outside",
        "app/one/pub/deep/far.txt": "far",
      });
      const flags = ["--asset", "../one/pub", "--asset", "pub"];
      const { plain, built, compiled } = await bothWaysIn(String(dir), "app/server", `./main.${kind}`, ...flags);
      expect((built.stdout + built.stderr).split("\n").filter(line => line.includes("share the path"))).toEqual([
        `warn: assets "pub/same.txt" and "../one/pub/same.txt" share the path "pub/same.txt" in the executable. That path reads "pub/same.txt". Each asset is also at its own path`,
      ]);
      const ownPlace = "own place in own out outside";
      const outside = "outside deep,out.txt,same.txt";
      expect(plain).toEqual({
        stdout: `${ownPlace}
base name ENOENT ENOENT ENOENT
${outside}
listed in.txt,same.txt
below in.txt,same.txt
glob pub/in.txt,pub/same.txt
embedded 
`,
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual({
        stdout: `${ownPlace}
base name out far ENOENT
${outside}
listed deep,in.txt,out.txt,same.txt
below deep,deep/far.txt,in.txt,out.txt,same.txt
glob pub/deep/far.txt,pub/in.txt,pub/out.txt,pub/same.txt
embedded _.._/one/pub/same.txt,pub/deep/far.txt,pub/in.txt,pub/out.txt,pub/same.txt
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.each(["mjs", "cjs"] as const)(
    "in %s what the root holds hides an outside entry of its name",
    async kind => {
      const head =
        kind === "mjs"
          ? `import fs from "node:fs"; import path from "node:path"; import "./pub/code.mjs"; const here = import.meta.dirname;`
          : `const fs = require("node:fs"), path = require("node:path"), here = __dirname; require("./pub/code.cjs");`;
      using dir = tempDir("aot-own-entries-hide-outside-ones", {
        [`app/server/main.${kind}`]: `${head}
const say = (label, ask) => {
  try {
    console.log(label, String(ask()));
  } catch (error) {
    console.log(label, error.code);
  }
};
const at = (...names) => path.join(here, ...names);
const tidy = it => it.replaceAll("\\\\", "/");
const open = folder => {
  const opened = fs.opendirSync(folder);
  const first = opened.readSync().name;
  opened.closeSync();
  return first;
};
say("as plain: the own folder is one", () => fs.statSync(at("pub", "folder")).isDirectory());
say("as plain: the own folder is read", () => fs.readFileSync(at("pub", "folder"), "utf8"));
say("as plain: the own folder is listed", () => fs.readdirSync(at("pub", "folder")).join());
say("as plain: the own folder is opened", () => open(at("pub", "folder")));
say("as plain: the own file is read", () => fs.readFileSync(at("pub", "file"), "utf8"));
say("as plain: below the own file", () => fs.readFileSync(at("pub", "file", "in.txt"), "utf8"));
say("as plain: the outside file", () => fs.readFileSync(at("..", "one", "pub", "folder"), "utf8"));
say("as plain: the outside folder", () => fs.readFileSync(at("..", "one", "pub", "file", "in.txt"), "utf8"));
say("outside alone", () => fs.readFileSync(at("pub", "only.txt"), "utf8"));
say("listed", () => fs.readdirSync(at("pub")).sort().join());
say("below", () => fs.readdirSync(at("pub"), { recursive: true }).map(tidy).sort().join());
`,
        [`app/server/pub/code.${kind}`]: kind === "mjs" ? "export {};\n" : "exports.loaded = true;\n",
        "app/server/pub/folder/in.txt": "own in",
        "app/server/pub/file": "own file",
        "app/one/pub/folder": "outside file",
        "app/one/pub/file/in.txt": "outside in",
        "app/one/pub/only.txt": "only",
      });
      const flags = ["--asset", "../one/pub", "--asset", "pub"];
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", `./main.${kind}`, ...flags);
      const isAsPlain = (line: string) => line.startsWith("as plain: ");
      const asPlain = plain.stdout.split("\n").filter(isAsPlain);
      expect(asPlain).toHaveLength(8);
      // A gap in CommonJS off Windows: a name below a file of the executable fails with ENOENT where `bun run` says ENOTDIR. The day it says ENOTDIR this fails: take the line out.
      const hasGap = kind === "cjs" && !isWindows;
      const expected = asPlain.map(line => (hasGap ? line.replace("own file ENOTDIR", "own file ENOENT") : line));
      expect(compiled.stdout.split("\n").filter(isAsPlain)).toEqual(expected);
      const rest = compiled.stdout.split("\n").filter(line => !isAsPlain(line));
      expect({ ...compiled, stdout: rest.join("\n") }).toEqual({
        stdout: `outside alone only
listed code.${kind},file,folder,only.txt
below code.${kind},file,folder,folder/in.txt,only.txt
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.each([
    ["the file", ["../one/pub", "../two/pub"], "file of one", "no file", "only.txt,x", "only.txt,x"],
    ["the folder", ["../two/pub", "../one/pub"], "EISDIR", "in two", "only.txt,x", "only.txt,x,x/in.txt"],
  ] as const)(
    "of two outside folders the earlier one decides: %s",
    async (_, assets, entry, below, listed, listedBelow) => {
      using dir = tempDir("aot-earlier-folder-hides-later-one", {
        "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const say = (label, ask) => {
  try {
    console.log(label, String(ask()));
  } catch (error) {
    console.log(label, error.code === "ENOTDIR" || error.code === "ENOENT" ? "no file" : error.code);
  }
};
const at = (...names) => path.join(import.meta.dirname, "pub", ...names);
say("entry", () => fs.readFileSync(at("x"), "utf8"));
say("below", () => fs.readFileSync(at("x", "in.txt"), "utf8"));
say("is a folder", () => fs.statSync(at("x")).isDirectory());
say("listed", () => fs.readdirSync(at()).sort().join());
say("listed below", () => fs.readdirSync(at(), { recursive: true }).map(it => it.replaceAll("\\\\", "/")).sort().join());
`,
        "app/one/pub/x": "file of one",
        "app/one/pub/only.txt": "only",
        "app/two/pub/x/in.txt": "in two",
      });
      const flags = assets.flatMap(asset => ["--asset", asset]);
      const { compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
      expect(compiled).toEqual({
        stdout: `entry ${entry}
below ${below}
is a folder ${entry === "EISDIR"}
listed ${listed}
listed below ${listedBelow}
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.each([
    ["a file", { "app/zero/pub/x": "file" }, "x/same.txt", "pub/x/same.txt", "no file"],
    ["a folder", { "app/zero/pub/x/in.txt": "in" }, "x", "pub/x", "EISDIR"],
    ["nothing", { "app/zero/pub/other.txt": "other" }, "x", "pub/x", "of one"],
  ] as const)(
    "the warning on a shared path says what the path reads where %s comes first",
    async (_, earlier, shared, name, read) => {
      using dir = tempDir("aot-shared-path-behind-earlier-entry", {
        "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
try {
  console.log(fs.readFileSync(path.join(import.meta.dirname, ${JSON.stringify(name)}), "utf8"));
} catch (error) {
  console.log(error.code === "ENOTDIR" || error.code === "ENOENT" ? "no file" : error.code);
}
`,
        ...earlier,
        [`app/one/pub/${shared}`]: "of one",
        [`app/two/pub/${shared}`]: "of two",
      });
      const flags = ["zero", "one", "two"].flatMap(folder => ["--asset", `../${folder}/pub`]);
      const { built, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
      expect(compiled).toEqual({ stdout: `${read}\n`, stderr: "", exitCode: 0 });
      const sentence = read === "of one" ? `"../one/${name}"` : `none of them: "../zero/pub/x" comes first`;
      expect((built.stdout + built.stderr).replaceAll("\\", "/")).toContain(
        `assets "../one/${name}" and "../two/${name}" share the path "${name}" in the executable. That path reads ${sentence}. Each`,
      );
    },
    120_000,
  );

  const namedAtRoot = [
    ["a folder", ["--asset", "../lib/pub"], "pub", "pub/a.txt", "../lib", ["pub/a.txt", "pub/deep/c.txt"]],
    ["a file", ["--asset", "../lib/note.txt"], "note.txt", "note.txt", "../lib", ["note.txt"]],
    [
      "two folders",
      ["--asset", "../lib/pub", "--asset", "../more/pub"],
      "pub",
      "pub/b.txt",
      "../more",
      ["pub/a.txt", "pub/b.txt", "pub/deep/c.txt"],
    ],
  ] as const;
  test.each(namedAtRoot.flatMap(row => (["mjs", "cjs"] as const).map(kind => [kind, ...row] as const)))(
    "in %s the base name of %s from outside answers as a path does",
    async (kind, _, flags, top, file, place, all) => {
      const head =
        kind === "mjs"
          ? `import fs from "node:fs"; import path from "node:path"; const here = import.meta.dirname;`
          : `const fs = require("node:fs"), path = require("node:path"), here = __dirname;`;
      using dir = tempDir("aot-base-names-at-root", {
        [`app/server/main.${kind}`]: `${head}
const tidy = it => it.replaceAll("\\\\", "/");
const isFile = at => {
  try {
    return fs.statSync(at, { throwIfNoEntry: false })?.isFile() ?? null;
  } catch (error) {
    return error.code;
  }
};
const ask = async at => [fs.existsSync(at), isFile(at), await Bun.file(at).exists()];
const spell = names => {
  const file = path.join(here, ...names), folder = path.dirname(file), base = path.basename(file);
  return {
    tidy: file,
    untidy: folder + "/./" + base,
    doubled: folder + "//" + base,
    slash: file + "/",
    separator: file + path.sep,
    backslash: file + "\\\\",
    climbs: file + "/../" + base,
    backslashes: here + "\\\\" + names.join("\\\\"),
    forward: tidy(file),
    lower: file[0].toLowerCase() + file.slice(1),
    upper: file[0].toUpperCase() + file.slice(1),
  };
};
(async () => {
  const names = ${JSON.stringify(file.split("/"))};
  for (const [way, from] of [["short", []], ["own", ${JSON.stringify(place.split("/"))}]])
    for (const [name, at] of Object.entries(spell([...from, ...names]))) console.log(way, name, JSON.stringify(await ask(at)));
  console.log("embedded", Bun.embeddedFiles.map(it => tidy(it.name)).filter(it => !it.startsWith("main")).sort().join());
  console.log("root", fs.readdirSync(here).sort().join());
  console.log("glob", [...new Bun.Glob("**/*.txt").scanSync({ cwd: here })].map(tidy).sort().join());
  console.log("globSync", fs.globSync("**/*.txt", { cwd: here }).map(tidy).sort().join());
})();
`,
        "app/lib/pub/a.txt": "a",
        "app/lib/pub/deep/c.txt": "c",
        "app/lib/note.txt": "n",
        "app/more/pub/b.txt": "b",
      });
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", `./main.${kind}`, ...flags);
      const linesOf = (ran: typeof plain) => ran.stdout.split("\n");
      const rowsOf = (ran: typeof plain, way: string) =>
        linesOf(ran)
          .filter(line => line.startsWith(way + " "))
          .map(line => line.slice(way.length + 1));
      // The platform decides what an untidy spelling names. Under plain Bun the asset lies at its own place alone: what is said of it there, the executable says by either name.
      const asPlain = rowsOf(plain, "own");
      const found = "[true,true,true]";
      const absent = "[false,null,false]";
      const noFolder = '[false,"ENOTDIR",false]';
      const onPosix = {
        tidy: found,
        untidy: found,
        doubled: found,
        slash: noFolder,
        separator: noFolder,
        backslash: absent,
      };
      const alsoOnPosix = { climbs: noFolder, backslashes: absent, forward: found, lower: found, upper: found };
      const said = Object.entries({ ...onPosix, ...alsoOnPosix }).map(([name, answer]) => `${name} ${answer}`);
      expect(isWindows ? asPlain.slice(0, 1) : asPlain).toEqual(isWindows ? said.slice(0, 1) : said);
      // CI cuts the middle out of a long failure, so only the rows that differ are shown, each with both answers.
      const differing = ["short", "own"].flatMap(way => {
        const rows = rowsOf(compiled, way);
        const missing = rows.length === asPlain.length ? [] : [`${way}: ${rows.length} rows of ${asPlain.length}`];
        return [...missing, ...rows.filter((row, at) => row !== asPlain[at]).map(row => `${way} ${row}`)];
      });
      const differingInPlain = asPlain.filter(row => differing.some(it => it.split(" ")[1] === row.split(" ")[0]));
      expect({ executable: differing, plain: differingInPlain }).toEqual({ executable: [], plain: [] });
      const rest = linesOf(compiled).filter(line => !/^(short|own) /.test(line));
      expect({ ...compiled, stdout: rest.join("\n") }).toEqual({
        stdout: `embedded ${all.join()}
root ${[`main.${kind}`, top].sort().join()}
glob ${all.join()}
globSync ${all.join()}
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "a backslash in an asset's name stays in it",
    async () => {
      using dir = tempDir("aot-backslash-in-asset-names", {
        "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const read = (...names) => {
  try {
    return fs.readFileSync(path.join(import.meta.dirname, ...names), "utf8");
  } catch (error) {
    return error.code;
  }
};
console.log(read("..", "lib", "pub\\\\x", "a.txt"), read("in\\\\y", "b.txt"), read("..", "lib", "f\\\\g.txt"));
console.log(read("pub\\\\x", "a.txt"), read("f\\\\g.txt"), read("pub", "x", "a.txt"), read("in", "y", "b.txt"), read("g.txt"));
console.log(Bun.embeddedFiles.map(it => it.name).filter(it => !it.startsWith("main")).sort().join());
`,
        "app/lib/pub\\x/a.txt": "a",
        "app/server/in\\y/b.txt": "b",
        "app/lib/f\\g.txt": "g",
      });
      const flags = ["--asset", "../lib/pub\\x", "--asset", "in\\y", "--asset", "../lib/f\\g.txt"];
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
      const byOwnPlace = "a b g\n";
      expect(plain).toEqual({ stdout: `${byOwnPlace}ENOENT ENOENT ENOENT ENOENT ENOENT\n\n`, stderr: "", exitCode: 0 });
      expect(compiled).toEqual({
        stdout: `${byOwnPlace}a g ENOENT ENOENT ENOENT\nf\\g.txt,in\\y/b.txt,pub\\x/a.txt\n`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test("an untidy path finds an embedded file", async () => {
    // Windows drops `absent/..` from a path before it looks, so plain Bun finds these three there.
    const climbsOutOfNoFolder = ["/absent/../sub/note.txt", "/../absent/../lib/data.txt", "/sub/note.txt/../note.txt"];
    const notFound = isWindows ? [] : climbsOutOfNoFolder;
    using dir = tempDir("aot-untidy-embedded-paths", {
      "app/server/main.mjs": `import fs from "node:fs";
const texts = ["/../lib/data.txt", "/../lib/./data.txt", "/../lib//data.txt", "/./sub/note.txt", "/sub/../sub/note.txt"];
for (const text of texts) console.log(text, fs.existsSync(import.meta.dirname + text), fs.readFileSync(import.meta.dirname + text, "utf8"));
for (const text of ${JSON.stringify(notFound)}) console.log(text, fs.existsSync(import.meta.dirname + text));
`,
      "app/server/sub/note.txt": "a note",
      "app/lib/data.txt": "the text",
    });
    const flags = ["--asset", "../lib/data.txt", "--asset", "sub/note.txt"];
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect(plain).toEqual({
      stdout: `/../lib/data.txt true the text
/../lib/./data.txt true the text
/../lib//data.txt true the text
/./sub/note.txt true a note
/sub/../sub/note.txt true a note
${notFound.map(text => text + " false\n").join("")}`,
      stderr: "",
      exitCode: 0,
    });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.each([
    [`"../server/note.txt"`, `"../server"`],
    [`"..", "server", "note.txt"`, `"..", "server"`],
  ])(
    "a module above the root reads below it by path.join(here, %s)",
    async (file, folder) => {
      using dir = tempDir("aot-back-through-root-folders", {
        "app/server/main.mjs": `import "../lib/load.mjs";\n`,
        "app/server/note.txt": "a note",
        "app/lib/load.mjs": `import fs from "node:fs";
import path from "node:path";
const here = import.meta.dirname;
const [file, folder] = [path.join(here, ${file}), path.join(here, ${folder})];
console.log(fs.existsSync(file), fs.readFileSync(file, "utf8"), fs.existsSync(folder), fs.statSync(folder).isDirectory());
console.log(fs.existsSync(path.join(here, "../servers/note.txt")), fs.existsSync(path.join(here, "../server/absent.txt")));
`,
      });
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "note.txt");
      expect(plain).toEqual({ stdout: "true a note true true\nfalse false\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("an outside folder keeps its path", async () => {
    using dir = tempDir("aot-outside-folder-keeps-path", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const folder = path.join(import.meta.dirname, "..", "elsewhere");
console.log(fs.readdirSync(folder).join(), fs.readFileSync(path.join(folder, "sub", "note.txt"), "utf8"));
`,
      "app/elsewhere/sub/note.txt": "a note",
    });
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "../elsewhere");
    expect(plain).toEqual({ stdout: "sub a note\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  // The second embeds the source of the compiled module too.
  test.each([[["--asset", "../lib/data.txt", "--asset", "../lib/sub"]], [["--asset", "../lib"]]])(
    "an asset beside an outside module keeps its path %j",
    async flags => {
      using dir = tempDir("aot-asset-beside-outside-module", {
        "app/server/main.mjs": `import "../lib/load.mjs";\n`,
        "app/lib/load.mjs": `import fs from "node:fs";
import path from "node:path";
const here = import.meta.dirname;
console.log(fs.readFileSync(path.join(here, "data.txt"), "utf8"), fs.readFileSync(path.join(here, "sub", "more.txt"), "utf8"));
console.log(fs.existsSync(path.join(here, "sub")), fs.existsSync(path.join(here, "absent.txt")), fs.statSync(path.join(here, "data.txt")).size);
console.log(fs.readdirSync(here).sort().join(), fs.readdirSync(path.join(here, "sub")).join());
`,
        "app/lib/data.txt": "the text",
        "app/lib/sub/more.txt": "more",
      });
      const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
      expect(plain).toEqual({
        stdout: "the text more\ntrue false 8\ndata.txt,load.mjs,sub more.txt\n",
        stderr: "",
        exitCode: 0,
      });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("an asset above the working directory keeps its path", async () => {
    using dir = tempDir("aot-asset-above-working-directory", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
console.log(fs.readFileSync(path.join(import.meta.dirname, "..", "data.txt"), "utf8"), fs.readFileSync(new URL("../data.txt", import.meta.url), "utf8"), await Bun.file(new URL("../data.txt", import.meta.url)).exists());
`,
      "app/data.txt": "the text",
    });
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "../data.txt");
    expect(plain).toEqual({ stdout: "the text the text true\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test.skipIf(isWindows)(
    "an asset in a linked package keeps its path",
    async () => {
      using dir = tempDir("aot-asset-in-linked-package", {
        "app/server/main.cjs": `console.log(require("pkg").load());\n`,
        "app/pkg/package.json": `{ "name": "pkg", "main": "index.cjs" }`,
        "app/pkg/index.cjs": `exports.load = () => require("node:fs").readFileSync(require("node:path").join(__dirname, "data.txt"), "utf8");\n`,
        "app/pkg/data.txt": "the text",
      });
      mkdirSync(join(String(dir), "app/server/node_modules"));
      symlinkSync("../../pkg", join(String(dir), "app/server/node_modules/pkg"));
      const { plain, compiled } = await bothWaysIn(
        String(dir),
        "app/server",
        "./main.cjs",
        "--asset",
        "../pkg/data.txt",
      );
      expect(plain).toEqual({ stdout: "the text\n", stderr: "", exitCode: 0 });
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test("outside assets may share a base name", async () => {
    using dir = tempDir("aot-outside-assets-share-base-name", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
const read = (...names) => fs.readFileSync(path.join(import.meta.dirname, ...names), "utf8");
console.log(read("..", "one", "config.json"), read("..", "two", "config.json"), fs.existsSync(path.join(import.meta.dirname, "config.json")));
`,
      "app/one/config.json": "1",
      "app/two/config.json": "2",
    });
    const flags = ["--asset", "../one/config.json", "--asset", "../two/config.json"];
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", ...flags);
    expect(plain).toEqual({ stdout: "1 2 false\n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an outside file is also found by its base name", async () => {
    using dir = tempDir("aot-outside-asset-base-name", {
      "app/server/main.mjs": `import fs from "node:fs";
import path from "node:path";
console.log(fs.existsSync(path.join(import.meta.dirname, "data.txt")), Bun.embeddedFiles.map(file => file.name).join());
`,
      "app/lib/data.txt": "the text",
    });
    const { plain, compiled } = await bothWaysIn(String(dir), "app/server", "./main.mjs", "--asset", "../lib/data.txt");
    expect(plain).toEqual({ stdout: "false \n", stderr: "", exitCode: 0 });
    expect(compiled).toEqual({ ...plain, stdout: "true data.txt\n" });
  }, 120_000);

  // macOS and Windows have no such names.
  test.skipIf(!isLinux).each([[[]], [["--compile-in-place"]]])(
    "an asset whose name is not UTF-8 has U+FFFD in place of each such byte %j",
    async flags => {
      using dir = tempDir("aot-asset-name-is-not-utf-8", {
        "app/main.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(fs.readFileSync(path.join(__dirname, "folder\\ufffd", "note.txt"), "utf8"), fs.readFileSync(path.join(__dirname, "file\\ufffd.txt"), "utf8"), fs.readdirSync(__dirname).sort().join());
`,
      });
      const app = join(String(dir), "app");
      const inApp = (before: string, byte: number, behind: string) =>
        Buffer.concat([Buffer.from(join(app, before)), Buffer.from([byte]), Buffer.from(behind)]);
      for (const [byte, text] of [
        [0xff, "a note"],
        [0xfe, "another note"],
      ] as const) {
        mkdirSync(inApp("folder", byte, ""));
        writeFileSync(inApp("folder", byte, "/note.txt"), text);
      }
      writeFileSync(inApp("file", 0xfe, ".txt"), "a file");
      const build = (...assets: string[]) =>
        run(app, [
          "sh",
          "-c",
          `exec "$0" build --compile --aot ./main.cjs "$@" ${assets.map(asset => `--asset "$(printf '${asset}')"`).join(" ")} --outfile ../built.exe`,
          bunExe(),
          ...flags,
        ]);
      const refused = await build("./folder\\377", "./folder\\376");
      expect({
        stderr: refused.stderr.split("\n").filter(line => line.startsWith("error")),
        exitCode: refused.exitCode,
      }).toEqual({
        stderr: [
          expect.stringMatching(/^error: asset .* collides with another embedded file at ".*folder\ufffd\/note\.txt"$/),
        ],
        exitCode: 1,
      });
      const built = await build("./folder\\377", "./file\\376.txt");
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      renameSync(app, join(String(dir), "moved-away"));
      expect(await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual({
        stdout: "a note a file file\ufffd.txt,folder\ufffd,main.cjs\n",
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );
});
