import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { cpSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./run";

// What the files of tests of embedded files share: test/aot/embedded-assets*.test.ts. Each is a file of its own, so that no one file builds all of them one behind another.
export async function run(cwd: string, cmd: string[], env = bunEnv) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, env);
  return { stdout, stderr, exitCode };
}

export function bothWays(dir: string, entryPoint: string, ...flags: string[]) {
  return bothWaysIn(dir, "app", entryPoint, ...flags);
}

/** Builds in `folder`, which is `app` or lies below it. All of `app` is moved away before the executable runs. */
export async function bothWaysIn(dir: string, folder: string, entryPoint: string, ...flags: string[]) {
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
export async function plainAfterBuild(dir: string, ...folders: string[]) {
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
export async function plainAndBeside(dir: string, ...flags: string[]) {
  const [app, copy, outfile] = ["app", "copy", "built.exe"].map(it => join(dir, it));
  cpSync(app, copy, { recursive: true });
  const built = await run(app, [bunExe(), "build", "--compile", "--aot", "./main.mjs", ...flags, "--outfile", outfile]);
  expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  const plain = await run(copy, [bunExe(), "run", "./main.mjs"]);
  const compiled = await run(dir, [outfile], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  return { plain, built, compiled };
}

export const say = `const say = (label, read) => {
  try {
    console.log(label, read());
  } catch (error) {
    console.log(label, error.code);
  }
};`;
export const packages = (below: string) => ({
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
export const main = `import fs from "node:fs";
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
export const warnings = (built: { stdout: string; stderr: string }) =>
  [...(built.stdout + built.stderr).matchAll(/(warn|note): (TS\d+): [^\n"]*"([^"]+)"/g)]
    .map(it => `${it[1]} ${it[2]} ${it[3].replaceAll("\\", "/")}`)
    .sort();
