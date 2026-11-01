// For ./stay-calls-<part>.test.ts: 300 programs take one process six minutes in CI, so each file has a share of them.
// ./operations.measure.ts takes a site's cost as the function with 12 sites less the one with 4, over 8. That holds while the two loops that call them are the same code.
import { expect } from "bun:test";
import { readFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "../harness/commands";
import { afterAll } from "../harness/default-timeout";
import { compileCommand, withProgramOutput } from "../harness/flags";
import { describe, test } from "../harness/printed-ir";
import { python, testaot, toolEnv } from "../shell/tools";

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build takes too long over 300 programs"
    : python
      ? undefined
      : "python3 is not installed";
if (skipped) console.error(`SKIPPED: test/aot/perf/stay-calls.ts: ${skipped}`);

// Only the function with 4 sites promises the type of its result, so the loop round the other one tests it. This list only gets shorter.
const differToday = new Set(["opened: direct_call_string"]);

function operationsOf(printed: string, name: string) {
  const copies = printed.split(/^function /m).filter(text => text.split("\n", 1)[0].includes(` name="${name}" `));
  return copies.map(text => {
    const [heading, ...lines] = text.split("\n");
    const operations = lines.flatMap(line => /^    (?:v\d+: .+? = )?([A-Z]\w*)/.exec(line)?.[1] ?? []);
    return { role: / role=(\w+)/.exec(heading)?.[1], operations };
  });
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
            const loops = [`drive_${name}_4`, `drive_${name}_12`];
            const printed = await spawned(
              [testaot!, "print", program, "--until=InlineHeads", `--aotFunctionToDump=${loops.join("|")}`],
              root,
              toolEnv,
            );
            rmSync(program, { force: true });
            expect({ stderr: printed.stderr, exitCode: printed.exitCode }).toEqual({
              stderr: expect.any(String),
              exitCode: 0,
            });
            const [few, many] = loops.map(loop => operationsOf(printed.stdout.replaceAll("\r\n", "\n"), loop));
            expect(few.flatMap(copy => copy.operations)).toContain("LoopHint");
            if (differToday.has(`${column}: ${name}`)) expect(few).not.toEqual(many);
            else
              expect({ name, loopRoundTheFunctionWith4Sites: few }).toEqual({
                name,
                loopRoundTheFunctionWith4Sites: many,
              });
          }),
        300_000,
      );
  });
