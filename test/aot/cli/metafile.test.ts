// `--metafile` and `--metafile-md` with `--aot`: the file has the format that `bun build --metafile` writes, and its inputs are
// those of the same build without `--aot`. What differs is written down here, each with its reason.
import { expect } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const bun = (cwd: string, ...args: string[]) => spawned([bunExe(), ...args], cwd, env);
const executable = (folder: string, name: string) => join(folder, isWindows ? name + ".exe" : name);
const buildLimit = 300_000;

interface Import {
  path: string;
  kind: string;
  external?: boolean;
  original?: string;
  with?: { type: string };
}
interface Metafile {
  inputs: Record<string, { bytes: number; imports: Import[]; format?: string }>;
  outputs: Record<
    string,
    {
      bytes: number;
      inputs: Record<string, { bytesInOutput: number }>;
      imports: Import[];
      exports: string[];
      entryPoint?: string;
    }
  >;
}

const program = {
  "main.ts": `import { readFileSync } from "node:fs";
import { sep } from "path";
import settings from "./settings.json";
import { twice } from "./lib/twice";
import note from "./note.txt" with { type: "text" };
import { viaBarrel } from "kit";
export * from "./lib/names";
const old = require("./lib/old.cjs");
const late = await import("./lib/late");
const worker = new Worker(new URL("./worker.ts", import.meta.url).href);
const answer = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
worker.terminate();
console.log(
  twice(settings.count), old.name, late.late(), answer, note.trim(), viaBarrel(), typeof readFileSync, sep.length,
  require.resolve("./lib/old.cjs").endsWith("old.cjs"),
);
`,
  "worker.ts": `import { twice } from "./lib/twice";\npostMessage("worker" + twice(2));\n`,
  "settings.json": `{ "count": 21, "unused": "x" }\n`,
  "note.txt": "a note\n",
  "lib/twice.ts": `export function twice(n: number): number {\n  return n * 2;\n}\n`,
  "lib/names.ts": `export const first = "first";\nexport const second = "second";\n`,
  "lib/old.cjs": `exports.name = "old";\nexports.separator = require("node:path").sep;\n`,
  "lib/late.ts": `import { twice } from "./twice";\nexport function late(): string {\n  return "late" + twice(1);\n}\n`,
  "node_modules/kit/package.json": `{ "name": "kit", "version": "1.0.0", "type": "module", "main": "./index.js", "sideEffects": false }\n`,
  "node_modules/kit/index.js": `export { viaBarrel } from "./behind-the-barrel.js";\nexport { other } from "./other.js";\n`,
  "node_modules/kit/index.d.ts": `export function viaBarrel(): string;\nexport function other(): string;\n`,
  "node_modules/kit/behind-the-barrel.js": `export function viaBarrel() {\n  return "barrel";\n}\n`,
  "node_modules/kit/other.js": `export function other() {\n  return "other";\n}\n`,
};
const behindTheBarrel = "node_modules/kit/behind-the-barrel.js";
const printed = "42 old late2 worker4 a note barrel function 1 true\n";

const read = (path: string): Metafile => JSON.parse(readFileSync(path, "utf8"));
const line = (it: Import) =>
  [it.kind, it.path, it.external ? "external" : "", it.original ?? "", it.with?.type ?? ""].join(" ").trimEnd();

/** What a tool that reads a metafile does: from the entry points, over every import that is not external. */
function walk(metafile: Metafile, from: string[]) {
  const reached = new Set<string>();
  const pending = [...from];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (reached.has(path)) continue;
    reached.add(path);
    for (const it of metafile.inputs[path].imports) if (!it.external) pending.push(it.path);
  }
  return [...reached].sort();
}

