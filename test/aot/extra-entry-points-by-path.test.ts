import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

// What a program loads by names that it computes is no part of it unless the build is told: the files are given as further entry
// points. The executable then finds each of them by the path it had when it was built: by `__dirname`, and from the file that asks.
// Nothing is read from the disk and nothing is interpreted.

const files = {
  "app/main.cjs": `const path = require("node:path");
const say = (what, make) => { try { console.log(what, String(make())); } catch (e) { console.log(what, "THROWS", e.code ?? e.name); } };
for (const name of ["a", "b"]) say("by __dirname " + name, () => require(path.join(__dirname, "plugins", name + ".cjs")).name);
say("from the first file", () => require("./plugins/" + ["a", ".cjs"].join("")).name);
say("from a file in a folder", () => require("./lib/loader.cjs").load("x.cjs").name);
say("from a module in a folder", () => require("./lib/made.mjs").load("./near/x.cjs").name);
say("without the extension", () => require(path.join(__dirname, "plugins", "a")).name);
say("one module", () => require(path.join(__dirname, "plugins", "a.cjs")) === require("./plugins/" + ["a", ".cjs"].join("")));
say("the module that a written name yields", () => require(path.join(__dirname, "plugins", "b.cjs")) === require("./plugins/b.cjs"));
say("no such file", () => require(path.join(__dirname, "plugins", "none.cjs")));
say("what resolve yields can be required", () => require(require("./lib/loader.cjs").resolved).name);
say("runs", () => [globalThis.runsOfA, globalThis.runsOfB, globalThis.runsOfX]);
const fs = require("node:fs");
say("is there", () => [fs.existsSync(path.join(__dirname, "plugins", "a.cjs")), fs.existsSync(path.join(__dirname, "plugins", "none.cjs")), fs.statSync(path.join(__dirname, "plugins")).isDirectory()]);
say("a folder that is listed and loaded", () => fs.readdirSync(path.join(__dirname, "plugins")).sort().filter(file => file.endsWith(".cjs")).map(file => require(path.join(__dirname, "plugins", file)).name));
import(path.join(__dirname, "plugins", "es.mjs"))
  .then(ns => console.log("import()", ns.name, ns.default), e => console.log("import() THROWS", e.code ?? e.name))
  .then(() => require("./lib/made.mjs").imports("./near/es.mjs"))
  .then(ns => console.log("import() from a module in a folder", ns.name), e => console.log("import() THROWS", e.code ?? e.name))
  .then(() => {
    const { Worker } = require("node:worker_threads");
    const worker = new Worker(path.join(__dirname, "worker.cjs"));
    worker.on("message", said => console.log("worker", said));
    worker.on("error", e => console.log("worker THROWS", e.code ?? e.name));
  });
`,
  "app/lib/loader.cjs": `exports.load = name => require("./near/" + name);\nexports.resolved = require.resolve("../plugins/only-resolved.cjs");\n`,
  "app/plugins/only-resolved.cjs": `exports.name = "only resolved";\n`,
  "app/lib/made.mjs": `import { createRequire } from "node:module";\nconst made = createRequire(import.meta.url);\nexport const load = name => made(name);\nexport const imports = name => import(name);\n`,
  "app/lib/near/x.cjs": `globalThis.runsOfX = (globalThis.runsOfX || 0) + 1;\nexports.name = "x";\n`,
  "app/lib/near/es.mjs": `export const name = "near";\n`,
  "app/plugins/a.cjs": `globalThis.runsOfA = (globalThis.runsOfA || 0) + 1;\nexports.name = "a";\n`,
  "app/plugins/b.cjs": `globalThis.runsOfB = (globalThis.runsOfB || 0) + 1;\nexports.name = "b";\n`,
  "app/plugins/es.mjs": `export const name = "es";\nexport default 7;\n`,
  "app/worker.cjs": `require("node:worker_threads").parentPort.postMessage("hello from " + require("node:path").basename(__filename));\n`,
};

const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

