// An object is made, and on a way that seldom runs (a value that its field does not hold, a callee that is not the expected one) it is
// made as a cell. Where that way meets the usual one, the object is only read. The usual way must not make it because of the meeting:
// millions of turns would keep the collector busy.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { built, slot, spawned, told } from "./run-programs";
import { describe, test } from "./supported";

const host = `const plan: number[] = new Array(100).fill(100_000);
export function nextTurns(_check: number): number {
  return plan.shift() ?? 0;
}
`;
const bench = `
function bench(n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum = (sum + turn(i)) | 0;
  return sum;
}
let total = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(total)) total = (total + bench(n)) | 0;
console.log(total);
`;
const turns = (body: string) => 'import { nextTurns } from "./host.ts";\n' + body + bench;
const turnsCountedInSameModule = (body: string) => host.replace("export ", "") + body + bench;
const turnsInLoopOfModule = (body: string) => `${body}
let total = 0;
for (let i = 0; i < 10_000_000; i++) total = (total + turn(i)) | 0;
console.log(total);
`;

// The field z has held integers alone, so a store into it is tested, and the way of any other number stores by name.
const methodWithResult = `class Vec {
  constructor(public x: number, public y: number, public z: number) {}
  minus(o: Vec) { return new Vec(this.x - o.x, this.y - o.y, this.z - o.z); }
  dot(o: Vec) { return this.x * o.x + this.y * o.y + this.z * o.z; }
}
const center = new Vec(0, 0, 5);
function turn(i: number): number {
  const direction = new Vec(((i & 15) - 8) / 16, (((i >> 4) & 15) - 8) / 16, 1);
  const toCenter = new Vec(0, 0, 0).minus(center);
  const a = direction.dot(direction);
  const b = 2 * toCenter.dot(direction);
  const c = toCenter.dot(toCenter) - 4;
  return b * b - 4 * a * c > 0 ? 1 : 0;
}`;

const literalWithMethod = turns(`interface Span { name: string; depth: number; [Symbol.dispose](): void }
let closed = 0;
function open(name: string, depth: number): Span { return { name, depth, [Symbol.dispose]() { closed += this.depth; } }; }
const makers = [open];
function turn(i: number): number { return makers[0]!("a", i).depth; }`);

describe("compile/aot/objects only read behind a meeting with a rare way", () => {
  for (const [title, text, run] of [
    ["the result of a method whose field is stored under a test", turns(methodWithResult), test],
    ["the same where the module counts its own turns", turnsCountedInSameModule(methodWithResult), test.todo],
    ["the same in the loop of the module", turnsInLoopOfModule(methodWithResult), test.todo],
    ["a literal with a method out of a function in a list", literalWithMethod, test],
  ] as const)
    run(title, () =>
      slot(async () => {
        using dir = tempDir("aot-objects-read-behind-a-meeting", { "main.ts": text, "host.ts": host });
        const folder = String(dir);
        const executable = join(folder, "main" + (isWindows ? ".exe" : ""));
        const env = { ...bunEnv, NO_COLOR: "1" };
        built(await spawned([bunExe(), ...compileCommand, "main.ts", "--outfile", executable], folder, env));
        expect(told(await spawned([executable], folder, env))).toEqual(
          told(await spawned([bunExe(), "main.ts"], folder, env)),
        );
        // Ten million objects of 32 bytes were over two hundred collections.
        const logged = await spawned([executable], folder, { ...env, BUN_JSC_logGC: "1" });
        expect(logged.exitCode).toBe(0);
        expect((logged.stdout + logged.stderr).split("\n").filter(line => /GC\b/.test(line)).length).toBeLessThan(20);
      }),
    );
});
