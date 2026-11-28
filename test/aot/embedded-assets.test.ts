import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { chmodSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { without } from "./harness/capabilities";
import {
  bothWays,
  bothWaysIn,
  main,
  packages,
  plainAfterBuild,
  plainAndBeside,
  run,
  say,
  warnings,
} from "./harness/embedded-files";
import { describe, test } from "./supported";

describe.concurrent("files that are embedded without --asset", () => {
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

  // Each form has a folder of its own, so that one program shows the warning of each.
  const readByAnotherFile = {
    ...Object.fromEntries(
      ["unknown", "known", "inside", "unread"].flatMap(folder => [
        [`app/${folder}/one.txt`, "one"],
        [`app/${folder}/two.txt`, "two"],
      ]),
    ),
    "app/read.mjs": `import { readFileSync } from "node:fs";
import { join } from "node:path";
const read = path => { try { return readFileSync(path, "utf8"); } catch (error) { return error.code; } };
export const readIn = (folder, name) => read(join(folder, name));
export const readOne = folder => read(join(folder, "one.txt"));
export const lengthOf = folder => typeof folder;
`,
  };
  const call = {
    unknown: `readIn(join(import.meta.dirname, "unknown"), process.argv[9] ?? "one.txt")`,
    known: `readIn(join(import.meta.dirname, "known"), "one.txt")`,
    inside: `readOne(join(import.meta.dirname, "inside"))`,
    unread: `lengthOf(join(import.meta.dirname, "unread"))`,
  };

  test.each([
    [
      ["unknown", "known", "inside", "unread"],
      [],
      ["warn TS100098 known/one.txt", "warn TS100172 inside", "warn TS100172 unknown"],
      "ENOENT\nENOENT\nENOENT\nstring\n",
    ],
    [["unknown"], ["--asset", "./unknown"], [], "one\n"],
    [["known", "inside"], ["--asset", "./known/one.txt", "--asset", "./inside/one.txt"], [], "one\none\n"],
  ] as [(keyof typeof call)[], string[], string[], string][])(
    "a warning names a folder that a function of another file reads: %j %j",
    async (forms, flags, expected, stdout) => {
      using dir = tempDir("aot-folder-read-by-another-file", {
        ...readByAnotherFile,
        "app/main.mjs": `import { join } from "node:path";
import { lengthOf, readIn, readOne } from "./read.mjs";
${forms.map(form => `console.log(${call[form]});\n`).join("")}`,
      });
      const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs", ...flags);
      const read = forms.map(form => (form === "unread" ? "string\n" : "one\n")).join("");
      expect(plain).toEqual({ stdout: read, stderr: "", exitCode: 0 });
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
const ways = { own: name => path.join(import.meta.dirname, name) };
export const read = () => fs.readFileSync(path.join(import.meta.dirname, "a.txt"), "utf8");
export const sheet = () => fs.readFileSync(path.join(import.meta.dirname, "a.module.css"), "utf8");
export const classes = async way => Object.keys((await import(ways[way](Buffer.from("a.module.css").toString()))).default).join();
`,
        "app/node_modules/store/a.txt": "first",
        "app/node_modules/store/a.module.css": ".first { color: red }",
        "app/main.mjs": `import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { below, classes, read, sheet } from "store";
const deeds = process.argv.slice(2);
const start = () => Bun.spawnSync({ cmd: [process.env.BUN_OF_TEST, "--version"], stdout: "ignore" });
if (deeds.includes("start")) start();
if (deeds.includes("remove")) fs.rmSync(fs.mkdtempSync(path.join(os.tmpdir(), "store-")), { recursive: true });
console.log("ready");
for await (const _ of console) break;
if (deeds.includes("start later")) start();
console.log(read(), path.basename(below("a.txt")), await classes("own"), sheet());
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
        writeFileSync(join(app, "node_modules/store/a.module.css"), ".changed { color: red }");
        program.stdin.write("go\n");
        program.stdin.end();
      }
      expect(said.split(/\r?\n/)).toEqual(["ready", `${expected} a.txt ${expected} .${expected} { color: red }`, ""]);
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

  test("--explain and the metafile list the files that a package's paths lead to", async () => {
    using dir = tempDir("aot-named-package-files-listed", {
      "app/package.json": `{ "name": "app" }`,
      "app/node_modules/named/package.json": `{ "name": "named", "version": "1.0.0", "main": "index.cjs" }`,
      "app/node_modules/named/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.helper = path.join(__dirname, "helper");
exports.list = () => fs.readdirSync(path.join(__dirname, "list")).sort().join();
exports.part = name => fs.readFileSync(path.join(__dirname, "parts", name + ".txt"), "utf8");
exports.read = () => fs.readFileSync(path.join(__dirname, "read.txt"), "utf8");
exports.has = () => fs.existsSync(path.join(__dirname, "asked.txt"));
`,
      "app/node_modules/named/helper": "a helper",
      "app/node_modules/named/list/a.txt": "a",
      "app/node_modules/named/list/b.txt": "b",
      "app/node_modules/named/parts/a.txt": "part a",
      "app/node_modules/named/parts/b.md": "other",
      "app/node_modules/named/read.txt": "read",
      "app/node_modules/named/asked.txt": "asked",
      "app/node_modules/named/unnamed.txt": "nobody names it",
      "app/main.mjs": `import named from "named";
import path from "node:path";
console.log(path.basename(named.helper), named.list(), named.part("a"), named.read(), named.has());
`,
    });
    const metafile = join(String(dir), "meta.json");
    const flags = ["--explain", "--metafile=" + metafile];
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs", ...flags);
    expect(plain.stdout).toBe("helper a.txt,b.txt part a read true\n");
    expect(compiled).toEqual(plain);
    const slashes = (text: string) => text.replaceAll("\\", "/");
    const notes = [...(built.stdout + built.stderr).matchAll(/note: TS100176: [^:\n]*: ([^\r\n]+)/g)];
    const below = "node_modules/named/";
    expect(notes.map(it => slashes(it[1])).sort()).toEqual([
      below + "asked.txt",
      below + "helper",
      `${below}list/a.txt, ${below}list/b.txt`,
      below + "parts/a.txt",
    ]);
    const inputs: Record<string, { bytes: number }> = JSON.parse(readFileSync(metafile, "utf8")).inputs;
    const sizes = Object.keys(inputs).map(name => `${slashes(name)} ${inputs[name].bytes}`);
    expect(sizes.filter(it => it.startsWith(below) && !/(index\.cjs|package\.json) /.test(it))).toEqual([
      below + "asked.txt 5",
      below + "helper 8",
      below + "list/a.txt 1",
      below + "list/b.txt 1",
      below + "parts/a.txt 6",
      below + "read.txt 4",
    ]);
  }, 120_000);

  test("--explain and the metafile list the files that a package only tests for", async () => {
    using dir = tempDir("aot-queried-package-files-listed", {
      "app/package.json": `{ "name": "app" }`,
      "app/node_modules/tester/package.json": `{ "name": "tester", "version": "1.0.0", "main": "index.cjs" }`,
      "app/node_modules/tester/index.cjs": `const fs = require("node:fs"), path = require("node:path");
exports.exists = () => fs.existsSync(path.join(__dirname, "tested.txt"));
exports.existsToo = () => fs.existsSync(path.join(__dirname, "tested.txt"));
exports.size = () => fs.statSync(path.join(__dirname, "sized.txt")).size;
exports.isReadable = () => !fs.accessSync(path.join(__dirname, "readable.txt"));
exports.read = () => fs.existsSync(path.join(__dirname, "read.txt")) && fs.readFileSync(path.join(__dirname, "read.txt"), "utf8");
`,
      "app/node_modules/tester/tested.txt": "tested",
      "app/node_modules/tester/sized.txt": "sized",
      "app/node_modules/tester/readable.txt": "readable",
      "app/node_modules/tester/read.txt": "read",
      "app/node_modules/tester/unnamed.txt": "nobody names it",
      "app/main.mjs": `import tester from "tester";
console.log(tester.exists(), tester.existsToo(), tester.size(), tester.isReadable(), tester.read());
`,
    });
    const metafile = join(String(dir), "meta.json");
    const flags = ["--explain", "--metafile=" + metafile];
    const { plain, built, compiled } = await bothWaysIn(String(dir), "app", "./main.mjs", ...flags);
    expect(plain.stdout).toBe("true true 5 true read\n");
    expect(compiled).toEqual(plain);
    const slashes = (text: string) => text.replaceAll("\\", "/");
    const notes = [...(built.stdout + built.stderr).matchAll(/note: TS100176: [^:\n]*: ([^\r\n]+)/g)];
    const below = "node_modules/tester/";
    expect(notes.map(it => slashes(it[1])).sort()).toEqual([
      below + "readable.txt",
      below + "sized.txt",
      below + "tested.txt",
    ]);
    type Metafile = {
      inputs: Record<string, { bytes: number }>;
      outputs: Record<string, { bytes: number; inputs: Record<string, { bytesInOutput: number }> }>;
    };
    const { inputs, outputs }: Metafile = JSON.parse(readFileSync(metafile, "utf8"));
    const [output] = Object.values(outputs);
    const sizes = Object.keys(inputs).map(
      name => `${slashes(name)} ${inputs[name].bytes} ${output.inputs[name].bytesInOutput}`,
    );
    expect(sizes.filter(it => it.startsWith(below) && it.includes(".txt "))).toEqual([
      below + "read.txt 4 0",
      below + "readable.txt 8 0",
      below + "sized.txt 5 0",
      below + "tested.txt 6 0",
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
});
