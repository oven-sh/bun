// A layout goes by the names of its members. The promise of an int32 goes by the type that a literal is written for.
// Each literal holds an expression of its own, so the expressions that the errors name say which literals were refused.
import { afterAll, expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { spawned, withoutDebugInformation } from "./harness/commands";
import { describe, test } from "./supported";

const head = `import type { int32 } from "bun";
interface Point { x: int32; y: int32 }
function first(point: Point): int32 { return point.x; }
const given: number[] = JSON.parse("[5, 2.5]");
`;

const programs: Record<string, { text: string; refused: string[] }> = {
  "beside the same names as numbers": {
    refused: ["0.5", "n / 2", "n / 3"],
    text: `
type Other = { x: number; y: number };
function sum(other: Other): number { return other.x + other.y; }
function declared(n: number): int32 { const point: Point = { x: n / 2, y: 2 }; return first(point); }
function handedOver(n: number): int32 { return first({ x: n / 3, y: 2 }); }
function ofConstants(): int32 { const point: Point = { x: 0.5, y: 2 }; return first(point); }
function ofTheOther(n: number): number { return sum({ x: n / 4, y: 1.5 }) + sum({ x: 0.25, y: 1.5 }); }
console.log(declared(given[0]!), handedOver(given[0]!), ofConstants(), ofTheOther(given[0]!));
`,
  },
  "objects that never leave whole": {
    refused: [],
    text: `
function read(n: number): number { const local = { x: n / 2, y: 2 }; return local.x + local.y; }
function readInAClosure(n: number): number { const local = { x: n / 3, y: 2 }; const sum = () => local.x + local.y; return sum(); }
function stored(n: number): number { const local = { x: n / 4, y: 2 }; local.x = n / 8; local.y += 0.5; return local.x + local.y; }
function asked(n: number): boolean { const local = { x: n / 5, y: 2 }; return "x" in local; }
function underAKey(n: number, key: "x" | "y"): number { const local = { x: n / 6, y: 2 }; return local[key]; }
function takenApart(n: number): number { const local = { x: n / 7, y: 2 }; const { x, y } = local; return x + y; }
function deleted(n: number): boolean { const local = { x: n / 9, y: 2 }; delete local.x; return "x" in local; }
console.log(read(given[1]!), readInAClosure(given[1]!), stored(given[1]!), asked(given[1]!), underAKey(given[1]!, "x"), takenApart(given[1]!), deleted(given[1]!), first({ x: 1, y: 2 }));
`,
  },
  "objects that leave whole": {
    refused: ["n / 2", "n / 3", "n / 4", "n / 5", "n / 6", "n / 7", "n / 8", "n / 9", "n / 10"],
    text: `
interface Walker { x: int32; y: int32; self(): Walker }
function firstOfWalker(walker: Walker): int32 { return walker.x; }
const holder: { point: Point } = { point: { x: 1, y: 2 } };
function handedOver(n: number): int32 { const local = { x: n / 2, y: 2 }; return first(local); }
function spread(n: number): int32 { const local = { x: n / 3, y: 2 }; const point: Point = { ...local }; return first(point); }
function made(n: number) { const local = { x: n / 4, y: 2 }; return local; }
function kept(n: number): int32 { const local = { x: n / 5, y: 2 }; holder.point = local; return first(holder.point); }
function handedOverInAClosure(n: number): int32 { const local = { x: n / 6, y: 2 }; const hand = () => first(local); return hand(); }
function handedOverAsThis(n: number): int32 { const local = { x: n / 7, y: 2, self() { return this; } }; return firstOfWalker(local.self()); }
function copiedByARest(n: number): number { const local = { x: n / 8, y: 2 }; const { y, ...rest } = local; return y + rest.x; }
function cast(n: number): int32 { const local = { x: n / 9, y: 2 }; return (local as Point).x; }
function assignedAgain(n: number): number { let local = { x: n / 10, y: 2 }; local = { x: 1, y: 2 }; return local.x; }
console.log(handedOver(given[1]!), spread(given[1]!), first(made(given[1]!)), kept(given[1]!), handedOverInAClosure(given[1]!), handedOverAsThis(given[1]!), copiedByARest(given[1]!), cast(given[1]!), assignedAgain(given[1]!));
`,
  },
};

describe("compile/aot/a literal's member owes what the literal's own type promises", () => {
  const folder = String(tempDir("aot-literal-members", {}));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));

  test.concurrent.each(Object.keys(programs))("%s", async name => {
    const stem = name.replaceAll(" ", "-");
    const file = join(folder, `${stem}.ts`);
    const executable = join(folder, stem + (isWindows ? ".exe" : ""));
    writeFileSync(file, head + programs[name]!.text);
    const built = await spawned(
      [bunExe(), "build", "--compile", "--aot", ...withoutDebugInformation(), file, "--outfile", executable],
      folder,
      bunEnv,
    );
    const named = [
      ...built.stderr.matchAll(/^error: TS10003[12]: .* but '(.*)' (?:might not be|is not) an int32/gm),
    ].map(found => found[1]!);
    named.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
    expect({ refused: named, errors: built.stderr.match(/^error: /gm)?.length ?? 0 }).toEqual({
      refused: programs[name]!.refused,
      errors: programs[name]!.refused.length,
    });
    if (programs[name]!.refused.length) return;
    const [compiled, plain] = [
      await spawned([executable], folder, bunEnv),
      await spawned([bunExe(), file], folder, bunEnv),
    ];
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
