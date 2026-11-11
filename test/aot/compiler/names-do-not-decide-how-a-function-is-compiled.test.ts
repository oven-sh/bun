// What a file or a variable is called does not decide how a function is compiled.
//
// The effects of an operation are masks of 64 bits a heap, and each variable of a module and each layout has one bit there. Two that share a bit count as
// one: a store into the one ends what is known of the other. The bit was drawn from a hash over the path of the file and the name of the record, so one
// pair in 64 met, by their names: the loop below was built a second time for its bound in `h-bound.ts` and not in a copy called `w01-h-bound.ts`, where
// `bound` and `seen` drew the same bit.
//
//   the place       the front end counts each variable and each environment in the source of its file, before anything is left out; the bit follows it
//   the file        the same text under two names compiles to the same operations
//   a variable      the same text with one variable under another name compiles to the same operations
//   another file    what another file imports leaves out a function, and the variables behind it keep their places
import { expect } from "bun:test";
import { tempDir } from "harness";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "../engine/testaot";
import { afterAll } from "../harness/default-timeout";
import { withProgramOutput } from "../harness/flags";
import { describe, test } from "../supported";
import { build } from "./measure";

const timeLimit = 600_000;

const loopWithABoundThatAGetterMoves = `
class Box { constructor(public v: number) {} }
let bound = 0, seen = 0, target = 0;
const trap: any = {};
Object.defineProperty(trap, "v", { get() { bound = target; return 1; } });
function run(boxes: Box[]): string {
  const k = boxes[0]; let sum = 0, hits = 0;
  for (let i = 0; i < bound; i++) { seen++; sum += i & 7; if (boxes[i & 3].v === k.v) hits++; }
  return sum + " " + hits;
}
const boxes: Box[] = [new Box(1), new Box(2), trap, new Box(3)];
for (const [from, to] of [[12, 5], [3, 7], [12, 2.5]]) { bound = from; target = to; seen = 0; const told = run(boxes); console.log(told, seen, bound); }
`;

const library = `
let v0 = 0, v1 = 1; let v2 = 2; let v3 = 3, v4 = 4, v5 = 5;
export function f(n: number) { v1 += n; v4 += v1; const inner = () => v1 + n; return inner(); }
export function g(n: number) { v0 += n; v2 += v0; v3 += v2; v5 += v3; const inner = () => v0 + n; return inner(); }
`;

describe("compile/aot/names-do-not-decide-how-a-function-is-compiled", () => {
  const root = String(tempDir("aot-names-do-not-decide", {}));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let numberOfPrograms = 0;

  async function wireOf(files: Record<string, string>, entry: string) {
    const folder = join(root, `program-${++numberOfPrograms}`);
    mkdirSync(folder);
    for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
    const wire = join(folder, "program.ir");
    await build({ folder, entry: `./${entry}` }, [withProgramOutput(wire)]);
    return wire;
  }

  async function printed(command: string, wire: string, ...words: string[]) {
    const { lines, exitCode } = await run(command, wire, ...words, "threads=1", "mechanisms=all");
    expect(exitCode).toBe(0);
    return lines;
  }

  async function compiled(file: string, text: string, called: string) {
    const wire = await wireOf({ [file]: text }, file);
    const statistic = "InvariantNumberGuardsHoisted";
    const counted = await printed("compile", wire, `--output=${wire}.image`, statistic);
    return {
      boundsAskedInFront: counted.find(line => line.startsWith(`statistic ${statistic} `))?.split(" ")[2],
      operations: (await printed("walk", wire))
        .map(line => line.replaceAll(called, "NAME").replace(/ @\d+| callPosition=\d+/g, ""))
        .join("\n"),
    };
  }

  test(
    "the same text under two names of the file",
    async () => {
      const one = await compiled("h-bound.ts", loopWithABoundThatAGetterMoves, "h-bound");
      const other = await compiled("w01-h-bound.ts", loopWithABoundThatAGetterMoves, "w01-h-bound");
      expect(one.boundsAskedInFront).toBe("1");
      expect(other).toEqual(one);
    },
    timeLimit,
  );

  test(
    "the same text with one variable under another name",
    async () => {
      const one = await compiled("a.ts", loopWithABoundThatAGetterMoves, '"seen"');
      const other = await compiled("a.ts", loopWithABoundThatAGetterMoves.replaceAll("seen", "s11"), '"s11"');
      expect(one.boundsAskedInFront).toBe("1");
      expect(other).toEqual(one);
    },
    timeLimit,
  );

  test(
    "a function that no file imports is left out, and the variables behind it keep their places",
    async () => {
      const placesIn = async (entry: string) => {
        const lines = await printed("print", await wireOf({ "lib.ts": library, "entry.ts": entry }, "entry.ts"));
        const module = lines.find(line => /^module m\d+ .*displayPath="lib\.ts"/.test(line))!.split(" ")[1];
        const ofLibrary = lines.filter(line => line.startsWith("variable ") && line.includes(` module=${module} `));
        return new Map(
          ofLibrary.map(line => [/ name="([^"]*)"/.exec(line)?.[1] ?? "", / place=(\d+)/.exec(line)?.[1]]),
        );
      };
      const alone = await placesIn(`import { f } from "./lib"; console.log(f(process.argv.length));`);
      const both = await placesIn(`import { f, g } from "./lib"; console.log(f(process.argv.length), g(2));`);
      expect(alone.has("g")).toBe(false);
      expect(both.has("g")).toBe(true);
      expect(new Set(both.values()).size).toBe(both.size);
      for (const [name, place] of alone) expect({ name, place }).toEqual({ name, place: both.get(name) });
    },
    timeLimit,
  );
});
