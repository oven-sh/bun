// tally.js of a package has no declaration file. Its loops read `faults` and `value`, or `weight`, off what they step over; nobody has typed that. Its own file writes no object with those names;
// shapes.js, which it imports, writes exactly one record with the first two and one class with the third. In a loop the one layout with all the names is looked for in the own file first and, where that has none,
// in the files that the text of the file names. Outside of loops the own file alone is asked: asked everywhere, the wider sight cost a large application 1.8 G of 281 and bought it nothing.
// (What heft() reads outside of a loop is expected all the same: where the text says nothing, what the program is seen to hand over speaks, behind its test.)
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runTestaot } from "./engine/testaot";
import { without } from "./harness/capabilities";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "node_modules/parcels/package.json": `{ "name": "parcels", "version": "1.0.0", "type": "module" }`,
  "node_modules/parcels/shapes.js": `export function open(value) { return { value, faults: [] }; }
export class Crate { constructor(weight) { this.weight = weight; } }
`,
  "node_modules/parcels/tally.js": `import { open } from "./shapes.js";
export function tally(list) { let sum = 0; for (const one of list) sum += one.faults.length + (one.value === undefined ? 0 : 1); return sum; }
export function weigh(crates) { let sum = 0; for (const crate of crates) sum += crate.weight; return sum; }
export function heft(crate) { return crate.weight; }
export const empty = open(undefined);
`,
  "alone.ts": `import { Crate, open } from "parcels/shapes.js";
import { empty, heft, tally, weigh } from "parcels/tally.js";
const parcels = [open(JSON.parse("1")), open("two"), empty];
const crates = [new Crate(3), new Crate(4)];
(globalThis as any).kept = [heft, tally, weigh, parcels, crates];
console.log(tally(parcels), weigh(crates), heft(crates[0]));
`,
};
async function walkTally(cwd: string, entry: string) {
  const [executable, wire] = [join(cwd, `${entry}.exe`), join(cwd, `${entry}.wire`)];
  const build = [bunExe(), "build", "--compile", "--aot", `--aot-out=${wire}`, entry, "--outfile", executable];
  expect((await run(build, cwd, bunEnv)).exitCode).toBe(0);
  expect((await run([executable], cwd, bunEnv)).stdout.trim()).toBe("2 7 3");
  const places = new Map<string, string>();
  const units = new Map<string, string>();
  const printed = (await runTestaot("print", wire)).lines;
  for (const line of printed) {
    const module = /^module (m\d+) path="[^"]*?([^/"]+\/[^/"]+)"/.exec(line);
    if (module) places.set(module[1], module[2]);
  }
  for (const line of printed) {
    const written =
      /^(?:function|layout) ([fL]\d+) (?:.*?\bname="([^"]*)" )?.*?\bmodule=(m\d+)(?: position=(\d+))?/.exec(line);
    if (!written) continue;
    places.set(written[1], `${written[1][0]}<${places.get(written[3])}:${written[4] ?? ""}>`);
    if (written[1][0] === "f" && places.get(written[3]) === "parcels/tally.js")
      units.set(written[2] ?? "", `${written[1]}:Body`);
  }
  const walked: Record<string, string[]> = {};
  for (const [name, unit] of units)
    walked[name] = (await runTestaot("walk", wire, unit, "exclude=CodeOutsideImage")).lines.map(line =>
      line
        .replace(/ # .*| traits=\[[^\]]*\]/g, "")
        .replace(/\b[Lfmgd]\d+\b/g, number => places.get(number) ?? "#")
        .trimEnd(),
    );
  return walked;
}

test.skipIf(!!without("testaot"))(
  "names read in a loop find the one layout that a file in sight writes",
  async () => {
    using dir = tempDir("aot-names-read-in-a-loop", files);
    const cwd = String(dir);
    const alone = await walkTally(cwd, "alone.ts");
    const namesShapes = (lines: string[]) => lines.filter(line => /\[L<parcels\/shapes\.js:\d+>\]/.test(line)).length;
    expect({
      tally: namesShapes(alone.tally) > 0,
      weigh: namesShapes(alone.weigh) > 0,
    }).toEqual({
      tally: true,
      weigh: true,
    });
  },
  600_000,
);
