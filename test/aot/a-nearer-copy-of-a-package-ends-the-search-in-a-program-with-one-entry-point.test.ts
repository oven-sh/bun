import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { renameSync } from "node:fs";
import { join } from "node:path";
import { afterAll, test } from "./harness/default-timeout";
import { run } from "./harness/run";

const main = `
const path = require("node:path");
const Module = require("node:module");
const tool = require("tool");
const held = require("dep");
const folder = path.join(__dirname, "node_modules", "tool");
const file = path.join(folder, "noop.js");
const show = found => found.split(path.sep).slice(-4).join("/");
const roads = {
  "require.resolve in the package": name => show(tool.where(name)),
  "createRequire of the package's file": name => show(Module.createRequire(require.resolve("tool")).resolve(name)),
  "createRequire of a path in the package's folder": name => show(Module.createRequire(file).resolve(name)),
  "_resolveFilename with a parent": name => show(Module._resolveFilename(name, { id: file, filename: file, paths: Module._nodeModulePaths(folder) })),
  "_resolveFilename with a string": name => show(Module._resolveFilename(name, file)),
  "_resolveFilename with paths": name => show(Module._resolveFilename(name, module, false, { paths: [folder] })),
  "require in the package": name => tool.load(name).version,
  "require.resolve in the entry point": name => show(require.resolve(name)).split("/").slice(-3).join("/"),
};
try {
  console.log(JSON.stringify({ held: held.version, answer: roads[process.argv[2]](process.argv[3]) }));
} catch (error) {
  console.log(JSON.stringify({ held: held.version, threw: error.code ?? error.name }));
}
`;

const dir = tempDir("aot-a-nearer-copy-with-one-entry-point", {
  "app/main.cjs": main,
  "app/node_modules/tool/package.json": JSON.stringify({ name: "tool", version: "1.0.0", main: "index.js" }),
  "app/node_modules/tool/index.js": `exports.where = name => require.resolve(name);\nexports.load = name => require(name);\n`,
  "app/node_modules/tool/node_modules/dep/package.json": JSON.stringify({
    name: "dep",
    version: "2.0.0",
    main: "index.js",
  }),
  "app/node_modules/tool/node_modules/dep/index.js": `exports.version = "2.0.0";\n`,
  "app/node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "index.js" }),
  "app/node_modules/dep/index.js": `exports.version = "1.0.0";\n`,
  "elsewhere/empty.txt": "",
});
afterAll(() => dir[Symbol.dispose]());
const app = join(String(dir), "app");
const executable = join(String(dir), "bin", isWindows ? "made.exe" : "made");

const ask = async (command: string[], startedIn: string, road: string) => {
  const { stdout, stderr, exitCode } = await run([...command, road, "dep"], startedIn, bunEnv);
  expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(stdout);
};

const roadsToTheNearerCopy = [
  "require.resolve in the package",
  "createRequire of the package's file",
  "createRequire of a path in the package's folder",
  "_resolveFilename with a parent",
  "_resolveFilename with a string",
  "_resolveFilename with paths",
];

test("no road hands out the copy further up for the nearer copy, which the executable lacks", async () => {
  const plain: Record<string, unknown> = {};
  for (const road of roadsToTheNearerCopy) plain[road] = await ask([bunExe(), "main.cjs"], app, road);
  expect(plain).toEqual(
    Object.fromEntries(
      roadsToTheNearerCopy.map(road => [road, { held: "1.0.0", answer: "tool/node_modules/dep/index.js" }]),
    ),
  );
  expect(await ask([bunExe(), "main.cjs"], app, "require in the package")).toEqual({ held: "1.0.0", answer: "2.0.0" });

  const build = await run([bunExe(), "build", "--compile", "--aot", "./main.cjs", "--outfile", executable], app);
  expect({ stderr: build.exitCode === 0 ? "" : build.stderr, exitCode: build.exitCode }).toEqual({
    stderr: "",
    exitCode: 0,
  });
  renameSync(app, join(String(dir), "away"));

  const compiled: Record<string, unknown> = {};
  for (const road of [...roadsToTheNearerCopy, "require in the package"])
    compiled[road] = await ask([executable], join(String(dir), "elsewhere"), road);
  expect(compiled).toEqual(
    Object.fromEntries(
      [...roadsToTheNearerCopy, "require in the package"].map(road => [
        road,
        { held: "1.0.0", threw: "MODULE_NOT_FOUND" },
      ]),
    ),
  );
  expect(await ask([executable], join(String(dir), "elsewhere"), "require.resolve in the entry point")).toEqual({
    held: "1.0.0",
    answer: "node_modules/dep/index.js",
  });
}, 600_000);
