// A loop costs the same wherever it stands. ./loops-at-the-top-level/loops.txt holds small programs, one under each line `//// <name>`: what is set up, then, under
// `//// in every turn`, the body of a loop over `i` that adds to `sum`. Each is built twice: with the loop at the top level of the module, the way a first benchmark is
// written, and with the same loop in `function main() { .. }` that is called once. The first may take 2% and one instruction more per turn than the second.
// Nothing is pinned: both are built by the same Bun, as TypeScript and with the types erased. No clock, the same at any load.
import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { measureCommand } from "../analysis-scaling/measure-check";
import { built, slot, spawned, withoutDebugInformation } from "../harness/commands";
import { withSteadyCollections } from "../harness/counted-run";
import { describe, test } from "../supported";

const root = join(import.meta.dir, "loops-at-the-top-level");
const [few, many] = [100_000, 400_000];

// What is further apart today, with what was last measured: at the top level | in main().
const today: Record<string, string> = {
  "a-list-that-is-filled-and-summed, typed": "85 | 58",
  "a-list-that-is-filled-and-summed, untyped": "81 | 56",
  "arithmetic-on-numbers-out-of-a-function, typed": "107 | 104",
};

const indented = (text: string) => text.replace(/^(?=.)/gm, "  ");
const [, ...sections] = readFileSync(join(root, "loops.txt"), "utf8").split(/^\/\/\/\/ (?!in every turn$)/m);
const programs = sections.map(section => {
  const end = section.indexOf("\n");
  const [setUp, turn] = section.slice(end + 1).split("//// in every turn\n");
  const head = `const turns = Number(process.argv[2] ?? 1000);\n${setUp}`;
  const loop = `let sum = 0;\nfor (let i = 0; i < turns; i++) {\n${turn}}\nconsole.log(sum);\n`;
  return {
    name: section.slice(0, end).trim(),
    atTheTopLevel: head + loop,
    inMain: `${head}function main() {\n${indented(loop)}}\nmain();\n`,
  };
});

const skipped =
  isDebug || isASAN
    ? "a debug or ASAN build counts other instructions"
    : isWindows
      ? "it counts with perf_event_open or /usr/bin/time -l"
      : undefined;
if (skipped) console.error(`SKIPPED: test/aot/perf/loops-at-the-top-level.test.ts: ${skipped}`);

describe.skipIf(!!skipped)("compile/aot/perf/loops-at-the-top-level", () => {
  const folder = String(tempDir("aot-loops-at-the-top-level", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const env = { ...bunEnv, ...withSteadyCollections };

  async function costOf(file: string, text: string, flags: string[]) {
    const source = join(folder, `${file}.ts`);
    const executable = join(folder, [file, ...flags].join(""));
    writeFileSync(source, text);
    built(
      await spawned(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          ...flags,
          ...withoutDebugInformation(),
          source,
          "--outfile",
          executable,
        ],
        folder,
        bunEnv,
      ),
    );
    const compiled = await spawned([executable], folder, bunEnv);
    const plain = await spawned([bunExe(), "run", source], folder, bunEnv);
    expect(compiled.stdout).toBe(plain.stdout);
    const less = await measureCommand(folder, [executable, String(few)], 300_000, env);
    const more = await measureCommand(folder, [executable, String(many)], 300_000, env);
    if (less.instructions === undefined || more.instructions === undefined) return undefined;
    return Math.round(((more.instructions - less.instructions) / (many - few)) * 10) / 10;
  }

  for (const { name, atTheTopLevel, inMain } of programs) {
    for (const [form, flags] of [
      ["typed", []],
      ["untyped", ["--aot-erase-types"]],
    ] as const) {
      const title = `${name}, ${form}`;
      (today[title] ? test.todo : test.concurrent)(
        today[title] ? `${title}: ${today[title]}` : title,
        () =>
          slot(async () => {
            const [top, main] = [
              await costOf(`${name}.${form}.top`, atTheTopLevel, [...flags]),
              await costOf(`${name}.${form}.main`, inMain, [...flags]),
            ];
            if (top === undefined || main === undefined)
              return void console.error(`SKIPPED: ${title}: instructions cannot be counted here`);
            console.error(`LOOPS AT THE TOP LEVEL ${title}\t${top}\t| in main()\t${main}`);
            expect({ top, main, isAsFast: top <= main * 1.02 + 1 }).toEqual({ top, main, isAsFast: true });
          }),
        900_000,
      );
    }
  }
});
