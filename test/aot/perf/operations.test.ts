// What ONE OPERATION of the language costs in compiled code: a field read, a store, a call, a closure made, a string compared .. : the rows of ./operations/generate.py.
//
// One method for every row (./operations/generate.py writes the programs into a temporary folder when this file starts, and the same rows in Go and C++ for whoever wants to compare): a function with 12 sites of the operation and
// one with 4, the same but for the number of sites; a site's result is the next site's operand, and nothing the rows work on is a constant of the program text.
//
//   instructions a site = (executed by N calls of the function with 12 sites - executed by N calls of the one with 4) / (8 N)
//
// each as the difference of a run with many calls and a run with few, so that start-up cancels out. Instructions are counted in user mode around the whole process: no clock, the same at any load.
//
// Every row is counted twice. `alone`: the whole program is in sight, and the compiler may prove what the values are. `opened`: the same texts, but every object, array, closure and
// string that the row works on has been handed once to text that is evaluated at run time, and has come back: nothing is left but the written types, which is the state of most accesses of a large program.
// Held against ./operations.<os>-<arch>.json and ./operations-opened.<os>-<arch>.json, which only go down:
//
//   bun test test/aot/perf/operations.test.ts                   fails if a site takes more than 10% AND more than 1 instruction more than its pin
//   AOT_PERF=lower bun test test/aot/perf/operations.test.ts    writes every number that got better into the file
//   AOT_PERF=update ..                                          rewrites the pinned numbers as measured
//   AOT_PERF_ONLY='^field_' ..                                  only the rows whose name matches the regular expression
import { afterAll, expect } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isMusl, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { slot, spawned, withoutDebugInformation } from "../run-programs";
import { describe, test } from "../supported";

const python = Bun.which("python3");
const root = String(
  tempDir("aot-operations", {
    "tsconfig.json": JSON.stringify({ extends: join(import.meta.dir, "operations", "tsconfig.json") }),
  }),
);
afterAll(() => rmSync(root, { recursive: true, force: true }));
if (python) {
  const generated = Bun.spawnSync({
    cmd: [python, join(import.meta.dir, "operations", "generate.py"), root],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  if (generated.exitCode !== 0) throw new Error(`generate.py ended with ${generated.exitCode}:\n${generated.stderr}`);
}
const mode = process.env.AOT_PERF;
const columns = [
  {
    title: "compile/aot/perf/operations",
    programs: "alone",
    pinsPath: join(import.meta.dir, `operations.${process.platform}-${process.arch}.json`),
  },
  {
    title: "compile/aot/perf/operations/opened",
    programs: "opened",
    pinsPath: join(import.meta.dir, `operations-opened.${process.platform}-${process.arch}.json`),
  },
];

const rows = (python ? readFileSync(join(root, "rows.tsv"), "utf8") : "")
  .split("\n")
  .filter(line => line !== "")
  .map(line => line.split("\t"))
  // name, group, the row whose cost is contained in this one, does a site take long, is it written in TypeScript | Go | C++, .., what it is
  .filter(fields => fields[4] === "1")
  .map(fields => ({ name: fields[0], isHeavy: fields[3] === "1", what: fields.at(-1)! }))
  .filter(row => new RegExp(process.env.AOT_PERF_ONLY ?? "").test(row.name));

const isWorse = (now: number, pin: number) => now > pin * 1.1 && now > pin + 1;

for (const { title, programs, pinsPath } of columns) {
  const pins: Record<string, number> = existsSync(pinsPath) ? JSON.parse(readFileSync(pinsPath, "utf8")) : {};
  const skipped =
    isDebug || isASAN
      ? "a debug or ASAN build counts other instructions"
      : isWindows
        ? "it counts with perf_event_open or /usr/bin/time -l"
        : isMusl
          ? "the pins are those of glibc"
          : !python
            ? "python3 is not installed"
            : !existsSync(pinsPath) && mode !== "update"
              ? `there is no ${pinsPath}`
              : undefined;
  if (skipped) console.error(`SKIPPED: test/aot/perf/operations.test.ts: ${programs}: ${skipped}`);

  describe.skipIf(!!skipped)(title, () => {
    const folder = String(tempDir(`aot-operations-${programs}`, {}));
    const carrier = skipped ? [] : withoutDebugInformation();
    afterAll(() => {
      rmSync(folder, { recursive: true, force: true });
      if (mode === "update" || mode === "lower")
        writeFileSync(
          pinsPath,
          JSON.stringify(Object.fromEntries(Object.entries(pins).sort(([a], [b]) => (a < b ? -1 : 1))), null, 2) + "\n",
        );
    });

    for (const { name, isHeavy, what } of rows) {
      test.concurrent(
        `${name}: ${what}`,
        () =>
          slot(async () => {
            const source = join(root, programs, `${name}.ts`);
            const executable = join(folder, name);
            const build = await spawned(
              [bunExe(), "build", "--compile", "--aot", ...carrier, source, "--outfile", executable],
              root,
              bunEnv,
            );
            expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
              stderr: expect.not.stringMatching(/^error\b/m),
              exitCode: 0,
            });
            const [few, many] = isHeavy ? [1000, 21000] : [1000, 401000];
            const operands = (sites: number, calls: number) => [
              `${name}_${sites}`,
              String(calls),
              "2",
              "lit_zz",
              "DELETE",
              "PATCH",
            ];
            const env = { ...bunEnv, ...withSteadyCollections };
            try {
              const costs: Record<string, number | undefined> = {};
              for (const sites of [4, 12]) {
                for (const calls of [few, many]) {
                  const run = await measureCommand(root, [executable, ...operands(sites, calls)], 300_000, env);
                  costs[`${sites} ${calls}`] = run.instructions;
                  if (calls !== few) continue;
                  const plain = await spawned([bunExe(), "run", source, ...operands(sites, calls)], root, bunEnv);
                  expect({ sites, printed: run.stdout }).toEqual({ sites, printed: plain.stdout });
                  expect(run.stdout).toStartWith(name);
                }
              }
              if (Object.values(costs).includes(undefined))
                return void console.error(`SKIPPED: ${name}: instructions cannot be counted here`);
              const calls = many - few;
              const now =
                Math.round(
                  ((costs[`12 ${many}`]! - costs[`12 ${few}`]! - (costs[`4 ${many}`]! - costs[`4 ${few}`]!)) /
                    8 /
                    calls) *
                    10,
                ) / 10;
              const pin = pins[name];
              console.error(
                `OPERATION ${programs === "alone" ? "" : programs + " "}${name}\t${now}\t| the pin\t${pin}`,
              );
              if (mode === "update") return void (pins[name] = now);
              expect(pin).toBeDefined();
              if (mode === "lower") pins[name] = Math.min(pin, now);
              expect({ name, instructionsASite: now, isWorse: isWorse(now, pin), pin }).toEqual({
                name,
                instructionsASite: now,
                isWorse: false,
                pin,
              });
            } finally {
              rmSync(executable, { force: true });
            }
          }),
        900_000,
      );
    }
  });
}
