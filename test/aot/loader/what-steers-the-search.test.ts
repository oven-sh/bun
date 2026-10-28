// What steers the search for the file of an import from outside the text of the program: a variable of the environment, flags of the
// command line, "imports" of a package.json, the names in a folder. The build without `--aot` says what is right: both programs print
// the same.
import { expect } from "bun:test";
import { mkdirSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { slot, spawned } from "../run-programs";
import { describe, test } from "../supported";
import { describeTree } from "./describe";

type Case = {
  files: Record<string, string>;
  // Link path to target path, both relative to the folder of the program.
  links?: Record<string, string>;
  flags?: string[];
  env?: (folder: string) => Record<string, string>;
  prints: string;
  // The flag is one of `bun run` alone: the program runs from its folder, without `--debug-aot` and with it.
  runsInPlace?: true;
};

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    types: [],
  },
});

const manifest = (fields: object) => JSON.stringify({ name: "lib", version: "1.0.0", ...fields });
const says = (word: string) => `export const from = ${JSON.stringify(word)};`;
const printsLib = { "main.js": `import { from } from "lib";\nconsole.log(from);` };

const inNodePath = { ...printsLib, "elsewhere/lib/index.js": says("NODE_PATH") };
const nodePath = (folder: string) => ({ NODE_PATH: join(folder, "elsewhere") });

const linked = {
  files: {
    "main.js": `import { from } from "linked";\nconsole.log(from);`,
    "store/linked/index.js": `export { from } from "dep";`,
    "store/node_modules/dep/index.js": says("beside the folder"),
    "node_modules/dep/index.js": says("beside the link"),
  },
  links: { "node_modules/linked": "store/linked" },
};

const twoMainFields = {
  ...printsLib,
  "node_modules/lib/package.json": manifest({ special: "./special.js", main: "./main.js" }),
  "node_modules/lib/special.js": says("special"),
  "node_modules/lib/main.js": says("main"),
};

const twoExtensions = {
  "main.js": `const { from } = require("./a");\nconsole.log(from);`,
  "a.js": `exports.from = "a.js";`,
  "a.ts": `export const from: string = "a.ts";`,
};

const withAddons = {
  ...printsLib,
  "node_modules/lib/package.json": manifest({
    exports: { ".": { "node-addons": "./addons.js", default: "./plain.js" } },
  }),
  "node_modules/lib/addons.js": says("addons"),
  "node_modules/lib/plain.js": says("plain"),
};

const cases: Record<string, Case> = {
  "NODE_PATH": { files: inNodePath, env: nodePath, prints: "NODE_PATH\n" },
  "node_modules comes before NODE_PATH": {
    files: { ...inNodePath, "node_modules/lib/index.js": says("node_modules") },
    env: nodePath,
    prints: "node_modules\n",
  },
  "a linked folder": { ...linked, prints: "beside the folder\n" },
  "the main fields of a target": { files: twoMainFields, prints: "main\n" },
  "--main-fields": { files: twoMainFields, flags: ["--main-fields", "special"], prints: "special\n" },
  "the extensions of a target": { files: twoExtensions, prints: "a.ts\n" },
  "--extension-order": {
    files: twoExtensions,
    flags: ["--extension-order", ".js", "--extension-order", ".ts"],
    prints: "a.js\n",
  },
  "the condition node-addons": { files: withAddons, runsInPlace: true, prints: "addons\n" },
  "--no-addons": { files: withAddons, flags: ["--no-addons"], runsInPlace: true, prints: "plain\n" },
  '"imports" names modules of Bun\'s own': {
    files: {
      "package.json": JSON.stringify({
        name: "app",
        version: "1.0.0",
        imports: { "#files": "node:fs", "#paths": "path" },
      }),
      "main.js": `import { existsSync } from "#files";\nimport { basename } from "#paths";\nconsole.log(typeof existsSync, basename("/a/b.txt"));`,
    },
    prints: "function b.txt\n",
  },
  "a name in another case": {
    files: { "main.js": `import { from } from "./Lib.js";\nconsole.log(from);`, "lib.js": says("lib.js") },
    prints: "lib.js\n",
  },
};

