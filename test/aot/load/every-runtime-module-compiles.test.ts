import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { slot, spawned, told } from "../run-programs";
import { describe, test } from "../supported";

const exe = (name: string) => name + (isWindows ? ".exe" : "");
const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

const names = builtinModules.filter(name => name !== "bun:main").sort();

const MAIN = `function attempt(name, load) {
  try {
    const loaded = load();
    console.log(name, typeof loaded, Object.keys(loaded ?? {}).length);
  } catch (error) {
    console.log(name, "threw", error.name, error.code);
  }
}
${names.map(name => `attempt(${JSON.stringify(name)}, () => require(${JSON.stringify(name)}));\n`).join("")}`;

const BASE_OPTIONS = {
  target: "ESNext",
  module: "Preserve",
  moduleResolution: "bundler",
  noEmit: true,
  types: [],
  allowJs: true,
};

const optionSets: [name: string, compilerOptions: Record<string, boolean>][] = [
  ["strict", { strict: true }],
  ["loose", { strict: false }],
  [
    "every option that only reports",
    {
      strict: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noImplicitReturns: true,
      noImplicitOverride: true,
      noFallthroughCasesInSwitch: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      noPropertyAccessFromIndexSignature: true,
      allowUnreachableCode: false,
      allowUnusedLabels: false,
    },
  ],
];

const normalizeWarnings = (stderr: string) =>
  stderr.replace(/^\(node:\d+\)/gm, "(node:pid)").replace(/^\(Use `\S+/gm, "(Use `bun");

function comparable(run: Awaited<ReturnType<typeof spawned>>) {
  const result = told(run);
  return { ...result, stderr: normalizeWarnings(result.stderr) };
}

describe.concurrent("compile/aot/load/every-runtime-module-compiles", () => {
  test.each(optionSets)(
    "tsconfig.json: %s",
    (_name, compilerOptions) =>
      slot(async () => {
        expect(names.length).toBeGreaterThan(70);
        using dir = tempDir("aot-load-every-module", {
          "tsconfig.json": JSON.stringify({ compilerOptions: { ...BASE_OPTIONS, ...compilerOptions } }),
          "main.cjs": MAIN,
        });
        const folder = String(dir);
        const program = join(folder, exe("program"));
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", program],
          folder,
          bunEnv,
        );
        const diagnostics = (built.stdout + built.stderr).split(/\r?\n/).filter(line => /^(error|warn)\b/.test(line));
        expect({ diagnostics, exitCode: built.exitCode, signal: built.signal }).toEqual({
          diagnostics: [],
          exitCode: 0,
          signal: null,
        });
        const reference = await spawned([bunExe(), "run", "main.cjs"], folder, bunEnv);
        expect({ stderr: reference.stderr, exitCode: reference.exitCode }).toEqual({
          stderr: expect.any(String),
          exitCode: 0,
        });
        expect(comparable(await spawned([program], folder, COMPILED))).toEqual(comparable(reference));
      }),
    600_000,
  );
});
