// Under "module": "Node16" | "NodeNext" TypeScript asks that a relative import in an ES module names its file with the extension (TS2834, TS2835). That is a rule about what Node would load from the
// emitted files. Bun finds `import "./src/value"` and `import "./src/folder"`, and nothing is emitted: the build does not refuse them. Everything else under those modes is as ever: a type error and a
// file that is not there stop the build, and a package's "exports" are followed by their conditions.
import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { compileCommand } from "./harness/flags";
import { spawned, withoutDebugInformation } from "./run-programs";
import { describe, test } from "./supported";

const head = "declare const console: { log(...values: unknown[]): void };\n";
const rows: [string, string, string | undefined][] = [
  [
    "a file and a folder without an extension",
    `import { value } from "./src/value"; import { inFolder } from "./src/folder"; console.log(value, inFolder);`,
    undefined,
  ],
  [
    "the extension of the emitted file",
    `import { value } from "./src/value.js"; import { inFolder } from "./src/folder/index.js"; console.log(value, inFolder);`,
    undefined,
  ],
  [
    "a type error behind such an import",
    `import { value } from "./src/value"; const text: string = value; console.log(text);`,
    "TS2322",
  ],
  ["a file that is not there", `import { value } from "./src/absent"; console.log(value);`, "TS"],
  ["a package with conditions", `import { how } from "pkg"; console.log(how);`, undefined],
  [
    "a load at run time without an extension",
    `const { value } = await import("./src/value"); console.log(value + 1);`,
    undefined,
  ],
];

describe.each(["Node16", "NodeNext"])("compile/aot/imports without an extension under %s", mode => {
  const folder = String(
    tempDir("aot-imports-without-an-extension", {
      "package.json": `{ "name": "under", "type": "module" }`,
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2023",
          module: mode,
          moduleResolution: mode,
          noEmit: true,
          strict: true,
          types: [],
        },
      }),
      "src/value.ts": "export const value: number = 1;\n",
      "src/folder/index.ts": `export const inFolder: string = "folder";\n`,
      "node_modules/pkg/package.json": `{ "name": "pkg", "type": "module", "exports": { ".": { "import": "./lib/es.js", "require": "./lib/common.cjs" } } }`,
      "node_modules/pkg/lib/es.js": `export const how = "import";\n`,
      "node_modules/pkg/lib/common.cjs": `exports.how = "require";\n`,
      "node_modules/pkg/lib/es.d.ts": "export declare const how: string;\n",
      ...Object.fromEntries(rows.map(([, text], index) => [`row-${index}.ts`, head + text + "\n"])),
    }),
  );
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test.each(rows.map(([title, , refusal], index) => [title, index, refusal] as const))(
    "%s",
    async (_, index, refusal) => {
      const executable = join(folder, `out-${index}`);
      const build = await spawned(
        [bunExe(), ...compileCommand, ...withoutDebugInformation(), `./row-${index}.ts`, "--outfile", executable],
        folder,
        bunEnv,
      );
      const codes = [...new Set(build.stderr.match(/^error: TS\d+/gm) ?? [])].join();
      if (refusal)
        return void expect({ codes, exitCode: build.exitCode }).toEqual({
          codes: expect.stringContaining(refusal),
          exitCode: 1,
        });
      expect({ codes, exitCode: build.exitCode }).toEqual({ codes: "", exitCode: 0 });
      const plain = await spawned([bunExe(), "run", `row-${index}.ts`], folder, bunEnv);
      const run = await spawned([executable], folder, bunEnv);
      expect({ stdout: run.stdout, exitCode: run.exitCode, signal: run.signal }).toEqual({
        stdout: plain.stdout,
        exitCode: 0,
        signal: null,
      });
    },
  );
});
