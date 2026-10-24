import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported-with-counted-calls";

// A member that a `const` symbol names is a field of the layout like a member under a name: of a class that declares it, and of a
// function that stores it into `this`. Making the object, reading the field and storing into it ask the run time for nothing.
const files = {
  "keys.ts": `
    export const kMass = Symbol("mass");
    export const kLabel = Symbol("label");
  `,
  "main.ts": `
    import { kMass, kLabel } from "./keys";
    declare const process: { argv: string[] };
    declare const console: { log(...values: any[]): void };
    class Planet {
      [kMass]: number;
      [kLabel]: string;
      constructor(mass: number, label: string) {
        this[kMass] = mass;
        this[kLabel] = label;
      }
    }
    interface Moon {
      [kMass]: number;
      [kLabel]: string;
    }
    function Moon(this: Moon, mass: number, label: string) {
      this[kMass] = mass;
      this[kLabel] = label;
    }
    function massOf(body: Planet | Moon): number {
      return body[kMass];
    }
    function labelOf(body: Planet | Moon): string {
      return body[kLabel];
    }
    function grow(body: Planet | Moon) {
      body[kMass] += 1;
    }
    const rounds = Number(process.argv[2]);
    const kept: (Planet | Moon)[] = [];
    let total = 0;
    let letters = 0;
    for (let round = 0; round < rounds; round++) {
      kept[round & 7] = new Planet(round, "p");
      kept[(round + 1) & 7] = new (Moon as any)(round, "mm");
      grow(kept[round & 7]);
      grow(kept[(round + 1) & 7]);
      total += massOf(kept[round & 7]) + massOf(kept[(round + 1) & 7]);
      letters += labelOf(kept[round & 7]).length + labelOf(kept[(round + 1) & 7]).length;
    }
    console.log(total === rounds * (rounds + 1), letters === 3 * rounds, Object.getOwnPropertySymbols(kept[0]).length, Object.keys(kept[1]).length);
  `,
};

const operations = [
  "operationAOTCreateThis",
  "operationAOTGetById",
  "operationAOTGetByIdAndCache",
  "operationAOTPutById",
  "operationAOTPutByIdAndCache",
  "operationAOTDidCreateField",
  "operationAOTDidCreateFieldAt",
  "operationAOTDidCreateFieldOutOfLineAt",
  "operationAOTDidCreateFieldsAt",
];

test("objects with fields under symbols are made, read and stored into without the run time", async () => {
  using directory = tempDir("aot-fields-under-symbols", files);
  const cwd = String(directory);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "--explain=statistics", "main.ts", "--outfile", executable],
    cwd,
    bunEnv,
  );
  expect(built.exitCode).toBe(0);
  // Both layouts have their two fields from the start: the analysis of the program finds none to add. Without a field a function that stores nothing else into `this` has no layout at all.
  const statistic = (name: string) =>
    Number(new RegExp("^" + name + " (\\d+)$", "m").exec(built.stdout + built.stderr)?.[1]);
  expect({ FlowAppendedFields: statistic("FlowAppendedFields"), Slots: statistic("Slots") }).toEqual({
    FlowAppendedFields: 0,
    Slots: 4,
  });

  const counted = async (rounds: number) => {
    const path = join(cwd, "counts" + rounds);
    const env = { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path };
    expect(await run([executable, String(rounds)], cwd, env)).toEqual({
      stdout: "true true 2 0\n",
      stderr: "",
      exitCode: 0,
    });
    const counts: Record<string, number> = {};
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const [count, name] = line.split("\toperation:");
      if (name !== undefined) counts[name] = Number(count);
    }
    return counts;
  };
  const few = await counted(500);
  const many = await counted(2500);
  // The file lists the operations that ran, and a program that starts runs some. An empty list would say that nothing is counted any more.
  expect(Object.keys(few).length).toBeGreaterThan(0);
  const growth = (name: string) => (many[name] ?? 0) - (few[name] ?? 0);
  const more = Object.fromEntries(operations.map(name => [name, growth(name) > 200 ? growth(name) : "level"]));
  expect(more).toEqual(Object.fromEntries(operations.map(name => [name, "level"])));
}, 240_000);
