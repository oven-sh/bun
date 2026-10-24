// A field that holds an object takes four bytes: the number of the cell in the heap's cage. Compiled code that reads such a field, calls
// something that can collect, and uses what it read afterwards keeps a full pointer to the cell alive over the call. The collector's scan
// of the stack also knows such numbers, so a missing pointer shows nowhere in an ordinary run.
//
// `--aot-check=validate-reference-guards` proves the pointers over the machine-independent code of every function. A check that never
// fails shows nothing, so here the pointers are left out and the build must fail. With the scan's knowledge of the numbers turned off,
// the pointers alone must keep every object alive.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned, unsupported, withoutCoreDump } from "./run-programs";

const program = `
class Link {
  next: Link | null = null;
  other: Link | null = null;
  label: string;
  constructor(label: string) {
    this.label = label;
  }
}

let churned = 0;
function churn(): void {
  const made: Link[] = [];
  for (let i = 0; i < 2000; i++) made.push(new Link("churn" + i));
  churned += made.length;
  Bun.gc(true);
}

function chain(length: number, name: string): Link {
  const first = new Link(name + 0);
  let last = first;
  for (let i = 1; i < length; i++) {
    last.next = new Link(name + i);
    last.next.other = last;
    last = last.next;
  }
  return first;
}

// The holder forgets the object before the collection, so only the local variable knows it.
function readThenCollect(holder: Link): string {
  const held = holder.next;
  holder.next = null;
  churn();
  return held === null ? "nothing" : held.label;
}

function readOnOnePath(holder: Link, collects: boolean): string {
  const held = holder.next;
  holder.next = null;
  if (collects) churn();
  return held === null ? "nothing" : held.label + "/" + (held.next === null ? "end" : held.next.label);
}

function copyBehindCollection(from: Link, to: Link): void {
  const held = from.next;
  from.next = null;
  churn();
  to.other = held;
}

function collectInLoop(holder: Link, rounds: number): string {
  const held = holder.next;
  holder.next = null;
  let seen = "";
  for (let i = 0; i < rounds; i++) {
    churn();
    if (held !== null) seen += held.label + ";";
  }
  return seen;
}

async function readThenAwait(holder: Link): Promise<string> {
  const held = holder.next;
  holder.next = null;
  await Promise.resolve();
  churn();
  await Promise.resolve();
  return held === null ? "nothing" : held.label;
}

function* readThenYield(holder: Link): Generator<number, string, void> {
  const held = holder.next;
  holder.next = null;
  yield 1;
  churn();
  yield 2;
  return held === null ? "nothing" : held.label;
}

console.log(readThenCollect(chain(3, "a")));
console.log(readOnOnePath(chain(3, "b"), true), readOnOnePath(chain(3, "c"), false));
const target = new Link("target");
copyBehindCollection(chain(3, "d"), target);
console.log(target.other === null ? "nothing" : target.other.label);
console.log(collectInLoop(chain(2, "e"), 3));
console.log(await readThenAwait(chain(2, "f")));
const steps = readThenYield(chain(2, "g"));
let step = steps.next();
while (!step.done) step = steps.next();
console.log(step.value, churned);
`;

const prints = "a1\nb1/b2 c1/c2\nd1\ne1;e1;e1;\nf1\ng1 16000\n";
const scanKnowsNoNumbers = { BUN_JSC_useNarrowReferenceScan: "0" };

async function build(folder: string, name: string, flags: string[]) {
  const executable = join(folder, name + (isWindows ? ".exe" : ""));
  const built = await spawned(
    [bunExe(), "build", "--compile", "--aot", ...flags, "main.ts", "--outfile", executable],
    folder,
    bunEnv,
  );
  return { executable, ...built };
}

describe.concurrent("compile/aot/narrow references and the collector", () => {
  if (unsupported) return void test.skip(unsupported, () => {});

  test(
    "every reference that lives over a collection has a pointer beside it",
    () =>
      slot(async () => {
        using dir = tempDir("aot-narrow-reference-guards", { "main.ts": program });
        const built = await build(String(dir), "guarded", [
          "--aot-check=validate-reference-guards",
          "--explain=statistics",
        ]);
        expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
        const guards = Number(/NarrowReferenceGuards\D+(\d+)/.exec(built.stdout + built.stderr)?.[1]);
        expect(guards).toBeGreaterThan(0);
        for (const env of [{}, scanKnowsNoNumbers]) {
          const ran = await spawned(withoutCoreDump([built.executable]), String(dir), {
            ...bunEnv,
            ...env,
            BUN_JSC_crashIfInterpreterIsUsed: "1",
          });
          expect({ env, stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
            env,
            stdout: prints,
            exitCode: 0,
            signal: null,
          });
        }
      }),
    600_000,
  );

  test(
    "the check fails a build without the pointers",
    () =>
      slot(async () => {
        using dir = tempDir("aot-narrow-reference-guards-dropped", { "main.ts": program });
        const built = await build(String(dir), "bare", [
          "--aot-check=validate-reference-guards",
          "--aot-testing=DropReferenceGuards",
        ]);
        expect(built.stderr).toContain("NarrowReferenceWithoutPointer");
        expect(built.exitCode).not.toBe(0);
      }),
    600_000,
  );

  test(
    "without the pointers the scan of the stack keeps the objects alive",
    () =>
      slot(async () => {
        using dir = tempDir("aot-narrow-reference-guards-scan", { "main.ts": program });
        const built = await build(String(dir), "scanned", ["--aot-testing=DropReferenceGuards"]);
        expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
        const ran = await spawned(withoutCoreDump([built.executable]), String(dir), {
          ...bunEnv,
          BUN_JSC_crashIfInterpreterIsUsed: "1",
        });
        expect({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
          stdout: prints,
          exitCode: 0,
          signal: null,
        });
      }),
    600_000,
  );

  // Where nothing is inlined the object that the program stores into lies in the frame of the module, and the numbers in its fields are all that names the objects stored last.
  test.each([["--aot-heat=everything-is-cold"], ["--aot-limit=MaxWarmCodeValues:1"]])(
    "the fields of an object in a frame keep objects alive: %s",
    flag =>
      slot(async () => {
        const source = join(import.meta.dir, "programs", "collector", "a-field-stored-on-two-paths-behind-a-call.ts");
        using dir = tempDir("aot-narrow-references-in-a-frame", { "main.ts": await Bun.file(source).text() });
        const built = await build(String(dir), "in-a-frame", ["--aot-check=validate-reference-guards", flag]);
        expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
        for (const env of [{}, scanKnowsNoNumbers]) {
          const ran = await spawned(withoutCoreDump([built.executable]), String(dir), { ...bunEnv, ...env });
          expect({ env, stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
            env,
            stdout: "every field holds what was stored\n360 4320 link44 other44\n",
            exitCode: 0,
            signal: null,
          });
        }
      }),
    600_000,
  );
});
