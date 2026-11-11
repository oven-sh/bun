import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, normalizeBunSnapshot, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "../harness/commands";
import { describe, test } from "../supported";

const exe = (name: string) => name + (isWindows ? ".exe" : "");
const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
// With a sanitizer or in a debug build Bun is half a gigabyte or more, and an executable is a copy of it. No test here asks anything of the file that a build writes.
// So there, on Linux, a build with --aot writes the program without the copy (../harness/program-alone.ts), as the builds of the stored programs do (../run-parallel.ts).
// AOT_REAL_EXECUTABLES=1 asks for the executables.
const BUILD =
  isLinux && (isASAN || isDebug) && !process.env.AOT_REAL_EXECUTABLES
    ? { ...bunEnv, BUN_AOT_WRITES_PROGRAM_ALONE: "1" }
    : bunEnv;
// log() of node:util begins its line with the day, the month and the time.
const withoutTimestamps = (text: string) =>
  text.replace(/^\d{1,2} [A-Z][a-z]{2} \d{2}:\d{2}:\d{2} - /gm, "<timestamp> - ");

type Ended = Awaited<ReturnType<typeof spawned>>;

/** A build that succeeds reports no mistake and makes no remark, and writes nothing to stderr. */
function expectBuilt(built: Ended) {
  const diagnostics = (built.stdout + built.stderr).split(/\r?\n/).filter(line => /^(error|warn|note)\b/.test(line));
  // With AOT_BUILD_FLAGS every build takes developer options, and a build names those that it took.
  const stderr = built.stderr.replace(/^Built with developer options: .*\r?\n/, "");
  expect({ diagnostics, stderr, exitCode: built.exitCode, signal: built.signal }).toEqual({
    diagnostics: [],
    stderr: "",
    exitCode: 0,
    signal: null,
  });
}

type Output = { stdout: string; stderr?: string };

const cases: [name: string, flags: string[], source: string, argument: string, expected: Output][] = [
  [
    "--drop=console",
    ["--drop=console"],
    `import { log } from "node:util";
console.log("dropped");
log("logged");
process.stdout.write("end\\n");
`,
    "",
    { stdout: "<timestamp> - logged\nend\n" },
  ],
  [
    "--define of a console member",
    ["--define=console.log=console.error"],
    `import { log } from "node:util";
console.log("moved");
log("logged");
`,
    "",
    { stdout: "<timestamp> - logged\n", stderr: "moved\n" },
  ],
  [
    "--define of a name the runtime also defines",
    ['--define=process.platform="plan9"'],
    `import os from "node:os";
console.log(process.platform, os.platform() === process.argv[2]);
`,
    process.platform,
    { stdout: "plan9 true\n" },
  ],
  [
    "--feature",
    ["--feature=ON"],
    `import { feature } from "bun:bundle";
import { format } from "node:util";
console.log(format("%s %s", feature("ON") ? "on" : "off", feature("OFF") ? "on" : "off"));
`,
    "",
    { stdout: "on off\n" },
  ],
  [
    "runtime defines do not fold in the program",
    [],
    "console.log(typeof IS_BUN_DEVELOPMENT);\n",
    "",
    { stdout: "undefined\n" },
  ],
];

const modes: [name: string, flags: string[], env: typeof bunEnv][] = [
  ["bundled", [], bunEnv],
  ["compiled", ["--aot"], COMPILED],
];

// Neither tree has a tsconfig.json or `@types/bun`.
const programsWithoutBunTypes: [name: string, source: string, ends: { stdout: string } | { refused: string }][] = [
  [
    "names and modules that Bun provides",
    'import { inspect } from "bun";\nconsole.log(inspect("ran"));\n',
    { stdout: '"ran"\n' },
  ],
  [
    "a name that nothing provides",
    "console.log(neverDeclared.title);\n",
    {
      refused: `1 | console.log(neverDeclared.title);
                ^
error: TS2304: Cannot find name 'neverDeclared'.
    at <dir>/main.ts:1:13`,
    },
  ],
];

const smallModules = ["node:events", "node:os", "node:punycode", "node:querystring", "node:string_decoder"];
const optionSets: [name: string, compilerOptions: Record<string, boolean>][] = [
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

describe.concurrent("compile/aot/load/runtime-modules-and-user-flags", () => {
  test.each(optionSets)(
    "the tsconfig.json of the program says nothing about Bun's modules: %s",
    (_name, compilerOptions) =>
      slot(async () => {
        using dir = tempDir("aot-load-user-flags", {
          "tsconfig.json": JSON.stringify({
            compilerOptions: {
              target: "ESNext",
              module: "Preserve",
              moduleResolution: "bundler",
              noEmit: true,
              types: [],
              allowJs: true,
              ...compilerOptions,
            },
          }),
          "main.cjs": `console.log([${smallModules.map(name => `typeof require("${name}")`).join(", ")}].join());\n`,
        });
        const folder = String(dir);
        const program = join(folder, exe("program"));
        expectBuilt(
          await spawned([bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", program], folder, BUILD),
        );
        expect(await spawned([program], folder, COMPILED)).toEqual({
          stdout: "function,object,object,object,object\n",
          stderr: "",
          exitCode: 0,
          signal: null,
        });
      }),
    600_000,
  );

  describe.each(cases)("%s", (_name, flags, source, argument, expected) => {
    test.each(modes)(
      "%s",
      (mode, modeFlags, env) =>
        slot(async () => {
          using dir = tempDir("aot-load-user-flags", { "main.mjs": source });
          const folder = String(dir);
          const program = join(folder, exe(mode));
          expectBuilt(
            await spawned(
              [bunExe(), "build", "--compile", ...modeFlags, ...flags, "main.mjs", "--outfile", program],
              folder,
              BUILD,
            ),
          );
          const ran = await spawned([program, argument], folder, env);
          expect({ ...ran, stdout: withoutTimestamps(ran.stdout) }).toEqual({
            stderr: "",
            ...expected,
            exitCode: 0,
            signal: null,
          });
        }),
      600_000,
    );
  });

  test.each(programsWithoutBunTypes)(
    "without Bun's type declarations: %s",
    (_name, source, ends) =>
      slot(async () => {
        using dir = tempDir("aot-load-user-flags", { "main.ts": source });
        const folder = String(dir);
        const program = join(folder, exe("compiled"));
        // Without --check no build looks for a name that nobody declares: build-gate.test.ts.
        const command = [bunExe(), "build", "--compile", "--aot", "--check", "main.ts", "--outfile", program];
        const built = await spawned(command, folder, { ...BUILD, NO_COLOR: "1" });
        if ("refused" in ends) {
          expect({
            stdout: built.stdout,
            stderr: normalizeBunSnapshot(built.stderr, folder),
            exitCode: built.exitCode,
            signal: built.signal,
            wroteExecutable: existsSync(program),
          }).toEqual({ stdout: "", stderr: ends.refused, exitCode: 1, signal: null, wroteExecutable: false });
          return;
        }
        expectBuilt(built);
        expect(await spawned([program], folder, COMPILED)).toEqual({
          stdout: ends.stdout,
          stderr: "",
          exitCode: 0,
          signal: null,
        });
      }),
    600_000,
  );
});
