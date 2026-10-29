// Whole packages at work, each held against the instructions a turn that it took when it was pinned (./application-pins.<os>-<arch>.json, which only goes down):
//
//   zod-as-installed       ../typed-packages/measure/programs/zod.ts: an order of 25 items against a schema, with zod as npm ships it
//   zod-from-its-sources   the same program with the TypeScript sources that zod ships (--conditions=@zod/source)
//   typescript             ../servers/typescript-check.ts: the type checker of the typescript package checks one fixed text
//
// ./idioms.test.ts says how instructions are counted and what a turn costs. A row is worse at 2% over its pin: two runs of one Bun differ by 0.02%. On a platform without pins the numbers are printed and not judged:
// ./pins-from-a-log.ts writes the file from the log of such a run.
//
//   TEST_PART=aot/perf/pinned-applications bun test test/aot/parts.test.ts
//   AOT_PERF=lower ..                                 writes every number that got better into the file
//   AOT_PERF=update ..                                rewrites the pinned numbers as measured
//   AOT_SERVERS_MODULES=<node_modules folder> ..      nothing is downloaded
import { afterAll, beforeAll, expect } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isMusl, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { withSteadyCollections } from "../harness/counted-run";
import { run } from "../harness/run";
import { slot, withoutDebugInformation } from "../run-programs";
import { installPackages } from "../servers/run-servers";
import { describe, test } from "../supported";

const pinsPath = join(import.meta.dir, `application-pins.${process.platform}-${process.arch}.json`);
const mode = process.env.AOT_PERF;
const hasPins = existsSync(pinsPath);
const pins: Record<string, number> = hasPins ? JSON.parse(readFileSync(pinsPath, "utf8")) : {};
const measure = join(import.meta.dir, "..", "typed-packages", "measure");

type Row = {
  name: string;
  project: "zod" | "typescript";
  entry: string;
  flags: string[];
  turns: number;
  argumentsFor: (turns: number) => string[];
};
// turns.ts of the measured programs takes: milliseconds and turns of warm-up, windows, milliseconds a window. Turns of warm-up alone are a fixed number of turns.
const orders = (turns: number) => ["valid", "0", String(turns), "0", "0"];
const rows: Row[] = [
  { name: "zod-as-installed", project: "zod", entry: "programs/zod.ts", flags: [], turns: 2000, argumentsFor: orders },
  {
    name: "zod-from-its-sources",
    project: "zod",
    entry: "programs/zod.ts",
    flags: ["--conditions=@zod/source"],
    turns: 2000,
    argumentsFor: orders,
  },
  {
    name: "typescript",
    project: "typescript",
    entry: "typescript-check.ts",
    flags: [],
    turns: 40,
    argumentsFor: turns => [String(turns)],
  },
];

export function pinnedApplications() {
  const skipped =
    isDebug || isASAN
      ? "a debug or ASAN build counts other instructions"
      : isWindows
        ? "it counts with perf_event_open or /usr/bin/time -l"
        : isMusl
          ? "the pins are those of glibc"
          : undefined;
  if (skipped) console.error(`SKIPPED: test/aot/perf/pinned-applications.ts: ${skipped}`);

  describe.skipIf(!!skipped)("compile/aot/perf/pinned-applications", () => {
    if (skipped) return;
    const folders = {
      zod: String(tempDir("aot-pinned-zod", {})),
      typescript: String(tempDir("aot-pinned-typescript", {})),
    };
    const carrier = withoutDebugInformation();
    afterAll(() => {
      for (const folder of Object.values(folders)) rmSync(folder, { recursive: true, force: true });
      if (mode === "lower" || mode === "update") writeFileSync(pinsPath, JSON.stringify(pins, null, 2) + "\n");
    });
    beforeAll(async () => {
      mkdirSync(join(folders.zod, "programs"));
      for (const file of ["programs/zod.ts", "turns.ts", "tsconfig.json"])
        cpSync(join(measure, file), join(folders.zod, file));
      const { zod } = JSON.parse(readFileSync(join(measure, "package.json"), "utf8")).dependencies;
      writeFileSync(
        join(folders.zod, "package.json"),
        JSON.stringify({ name: "pinned", private: true, type: "module", dependencies: { zod } }),
      );
      await installPackages(folders.zod);
      cpSync(
        join(import.meta.dir, "..", "servers", "typescript-check.ts"),
        join(folders.typescript, "typescript-check.ts"),
      );
      mkdirSync(join(folders.typescript, "node_modules"));
      const modules = process.env.AOT_SERVERS_MODULES;
      symlinkSync(
        modules && existsSync(join(modules, "typescript"))
          ? join(modules, "typescript")
          : dirname(require.resolve("typescript/package.json")),
        join(folders.typescript, "node_modules", "typescript"),
      );
    }, 300_000);

    test("every pin names a row", () =>
      expect(Object.keys(pins).filter(name => !rows.some(row => row.name === name))).toEqual([]));
    for (const { name, project, entry, flags, turns, argumentsFor } of rows) {
      test.concurrent(
        name,
        () =>
          slot(async () => {
            const folder = folders[project];
            const executable = join(folder, name);
            const build = await run(
              [bunExe(), "build", "--compile", "--aot", ...carrier, ...flags, `./${entry}`, "--outfile", executable],
              folder,
              bunEnv,
            );
            expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({
              stderr: expect.not.stringMatching(/^error\b/m),
              exitCode: 0,
            });
            const count = async (turns: number) =>
              (
                await measureCommand(folder, [executable, ...argumentsFor(turns)], 300_000, {
                  ...bunEnv,
                  ...withSteadyCollections,
                })
              ).instructions;
            const [short, long] = [await count(turns >> 2), await count(turns)];
            rmSync(executable, { force: true });
            if (short === undefined || long === undefined)
              return void console.error(`SKIPPED: ${name}: instructions cannot be counted here`);
            const now = Math.round((long - short) / (turns - (turns >> 2)));
            const pin = pins[name];
            console.error(`APPLICATION ${name}\t${now}\t| the pin\t${pin}`);
            if (mode === "update") return void (pins[name] = now);
            if (!hasPins) return;
            expect(pin).toBeDefined();
            if (mode === "lower") pins[name] = Math.min(pin, now);
            expect({ isWorse: now > pin * 1.02, now, pin }).toEqual({ isWorse: false, now, pin });
          }),
        900_000,
      );
    }
  });
}
