// `{ z: 1, ...o, a: 0.5 }`, where `o` holds `a: null` that a store has laid: the spread's copy lays null into the slot of `a` before the literal's own 0.5 comes. A build that called the fields of such a record
// "filled at birth" leaned on what the literal itself writes there, and the executable stopped: "StoreOfOtherType .. the compiler has proven that it never happens". Each program says what plain Bun says.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const programs: Record<string, string> = {
  "smallest.ts": `const o: Record<string, number | null | undefined> = {};
o.a = null; o.b = undefined;
console.log({ z: 1, ...o, a: 0.5 }.a);
export {};`,
  "kept.ts": `type Entry = { seenAt?: number | null; ttl?: number | null };
const kept: Entry = {};
kept.seenAt = null; kept.ttl = undefined;
const next = { ...kept, seenAt: Date.now() / 1000 };
console.log(typeof next.seenAt, Object.keys(next).join());
export {};`,
  "in-a-loop.ts": `const rows: Record<string, number | null | undefined>[] = [{}, {}, {}];
rows[1].share = null; rows[2].share = undefined; rows[2].more = null;
let sum = 0;
for (const row of rows) sum += { first: 1, ...row, share: 0.25 }.share;
console.log(sum);
export {};`,
  "the-spread-wins.ts": `const o: Record<string, number | null | undefined> = {};
o.a = null;
const made = { a: 0.5, z: 1, ...o };
console.log(made.a, made.z);
export {};`,
};

for (const [name, text] of Object.entries(programs)) {
  test(`a spread lays null under a name that the literal writes: ${name}`, async () => {
    using dir = tempDir("aot-spread-lays-null", { [name]: text });
    const cwd = String(dir);
    const plain = await run([bunExe(), name], cwd, bunEnv);
    expect(plain.exitCode).toBe(0);
    const executable = join(cwd, "program");
    expect(
      (await run([bunExe(), "build", "--compile", "--aot", name, "--outfile", executable], cwd, bunEnv)).exitCode,
    ).toBe(0);
    const compiled = await run([executable], cwd, bunEnv);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 120_000);
}