async function run(folder: string, how: "plain" | "aot", it: Case) {
  const env = { ...bunEnv, ...it.env?.(folder) };
  const flags = it.flags ?? [];
  if (it.runsInPlace)
    return spawned([bunExe(), "run", ...(how === "aot" ? ["--debug-aot"] : []), ...flags, "./main.js"], folder, env);
  const executable = join(folder, how + (isWindows ? ".exe" : ""));
  const command = [
    bunExe(),
    "build",
    "--compile",
    ...(how === "aot" ? ["--aot"] : []),
    ...flags,
    "./main.js",
    "--outfile",
    executable,
  ];
  const build = await spawned(command, folder, env);
  expect({ how, stderr: build.stderr, exitCode: build.exitCode }).toEqual({
    how,
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  return spawned([executable], folder, how === "aot" ? { ...env, BUN_JSC_crashIfInterpreterIsUsed: "1" } : env);
}

describe.concurrent("compile/aot/what steers the search for a file", () => {
  for (const [name, it] of Object.entries(cases)) {
    test(
      name,
      () =>
        slot(async () => {
          using dir = tempDir("aot-what-steers-the-search", { "tsconfig.json": tsconfig, ...it.files });
          const folder = String(dir);
          for (const [link, target] of Object.entries(it.links ?? {})) {
            mkdirSync(dirname(join(folder, link)), { recursive: true });
            symlinkSync(join(folder, target), join(folder, link), "junction");
          }
          for (const how of ["plain", "aot"] as const) {
            const ran = await run(folder, how, it);
            expect({
              how,
              stdout: ran.stdout,
              stderr: ran.exitCode === 0 ? "" : ran.stderr,
              exitCode: ran.exitCode,
            }).toEqual({
              how,
              stdout: it.prints,
              stderr: "",
              exitCode: 0,
            });
          }
        }),
      600_000,
    );
  }
});

// `bun build` without `--aot` takes "development" by itself, so here `bun run` says what is right.
test.each([
  ["nobody asks for it", [], "default\n"],
  ["--conditions asks for it", ["--conditions", "development"], "development\n"],
] as const)(
  'the "development" condition when %s',
  async (_, flags, prints) => {
    using dir = tempDir("aot-what-steers-the-search", {
      "tsconfig.json": tsconfig,
      ...printsLib,
      "node_modules/lib/package.json": manifest({
        exports: { development: "./development.js", production: "./production.js", default: "./default.js" },
      }),
      "node_modules/lib/development.js": says("development"),
      "node_modules/lib/production.js": says("production"),
      "node_modules/lib/default.js": says("default"),
    });
    const folder = String(dir);
    const plain = await spawned([bunExe(), ...flags, "./main.js"], folder, bunEnv);
    const compiled = await run(folder, "aot", { files: {}, flags: [...flags], prints });
    expect([plain.stdout, compiled.stdout]).toEqual([prints, prints]);
  },
  600_000,
);

test.each(["import", "require"] as const)(
  'what "imports" names is a module of Bun\'s own or a package, for %s',
  kind => {
    const answers = [
      ["#files", "builtin:node:fs"],
      ["#paths", "builtin:node:path"],
      ["#installed", "node_modules/installed/index.js"],
      ["#absent", "not found (PackageNotFound)"],
    ];
    const write = (specifier: string) => (kind === "import" ? `import "${specifier}";` : `require("${specifier}");`);
    const main = kind === "import" ? "main.mjs" : "main.cjs";
    const imports = { "#files": "node:fs", "#paths": "path", "#installed": "installed", "#absent": "absent" };
    using graph = describeTree(
      {
        "package.json": JSON.stringify({ name: "app", version: "1.0.0", imports }),
        "node_modules/installed/index.js": "",
        [main]: answers.map(([specifier]) => write(specifier)).join("\n"),
      },
      [main],
    );
    expect(graph.file(main).sites.map(site => [site.specifier, site.answer])).toEqual(answers);
  },
);
