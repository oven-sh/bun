// For ./stay-calls-<part>.measure.ts, which the bench runs and CI does not: 300 programs take one process six minutes, so each file has a share of them.
// ./operations.measure.ts takes a site's cost as the function with 12 sites less the one with 4, over 8. That holds while the two loops that call them are the same code.
import { expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { testaot, toolEnv, whyNoTestaot } from "../engine/testaot";
import { built, slot, spawned } from "../harness/commands";
import { afterAll } from "../harness/default-timeout";
import { compileCommand, withProgramOutput, wordsOfAPlainBuild } from "../harness/flags";
import { describe, test } from "../supported";

const python = Bun.which("python3");
const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build takes too long over 300 programs"
    : python
      ? whyNoTestaot
      : "python3 is not installed";
if (skipped) console.error(`SKIPPED: test/aot/perf/stay-calls.ts: ${skipped}`);

async function printedByTestaot(root: string, ...words: string[]) {
  const { stdout, stderr, exitCode } = await spawned([testaot!, ...words], root, toolEnv);
  expect({ words, stderr, exitCode }).toEqual({ words, stderr: expect.any(String), exitCode: 0 });
  return stdout.replaceAll("\r\n", "\n");
}

/** The units that hold the code of a function as written. `testaot walk` stops at a unit that the plan lacks, and the loop of a coroutine stands in its CoroutineBody. */
function unitsOf(printed: string, name: string) {
  const heading = new RegExp(`^function (f\\d+) name="${name}" .*$`, "m").exec(printed);
  if (!heading) throw new Error(`testaot print shows no function ${name}`);
  const isCoroutine = /\bflags=\[[^\]]*\bIs(?:Async|Generator)\b/.test(heading[0]);
  return (isCoroutine ? ["Body", "CoroutineBody"] : ["Body"]).map(role => `${heading[1]}:${role}`);
}

// A line that is not read stands for itself, so nothing is left out of the comparison.
function operationsOf(codes: string[], unit: string) {
  const code = codes.find(text => text.startsWith(`code ${unit} `));
  if (!code) throw new Error(`testaot walk shows no code of ${unit}`);
  const operations = code
    .split("\n")
    .filter(line => /^ {4}[^ #]/.test(line))
    .map(line => /^ {4}(?:v\d+(?:: .+?)? @\w+ = )?([A-Z]\w*)/.exec(line)?.[1] ?? line);
  return { role: unit.split(":")[1], hasLoop: / isLoopHead=true\b/.test(code), operations };
}

/** Every `parts`-th program, from the `part`-th on. */
export const bothFunctionsStayCalls = (part: number, parts: number) =>
  describe.skipIf(!!skipped)("compile/aot/perf/operations: the loops round both functions are the same code", () => {
    if (skipped) return;
    const root = String(
      tempDir("aot-operations-stay-calls", {
        "tsconfig.json": JSON.stringify({ extends: join(import.meta.dir, "operations", "tsconfig.json") }),
      }),
    );
    afterAll(() => rmSync(root, { recursive: true, force: true }));
    const generated = Bun.spawnSync({
      cmd: [python!, join(import.meta.dir, "operations", "generate.py"), root],
      env: bunEnv,
      stdout: "ignore",
      stderr: "pipe",
    });
    if (generated.exitCode !== 0) throw new Error(`generate.py ended with ${generated.exitCode}:\n${generated.stderr}`);
    const rows = readFileSync(join(root, "rows.tsv"), "utf8")
      .split("\n")
      .map(line => line.split("\t"))
      .filter(fields => fields[4] === "1")
      .map(fields => fields[0]);

    const programs = ["alone", "opened"].flatMap(column => rows.map(name => [column, name] as const));
    for (const [column, name] of programs.filter((_, index) => index % parts === part - 1))
      test.concurrent(
        `${column}: ${name}`,
        () =>
          slot(async () => {
            const program = join(root, `${column}-${name}.aot`);
            built(
              await spawned(
                [
                  bunExe(),
                  ...compileCommand,
                  withProgramOutput(program),
                  "--aot-testing=NoExecutable",
                  join(root, column, `${name}.ts`),
                  "--outfile",
                  `${program}.executable`,
                ],
                root,
                bunEnv,
              ),
            );
            try {
              const printed = await printedByTestaot(root, "print", program);
              const loops = [`drive_${name}_4`, `drive_${name}_12`].map(loop => unitsOf(printed, loop));
              // The file of a program holds no options.
              const walked = await printedByTestaot(root, "walk", program, ...loops.flat(), ...wordsOfAPlainBuild);
              const codes = walked.split(/^(?=code )/m);
              const [few, many] = loops.map(units => units.map(unit => operationsOf(codes, unit)));
              expect(few.map(unit => unit.hasLoop)).toContain(true);
              expect({ name, loopRoundTheFunctionWith4Sites: few }).toEqual({
                name,
                loopRoundTheFunctionWith4Sites: many,
              });
            } finally {
              rmSync(program, { force: true });
            }
          }),
        300_000,
      );
  });
