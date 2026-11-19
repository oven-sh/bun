// `path.join(import.meta.dirname, "../data", name)` in a file of the entry point's folder gives /$bunfs/data/.., which stands for what lay beside that folder.
// A file that lay above the entry point's folder, like a package in a `node_modules` beside `src`, gets the same string when it climbs out of its own mount, /$bunfs/_.._, past everything that the executable holds.
// Nothing at run time tells the two apart, so such a file finds nothing under that string, as with `bun build --compile`: a loud error, where it used to load a file that may lie somewhere else.
// This expects the error. Whoever makes it find the file again brings the silent answer back: see a-path-that-climbs-above-all-that-an-executable-holds-names-nothing.test.ts. The way out is a path made from `__dirname`.
import { expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { compileCommand } from "./harness/flags";
import { describe, test } from "./supported";

describe("compile/aot/a path made by one climb out of the root is for the files in the root", () => {
  const root = String(tempDir("aot-one-climb-handed-on", {}));
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("handed to a file beside the root and to a package, by import.meta.dirname and by __dirname", async () => {
    const project = join(root, "tool");
    const files: Record<string, string> = {
      "src/cli/main.mjs": `import "../data/en.json";
import path from "node:path";
import { load as loadInPackage } from "made-up-loader";
import { load as loadBeside } from "../loads/beside.mjs";
const unseen = text => JSON.parse(JSON.stringify(text));
const tell = async ask => {
  try {
    return (await ask()).default.from;
  } catch (error) {
    return error.code;
  }
};
for (const [how, folder] of [["import.meta.dirname", import.meta.dirname], ["__dirname", __dirname]]) {
  const made = path.join(folder, unseen(".."), unseen("data"), unseen("en") + ".json");
  console.log(how + ":", await tell(() => import(made)), await tell(() => loadBeside(made)), await tell(() => loadInPackage(made)));
}
`,
      "src/loads/beside.mjs": "export const load = name => import(name);\n",
      "src/data/en.json": `{ "from": "src" }`,
      "node_modules/made-up-loader/package.json": `{ "name": "made-up-loader", "type": "module", "main": "index.mjs" }`,
      "node_modules/made-up-loader/index.mjs": "export const load = name => import(name);\n",
    };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(project, file)), { recursive: true });
      writeFileSync(join(project, file), text);
    }
    const executable = join(elsewhere, isWindows ? "handed.exe" : "handed");
    built(
      await spawned(
        [bunExe(), ...compileCommand, ...withoutDebugInformation(), "./src/cli/main.mjs", "--outfile", executable],
        project,
        bunEnv,
      ),
    );
    // What answers under the path made from `__dirname` is the executable, not the disk.
    rmSync(project, { recursive: true, force: true });
    const run = await spawned([executable], elsewhere, bunEnv);
    expect({ stdout: run.stdout.trim().split("\n"), exitCode: run.exitCode }).toEqual({
      stdout: ["import.meta.dirname: src ERR_MODULE_NOT_FOUND ERR_MODULE_NOT_FOUND", "__dirname: src src src"],
      exitCode: 0,
    });
  }, 300_000);
});
