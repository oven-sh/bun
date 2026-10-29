import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

const exe = (name: string) => name + (isWindows ? ".exe" : "");
const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const withoutTimestamps = (text: string) => text.replace(/^.* - /gm, "");

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
    { stdout: "logged\nend\n" },
  ],
  [
    "--define of a console member",
    ["--define=console.log=console.error"],
    `import { log } from "node:util";
console.log("moved");
log("logged");
`,
    "",
    { stdout: "logged\n", stderr: "moved\n" },
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

type Build = { errors: string[]; warnings: string[]; exitCode: number };

// Neither tree has a tsconfig.json or `@types/bun`.
const programsWithoutBunTypes: [name: string, source: string, build: Build, stdout: string | null][] = [
  [
    "names and modules that Bun provides",
    'import { inspect } from "bun";\nconsole.log(inspect("ran"));\n',
    { errors: [], warnings: [], exitCode: 0 },
    '"ran"\n',
  ],
  [
    "a name that Bun does not provide",
    "console.log(document.title);\n",
    { errors: ["TS2584"], warnings: [], exitCode: 1 },
    null,
  ],
];

describe.concurrent("compile/aot/load/runtime-modules-and-user-flags", () => {
  test.each(cases)(
    "%s",
    (_name, flags, source, argument, expected) =>
      slot(async () => {
        using dir = tempDir("aot-load-user-flags", { "main.mjs": source });
        const folder = String(dir);
        for (const mode of [[], ["--aot"]]) {
          const program = join(folder, exe(mode.length ? "compiled" : "bundled"));
          const built = await spawned(
            [bunExe(), "build", "--compile", ...mode, ...flags, "main.mjs", "--outfile", program],
            folder,
            bunEnv,
          );
          expect({ mode, stdout: built.stdout, stderr: built.stderr, exitCode: built.exitCode }).toEqual({
            mode,
            stdout: expect.any(String),
            stderr: expect.any(String),
            exitCode: 0,
          });
          const ran = await spawned([program, argument], folder, mode.length ? COMPILED : bunEnv);
          expect({
            mode,
            stdout: withoutTimestamps(ran.stdout),
            stderr: ran.stderr,
            exitCode: ran.exitCode,
            signal: ran.signal,
          }).toEqual({ mode, stderr: "", ...expected, exitCode: 0, signal: null });
        }
      }),
    600_000,
  );

  test.each(programsWithoutBunTypes)(
    "without Bun's type declarations: %s",
    (_name, source, build, stdout) =>
      slot(async () => {
        using dir = tempDir("aot-load-user-flags", { "main.ts": source });
        const folder = String(dir);
        const program = join(folder, exe("compiled"));
        const command = [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", program];
        const built = await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" });
        const lines = (built.stdout + built.stderr).split(/\r?\n/);
        const codes = (prefix: string) =>
          lines
            .filter(line => line.startsWith(prefix))
            .map(line => /^TS\d+/.exec(line.slice(prefix.length))?.[0] ?? line)
            .toSorted();
        expect({
          errors: codes("error: "),
          warnings: codes("warn: "),
          exitCode: built.exitCode,
          signal: built.signal,
        }).toEqual({ ...build, signal: null });
        if (stdout === null) return;
        expect(await spawned([program], folder, COMPILED)).toEqual({ stdout, stderr: "", exitCode: 0, signal: null });
      }),
    600_000,
  );
});