for (const [how, further] of [
  [
    "named one by one",
    [
      "plugins/a.cjs",
      "plugins/b.cjs",
      "plugins/es.mjs",
      "plugins/only-resolved.cjs",
      "lib/near/x.cjs",
      "lib/near/es.mjs",
      "worker.cjs",
    ],
  ],
  ["given by patterns", ["plugins/*", "lib/near/**/*.{cjs,mjs}", "worker.cjs"]],
] as const) {
  test(`further entry points ${how} are found by their paths`, async () => {
    using dir = tempDir("entry-points-by-path", files);
    const app = join(String(dir), "app");
    mkdirSync(join(String(dir), "elsewhere"));
    const plain = await run([bunExe(), "run", "main.cjs"], app, bunEnv);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "main.cjs", ...further, "--outfile", "../elsewhere/program"],
      app,
      bunEnv,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    const program = join(String(dir), "elsewhere", "program");
    const whereItWasBuilt = await run([program], app, compiledOnly);
    expect({ stdout: whereItWasBuilt.stdout, exitCode: whereItWasBuilt.exitCode }).toEqual({
      stdout: plain.stdout,
      exitCode: 0,
    });
    renameSync(app, join(String(dir), "hidden"));
    const alone = await run([program], join(String(dir), "elsewhere"), compiledOnly);
    expect({ stdout: alone.stdout, exitCode: alone.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 120_000);
}

test("a computed name of a package finds the package whose main file is a further entry point", async () => {
  using dir = tempDir("entry-points-by-package-name", {
    "app/main.cjs": `const orm = require("orm");
console.log(orm.connect("driver"), orm.connect("@scope/driver"), orm.connect("driver/lib/extra"));
orm.imports("both").then(ns => console.log(ns.default, orm.connect("both")));
`,
    "app/node_modules/orm/package.json": `{ "name": "orm", "main": "lib/index.js" }`,
    "app/node_modules/orm/lib/index.js": `exports.connect = name => require(name).name;\nexports.imports = name => import(name);\n`,
    "app/node_modules/driver/package.json": `{ "name": "driver", "main": "./lib/entry.js" }`,
    "app/node_modules/driver/lib/entry.js": `exports.name = "driver";\n`,
    "app/node_modules/driver/lib/extra.js": `exports.name = "extra";\n`,
    "app/node_modules/@scope/driver/package.json": `{ "name": "@scope/driver", "exports": { ".": "./main.cjs" } }`,
    "app/node_modules/@scope/driver/main.cjs": `exports.name = "scoped";\n`,
    "app/node_modules/both/package.json": `{ "name": "both", "exports": { ".": { "import": "./es.mjs", "require": "./common.cjs" } } }`,
    "app/node_modules/both/es.mjs": `export default "imported";\n`,
    "app/node_modules/both/common.cjs": `exports.name = "required";\n`,
  });
  const app = join(String(dir), "app");
  const plain = await run([bunExe(), "run", "main.cjs"], app, bunEnv);
  expect({ stdout: plain.stdout, stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({
    stdout: "driver scoped extra\nimported required\n",
    stderr: "",
    exitCode: 0,
  });
  const build = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "main.cjs",
      "node_modules/driver/lib/*.js",
      "node_modules/@scope/driver/main.cjs",
      "node_modules/both/*.{mjs,cjs}",
      "--outfile",
      "../program",
    ],
    app,
    bunEnv,
  );
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const whereItWasBuilt = await run([join(String(dir), "program")], app, compiledOnly);
  expect({ stdout: whereItWasBuilt.stdout, exitCode: whereItWasBuilt.exitCode }).toEqual({
    stdout: plain.stdout,
    exitCode: 0,
  });
  renameSync(app, join(String(dir), "hidden"));
  const alone = await run([join(String(dir), "program")], String(dir), compiledOnly);
  expect({ stdout: alone.stdout, exitCode: alone.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 120_000);

test("a further entry point is still found by the name it has in the executable", async () => {
  using dir = tempDir("entry-points-by-embedded-name", {
    "app/main.cjs": `console.log(require(["./plugins/a", ".js"].join("")).name, require("./lib/loader.cjs").load("./plugins/a.js").name);\n`,
    "app/lib/loader.cjs": `exports.load = name => require(name);\n`,
    "app/plugins/a.cjs": `exports.name = "a";\n`,
  });
  const app = join(String(dir), "app");
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "plugins/a.cjs", "--outfile", "../program"],
    app,
    bunEnv,
  );
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  renameSync(app, join(String(dir), "hidden"));
  const ran = await run([join(String(dir), "program")], String(dir), compiledOnly);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "a a\n", exitCode: 0 });
}, 120_000);

test("a program with one entry point holds no path", async () => {
  using dir = tempDir("entry-points-by-path-one", {
    "main.cjs": `console.log(require(["node:", "path"].join("")).sep);\n`,
  });
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "program"],
    String(dir),
    bunEnv,
  );
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const bytes = await Bun.file(join(String(dir), "program")).bytes();
  expect(Buffer.from(bytes).includes(join(String(dir), "main.cjs") + "\0")).toBe(false);
}, 120_000);
