// A field that takes a value of another type than it is written with, and then one of its own type again, turn after turn, costs
// little more than a field that is written to take anything.
//
// A field written as a number has a slot for numbers. A text stored through `any` does not fit: the field leaves its slot and lies
// beside the fields. The next number brings it back. Both moves are remembered and repeated, and the way back leaves the object as it
// was before the field left. Where it does not, each turn leaves the object in a state that nothing has seen, no read or store finds
// what an earlier turn found, and a turn takes ten to seventeen times as long.
//
// The twin does the same work on a field written `any`, which never leaves its slot. The text is made a number twice a turn in both.
// The program measures itself with process.cpuUsage(), around the loops alone, so the test needs no counters and runs on every platform.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { describe, test } from "./measures";

const program = (field: string, key: string, setUp: string) => `
  enum Shade { Dim = 1, Warm = 2, Bright = 4 }
  ${setUp}
  class Lamp { ${field}: Shade = Shade.Bright; }
  class Lantern { ${field}: any = Shade.Bright; }
  function glows(lamp: Lamp): boolean { const yes = (lamp${key} & 4) !== 0; lamp${key} |= 2; return yes; }
  function shines(lantern: Lantern): boolean { const yes = (lantern${key} & 4) !== 0; lantern${key} |= 2; return yes; }
  const lamp = new Lamp(), lantern = new Lantern(); (globalThis as any).shelf = [lamp, lantern];
  const name = Reflect.ownKeys(lamp)[0]!;
  const turns = 1_000_000;
  let seen = 0;
  const measured: Record<string, number> = {};
  for (let round = 0; round < 3; round++) {
    let start = process.cpuUsage();
    for (let turn = 0; turn < turns; turn++) { (lamp as any)[name] = "4"; if (glows(lamp)) seen++; }
    let spent = process.cpuUsage(start);
    measured.leaves = Math.min(measured.leaves ?? Infinity, (spent.user + spent.system) / 1000);
    start = process.cpuUsage();
    for (let turn = 0; turn < turns; turn++) { (lantern as any)[name] = "4"; if (shines(lantern)) seen++; }
    spent = process.cpuUsage(start);
    measured.stays = Math.min(measured.stays ?? Infinity, (spent.user + spent.system) / 1000);
  }
  console.log(JSON.stringify({ seen, ...measured }));`;

const programs = {
  "under-a-name": program("shade", ".shade", ""),
  "under-a-symbol": program("[shade]", "[shade]", `const shade = Symbol("shade");`),
};
type Program = keyof typeof programs;

const dir = tempDir(
  "aot-fields-that-come-back",
  Object.fromEntries(Object.entries(programs).map(([name, text]) => [`${name}.ts`, text])),
);
afterAll(() => dir[Symbol.dispose]());
const folder = String(dir);
const pathOf = (name: Program) => join(folder, isWindows ? `${name}.exe` : name);

describe.concurrent("a field that leaves its slot and comes back each turn", () => {
  for (const name of Object.keys(programs) as Program[]) {
    test(
      name,
      async () => {
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", `./${name}.ts`, "--outfile", pathOf(name)],
            folder,
            bunEnv,
          ),
        );
        const ran = await spawned([pathOf(name)], folder, bunEnv, 200_000);
        expect({ stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ stderr: "", exitCode: 0 });
        const { seen, leaves, stays } = JSON.parse(ran.stdout);
        expect(seen).toBe(6_000_000);
        console.error(
          `TURNS ${name}: ${leaves.toFixed(1)} ms where the field leaves and comes back | ${stays.toFixed(1)} ms where it stays`,
        );
        expect(leaves).toBeLessThan(4 * stays + 20);
      },
      480_000,
    );
  }
});
