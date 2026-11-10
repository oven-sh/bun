import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, tempDir } from "harness";
import {
  chmodSync,
  chownSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { slot } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { run as runCommand } from "./harness/run";
import { test as oneAtATime, unsupported } from "./supported";

// Each test has a folder of its own, and each build waits for a processor.
const test = oneAtATime.concurrent;

const files = {
  "app/main.cjs": `const path = require("node:path");
const fs = require("node:fs");
const shared = require("./shared.cjs");
for (const name of process.argv.slice(2)) {
  const file = path.join(__dirname, "plugins", name + ".cjs");
  try { const plugin = require(file); console.log(name, plugin.name, plugin.isSameShared(shared), plugin.twice(21), require(file) === plugin); } catch (error) { console.log(name, error.code); }
}
try { require("a-package-that-is-not-installed"); } catch (error) { console.log(error.code); }
console.log(fs.readFileSync(path.join(__dirname, "data", "note.txt"), "utf8").trim(), __filename === path.join(__dirname, "main.cjs"), require.main === module);
import(path.join(__dirname, "plugins", "module.mjs")).then(m => console.log("imported", m.default, m.isSameShared(shared), m.note), error => console.log("import", error.code));
`,
  "app/shared.cjs": `module.exports = { id: Symbol("once") };\n`,
  "app/plugins/a.cjs": `const shared = require("../shared.cjs");\nmodule.exports = { name: "plugin a", isSameShared: other => other === shared, twice: n => n * 2 };\n`,
  "app/plugins/b.cjs": `const shared = require("../shared.cjs");\nmodule.exports = { name: "plugin b", isSameShared: other => other === shared, twice: n => n + n };\n`,
  "app/plugins/left-on-disk.cjs": `const shared = require("../shared.cjs");\nmodule.exports = { name: "not compiled", isSameShared: other => other === shared, twice: n => 2 * n };\n`,
  "app/plugins/module.mjs": `import shared from "../shared.cjs";\nimport { readFileSync } from "node:fs";\nexport default "an ES module";\nexport const isSameShared = other => other === shared;\nexport const note = readFileSync(new URL("../data/note.txt", import.meta.url), "utf8").trim();\n`,
  "app/data/note.txt": "a note\n",
};

// A test's timeout also counts the time its commands wait. Only a build keeps a processor busy for seconds, so the other commands do not queue behind builds.
async function run(cwd: string, cmd: string[], env = bunEnv) {
  const isBuild = cmd[0] === bunExe() && cmd[1] === "build";
  const start = () => runCommand(cmd, cwd, env);
  const { stdout, stderr, exitCode } = await (isBuild ? slot(start) : start());
  return { stdout, stderr, exitCode };
}

const build = (app: string, ...entryPoints: string[]) =>
  run(app, [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    "--compile-in-place",
    ...entryPoints,
    "--outfile",
    "../built.exe",
  ]);

// Most scenes are folders of an app that they share, and one executable holds them: a build compiles what its program reaches of Bun's own library, and these programs reach
// much the same. main.cjs starts the scene that the first argument names and takes the name out of the arguments. A scene touches no folder but its own.
// Windows renames no folder that a running process works in or was started from: the executable lies above the scenes, and every run of it starts in the folder that holds it.
// What a build finds in one scene holds for the whole program, so a scene stands only with scenes of which a build finds the same when each is built alone.
const companies = {
  // Under --explain=trim the build names nothing that blocks it.
  "closed": ["assets", "opened-for-writing", "opened-assets", "writable-folder", "folders-of-files"],
  // It names loads by a computed name, and nothing that lets code run which no build has seen.
  "loads by name": [
    "by-path",
    "asset-modules-imported",
    "asset-modules-required",
    "patterns",
    "computed-names",
    "package-json",
    "asked-again",
    "names-of-files",
    "glob",
    "store",
  ],
  // It names node:vm or a native addon.
  "open": [
    "compiled-and-embedded",
    "written-addon",
    "addon-given-1",
    "addon-given-2",
    "addon-given-3",
    "addon-as-asset",
  ],
};
type Company = keyof typeof companies;
const whatBlocks = new Map<Company, { causes: string[]; keepsEveryLocale: boolean }>();
const scenes: { folder: string; files: Record<string, unknown>; args: string[] }[] = [];
// What has to lie in the folder of a scene before the build and is no text: a native addon, a link.
const laidBeforeTheBuild: [folder: string, lay: (app: string) => unknown][] = [];
const sceneries = new Map<Company, Promise<string>>();
const madeForScenes: Disposable[] = [];
afterAll(() => madeForScenes.forEach(dir => dir[Symbol.dispose]()));
const buildScenery = (company: Company) =>
  sceneries.getOrInsertComputed(company, async () => {
    const together = scenes.filter(({ folder }) => companies[company].includes(folder));
    const starts = together.map(
      ({ folder, args: [start] }) =>
        `  ${JSON.stringify(folder)}: () => ${start.endsWith(".mjs") ? "import" : "require"}(${JSON.stringify(start)}),\n`,
    );
    const dir = tempDir("aot-in-place-scenes", {
      ...Object.assign({}, ...together.map(({ files }) => files)),
      "app/main.cjs": `const scenes = {\n${starts.join("")}};\nscenes[process.argv.splice(2, 1)[0]]();\n`,
    });
    madeForScenes.push(dir);
    for (const [folder, lay] of laidBeforeTheBuild)
      if (companies[company].includes(folder)) await lay(join(String(dir), "app", folder));
    const args = together.flatMap(({ args }) => args);
    const built = await build(join(String(dir), "app"), "./main.cjs", ...args, "--explain=trim");
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    // A build that explains nothing would pass for one that nothing blocks.
    expect(built.stderr).toContain("trim: ");
    const blockers = Array.from(built.stderr.matchAll(/\btrim: blocked by ([\w-]+):/g), ([, cause]) => cause);
    whatBlocks.set(company, {
      causes: [...new Set(blockers)].sort(),
      // dynamic-import also names what lets code run that no build has seen, and for such code the build keeps every locale.
      keepsEveryLocale: built.stderr.includes("code loaded at run time could use any"),
    });
    return String(dir);
  });
/** `files` are written as those of an app of their own, below `app/`, and `args` as for a build in that folder. The first of `args` is the file that the scene starts with. */
function scene(folder: string, files: Record<string, unknown>, ...args: string[]) {
  const company = (Object.keys(companies) as Company[]).find(company => companies[company].includes(folder));
  if (!company) throw new Error(`the scene ${folder} stands in no company`);
  scenes.push({
    folder,
    files: Object.fromEntries(
      Object.entries(files).map(([path, text]) => [path.replace(/^app\//, `app/${folder}/`), text]),
    ),
    args: args.map(arg => (arg.startsWith("--") ? arg : `./${folder}/${arg.replace(/^\.\//, "")}`)),
  });
  return async () => {
    const dir = await buildScenery(company);
    const app = join(dir, "app", folder);
    return { dir, app, exe: ["./built.exe", folder], away: join(dir, "moved-away-" + folder) };
  };
}

// What the build of a company names is asked here and not where its scenes are built: a scene says what an executable does, whatever the report says of its build.
const names = (company: Company, causes: string[]) => async () => {
  await buildScenery(company);
  expect(whatBlocks.get(company)).toEqual({ causes, keepsEveryLocale: false });
};
test("the build of the closed scenes names nothing that blocks it", names("closed", []));
oneAtATime.failing(
  "the build of the scenes that load by name names dynamic-import alone: 4 causes for 1: eval, native-code and runtime-code beside it, none with a place",
  names("loads by name", ["dynamic-import"]),
);
// A mark does not see a number grow worse. On Windows the build names the first two alone.
oneAtATime(
  "the build of the scenes that load by name names dynamic-import alone but for eval, native-code and runtime-code",
  async () => {
    await buildScenery("loads by name");
    const namedToday = ["dynamic-import", "eval", "native-code", "runtime-code"];
    expect(whatBlocks.get("loads by name")!.causes.filter(cause => !namedToday.includes(cause))).toEqual([]);
  },
);

test("extra entry points load as compiled code by absolute path", async () => {
  using dir = tempDir("aot-in-place", files);
  const app = join(String(dir), "app");
  const plain = await run(app, [bunExe(), "run", "./main.cjs", "a", "b", "c"]);
  expect(plain).toEqual({
    stdout:
      "a plugin a true 42 true\nb plugin b true 42 true\nc MODULE_NOT_FOUND\nMODULE_NOT_FOUND\na note true true\nimported an ES module true a note\n",
    stderr: "",
    exitCode: 0,
  });
  const built = await build(app, "./main.cjs", "./plugins/a.cjs", "./plugins/b.cjs", "./plugins/module.mjs");
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(
    await run(String(dir), ["./built.exe", "a", "b", "c"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" }),
  ).toEqual(plain);
}, 120_000);

test("the path that an import of a file gives loads the file as compiled code", async () => {
  using dir = tempDir("aot-in-place", {
    "app/main.mjs": `import carried from "./carried.js" with { type: "file" };
import { kept } from "./between.mjs";
console.log((await import(carried)).named, require(kept).named, require.resolve(carried) === carried);\n`,
    "app/between.mjs": `import given from "./carried.js" with { type: "file" };\nexport const kept = given;\n`,
    "app/carried.js": `export const named = "carried";\n`,
  });
  const app = join(String(dir), "app");
  const plain = await run(app, [bunExe(), "run", "./main.mjs"]);
  expect(plain).toEqual({ stdout: "carried carried true\n", stderr: "", exitCode: 0 });
  const built = await build(app, "./main.mjs");
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(plain);
}, 120_000);

test("a module that was not compiled is not loaded from disk", async () => {
  // The build follows `path.join(__dirname, "plugins", name + ".cjs")` and compiles what lies in that folder. It does not follow a path that comes back from native code.
  const written = `path.join(__dirname, "plugins", name + ".cjs")`;
  const main = files["app/main.cjs"].replace(written, `new CustomEvent("path", { detail: ${written} }).detail`);
  expect(main).not.toBe(files["app/main.cjs"]);
  using dir = tempDir("aot-in-place-from-disk", { ...files, "app/main.cjs": main });
  const app = join(String(dir), "app");
  const plain = await run(app, [bunExe(), "run", "./main.cjs", "left-on-disk"]);
  expect(plain.stdout.split("\n")[0]).toBe("left-on-disk not compiled true 42 true");
  const built = await build(app, "./main.cjs", "./plugins/module.mjs");
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(
    await run(String(dir), ["./built.exe", "left-on-disk"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" }),
  ).toEqual({
    ...plain,
    stdout: plain.stdout.replace("left-on-disk not compiled true 42 true", "left-on-disk MODULE_NOT_FOUND"),
  });
}, 120_000);

const byPath = scene(
  "by-path",
  {
    ...files,
    "app/node_modules/a-package/package.json": `{ "name": "a-package", "exports": { "import": "./esm.mjs", "require": "./cjs.cjs" } }`,
    "app/node_modules/a-package/esm.mjs": `export default "a package, imported";\n`,
    "app/node_modules/a-package/cjs.cjs": `module.exports = "a package, required";\n`,
    "app/start.cjs": `const path = require("node:path");
const shared = require("./shared");
console.log(require("a-package"), require.resolve("a-package") === path.join(__dirname, "node_modules", "a-package", "cjs.cjs"));
for (const name of process.argv.slice(2)) {
  for (const file of [path.join(__dirname, "plugins", name + ".cjs"), path.join(__dirname, "plugins", name), "./plugins/" + name]) {
    try { const plugin = require(file); console.log(name, plugin.name, plugin.isSameShared(shared)); } catch (error) { console.log(name, error.code); }
  }
}
import("a-package").then(m => console.log(m.default));
`,
  },
  "./start.cjs",
  "./plugins/a.cjs",
);
test("compiled modules resolve by path", async () => {
  const { dir, app, exe, away } = await byPath();
  const plain = await run(app, [bunExe(), "run", "./start.cjs", "a", "c"]);
  expect(plain).toEqual({
    stdout:
      "a package, required true\na plugin a true\na plugin a true\na plugin a true\nc MODULE_NOT_FOUND\nc MODULE_NOT_FOUND\nc MODULE_NOT_FOUND\na package, imported\n",
    stderr: "",
    exitCode: 0,
  });
  expect(await run(String(dir), [...exe, "a", "c"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(
    plain,
  );
  renameSync(app, away);
  expect(await run(String(dir), [...exe, "a", "c"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(
    plain,
  );
}, 120_000);

const assets = scene(
  "assets",
  {
    "app/server/codes.json": `{ "ok": 200 }`,
    "app/server/status.cjs": `module.exports = require("./codes.json");\n`,
    "app/server/start.mjs": `import fs from "node:fs";
import status from "./status.cjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const folder = fileURLToPath(new URL("../public", import.meta.url));
const page = path.join(folder, "index.html");
console.log(fs.existsSync(folder), fs.statSync(folder).isDirectory(), fs.readdirSync(folder, { recursive: true }).sort().join());
console.log(fs.existsSync(page), fs.statSync(page).size, fs.readFileSync(page, "utf8"), await Bun.file(path.join(folder, "scripts", "app.js")).text());
console.log(fs.readFileSync(fileURLToPath(new URL("../data.json", import.meta.url)), "utf8"), fs.existsSync(path.join(folder, "none.txt")), fs.existsSync(fileURLToPath(new URL("../not-an-asset.txt", import.meta.url))));
console.log(status.ok);
if (fs.existsSync(new URL("./codes.json", import.meta.url))) {
  fs.writeFileSync(new URL("./codes.json", import.meta.url), "written");
  console.log(fs.readFileSync(new URL("./codes.json", import.meta.url), "utf8"));
  fs.writeFileSync(new URL("./codes.json", import.meta.url), '{ "ok": 200 }');
} else console.log("written");
`,
    "app/public/index.html": `<script src="/scripts/app.js"></script>`,
    "app/public/scripts/app.js": `console.log(window.location)`,
    "app/data.json": `{ "value":   "as it is written" }`,
    "app/note.txt": "a note",
    "app/not-an-asset.txt": "left on the disk",
  },
  "./server/start.mjs",
  "--asset",
  "./public",
  "--asset",
  "./data.json",
  "--asset",
  "./note.txt",
);
test("assets resolve at their source paths without files beside the executable", async () => {
  const { dir, app, exe, away } = await assets();
  const plain = await run(app, [bunExe(), "run", "./server/start.mjs"]);
  expect(plain).toEqual({
    stdout: `true true index.html,scripts,${join("scripts", "app.js")}\ntrue 39 <script src="/scripts/app.js"></script> console.log(window.location)\n{ "value":   "as it is written" } false true\n200\nwritten\n`,
    stderr: "",
    exitCode: 0,
  });
  expect(await run(String(dir), [...exe], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(plain);
  renameSync(app, away);
  expect(await run(String(dir), [...exe], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual({
    ...plain,
    stdout: plain.stdout.replace("false true\n", "false false\n"),
  });
}, 120_000);

const assetModules = {
  "app/start.mjs": `import path from "node:path";
const data = path.join(import.meta.dirname, ["data", "json"].join("."));
console.log(import.meta.require(data).value, (await import(data)).default.value);
console.log((await import(path.join(import.meta.dirname, ["note", "txt"].join(".")), { with: { type: "text" } })).default);
`,
  "app/start.cjs": `console.log(require(require("node:path").join(__dirname, ["data", "json"].join("."))).value);\n`,
  "app/data.json": `{ "value":   "as it is written" }`,
  "app/note.txt": "a note",
};
const assetModulesOf = {
  "./start.mjs": scene(
    "asset-modules-imported",
    assetModules,
    "./start.mjs",
    "--asset",
    "./data.json",
    "--asset",
    "./note.txt",
  ),
  "./start.cjs": scene(
    "asset-modules-required",
    assetModules,
    "./start.cjs",
    "--asset",
    "./data.json",
    "--asset",
    "./note.txt",
  ),
};
test("an asset loads under a computed path as its extension says", async () => {
  for (const [entry, stdout] of [
    ["./start.mjs", "as it is written as it is written\na note\n"],
    ["./start.cjs", "as it is written\n"],
  ] as const) {
    const { dir, app, exe, away } = await assetModulesOf[entry]();
    expect(await run(app, [bunExe(), "run", entry])).toEqual({ stdout, stderr: "", exitCode: 0 });
    expect(await run(String(dir), [...exe], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual({
      stdout,
      stderr: "",
      exitCode: 0,
    });
    renameSync(app, away);
    expect(await run(String(dir), [...exe], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual({
      stdout,
      stderr: "",
      exitCode: 0,
    });
  }
}, 120_000);

const openedForWriting = scene(
  "opened-for-writing",
  {
    "app/public/sync.txt": "embedded\n",
    "app/public/promise.txt": "embedded\n",
    "app/public/callback.txt": "embedded\n",
    "app/public/stream.txt": "embedded\n",
    "app/public/untouched.txt": "embedded\n",
    "app/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
const file = name => path.join(__dirname, "public", name);
(async () => {
  fs.closeSync(fs.openSync(file("sync.txt"), "w"));
  await (await fs.promises.open(file("promise.txt"), "w")).close();
  await new Promise((done, fail) => fs.open(file("callback.txt"), "w", (error, fd) => (error ? fail(error) : fs.close(fd, done))));
  await new Promise((done, fail) => fs.createWriteStream(file("stream.txt")).on("error", fail).end("", done));
  for (const name of ["sync", "promise", "callback", "stream", "untouched"]) console.log(name, JSON.stringify(fs.readFileSync(file(name + ".txt"), "utf8")));
})().catch(error => console.log("failed", error.code, error.syscall));
`,
  },
  "./start.cjs",
  "--asset",
  "./public",
);
test("every kind of open creates an embedded file that is not on disk", async () => {
  const { dir, app, exe, away } = await openedForWriting();
  renameSync(app, away);
  mkdirSync(join(app, "public"), { recursive: true });
  expect(await run(String(dir), [...exe])).toEqual({
    stdout: `sync ""\npromise ""\ncallback ""\nstream ""\nuntouched "embedded\\n"\n`,
    stderr: "",
    exitCode: 0,
  });
}, 120_000);

const openedAssets = scene(
  "opened-assets",
  {
    "app/public/hello.txt": "a public file\n",
    "app/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
const file = path.join(__dirname, "public", "hello.txt");
const text = stream => new Promise((done, fail) => {
  let all = "";
  stream.setEncoding("utf8").on("data", part => (all += part)).on("end", () => done(JSON.stringify(all))).on("error", fail);
});
(async () => {
  const fd = fs.openSync(file, "r");
  const part = Buffer.alloc(4);
  console.log(fs.readSync(fd, part, 0, 4, 2), part.toString(), fs.fstatSync(fd).size);
  fs.closeSync(fd);
  const handle = await fs.promises.open(file, "r");
  console.log((await handle.stat()).size, JSON.stringify(await handle.readFile("utf8")));
  await handle.close();
  console.log(await text(fs.createReadStream(file)), await text(fs.createReadStream(file, { start: 2, end: 5 })));
  console.log(path.basename(fs.realpathSync.native(file)), path.basename(await fs.promises.realpath(file)));
  process.chdir(__dirname);
  console.log(JSON.stringify(fs.readFileSync(path.join("public", "hello.txt"), "utf8")), fs.statSync("public").isDirectory(), fs.existsSync("./public/none.txt"));
  const copy = path.join(require("node:os").tmpdir(), "a-copy-of-an-asset-" + process.pid + ".txt");
  fs.copyFileSync(file, copy);
  console.log(JSON.stringify(fs.readFileSync(copy, "utf8")), (await Bun.file(file).stat()).size);
  fs.rmSync(copy);
})();
`,
  },
  "./start.cjs",
  "--asset",
  "./public",
);
test("assets open and stream like files on disk", async () => {
  const { dir, app, exe, away } = await openedAssets();
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  expect(plain).toEqual({
    stdout: `4 publ 14\n14 "a public file\\n"\n"a public file\\n" "publ"\nhello.txt hello.txt\n"a public file\\n" true false\n"a public file\\n" 14\n`,
    stderr: "",
    exitCode: 0,
  });
  expect(await run(String(dir), [...exe])).toEqual(plain);
  renameSync(app, away);
  mkdirSync(app);
  expect(await run(String(dir), [...exe])).toEqual(plain);
}, 120_000);

// Next.js reads `page_client-reference-manifest.js` as text and requires `page.js` beside it: one pattern names both as entry points, one folder as assets.
{
  const entryPoints = {
    "entry-script.js": `exports.answer = "a script";\n`,
    "entry-required.cjs": `exports.answer = "a CommonJS module";\n`,
    "entry-imported.mjs": `export const answer = "an ES module";\n`,
    "entry-typed.ts": `export const answer: string = "a typed module";\n`,
    "deep/entry-deep.js": `exports.answer = "in a folder of the folder";\n`,
    "entry-empty.js": "",
    "entry-accents.js": `exports.answer = "café ☃ 😀";\n`,
    "entry-marked.js": `﻿exports.answer = "behind a byte order mark";\n`,
    "entry-not-utf8.js": Buffer.concat([Buffer.from(`exports.answer = "ok"; // `), Buffer.from([0xe9, 0xff, 0x0a])]),
  };
  const others = {
    "imported.cjs": `exports.answer = "imported by the program";\n`,
    "settings.json": `{ "answer":   "as it is written" }\n`,
    "only-data.js": `made = "by text that was read";\n`,
    "empty-data.js": "",
  };
  const compiledAndEmbedded = {
    "app/start.cjs": `const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");
const imported = require("./data/imported.cjs");
const settings = require("./data/settings.json");
const folder = path.join(__dirname, "data");
const hex = bytes => bytes.length + " " + Buffer.from(bytes).toString("hex");
const ways = {
readFileSync: file => fs.readFileSync(file, "utf8"),
bytes: file => hex(fs.readFileSync(file)),
url: file => fs.readFileSync(pathToFileURL(file), "utf8"),
callback: file => new Promise((resolve, reject) => fs.readFile(file, (error, bytes) => (error ? reject(error) : resolve(hex(bytes))))),
promise: async file => hex(await fs.promises.readFile(file)),
handle: async file => {
  const handle = await fs.promises.open(file);
  try { return (await handle.stat()).size + " " + hex(await handle.readFile()); } finally { await handle.close(); }
},
descriptor: file => {
  const descriptor = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(128);
    return fs.fstatSync(descriptor).size + " " + hex(buffer.subarray(0, fs.readSync(descriptor, buffer, 0, 128, 0)));
  } finally { fs.closeSync(descriptor); }
},
stream: file => new Promise((resolve, reject) => {
  const chunks = [];
  fs.createReadStream(file).on("data", chunk => chunks.push(chunk)).on("end", () => resolve(hex(Buffer.concat(chunks)))).on("error", reject);
}),
stat: file => [fs.statSync(file).size, fs.statSync(file).isFile(), fs.lstatSync(file).size].join(),
statPromise: async file => (await fs.promises.stat(file)).size,
exists: file => fs.existsSync(file),
access: file => fs.accessSync(file, fs.constants.R_OK),
realpath: file => fs.realpathSync(file) === file,
copy: file => {
  const copy = path.join(os.tmpdir(), "a-copy-of-a-compiled-asset-" + process.pid);
  fs.copyFileSync(file, copy);
  try { return hex(fs.readFileSync(copy)); } finally { fs.unlinkSync(copy); }
},
bunFile: file => Bun.file(file).text(),
bunFileSize: file => Bun.file(file).size,
bunFileExists: file => Bun.file(file).exists(),
bunFileBytes: async file => hex(await Bun.file(file).bytes()),
response: async file => hex(await new Response(Bun.file(file)).bytes()),
};
(async () => {
for (const name of process.argv.slice(2)) {
  for (const [way, read] of Object.entries(ways)) {
    let answer;
    try { answer = JSON.stringify(await read(path.join(folder, name))); } catch (error) { answer = "throws " + (error.code ?? error.name); }
    console.log(name, way, answer);
  }
  if (name.includes("entry-")) console.log(name, "loaded", (await import(path.join(folder, name))).answer, /\\.c?js$/.test(name) && require(path.join(folder, name)).answer);
}
console.log(fs.readdirSync(folder, { recursive: true }).sort().join());
const context = {};
vm.runInNewContext(fs.readFileSync(path.join(folder, "only-data.js"), "utf8"), context);
console.log(context.made, imported.answer, settings.answer);
})();
`,
    "app/data": { ...entryPoints, ...others },
  };
  const inPlace = scene(
    "compiled-and-embedded",
    compiledAndEmbedded,
    "./start.cjs",
    "./data/**/entry-*",
    "--asset",
    "./data",
  );
  test.each([
    ["in place", ["--compile-in-place"]],
    ["under its own root", []],
  ])(
    "a file that is both an entry point and an asset is read as it is on disk, compiled %s",
    async (_, flags) => {
      using own = flags.length ? undefined : tempDir("aot-compiled-and-embedded", compiledAndEmbedded);
      const { dir, app, exe, away } = own
        ? {
            dir: String(own),
            app: join(String(own), "app"),
            exe: ["./built.exe"],
            away: join(String(own), "moved-away"),
          }
        : await inPlace();
      const names = [...Object.keys(entryPoints), ...Object.keys(others)];
      const plain = await run(app, [bunExe(), "run", "./start.cjs", ...names]);
      expect({
        ...plain,
        stdout: plain.stdout.split("\n").filter(line => line.includes(" throws ") || line.startsWith("by text")),
      }).toEqual({
        stdout: ["by text that was read imported by the program as it is written"],
        stderr: "",
        exitCode: 0,
      });
      if (own) {
        const built = await run(app, [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          "./start.cjs",
          "./data/**/entry-*",
          "--asset",
          "./data",
          "--outfile",
          "../built.exe",
        ]);
        expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
          stderr: "",
          exitCode: 0,
        });
      }
      renameSync(app, away);
      expect(await run(String(dir), [...exe, ...names])).toEqual(plain);
    },
    120_000,
  );
}

test("the main entry point inside an asset folder is read as it is on disk", async () => {
  using dir = tempDir("aot-in-place-main-among-the-assets", {
    "app/server/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(fs.readFileSync(__filename, "utf8").length, fs.statSync(__filename).size, require.main === module, path.basename(__filename));
console.log(fs.readdirSync(__dirname).sort().join(), fs.readFileSync(path.join(__dirname, "note.txt"), "utf8"));
Bun.file(__filename).text().then(text => console.log(text.split("\\n")[0]));
`,
    "app/server/note.txt": "a note",
  });
  const app = join(String(dir), "app");
  const plain = await run(app, [bunExe(), "run", "./server/start.cjs"]);
  expect({ ...plain, stdout: plain.stdout.replace(/^(\d+) \1 /, "") }).toEqual({
    stdout: `true start.cjs\nnote.txt,start.cjs a note\nconst fs = require("node:fs");\n`,
    stderr: "",
    exitCode: 0,
  });
  const built = await build(app, "./server/start.cjs", "--asset", "./server");
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  renameSync(app, join(String(dir), "moved-away"));
  expect(await run(String(dir), ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(plain);
}, 120_000);

test("embedded folders do not appear at the file system root", async () => {
  using dir = tempDir("aot-in-place-inner-folders", {
    "app/main.cjs": `const fs = require("node:fs");
const root = fs.statSync("/");
console.log(fs.existsSync("/a-folder-of-plugins"), fs.existsSync("/a-folder-of-data"), root.ino > 0, root.mtimeMs > 0, fs.readdirSync("/").includes("a-folder-of-plugins"));
try { console.log(fs.statSync("/a-folder-of-plugins").isDirectory()); } catch (error) { console.log(error.code); }
const here = fs.statSync(__dirname);
console.log(here.isDirectory(), here.ino > 0, fs.statSync(__dirname + "/a-folder-of-data").ino > 0);
console.log(require(require("node:path").join(__dirname, "a-folder-of-plugins", "a.cjs")), fs.readFileSync(__dirname + "/a-folder-of-data/note.txt", "utf8"));
`,
    "app/a-folder-of-plugins/a.cjs": `module.exports = "plugin a";\n`,
    "app/a-folder-of-data/note.txt": "a note",
  });
  const app = join(String(dir), "app");
  const plain = await run(app, [bunExe(), "run", "./main.cjs"]);
  expect(plain).toEqual({
    stdout: "false false true true false\nENOENT\ntrue true true\nplugin a a note\n",
    stderr: "",
    exitCode: 0,
  });
  const built = await build(app, "./main.cjs", "./a-folder-of-plugins/a.cjs", "--asset", "./a-folder-of-data");
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run(String(dir), ["./built.exe"])).toEqual(plain);
}, 120_000);

const patterns = scene(
  "patterns",
  {
    ...files,
    "app/.hidden/[id]/deep.cjs": `module.exports = { name: "deep", isSameShared: () => true, twice: n => 2 * n };\n`,
    "app/start.cjs": `const path = require("node:path");
for (const file of ["plugins/a.cjs", "plugins/b.cjs", ".hidden/[id]/deep.cjs"]) console.log(require(path.join(__dirname, file)).name);
`,
  },
  "./start.cjs",
  "./plugins/{a,b}.cjs",
  ".hidden/**/*.cjs",
);
test("entry points accept glob patterns", async () => {
  const { dir, app, exe } = await patterns();
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  expect(plain).toEqual({ stdout: "plugin a\nplugin b\ndeep\n", stderr: "", exitCode: 0 });
  expect(await run(String(dir), [...exe], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(plain);
  const none = await build(app, "./start.cjs", "./nothing/**/*.cjs");
  expect(none.stderr).toContain(`no file matches the entry point "./nothing/**/*.cjs"`);
  expect(none.exitCode).toBe(1);
}, 120_000);

const computedNames = scene(
  "computed-names",
  {
    "app/start.mjs": `import driver from "a-driver";
import scoped from "@a-scope/driver/sub.cjs";
import load from "an-orm";
console.log(load("a-driver") === driver, load("@a-scope/driver/sub.cjs") === scoped, driver.name, scoped.name);
try { load("a-driver-nobody-wrote"); } catch (error) { console.log(error.code); }
`,
    "app/node_modules/an-orm/package.json": `{ "name": "an-orm", "main": "./lib/deep/index.cjs" }`,
    "app/node_modules/an-orm/lib/deep/index.cjs": `module.exports = name => require(name);\n`,
    "app/node_modules/a-driver/package.json": `{ "name": "a-driver", "main": "./lib/main.cjs" }`,
    "app/node_modules/a-driver/lib/main.cjs": `module.exports = { name: "the driver" };\n`,
    "app/node_modules/@a-scope/driver/package.json": `{ "name": "@a-scope/driver" }`,
    "app/node_modules/@a-scope/driver/sub.cjs": `module.exports = { name: "the scoped one" };\n`,
  },
  "./start.mjs",
  "./node_modules/a-driver/lib/main.cjs",
  "./node_modules/@a-scope/driver/sub.cjs",
);
test("a computed package name resolves like the same literal name", async () => {
  const { dir, app, exe } = await computedNames();
  const plain = await run(app, [bunExe(), "run", "./start.mjs"]);
  expect(plain).toEqual({ stdout: "true true the driver the scoped one\nMODULE_NOT_FOUND\n", stderr: "", exitCode: 0 });
  expect(await run(String(dir), [...exe], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(plain);
}, 120_000);

test("a package subpath resolves to the nearest copy of the package", async () => {
  const library = (which: string) => ({
    "package.json": `{ "name": "a-library", "main": "./index.cjs" }`,
    "index.cjs": `exports.which = "the ${which} copy";\nexports.part = name => require("a-library/parts/" + name);\n`,
    "parts/one.cjs": `module.exports = "a part of the ${which} copy";\n`,
  });
  using dir = tempDir("aot-in-place-two-copies", {
    project: {
      node_modules: { "a-library": library("outer") },
      out: {
        node_modules: { "a-library": library("inner") },
        "start.cjs": `const library = require("a-library");\nconsole.log(library.which, "|", library.part("one.cjs"), "|", library.part("one"));\n`,
      },
    },
  });
  const project = join(String(dir), "project");
  const out = join(project, "out");
  const plain = await run(out, [bunExe(), "run", "./start.cjs"]);
  expect(plain).toEqual({
    stdout: "the inner copy | a part of the inner copy | a part of the inner copy\n",
    stderr: "",
    exitCode: 0,
  });
  const built = await build(out, "./start.cjs", "./node_modules/a-library/parts/one.cjs");
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run(project, ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(plain);
  renameSync(out, join(project, "moved-away"));
  expect(await run(project, ["./built.exe"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" })).toEqual(plain);
}, 120_000);

const packageJson = scene(
  "package-json",
  {
    "app/node_modules/a-library/package.json": `{ "name": "a-library", "version": "1.2.3", "main": "./index.cjs" }`,
    "app/node_modules/a-library/index.cjs": `module.exports = "the library";\n`,
    "app/node_modules/@a-scope/library/package.json": `{ "name": "@a-scope/library", "version": "4.5.6", "main": "./index.cjs" }`,
    "app/node_modules/@a-scope/library/index.cjs": `module.exports = "the scoped library";\n`,
    "app/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
const resolve = require.resolve;
console.log(require("a-library"), require("@a-scope/library"));
for (const name of ["a-library", "@a-scope/library"]) {
  const file = resolve(name + "/package.json");
  console.log(path.relative(__dirname, file), JSON.parse(fs.readFileSync(file, "utf8")).version, require(name + "/package.json").version, fs.existsSync(path.dirname(file)));
}
`,
  },
  "./start.cjs",
);
test("package.json is found for every compiled package", async () => {
  const { dir, app, exe } = await packageJson();
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  expect(plain).toEqual({
    stdout: `the library the scoped library\n${join("node_modules", "a-library", "package.json")} 1.2.3 1.2.3 true\n${join("node_modules", "@a-scope", "library", "package.json")} 4.5.6 4.5.6 true\n`,
    stderr: "",
    exitCode: 0,
  });
  expect(await run(String(dir), [...exe])).toEqual(plain);
}, 120_000);

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const addonSource = `#include <node_api.h>
#ifdef _WIN32
#include <windows.h>
#define HOST(function) ((__typeof__(&function))GetProcAddress(GetModuleHandleW(NULL), #function))
#else
#define HOST(function) function
#endif
static napi_value hello(napi_env env, napi_callback_info info) {
  napi_value text;
  HOST(napi_create_string_utf8)(env, "from a native addon", NAPI_AUTO_LENGTH, &text);
  return text;
}
NAPI_MODULE_INIT() {
  napi_value function;
  HOST(napi_create_function)(env, "hello", NAPI_AUTO_LENGTH, hello, NULL, &function);
  HOST(napi_set_named_property)(env, exports, "hello", function);
  return exports;
}
`;

const addonWithLibrary = {
  "app/start.cjs": `const path = require("node:path");
console.log(require(path.join(__dirname, "vendor", "addon", ["addon", "node"].join("."))).hello());
`,
};

// addon.node, and vendor/ with an addon that links to a shared library beside it.
async function compileAddons() {
  const isDarwin = process.platform === "darwin";
  const library = isDarwin ? "libgreeting.dylib" : isWindows ? "greeting.dll" : "libgreeting.so";
  const libraryFolder = isWindows ? "vendor/addon" : "vendor/lib";
  const folder = String(
    tempDir("aot-in-place-addons", {
      "addon.c": addonSource,
      "greeting.c": `${isWindows ? "__declspec(dllexport) " : ""}const char* greeting(void) { return "from a library beside the addon"; }\n`,
      "addon-with-library.c":
        "const char* greeting(void);\n" + addonSource.replace(`"from a native addon"`, "greeting()"),
    }),
  );
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(join(folder, "vendor", "lib"), { recursive: true });
  mkdirSync(join(folder, "vendor", "addon"));
  const shared = [systemCC!, "-shared", ...(isWindows ? [] : ["-fPIC"])];
  const addon = [
    ...shared,
    ...(isDarwin ? ["-undefined", "dynamic_lookup"] : []),
    "-I" + resolve(import.meta.dir, "../../src/runtime/napi"),
  ];
  for (const command of [
    [...addon, "addon.c", "-o", "addon.node"],
    [
      ...shared,
      "greeting.c",
      "-o",
      `${libraryFolder}/${library}`,
      ...(isDarwin ? ["-install_name", `@rpath/${library}`] : []),
    ],
    [
      ...addon,
      "addon-with-library.c",
      "-o",
      "vendor/addon/addon.node",
      `-L${libraryFolder}`,
      "-lgreeting",
      ...(isWindows ? [] : [`-Wl,-rpath,${isDarwin ? "@loader_path" : "$ORIGIN"}/../lib`]),
    ],
  ]) {
    const compiled = await run(folder, command);
    expect({ stderr: compiled.exitCode ? compiled.stderr : "", exitCode: compiled.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
  }
  return folder;
}
// The system compiler can take half a minute to answer. The addons are compiled once, starting before the first test, and each test copies what it needs.
const compiledAddons = systemCC && !unsupported ? compileAddons() : Promise.reject(new Error("no C compiler"));
compiledAddons.catch(() => {});
async function copyAddon(to: string) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(join(await compiledAddons, "addon.node"), to);
}

async function buildAddonWithLibrary(dir: string, flags = ["--compile-in-place"]) {
  const app = join(dir, "app");
  cpSync(join(await compiledAddons, "vendor"), join(app, "vendor"), { recursive: true });
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  expect(plain).toEqual({ stdout: "from a library beside the addon\n", stderr: "", exitCode: 0 });
  const built = await run(app, [
    bunExe(),
    "build",
    "--compile",
    "--aot",
    ...flags,
    "./start.cjs",
    "--asset",
    "./vendor",
    "--outfile",
    "../built.exe",
  ]);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  renameSync(app, join(dir, "moved-away"));
  return plain;
}

// Three tests run the executable that is compiled in place. None of them writes beside it.
let addonWithLibraryInPlace: Promise<{ folder: string; executable: string; plain: Awaited<ReturnType<typeof run>> }>;
let folderOfAddonWithLibrary: Disposable | undefined;
afterAll(() => folderOfAddonWithLibrary?.[Symbol.dispose]());
const buildAddonWithLibraryInPlace = () =>
  (addonWithLibraryInPlace ??= (async () => {
    const dir = tempDir("aot-addon-with-a-library", addonWithLibrary);
    folderOfAddonWithLibrary = dir;
    const plain = await buildAddonWithLibrary(String(dir));
    return { folder: String(dir), executable: join(String(dir), "built.exe"), plain };
  })());

test.skipIf(!systemCC).each([
  ["in place", ["--compile-in-place"]],
  ["under its own root", []],
])(
  "a native addon loads the shared library it links to, compiled %s",
  async (_, flags) => {
    if (flags.length) {
      const { folder, executable, plain } = await buildAddonWithLibraryInPlace();
      return void expect(await run(folder, [executable])).toEqual(plain);
    }
    using dir = tempDir("aot-addon-with-a-library", addonWithLibrary);
    const plain = await buildAddonWithLibrary(String(dir), flags);
    expect(await run(String(dir), ["./built.exe"])).toEqual(plain);
  },
  120_000,
);

const icacls = (...args: string[]) =>
  Bun.spawnSync({ cmd: ["icacls", ...args], stdout: "ignore", stderr: "ignore" }).exitCode === 0;
const tryChangeOwner = (folder: string) => {
  try {
    chownSync(folder, 12345, 12345);
    return true;
  } catch {
    return false;
  }
};
const untrustedFolderSetups: Record<string, (folder: string) => boolean> = {
  "writable by everyone": folder =>
    isWindows ? icacls(folder, "/grant", "*S-1-1-0:(OI)(CI)F") : (chmodSync(folder, 0o777), true),
  "owned by another user": folder =>
    isWindows ? icacls(folder, "/setowner", "*S-1-5-32-546") : tryChangeOwner(folder),
};

test.skipIf(!systemCC).each(Object.keys(untrustedFolderSetups))(
  "extracted libraries are not loaded from a folder %s",
  async setup => {
    using dir = tempDir("aot-in-place-planted-library", { "temporary/.keep": "" });
    const { executable, plain } = await buildAddonWithLibraryInPlace();
    const temporary = join(String(dir), "temporary");
    const env = { ...bunEnv, BUN_TMPDIR: temporary };
    const folders = () => readdirSync(temporary).filter(name => name.startsWith(".bun-"));
    expect(await run(String(dir), [executable], env)).toEqual(plain);
    expect(await run(String(dir), [executable], env)).toEqual(plain);
    const [written, ...others] = folders();
    expect(others).toEqual([]);

    const planted = readdirSync(join(temporary, written), { recursive: true, withFileTypes: true })
      .filter(entry => entry.isFile())
      .map(entry => join(entry.parentPath, entry.name));
    expect(planted.length).toBe(2);
    for (const file of planted) writeFileSync(file, Buffer.alloc(statSync(file).size, "planted"));
    if (!untrustedFolderSetups[setup](join(temporary, written)))
      return console.warn(`this user cannot make a folder ${setup}: not tested`);

    expect(await run(String(dir), [executable], env)).toEqual(plain);
    expect(folders().length).toBe(2);
    for (const file of planted) expect(readFileSync(file).subarray(0, 7).toString()).toBe("planted");
  },
  120_000,
);

// Without a C compiler the scene has no addon, and its test is skipped.
const writtenAddon = !systemCC
  ? undefined
  : scene(
      "written-addon",
      {
        "app/node_modules/an-addon-for-this-platform/package.json": `{ "name": "an-addon-for-this-platform", "main": "addon.node" }`,
        "app/start.cjs": `console.log(require("./addon.node").hello());
console.log(require("an-addon-for-this-platform").hello());
`,
      },
      "./start.cjs",
    );
if (systemCC)
  laidBeforeTheBuild.push([
    "written-addon",
    async app => {
      for (const to of ["addon.node", "node_modules/an-addon-for-this-platform/addon.node"])
        await copyAddon(join(app, to));
    },
  ]);
test.skipIf(!systemCC)(
  "a native addon required by a literal path is embedded without --asset",
  async () => {
    const { dir, app, exe, away } = await writtenAddon!();
    const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
    expect(plain).toEqual({ stdout: "from a native addon\nfrom a native addon\n", stderr: "", exitCode: 0 });
    renameSync(app, away);
    expect(await run(String(dir), [...exe])).toEqual(plain);
  },
  120_000,
);

const addonUnderAComputedPath = {
  "app/start.cjs": `const path = require("node:path");
const name = path.join(__dirname, "prebuilds", ["addon", "node"].join("."));
console.log(Object.keys(require(name)), require(name).hello(), require(name) === require(name));
`,
};
const waysToGiveAnAddon = [
  ["./prebuilds/addon.node"],
  ["--asset", "./prebuilds"],
  ["--asset", "./prebuilds/addon.node"],
];
const addonsGivenInPlace = !systemCC
  ? []
  : waysToGiveAnAddon.map((given, index) => {
      const folder = `addon-given-${index + 1}`;
      laidBeforeTheBuild.push([folder, app => copyAddon(join(app, "prebuilds", "addon.node"))]);
      return scene(folder, addonUnderAComputedPath, "./start.cjs", ...given);
    });
test
  .skipIf(!systemCC)
  .each(
    [[], ["--compile-in-place"]].flatMap(flags =>
      waysToGiveAnAddon.map(
        (given, index) => [[...flags, "./start.cjs", ...given], flags.length ? index : -1] as const,
      ),
    ),
  )(
  "a native addon given as a further entry point or among the assets loads under a computed path: %j",
  async (args, inPlace) => {
    using own = inPlace < 0 ? tempDir("aot-addon-entry-point", addonUnderAComputedPath) : undefined;
    const { dir, app, exe, away } = own
      ? { dir: String(own), app: join(String(own), "app"), exe: ["./built.exe"], away: join(String(own), "moved-away") }
      : await addonsGivenInPlace[inPlace]();
    if (own) await copyAddon(join(app, "prebuilds", "addon.node"));
    const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
    expect(plain).toEqual({ stdout: '[ "hello" ] from a native addon true\n', stderr: "", exitCode: 0 });
    if (own) {
      const built = await run(app, [bunExe(), "build", "--compile", "--aot", ...args, "--outfile", "../built.exe"]);
      expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });
    }
    expect(await run(String(dir), [...exe])).toEqual(plain);
    renameSync(app, away);
    expect(await run(String(dir), [...exe])).toEqual(plain);
  },
  120_000,
);

// Without a C compiler the scene has no addon, and its test is skipped.
const addonAsAsset = !systemCC
  ? undefined
  : scene(
      "addon-as-asset",
      {
        "app/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
const folder = path.join(__dirname, "prebuilds");
for (const file of fs.readdirSync(folder).filter(file => file.endsWith(".node"))) console.log(file, require(path.join(folder, file)).hello());
`,
      },
      "./start.cjs",
      "--asset",
      "./prebuilds",
    );
if (systemCC)
  laidBeforeTheBuild.push([
    "addon-as-asset",
    async app => {
      await copyAddon(join(app, "prebuilds", "addon.node"));
    },
  ]);
test.skipIf(!systemCC)(
  "a native addon passed as an asset loads from the executable",
  async () => {
    const { dir, app, exe, away } = await addonAsAsset!();
    const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
    expect(plain).toEqual({ stdout: "addon.node from a native addon\n", stderr: "", exitCode: 0 });
    expect(await run(String(dir), [...exe])).toEqual(plain);
    renameSync(app, away);
    expect(await run(String(dir), [...exe])).toEqual(plain);
  },
  120_000,
);

const askedAgain = scene(
  "asked-again",
  {
    "app/node_modules/a-package/package.json": `{ "name": "a-package", "main": "index.cjs" }`,
    "app/node_modules/a-package/index.cjs": `module.exports = "a package";`,
    "app/compiled.cjs": `module.exports = "compiled";`,
    "app/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
require("a-package");
const later = path.join(__dirname, "later.cjs");
const name = ["a", "package"].join("-");
for (let round = 0; round < 3; round++) {
  const answers = [require(path.join(__dirname, "compiled")), require(name), require.resolve(name) === require.resolve("a-package")];
  try {
    answers.push(require(later));
  } catch (error) {
    answers.push(error.code);
  }
  console.log(round, answers.join(", "));
  if (round === 1) fs.writeFileSync(later, 'module.exports = "came later";');
}
`,
  },
  "./start.cjs",
  "./compiled.cjs",
  "./node_modules/a-package/index.cjs",
);
test("repeated requires return the same module, and a file that is written later is not loaded", async () => {
  const { dir, app, exe } = await askedAgain();
  expect(await run(String(dir), [...exe])).toEqual({
    stdout:
      "0 compiled, a package, true, MODULE_NOT_FOUND\n1 compiled, a package, true, MODULE_NOT_FOUND\n2 compiled, a package, true, MODULE_NOT_FOUND\n",
    stderr: "",
    exitCode: 0,
  });
}, 120_000);

test("an asset passed through a symlink is also embedded at its real path", async () => {
  using dir = tempDir("aot-in-place-linked-asset", {
    "store/a-package/package.json": `{ "name": "a-package", "main": "index.cjs" }`,
    "store/a-package/index.cjs": `const fs = require("node:fs");
const path = require("node:path");
exports.words = () => fs.readFileSync(path.join(__dirname, "data", "words.txt"), "utf8");
`,
    "store/a-package/data/words.txt": "words of the package",
    "app/node_modules/.keep": "",
    "app/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
console.log(require("a-package").words());
console.log(fs.readFileSync(path.join(__dirname, "node_modules", "a-package", "data", "words.txt"), "utf8"));
`,
  });
  const app = join(String(dir), "app");
  symlinkSync(join("..", "..", "store", "a-package"), join(app, "node_modules", "a-package"));
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  expect(plain).toEqual({ stdout: "words of the package\nwords of the package\n", stderr: "", exitCode: 0 });
  const built = await build(app, "./start.cjs", "--asset", "./node_modules/a-package");
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  renameSync(app, join(String(dir), "moved-away"));
  renameSync(join(String(dir), "store"), join(String(dir), "store-moved-away"));
  expect(await run(String(dir), ["./built.exe"])).toEqual(plain);
}, 120_000);

const writableFolder = scene(
  "writable-folder",
  {
    "app/node_modules/a-library/package.json": `{ "name": "a-library", "main": "./index.cjs" }`,
    "app/node_modules/a-library/index.cjs": `module.exports = "the library";\n`,
    "app/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
const folder = path.dirname(require.resolve("a-library"));
try {
  fs.accessSync(folder, fs.constants.W_OK);
  fs.writeFileSync(path.join(folder, "written.txt"), "written");
  console.log(fs.readFileSync(path.join(folder, "written.txt"), "utf8"));
} catch (error) {
  console.log(error.code);
}
`,
  },
  "./start.cjs",
);
test("write access to a folder on disk follows the disk's permissions", async () => {
  const { dir, app, exe } = await writableFolder();
  expect(await run(String(dir), [...exe])).toEqual({ stdout: "written\n", stderr: "", exitCode: 0 });
}, 120_000);

const namesOfFiles = scene(
  "names-of-files",
  {
    "app/plugins/first.cjs": `module.exports = "the first plugin";`,
    "app/plugins/more/second.cjs": `module.exports = "the second plugin";`,
    "app/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
const folder = path.join(__dirname, "plugins");
const first = path.join(folder, "first.cjs");
console.log(fs.readdirSync(folder).sort().join());
console.log(fs.readdirSync(folder, { withFileTypes: true }).map(entry => entry.name + ":" + entry.isDirectory()).sort().join());
console.log(fs.readdirSync(__dirname, { recursive: true }).sort().join());
console.log(fs.existsSync(first), fs.existsSync(folder), fs.existsSync(path.join(folder, "none.cjs")));
console.log(fs.statSync(first).isFile(), fs.lstatSync(first).isFile(), fs.statSync(folder).isDirectory(), fs.statSync(path.join(folder, "none.cjs"), { throwIfNoEntry: false }));
console.log(fs.accessSync(first), fs.realpathSync(first) === first);
if (fs.existsSync(first)) console.log(require(first));
for (const file of fs.readdirSync(path.join(folder, "more"))) console.log(require(path.join(folder, "more", file)));
fs.promises.stat(first).then(stats => console.log(stats.isFile()));
`,
  },
  "./start.cjs",
  "./plugins/**/*.cjs",
);
test("fs finds compiled files by path and in directory listings", async () => {
  const { dir, app, exe } = await namesOfFiles();
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  expect(plain.stdout).toContain("first.cjs,more\n");
  expect(await run(String(dir), [...exe])).toEqual(plain);
}, 120_000);

const foldersOfFiles = scene(
  "folders-of-files",
  {
    "app/plugins/deep/er/est/last.cjs": `module.exports = "the last plugin";`,
    "app/plugins/déjà/vu.cjs": `module.exports = "seen before";`,
    "app/plugins/日本/語.cjs": `module.exports = "a word";`,
    "app/start.cjs": `const fs = require("node:fs");
const path = require("node:path");
const kind = file => {
  const stats = fs.statSync(file, { throwIfNoEntry: false });
  return [stats ? (stats.isDirectory() ? "folder" : "file") : "none", fs.existsSync(file)].join();
};
for (const name of [
  "", "deep", "deep/er", "deep/er/est", "deep/er/est/last.cjs", "déjà", "déjà/vu.cjs", "日本", "日本/語.cjs",
  "dee", "deeper", "deep/e", "deep/er/es", "deep/er/other", "deep/er/est/last", "deep/er/est/none.cjs",
  "déj", "déjà/none.cjs", "日", "日本/none.cjs", "none", "none/deep/er/est/last.cjs",
])
  console.log(JSON.stringify(name), kind(path.join(__dirname, "plugins", ...name.split("/"))));
console.log(require(path.join(__dirname, "plugins", "deep", "er", "est", "last.cjs")));
`,
  },
  "./start.cjs",
  "./plugins/**/*.cjs",
);
test("fs tells folders of compiled files from paths that begin alike, once the files are gone from the disk", async () => {
  const { dir, app, exe } = await foldersOfFiles();
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  expect(plain.stdout).toContain('"deep/er" folder,true\n');
  expect(plain.stdout).toContain('"deep/e" none,false\n');
  rmSync(join(app, "plugins"), { recursive: true });
  expect(await run(String(dir), [...exe])).toEqual(plain);
}, 120_000);

const glob = scene(
  "glob",
  {
    "app/public/index.html": "<p>a page</p>",
    "app/public/styles/main.css": "p {}",
    "app/public/styles/print.css": "p {}",
    "app/routes/first.cjs": `module.exports = "the first route";\n`,
    "app/routes/nested/second.cjs": `module.exports = "the second route";\n`,
    "app/start.cjs": `const path = require("node:path");
const found = (pattern, options) => [...new Bun.Glob(pattern).scanSync(options)].map(file => file.replaceAll("\\\\", "/")).sort();
const inApp = file => path.relative(__dirname, file).replaceAll("\\\\", "/");
console.log(found("**/*", { cwd: path.join(__dirname, "public") }).join(" "));
console.log(found("styles/*.css", { cwd: path.join(__dirname, "public"), absolute: true }).map(inApp).join(" "));
console.log(found("*", { cwd: path.join(__dirname, "public"), onlyFiles: false }).join(" "));
console.log(found(__dirname.replaceAll("\\\\", "/") + "/public/**/*.css").map(inApp).join(" "));
for (const route of found("**/*.cjs", { cwd: path.join(__dirname, "routes") })) console.log(route, require(path.join(__dirname, "routes", route)));
new Bun.Glob("**/*.html").scan({ cwd: path.join(__dirname, "public") }).next().then(first => console.log(first.value));
`,
  },
  "./start.cjs",
  "./routes/**/*.cjs",
  "--asset",
  "./public",
);
test("Bun.Glob finds embedded files", async () => {
  const { dir, app, exe } = await glob();
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  expect(plain).toEqual({
    stdout:
      "index.html styles/main.css styles/print.css\npublic/styles/main.css public/styles/print.css\nindex.html styles\npublic/styles/main.css public/styles/print.css\n" +
      "first.cjs the first route\nnested/second.cjs the second route\nindex.html\n",
    stderr: "",
    exitCode: 0,
  });
  expect(await run(String(dir), [...exe])).toEqual(plain);
}, 120_000);

test("require.resolve searches from the folders in its paths option", async () => {
  using dir = tempDir("aot-in-place-resolve-paths", {
    "store/a-hook/node_modules/a-hook/package.json": `{ "name": "a-hook", "main": "index.cjs" }`,
    "store/a-hook/node_modules/a-hook/index.cjs": `module.exports = (name, folder) => require.resolve(name, { paths: [folder] });\n`,
    "store/a-library/node_modules/a-library/package.json": `{ "name": "a-library", "main": "index.cjs" }`,
    "store/a-library/node_modules/a-library/index.cjs": `module.exports = "the library";\n`,
    "app/node_modules/.keep": "",
    "app/start.cjs": `const path = require("node:path");
const main = require.resolve("a-library");
console.log(require("a-library"), require("a-hook")(["a", "library"].join("-"), path.dirname(main)) === main);
`,
  });
  const app = join(String(dir), "app");
  for (const name of ["a-hook", "a-library"])
    symlinkSync(join("..", "..", "store", name, "node_modules", name), join(app, "node_modules", name));
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  // TODO: on Windows plain `bun run` answers false on some machines.
  expect(plain).toEqual({
    stdout: isWindows ? expect.stringMatching(/^the library (true|false)\n$/) : "the library true\n",
    stderr: "",
    exitCode: 0,
  });
  const built = await build(app, "./start.cjs");
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run(String(dir), ["./built.exe"])).toEqual({ ...plain, stdout: "the library true\n" });
}, 120_000);

const store = scene(
  "store",
  {
    "app/node_modules/.bun/an-orm@1.0.0/node_modules/an-orm/package.json": `{ "name": "an-orm", "main": "index.cjs" }`,
    "app/node_modules/.bun/an-orm@1.0.0/node_modules/an-orm/index.cjs": `module.exports = name => require(name);\n`,
    "app/node_modules/.bun/a-driver@1.0.0/node_modules/a-driver/package.json": `{ "name": "a-driver", "main": "index.cjs" }`,
    "app/node_modules/.bun/a-driver@1.0.0/node_modules/a-driver/index.cjs": `module.exports = "the driver";\n`,
    "app/start.cjs": `require("a-driver");
console.log(require("an-orm")(["a", "driver"].join("-")));
`,
  },
  "./start.cjs",
  "./node_modules/a-driver/index.cjs",
);
laidBeforeTheBuild.push([
  "store",
  async app => {
    for (const name of ["an-orm", "a-driver"])
      symlinkSync(join(".bun", name + "@1.0.0", "node_modules", name), join(app, "node_modules", name));
  },
]);
test("a computed package name resolves in a symlinked package store", async () => {
  const { dir, app, exe } = await store();
  const plain = await run(app, [bunExe(), "run", "./start.cjs"]);
  expect(plain).toEqual({ stdout: "the driver\n", stderr: "", exitCode: 0 });
  expect(await run(String(dir), [...exe])).toEqual(plain);
}, 120_000);

test.skipIf(isASAN)(
  "repeated requires of a loaded module do not grow memory",
  async () => {
    using dir = tempDir("aot-in-place-required-again", {
      "app/child.cjs": `module.exports = { answer: 42 };\n`,
      "app/start.cjs": `const name = "./child.cjs";
let sum = 0;
for (let i = 0; i < 100_000; i++) sum += require(name).answer;
Bun.gc(true);
const before = process.memoryUsage().rss;
for (let i = 0; i < 2_000_000; i++) sum += require(name).answer;
Bun.gc(true);
const grown = process.memoryUsage().rss - before;
console.log(sum, grown < 8 * 1024 * 1024 ? "level" : "grew by " + grown);
`,
    });
    const app = join(String(dir), "app");
    const built = await build(app, "./start.cjs", "./child.cjs");
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run(String(dir), ["./built.exe"])).toEqual({ stdout: "88200000 level\n", stderr: "", exitCode: 0 });
  },
  240_000,
);

test("module.children lists each module once, in first-require order", async () => {
  using dir = tempDir("aot-children-in-order", {
    "app/a.cjs": `exports.name = "a";\n`,
    "app/b.cjs": `exports.name = "b";\n`,
    "app/c.cjs": `exports.name = "c";\n`,
    "app/start.cjs": `for (const name of ["a", "b", "a", "c", "b", "a", "c"]) require("./" + name + ".cjs");
console.log(module.children.map(child => child.exports.name).join(" "));
require("./b.cjs");
console.log(module.children.map(child => child.exports.name).join(" "));
`,
  });
  expect(await run(join(String(dir), "app"), [bunExe(), "run", "./start.cjs"])).toEqual({
    stdout: "a b c\na b c\n",
    stderr: "",
    exitCode: 0,
  });
}, 120_000);

test("module.children with many children lists each once, in first-require order", async () => {
  const names = Array.from({ length: 20 }, (_, index) => "child" + index);
  using dir = tempDir("aot-many-children-in-order", {
    ...Object.fromEntries(names.map(name => ["app/" + name + ".cjs", `exports.name = "${name}";\n`])),
    "app/start.cjs": `const names = ${JSON.stringify(names)};
for (const name of names) { require("./" + name + ".cjs"); require("./" + names[0] + ".cjs"); }
for (const name of names.toReversed()) { require("./" + name + ".cjs"); require("./" + name + ".cjs"); }
console.log(module.children.map(child => child.exports.name).join(" "));
`,
  });
  expect(await run(join(String(dir), "app"), [bunExe(), "run", "./start.cjs"])).toEqual({
    stdout: names.join(" ") + "\n",
    stderr: "",
    exitCode: 0,
  });
}, 120_000);

test("--compile-in-place requires --aot", async () => {
  using dir = tempDir("aot-in-place-flag", files);
  const rejected = await run(join(String(dir), "app"), [
    bunExe(),
    "build",
    "--compile",
    "--compile-in-place",
    "./main.cjs",
    "--outfile",
    "../built.exe",
  ]);
  expect(rejected.stderr).toContain("--compile-in-place requires --aot");
  expect(rejected.exitCode).not.toBe(0);
});

test("process.execArgv excludes the program's own flags", async () => {
  using dir = tempDir("aot-in-place-exec-argv", {
    "app/main.cjs": `console.log(JSON.stringify(process.execArgv), JSON.stringify(process.argv.slice(2)));\n`,
  });
  const app = join(String(dir), "app");
  const plain = await run(app, [bunExe(), "run", "./main.cjs", "--port", "3000"]);
  expect(plain).toEqual({ stdout: `[] ["--port","3000"]\n`, stderr: "", exitCode: 0 });
  expect(await run(app, [bunExe(), "run", "--debug-aot", "./main.cjs", "--port", "3000"])).toEqual({
    ...plain,
    stdout: `["--debug-aot"] ["--port","3000"]\n`,
  });
  const built = await build(app, "./main.cjs");
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  expect(await run(String(dir), ["./built.exe", "--port", "3000"])).toEqual(plain);
}, 120_000);