describe.concurrent("--metafile with --aot", () => {
  test(
    "lists the modules and the imports that the build without --aot lists",
    () =>
      slot(async () => {
        using dir = tempDir("aot-metafile", program);
        const folder = String(dir);
        const build = (...flags: string[]) => bun(folder, "build", "--compile", ...flags, "main.ts", "worker.ts");
        built(await build("--metafile=plain.json", "--outfile", "plain/app"));
        built(await build("--aot", "--metafile=aot.json", "--metafile-md=notes/aot.md", "--outfile", "aot/app"));

        const ran = await spawned([executable(join(folder, "aot"), "app")], folder, env);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: printed, exitCode: 0 });

        const [plain, aot] = [read(join(folder, "plain.json")), read(join(folder, "aot.json"))];
        expect(Object.keys(aot.inputs).sort()).toEqual(Object.keys(plain.inputs).sort());
        // Nothing reads what it exports, and the package says that it has no side effects.
        expect(Object.keys(aot.inputs)).not.toContain("node_modules/kit/other.js");

        for (const [path, input] of Object.entries(aot.inputs)) {
          const expected = plain.inputs[path];
          expect({ path, format: input.format }).toEqual({ path, format: expected.format });
          // The bundler says 0 for a file that it loads as text.
          if (path !== "note.txt") expect({ path, bytes: input.bytes }).toEqual({ path, bytes: expected.bytes });
          const imports = expected.imports
            // The bundler's own helpers.
            .filter(it => it.path !== "bun:wrap")
            // The bundler lists the import of a file that it leaves out, as external where it has not resolved it.
            .filter(it => (it.external ? !it.path.startsWith(".") : it.path in plain.inputs));
          expect({ path, imports: input.imports.map(line).sort() }).toEqual({
            path,
            imports: imports.map(line).sort(),
          });
        }
        expect(aot.inputs["note.txt"].bytes).toBe(program["note.txt"].length);
        expect(aot.inputs["main.ts"].imports.map(line)).toEqual([
          "import-statement fs external node:fs",
          "import-statement path external",
          "import-statement settings.json  ./settings.json json",
          "import-statement lib/twice.ts  ./lib/twice",
          "import-statement note.txt  ./note.txt text",
          "import-statement node_modules/kit/index.js  kit",
          "import-statement lib/names.ts  ./lib/names",
          "require-call lib/old.cjs  ./lib/old.cjs",
          "dynamic-import lib/late.ts  ./lib/late",
          "require-resolve lib/old.cjs  ./lib/old.cjs",
        ]);

        // Nothing is bundled: the one output is the executable, whichever number of entry points the build has.
        // It is listed by the name of the file that was written. The build without --aot lists the name that --outfile has.
        const app = isWindows ? "./app.exe" : "./app";
        expect(Object.keys(plain.outputs).sort()).toEqual(["./app", "./worker.js"]);
        expect(Object.keys(aot.outputs)).toEqual([app]);
        const output = aot.outputs[app];
        expect({ ...output, bytes: 0, inputs: Object.keys(output.inputs).sort() }).toEqual({
          bytes: 0,
          inputs: Object.keys(aot.inputs).sort(),
          imports: [],
          exports: plain.outputs["./app"].exports,
          entryPoint: "main.ts",
        });
        expect(output.exports).toEqual(["first", "second"]);
        const codeBytes = Object.values(output.inputs).map(it => it.bytesInOutput);
        expect(output.inputs["main.ts"].bytesInOutput).toBeGreaterThan(0);
        expect(output.inputs["lib/late.ts"].bytesInOutput).toBeGreaterThan(0);
        expect(codeBytes.every(bytes => Number.isInteger(bytes) && bytes >= 0)).toBe(true);
        expect(output.bytes).toBeGreaterThan(codeBytes.reduce((sum, bytes) => sum + bytes, 0));

        expect(walk(aot, ["main.ts", "worker.ts"])).toEqual(Object.keys(aot.inputs).sort());

        const markdown = readFileSync(join(folder, "notes", "aot.md"), "utf8");
        expect(markdown).toContain("# Bundle Analysis Report");
        expect(markdown).toContain(behindTheBarrel);
      }),
    buildLimit,
  );

  test(
    "the executable is the one that the build without --metafile writes",
    () =>
      slot(async () => {
        using dir = tempDir("aot-metafile-same-executable", program);
        const folder = String(dir);
        const hash = async (outdir: string, ...flags: string[]) => {
          built(
            await bun(
              folder,
              "build",
              "--compile",
              "--aot",
              ...flags,
              "main.ts",
              "worker.ts",
              "--outfile",
              outdir + "/app",
            ),
          );
          return new Bun.CryptoHasher("sha256")
            .update(readFileSync(executable(join(folder, outdir), "app")))
            .digest("hex");
        };
        expect(await hash("with", "--metafile=meta.json")).toBe(await hash("without"));
      }),
    buildLimit,
  );

  test(
    "what the program finds when it runs is external, and what it never loads is not listed",
    () =>
      slot(async () => {
        using dir = tempDir("aot-metafile-external", {
          "main.ts": `/// <reference path="./marked-external.d.ts" />
import type { Shape } from "./shape";
import { unused } from "./unused";
import * as marked from "marked-external";
import test from "node:test";
let missing: unknown;
try {
  missing = require("./not-there");
} catch {}
const shape: Shape = { name: process.argv[2] ?? "b" };
const chosen = require("./chosen/" + shape.name + ".ts");
console.log(typeof marked, typeof test, typeof missing, chosen.name, import.meta.resolve("./resolved.ts").endsWith("resolved.ts"));
`,
          "marked-external.d.ts": `declare module "marked-external";\n`,
          "shape.ts": `export interface Shape {\n  name: string;\n}\n`,
          "unused.ts": `export const unused = 1;\n`,
          "resolved.ts": `export const resolved = 1;\n`,
          "chosen/a.ts": `export const name = "a";\n`,
          "chosen/b.ts": `export const name = "b";\n`,
        });
        const folder = String(dir);
        built(
          await bun(
            ...[folder, "build", "--compile", "--aot", "--external", "marked-external"],
            ...["--metafile=meta.json", "main.ts", "--outfile", "app"],
          ),
        );
        const metafile = read(join(folder, "meta.json"));
        expect(Object.keys(metafile.inputs).sort()).toEqual(["chosen/a.ts", "chosen/b.ts", "main.ts", "resolved.ts"]);
        expect(metafile.inputs["main.ts"].imports.map(line).sort()).toEqual([
          "import-statement marked-external external",
          "import-statement node:test external",
          "require-call ./not-there external",
          "require-call chosen/a.ts  ./chosen/a.ts",
          "require-call chosen/b.ts  ./chosen/b.ts",
          "require-resolve resolved.ts  ./resolved.ts",
        ]);
      }),
    buildLimit,
  );

  test(
    "Bun.build",
    () =>
      slot(async () => {
        using dir = tempDir("aot-metafile-api", {
          ...program,
          "build.ts": `const entrypoints = ["./main.ts", "./worker.ts"];
const inResult = await Bun.build({ entrypoints, metafile: true, compile: { outfile: "./first/app", aot: true } });
const inFiles = await Bun.build({
  entrypoints,
  outdir: "./second",
  metafile: { json: "meta/build.json", markdown: "meta/build.md" },
  compile: { outfile: "app", aot: true },
});
const without = await Bun.build({ entrypoints, compile: { outfile: "./third/app", aot: true } });
process.stdout.write(
  JSON.stringify({
    success: [inResult.success, inFiles.success, without.success],
    outputs: [inResult.outputs.length, inFiles.outputs.length, without.outputs.length],
    inResult: inResult.metafile,
    inFiles: inFiles.metafile,
    without: without.metafile === undefined,
  }),
);
`,
        });
        const folder = String(dir);
        const build = await bun(folder, "build.ts");
        expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
        const result = JSON.parse(build.stdout);
        expect({ ...result, inResult: undefined, inFiles: undefined }).toEqual({
          success: [true, true, true],
          outputs: [1, 1, 1],
          without: true,
        });
        const metafile: Metafile = result.inResult;
        expect(walk(metafile, ["main.ts", "worker.ts"])).toEqual(Object.keys(metafile.inputs).sort());
        expect(Object.keys(metafile.inputs)).toContain(behindTheBarrel);
        expect(Object.values(metafile.outputs).map(output => output.entryPoint)).toEqual(["main.ts"]);

        expect(result.inFiles.inputs).toEqual(metafile.inputs);
        expect(read(join(folder, "second", "meta", "build.json")).inputs).toEqual(metafile.inputs);
        expect(readFileSync(join(folder, "second", "meta", "build.md"), "utf8")).toStartWith(
          "# Bundle Analysis Report",
        );
      }),
    buildLimit,
  );
});
