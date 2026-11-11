import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { chmodSync, mkdirSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
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

/** Plain Bun runs behind the build, because the program changes its files. Then they are moved away. */
async function plainAfterBuild(dir: string) {
  const app = join(dir, "app");
  const outfile = join(dir, "built.exe");
  const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", outfile]);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const plain = await run(app, [bunExe(), "run", "./main.mjs"]);
  renameSync(app, join(dir, "moved-away"));
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

  test("a module of a package removes a file that it names", async () => {
    using dir = tempDir("aot-module-removes-embedded-file", {
      "app/node_modules/locks/package.json": `{ "name": "locks", "version": "1.0.0", "type": "module", "exports": "./index.js" }`,
      "app/node_modules/locks/index.js": `import fs from "node:fs";
import path from "node:path";
import { clear } from "./clear.js";
const lock = path.join(import.meta.dirname, "a.lock");
const cache = path.join(import.meta.dirname, "cache.json");
const state = path.join(import.meta.dirname, "state.json");
const log = path.join(import.meta.dirname, "app.log");
export const start = async () => {
  clear(lock);
  clear(lock);
  if (fs.existsSync(cache)) fs.unlinkSync(cache);
  if (fs.existsSync(state)) await fs.promises.rm(state);
  const parts = fs.readdirSync(path.join(import.meta.dirname, "parts"));
  fs.rmSync(path.join(import.meta.dirname, "parts"), { recursive: true, force: true });
  fs.rmSync(path.join(import.meta.dirname, "parts"), { recursive: true, force: true });
  if (parts.join() !== "a.txt,below" || fs.existsSync(path.join(import.meta.dirname, "parts"))) throw new Error(parts.join());
  if (fs.readFileSync(path.join(import.meta.dirname, "single/a.txt"), "utf8") !== "a") throw new Error("unread");
  fs.unlinkSync(path.join(import.meta.dirname, "single/a.txt"));
  fs.rmdirSync(path.join(import.meta.dirname, "single"));
  if (fs.readdirSync(import.meta.dirname).some(name => name === "parts" || name === "single")) throw new Error("left");
  try {
    fs.rmSync(import.meta.dirname, { recursive: true, force: true });
    throw new Error("code is removed");
  } catch (error) {
    if (error.code !== "EROFS") throw error;
  }
  if (fs.existsSync(log)) fs.renameSync(log, log + ".old");
  if (fs.existsSync(log)) fs.renameSync(log, log + ".older");
  const left = fs.readdirSync(import.meta.dirname).filter(name => /\\.(lock|json|log|old|older)$/.test(name) && name !== "package.json");
  return [lock, cache, state, log].map(file => fs.existsSync(file)).concat(left, fs.readFileSync(log + ".old", "utf8")).join();
};
`,
      "app/node_modules/locks/clear.js": `import fs from "node:fs";
export const clear = file => fs.rmSync(file, { force: true });
`,
      "app/node_modules/locks/a.lock": "1",
      "app/node_modules/locks/cache.json": "{}",
      "app/node_modules/locks/state.json": "{}",
      "app/node_modules/locks/app.log": "a line",
      "app/node_modules/locks/parts/a.txt": "a",
      "app/node_modules/locks/parts/below/b.txt": "b",
      "app/node_modules/locks/single/a.txt": "a",
      "app/main.mjs": `import { start } from "locks"; console.log(await start());`,
    });
    const app = join(String(dir), "app");
    const outfile = join(String(dir), "built.exe");
    const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", outfile]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(warnings(built)).toEqual([]);
    renameSync(app, join(String(dir), "moved-away"));
    const compiled = await run(String(dir), [outfile], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(compiled).toEqual({ stdout: "false,false,false,false,app.log.old,a line\n", stderr: "", exitCode: 0 });
  }, 120_000);

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

  describe.each(["__dirname", "import.meta.dirname"])("a package changes its own files by %s", own => {
    const isModule = own !== "__dirname";
    test("away from its sources", async () => {
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
      const { plain, built, compiled } = await plainAfterBuild(String(dir));
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

  test.each(["__dirname", "import.meta.dirname"])(
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
      const { plain, built, compiled } = await plainAfterBuild(String(dir));
      expect(warnings(built)).toEqual([]);
      expect(plain.stdout).toBe(
        "a.txt,sub,sub/b.txt false a.txt,sub,sub/b.txt b b.txt a.txt true ENOTEMPTY false data data,data/b.txt b false\n",
      );
      expect(compiled).toEqual(plain);
    },
    120_000,
  );

  test.each([[], ["--asset", "./data", "--asset", "./other"]])(
    "a program writes into an embedded folder, away from its sources %j",
    async (...flags) => {
      using dir = tempDir("aot-writes-into-embedded-folder", {
        "app/package.json": `{ "name": "app" }`,
        "app/main.mjs": flags.length ? `import "./start.cjs";` : `import "store";`,
        [`app/${flags.length ? "" : "node_modules/store/"}start.cjs`]: `const fs = require("node:fs"), path = require("node:path");
const data = path.join(__dirname, "data");
const list = () => fs.readdirSync(data).sort().join();
const said = [list()];
fs.writeFileSync(path.join(__dirname, "other", "new.txt"), "o");
said.push(fs.readFileSync(path.join(__dirname, "other", "new.txt"), "utf8") + fs.existsSync(path.join(__dirname, "other", "e.txt")));
for (const name of ["data", "data/logs"]) {
  const folder = path.join(__dirname, name);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder);
}
if (fs.existsSync(data)) fs.chmodSync(data, 0o755);
fs.writeFileSync(path.join(data, "new.txt"), "n");
fs.appendFileSync(path.join(data, "logs", "app.log"), "l");
fs.appendFileSync(path.join(data, "a.txt"), "+");
fs.copyFileSync(path.join(data, "b.txt"), path.join(data, "c.txt"));
said.push(list(), fs.readdirSync(data, { recursive: true }).sort().join().replaceAll(path.sep, "/"));
said.push(...["a", "b", "c", "new"].map(name => fs.readFileSync(path.join(data, name + ".txt"), "utf8")));
fs.rmSync(path.join(data, "b.txt"));
said.push(list());
console.log(said.join(" "));
`,
        "app/node_modules/store/package.json": `{ "name": "store", "version": "1.0.0", "main": "start.cjs" }`,
        ...Object.fromEntries(
          ["data/a.txt", "data/b.txt", "data/below/d.txt", "other/e.txt"].map(name => [
            `app/${flags.length ? "" : "node_modules/store/"}${name}`,
            name.at(-5),
          ]),
        ),
      });
      const app = join(String(dir), "app");
      const outfile = join(String(dir), "built.exe");
      const command = [bunExe(), "build", "--compile", "--aot", "./main.mjs", ...flags, "--outfile", outfile];
      const built = await run(app, command);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
      renameSync(app, join(String(dir), "moved-away"));
      const compiled = await run(String(dir), [outfile], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout:
          "a.txt,b.txt,below otrue a.txt,b.txt,below,c.txt,logs,new.txt a.txt,b.txt,below,below/d.txt,c.txt,logs,logs/app.log,new.txt a+ b b n a.txt,below,c.txt,logs,new.txt\n",
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
].join(" ");
`,
        "app/node_modules/store/data/a.txt": "a",
        "app/node_modules/store/data/b.txt": "b",
        "app/make.mjs": `import { Database } from "bun:sqlite";
for (const [name, mode] of [["plain", "delete"], ["ahead", "wal"]]) {
  const database = new Database("./node_modules/store/data/" + name + ".sqlite");
  database.run("pragma journal_mode = " + mode);
  database.run("create table words (word)");
  database.run("insert into words values ('a')");
  database.run("pragma wal_checkpoint(truncate)");
  database.close();
}
`,
        "app/main.mjs": `import { start } from "store"; console.log(start());`,
      });
      const app = join(String(dir), "app");
      expect(await run(app, [bunExe(), "run", "./make.mjs"])).toEqual({ stdout: "", stderr: "", exitCode: 0 });
      const { plain, built, compiled } = await bothWays(String(dir), "./main.mjs", ...flags);
      expect(warnings(built)).toEqual([]);
      expect(plain).toEqual({
        stdout: "a.txt,b.txt a.txt,b.txt a read-only a read-only\n",
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

  test("a file that is only asked about has no bytes, and one read on another platform is not there", async () => {
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
    expect(plain.stdout).toBe(
      `${asked}is that file there true\nthe program's bytes MZ a program\nthe script's bytes a script\nthe program, mapped 12\nit is listed helper.bin\nimported, it answers as a file that is left out false\n`,
    );
    // Every question is answered as by plain Bun, so nothing is warned of.
    expect(compiled).toEqual({
      stdout: `${asked}is that file there false\nthe program's bytes ENOENT\nthe script's bytes ENOENT\nthe program, mapped ENOENT\nit is listed helper.bin\nimported, it answers as a file that is left out true\n`,
      stderr: "",
      exitCode: 0,
    });
    expect(warnings(built)).toEqual([]);
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
      stdout: `${asked}the program's own page ENOENT\nis what is only written there false\nthe bytes of what is only asked about ENOENT\nit can save function\nthe program's own file by its real path ENOENT\n`,
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

  test.each([[[]], [["--asset", "node_modules/keeper/data"]]])(
    "an append or an update of an embedded file goes on from its bytes, away from the sources %j",
    async flags => {
      const at = (name: string) => `path.join(__dirname, "data", ${JSON.stringify(name)})`;
      const names = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt", "f.txt", "deep/g.txt"];
      using dir = tempDir("aot-append-to-embedded-file", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = async () => {
  say("no folder for it", () => fs.appendFileSync(${at("a.txt")}, " more"));
  say("no folder for it", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  fs.appendFileSync(${at("a.txt")}, " more");
  say("appendFileSync", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  await fs.promises.appendFile(${at("b.txt")}, " more");
  say("promises.appendFile", () => fs.readFileSync(${at("b.txt")}, "utf8"));
  fs.writeFileSync(${at("c.txt")}, " more", { flag: "a" });
  say("writeFileSync with a", () => fs.readFileSync(${at("c.txt")}, "utf8"));
  const fd = fs.openSync(${at("d.txt")}, "r+");
  fs.writeSync(fd, "F");
  fs.closeSync(fd);
  say("openSync with r+", () => fs.readFileSync(${at("d.txt")}, "utf8"));
  fs.writeFileSync(${at("e.txt")}, "new");
  say("a write that truncates", () => fs.readFileSync(${at("e.txt")}, "utf8"));
  say("untouched", () => fs.readFileSync(${at("f.txt")}, "utf8"));
  say("writeFileSync onto a folder", () => fs.writeFileSync(${at("deep")}, "x"));
  console.log("Bun.write onto a folder", await Bun.write(${at("deep")}, "x").catch(error => error.code));
  say("below that folder", () => fs.readFileSync(${at("deep/g.txt")}, "utf8"));
};
`,
        ...Object.fromEntries(names.map(name => [`app/node_modules/keeper/data/${name}`, "first"])),
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
        stdout: `no folder for it undefined
no folder for it first more
appendFileSync first more more
promises.appendFile first more
writeFileSync with a first more
openSync with r+ First
a write that truncates new
untouched first
writeFileSync onto a folder EISDIR
Bun.write onto a folder EISDIR
below that folder first
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test("truncate() of an embedded file cuts its bytes, away from the sources", async () => {
    const at = (name: string) => `path.join(__dirname, "data", ${JSON.stringify(name)})`;
    using dir = tempDir("aot-truncate-embedded-file", {
      "app/package.json": `{ "name": "server" }`,
      "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
      "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
      "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = async () => {
  say("no folder for it", () => fs.truncateSync(${at("a.txt")}, 2));
  say("no folder for it", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  fs.truncateSync(${at("a.txt")}, 2);
  say("to two bytes", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  await fs.promises.truncate(${at("b.txt")});
  say("to nothing", () => JSON.stringify(fs.readFileSync(${at("b.txt")}, "utf8")));
  say("a folder", () => fs.truncateSync(${at("deep")}, 2));
  say("below that folder", () => fs.readFileSync(${at("deep/c.txt")}, "utf8"));
};
`,
      "app/node_modules/keeper/data/a.txt": "first",
      "app/node_modules/keeper/data/b.txt": "first",
      "app/node_modules/keeper/data/deep/c.txt": "first",
    });
    const cwd = join(String(dir), "app");
    const built = await run(cwd, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "../built.exe"]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    renameSync(cwd, join(String(dir), "away"));
    const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(compiled).toEqual({
      stdout: `no folder for it undefined
no folder for it fi
to two bytes fi
to nothing ""
a folder EISDIR
below that folder first
`,
      stderr: "",
      exitCode: 0,
    });
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

  test("a package writes its own files by both of their names", async () => {
    const names = "abcdefghij".split("").map(it => `${it}.txt`);
    using dir = tempDir("aot-writes-by-both-names", {
      "app/package.json": `{ "name": "server" }`,
      "app/main.mjs": `import { run } from "keeper";
await run();
`,
      "app/node_modules/keeper/package.json": `{ "name": "keeper", "exports": "./index.mjs" }`,
      "app/node_modules/keeper/by-dirname.cjs": `const fs = require("node:fs"), path = require("node:path");
const at = name => path.join(__dirname, "data", name);
exports.read = name => fs.readFileSync(at(name), "utf8");
exports.write = (name, text) => fs.writeFileSync(at(name), text);
exports.replace = (name, text) => {
  fs.writeFileSync(at("next"), text);
  fs.renameSync(at("next"), at(name));
};
`,
      "app/node_modules/keeper/index.mjs": `import fs from "node:fs";
import path from "node:path";
import { finished } from "node:stream/promises";
import byDirname from "./by-dirname.cjs";
${say}
const at = name => path.join(import.meta.dirname, "data", name);
const show = (label, name) => say(label, () => [fs.readFileSync(at(name), "utf8"), byDirname.read(name), fs.statSync(at(name)).size].join());
export const run = async () => {
  byDirname.write("a.txt", "written");
  show("written by the other name", "a.txt");
  fs.appendFileSync(at("b.txt"), " and more");
  show("appended", "b.txt");
  const fd = fs.openSync(at("c.txt"), "r+");
  fs.writeSync(fd, "F");
  fs.closeSync(fd);
  show("updated", "c.txt");
  fs.truncateSync(at("d.txt"), 2);
  show("truncated", "d.txt");
  fs.writeFileSync(at("e.txt"), "whole");
  show("written", "e.txt");
  await Bun.write(at("f.txt"), "by Bun.write");
  show("written by Bun", "f.txt");
  fs.copyFileSync(at("e.txt"), at("g.txt"));
  show("copied", "g.txt");
  await finished(fs.createWriteStream(at("h.txt")).end("streamed"));
  show("streamed", "h.txt");
  say("a file that is there", () => fs.writeFileSync(at("i.txt"), "no", { flag: "wx" }));
  show("not written", "i.txt");
  byDirname.replace("j.txt", "replaced");
  show("replaced by the other name", "j.txt");
  fs.unlinkSync(at("e.txt"));
  say("removed", () => fs.existsSync(at("e.txt")));
  show("removed", "e.txt");
};
`,
      ...Object.fromEntries(names.map(it => [`app/node_modules/keeper/data/${it}`, "first"])),
    });
    const { plain, compiled } = await plainAfterBuild(String(dir));
    expect(plain.stdout).toBe(`written by the other name written,written,7
appended first and more,first and more,14
updated First,First,5
truncated fi,fi,2
written whole,whole,5
written by Bun by Bun.write,by Bun.write,12
copied whole,whole,5
streamed streamed,streamed,8
a file that is there EEXIST
not written first,first,5
replaced by the other name replaced,replaced,8
removed false
removed ENOENT
`);
    expect(compiled).toEqual(plain);
  }, 120_000);

  test("an open that must make the file finds the embedded one, away from the sources", async () => {
    const at = (name: string) => `path.join(__dirname, "data", ${JSON.stringify(name)})`;
    using dir = tempDir("aot-exclusive-open-of-embedded-file", {
      "app/package.json": `{ "name": "server" }`,
      "app/main.mjs": `import keeper from "keeper";
keeper.run();
`,
      "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
      "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = () => {
  for (const made of [false, true]) {
    if (made) fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
    for (const flag of ["wx", "wx+", "ax", "ax+"]) say(flag, () => fs.closeSync(fs.openSync(${at("a.txt")}, flag)));
    say("writeFileSync with wx", () => fs.writeFileSync(${at("a.txt")}, "new", { flag: "wx" }));
    say("its text", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  }
  say("a new file", () => fs.closeSync(fs.openSync(${at("new.txt")}, "wx")));
};
`,
      "app/node_modules/keeper/data/a.txt": "first",
    });
    const cwd = join(String(dir), "app");
    const built = await run(cwd, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "../built.exe"]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    renameSync(cwd, join(String(dir), "away"));
    const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    const refused = ["wx", "wx+", "ax", "ax+", "writeFileSync with wx"].map(it => `${it} EEXIST\n`).join("");
    const stdout = `${refused}its text first\n${refused}its text first\na new file undefined\n`;
    expect(compiled).toEqual({ stdout, stderr: "", exitCode: 0 });
    // Nothing was laid.
    expect(await Bun.file(join(cwd, "node_modules/keeper/data/a.txt")).exists()).toBe(false);
  }, 120_000);

  test.skipIf(isWindows)(
    "an embedded file that can't be laid whole is not laid at all",
    async () => {
      using dir = tempDir("aot-copy-up-fails-midway", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
keeper.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = () => {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  say("an append", () => fs.appendFileSync(path.join(__dirname, "data", "large.txt"), "more"));
  say("its length", () => fs.readFileSync(path.join(__dirname, "data", "large.txt")).length);
};
`,
        "app/node_modules/keeper/data/large.txt": Buffer.alloc(300_000, "x").toString(),
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
      // No file grows past 100 blocks, as on a disk that is full.
      const limited = ["sh", "-c", "ulimit -f 100 && exec ./built.exe"];
      const compiled = await run(String(dir), limited, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({ stdout: "an append EFBIG\nits length 300000\n", stderr: "", exitCode: 0 });
      const left = [...new Bun.Glob("*").scanSync({ cwd: join(cwd, "node_modules/keeper/data"), dot: true })];
      expect(left).toEqual([]);
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "the shell's >> goes on from an embedded file's bytes, and its name is taken, away from the sources",
    async () => {
      const at = (name: string) => `path.join(__dirname, "data", ${JSON.stringify(name)})`;
      using dir = tempDir("aot-shell-appends-to-embedded-file", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
exports.run = async () => {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  await Bun.$\`echo more >> \${${at("a.txt")}}\`;
  say("a command of the shell", () => JSON.stringify(fs.readFileSync(${at("a.txt")}, "utf8")));
  await Bun.$\`echo more >> b.txt\`.cwd(path.join(__dirname, "data"));
  say("a relative path", () => JSON.stringify(fs.readFileSync(${at("b.txt")}, "utf8")));
  await Bun.$\`sh -c "echo more" >> \${${at("c.txt")}}\`;
  say("another program", () => JSON.stringify(fs.readFileSync(${at("c.txt")}, "utf8")));
  await Bun.$\`echo new > \${${at("d.txt")}}\`;
  say("a redirect that truncates", () => JSON.stringify(fs.readFileSync(${at("d.txt")}, "utf8")));
  say("mkdirSync", () => fs.mkdirSync(${at("e.txt")}));
  say("mkdirSync, recursive", () => fs.mkdirSync(${at("e.txt")}, { recursive: true }));
  say("symlinkSync", () => fs.symlinkSync("a.txt", ${at("e.txt")}));
  say("copyFileSync, exclusive", () => fs.copyFileSync(${at("a.txt")}, ${at("e.txt")}, fs.constants.COPYFILE_EXCL));
  say("its text", () => fs.readFileSync(${at("e.txt")}, "utf8"));
  say("copyFileSync", () => fs.copyFileSync(${at("d.txt")}, ${at("e.txt")}));
  say("its text", () => JSON.stringify(fs.readFileSync(${at("e.txt")}, "utf8")));
};
`,
        ...Object.fromEntries(
          ["a", "b", "c", "d", "e"].map(name => [`app/node_modules/keeper/data/${name}.txt`, "first "]),
        ),
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
      const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout: `a command of the shell "first more\\n"
a relative path "first more\\n"
another program "first more\\n"
a redirect that truncates "new\\n"
mkdirSync EEXIST
mkdirSync, recursive EEXIST
symlinkSync EEXIST
copyFileSync, exclusive EEXIST
its text first 
copyFileSync undefined
its text "new\\n"
`,
        stderr: "",
        exitCode: 0,
      });
    },
    120_000,
  );

  test("appends at once, as the first writes to embedded files, all arrive", async () => {
    const names = Array.from({ length: 24 }, (_, index) => `${index}.txt`);
    using dir = tempDir("aot-appends-at-once", {
      "app/package.json": `{ "name": "server" }`,
      "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
      "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
      "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
const files = [
${names.map(name => `  path.join(__dirname, "data", ${JSON.stringify(name)}),`).join("\n")}
];
exports.run = async () => {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  const appended = files.flatMap(file => [fs.promises.appendFile(file, "one\\n"), fs.promises.appendFile(file, "two\\n")]);
  const failed = (await Promise.allSettled(appended)).filter(it => it.status === "rejected").map(it => it.reason.code);
  const texts = new Set(files.map(file => fs.readFileSync(file, "utf8").split("\\n").sort().join()));
  console.log(failed, [...texts], fs.readdirSync(path.join(__dirname, "data")).length);
};
${names.map(name => `exports[${JSON.stringify(name)}] = () => fs.readFileSync(path.join(__dirname, "data", ${JSON.stringify(name)}));`).join("\n")}
`,
      ...Object.fromEntries(names.map(name => [`app/node_modules/keeper/data/${name}`, "first\n"])),
    });
    const cwd = join(String(dir), "app");
    const built = await run(cwd, [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", "../built.exe"]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    renameSync(cwd, join(String(dir), "away"));
    const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(compiled).toEqual({ stdout: `[] [ ",first,one,two" ] 24\n`, stderr: "", exitCode: 0 });
  }, 120_000);

  test.skipIf(isWindows)(
    "the shell's rm, touch, mkdir and [[ -f ]] find an embedded file, away from the sources",
    async () => {
      const at = (name: string) => `path.join(__dirname, "data", ${JSON.stringify(name)})`;
      using dir = tempDir("aot-shell-finds-embedded-file", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
const code = async command => (await command.nothrow().quiet()).exitCode;
exports.run = async () => {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  console.log("rm", await code(Bun.$\`rm \${${at("a.txt")}}\`));
  say("rm", () => fs.readFileSync(${at("a.txt")}, "utf8"));
  console.log("rm and >>", await code(Bun.$\`rm \${${at("b.txt")}}; echo more >> \${${at("b.txt")}}\`));
  say("rm and >>", () => JSON.stringify(fs.readFileSync(${at("b.txt")}, "utf8")));
  console.log("rm -r of a folder", await code(Bun.$\`rm -r \${${at("deep")}}\`));
  say("rm -r of a folder", () => fs.readFileSync(${at("deep/g.txt")}, "utf8"));
  console.log("rm of what is nowhere", await code(Bun.$\`rm \${${at("nowhere.txt")}}\`));
  console.log("touch", await code(Bun.$\`touch \${${at("c.txt")}}\`));
  say("touch", () => fs.readFileSync(${at("c.txt")}, "utf8"));
  console.log("mkdir", await code(Bun.$\`mkdir \${${at("d.txt")}}\`), await code(Bun.$\`mkdir -p \${${at("d.txt")}}\`));
  say("mkdir", () => fs.readFileSync(${at("d.txt")}, "utf8"));
  say("mkdirSync below it", () => fs.mkdirSync(${at("e.txt")} + "/below", { recursive: true }));
  say("mkdirSync below it", () => fs.readFileSync(${at("e.txt")}, "utf8"));
  say("[[ -f ]]", () => fs.readFileSync(${at("f.txt")}, "utf8"));
  console.log("[[ -f ]]", await code(Bun.$\`[[ -f \${${at("f.txt")}} ]]\`), await code(Bun.$\`[[ -d \${${at("f.txt")}} ]]\`), await code(Bun.$\`[[ -f \${${at("nowhere.txt")}} ]]\`));
};
`,
        ...Object.fromEntries(
          ["a", "b", "c", "d", "e", "f", "deep/g"].map(name => [`app/node_modules/keeper/data/${name}.txt`, "first"]),
        ),
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
      const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout: `rm 0
rm ENOENT
rm and >> 0
rm and >> "more\\n"
rm -r of a folder 0
rm -r of a folder ENOENT
rm of what is nowhere 1
touch 0
touch first
mkdir 1 1
mkdir first
mkdirSync below it ENOTDIR
mkdirSync below it first
[[ -f ]] first
[[ -f ]] 0 1 1
`,
        stderr: "",
        exitCode: 0,
      });
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

  test.skipIf(isWindows)(
    "the shell's rm -f without -r keeps an embedded folder, away from the sources",
    async () => {
      const at = (name: string) => `path.join(__dirname, "data", ${JSON.stringify(name)})`;
      using dir = tempDir("aot-shell-keeps-embedded-folder", {
        "app/package.json": `{ "name": "server" }`,
        "app/main.mjs": `import keeper from "keeper";
await keeper.run();
`,
        "app/node_modules/keeper/package.json": `{ "name": "keeper", "main": "index.cjs" }`,
        "app/node_modules/keeper/index.cjs": `const fs = require("node:fs"), path = require("node:path");
${say}
const code = async command => (await command.nothrow().quiet()).exitCode;
exports.run = async () => {
  say("embedded", () => fs.readFileSync(${at("deep/g.txt")}, "utf8"));
  console.log("rm -f", await code(Bun.$\`rm -f \${${at("deep")}}\`));
  say("rm -f", () => fs.readFileSync(${at("deep/g.txt")}, "utf8"));
  console.log("rm -f of what is nowhere", await code(Bun.$\`rm -f \${${at("nowhere")}}\`));
  console.log("rm -rf", await code(Bun.$\`rm -rf \${${at("deep")}}\`));
  say("rm -rf", () => fs.readFileSync(${at("deep/g.txt")}, "utf8"));
};
`,
        "app/node_modules/keeper/data/deep/g.txt": "first",
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
      const compiled = await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect(compiled).toEqual({
        stdout: `embedded first
rm -f 1
rm -f first
rm -f of what is nowhere 0
rm -rf 0
rm -rf ENOENT
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
