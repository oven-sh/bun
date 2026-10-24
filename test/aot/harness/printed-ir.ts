// The IR of a build, as text. No Bun prints IR. Every Bun writes the program that its front end hands to the engine
// (`--aot-out=<file>`), and `testaot`, built from the same engine and packed beside Bun, runs the same passes over it and prints.
// shell/tools.ts says where testaot is looked for.
//
// `test` and `describe` are those of ../supported.ts, and skip where there is no testaot either.
import { describe as describeAnywhere, expect, test as testAnywhere } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "../run-programs";
import { testaot, toolEnv } from "../shell/tools";
import { alwaysSkipped, unsupported } from "../supported";
import { compileCommand, withProgramOutput } from "./flags";

const programFile = "program.aot";

// The program names built-ins by their numbers in the table that Bun was linked with, so a testaot with another table refuses it.
function whyTestaotCannotRead(): string | undefined {
  using dir = tempDir("aot-printed-ir", { "one.ts": "console.log(1);" });
  const cwd = String(dir);
  const options = { cwd, stdout: "ignore", stderr: "pipe" } as const;
  const cmd = [bunExe(), ...compileCommand, withProgramOutput(programFile), "one.ts", "--outfile", "one"];
  const build = Bun.spawnSync({ cmd, env: bunEnv, ...options });
  if (build.exitCode !== 0) return `the Bun under test does not write a program: ${build.stderr.toString().trim()}`;
  const print = Bun.spawnSync({ cmd: [testaot!, "print", programFile], env: toolEnv, ...options });
  return print.exitCode === 0
    ? undefined
    : `${testaot} does not read what the Bun under test writes: ${print.stderr.toString().trim()}`;
}

const whySkipped =
  unsupported ??
  (testaot
    ? whyTestaotCannotRead()
    : "there is no testaot: not in $TESTAOT, not beside the Bun under test, not in build/release-local or build/release");
if (!unsupported && whySkipped) console.error(`SKIPPED: the tests that read IR: ${whySkipped}`);

export const test = whySkipped ? alwaysSkipped(testAnywhere.skip) : testAnywhere;
export const describe = whySkipped ? alwaysSkipped(describeAnywhere.skip) : describeAnywhere;

/** For the command line of the build whose IR `printIR` is asked for, with the same folder. */
export const writesProgramInto = (folder: string) => withProgramOutput(join(folder, programFile));

export interface PrintedIR {
  /** The IR behind this pass. `Select` is the last one in front of the form `Selected`. */
  until: string;
  /** As BUN_JSC_aotFunctionToDump: a name, several with `|` between them, or an id such as f0. Every function if there is none. */
  functionName?: string;
  /** The `--aot-<word>` flags of the build that the engine reads. */
  flags?: string[];
}

export async function printIR(folder: string, { until, functionName, flags = [] }: PrintedIR): Promise<string> {
  const printed = await spawned(
    [
      testaot!,
      "print",
      programFile,
      `--until=${until}`,
      ...(functionName === undefined ? [] : [`--aotFunctionToDump=${functionName}`]),
      ...flags.map(flag => flag.replace(/^--aot-/, "")),
    ],
    folder,
    toolEnv,
  );
  expect({ stderr: printed.stderr, exitCode: printed.exitCode, signal: printed.signal }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
    signal: null,
  });
  // testaot prints through C's stdout, which translates line ends on Windows.
  return printed.stdout.replaceAll("\r\n", "\n");
}
