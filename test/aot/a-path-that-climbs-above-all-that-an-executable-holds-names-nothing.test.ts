// A file that lay above the folder of the entry point has its own mount in the executable, /$bunfs/_.._, beside /$bunfs/root.
// `path.join(import.meta.dirname, "../../../data", name)` in such a file can leave that mount. What it gets then, /$bunfs/data/.., is also what a file in the root gets for `../data`,
// where it stands for what lay beside the root. Asked from the mount above the root it leads above everything that the executable holds, and finds nothing there, as `bun build --compile` finds nothing.
import { expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { compileCommand } from "./harness/flags";
import { describe, test } from "./supported";

// The build does not see the names: where it does, it embeds the data file that lies up there, and the mount is as much deeper.
const asks = `import path from "node:path";
const unseen = text => JSON.parse(JSON.stringify(text));
const ask = async up => {
  try {
    return (await import(path.join(import.meta.dirname, unseen(up), unseen("data"), unseen("en") + ".json"))).default.from;
  } catch (error) {
    return error.code;
  }
};
`;

describe("compile/aot/a path that climbs above all that an executable holds names nothing", () => {
  const root = String(tempDir("aot-climbs-above-all", {}));
  const elsewhere = join(root, "elsewhere");
  mkdirSync(elsewhere);
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  test("from a file above the root, and from a file in the root", async () => {
    const project = join(root, "outer", "tool");
    const files: Record<string, string> = {
      "src/cli/main.mjs": `import "../data/en.json";
import "./inner.json";
import "../root/inner.json";
${asks}console.log("in the root:", await ask(".."), await ask("../.."), await ask("../../.."));
const mounts = unseen(path.dirname(import.meta.dirname)), own = path.basename(import.meta.dirname);
const spelled = async name => {
  try {
    return (await import(name)).default.from;
  } catch (error) {
    return error.code;
  }
};
console.log("a mount behind a slash too many:", await spelled(mounts + "//" + own + "/inner.json"), await spelled(mounts + "/./" + own + "/inner.json"), await spelled(mounts + "//_.._/_.._/data/en.json"));
await import("../loads/above.mjs");
`,
      "src/loads/above.mjs": `${asks}console.log("above the root:", await ask(".."), await ask("../.."), await ask("../../.."), await ask("../../../.."));
const left = path.join(import.meta.dirname, unseen("../../.."));
const spelled = async name => {
  try {
    return (await import(name)).default.from;
  } catch (error) {
    return error.code;
  }
};
console.log("with a slash too many:", await spelled(left + "//data/en.json"), await spelled(left + "/./data/en.json"));
`,
      "src/data/en.json": `{ "from": "src" }`,
      "src/cli/inner.json": `{ "from": "the root" }`,
      // The name that the executable gives the folder of the entry point, on a folder beside it.
      "src/root/inner.json": `{ "from": "a folder named root beside it" }`,
      "../data/en.json": `{ "from": "outer" }`,
    };
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(project, file)), { recursive: true });
      writeFileSync(join(project, file), text);
    }
    const executable = join(elsewhere, isWindows ? "climbs.exe" : "climbs");
    built(
      await spawned(
        [bunExe(), ...compileCommand, ...withoutDebugInformation(), "./src/cli/main.mjs", "--outfile", executable],
        project,
        bunEnv,
      ),
    );
    const run = await spawned([executable], elsewhere, bunEnv);
    expect({ stdout: run.stdout.trim().split("\n"), exitCode: run.exitCode }).toEqual({
      stdout: [
        "in the root: src ERR_MODULE_NOT_FOUND ERR_MODULE_NOT_FOUND",
        "a mount behind a slash too many: the root the root src",
        "above the root: src ERR_MODULE_NOT_FOUND ERR_MODULE_NOT_FOUND ERR_MODULE_NOT_FOUND",
        "with a slash too many: ERR_MODULE_NOT_FOUND ERR_MODULE_NOT_FOUND",
      ],
      exitCode: 0,
    });
  }, 300_000);
});
