import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// `if ((kind as Whole).part)`: where a look finds the slot of an appended field empty, compiled code takes the property for missing once the object's own byte and the guard of its class have answered.
// A test run opens the names that its tests plant on Object.prototype, and nobody answers for those: the read goes on upward.

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>) {
  using dir = tempDir("an-empty-slot-in-test-runs", files);
  const plain = await runTests(String(dir));
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--aot")).toEqual(plain);
}

const kinds = `
  export interface Part { id: number }
  export class Kind { flags: number; constructor(flags: number) { this.flags = flags; } }
  export interface Whole extends Kind { part: Part }
  export function has(kind: Kind): string { if ((kind as Whole).part) return "has " + (kind as Whole).part.id; return "none"; }
  export function lacks(kind: Kind): string { if (!(kind as Whole).part) return "none"; return "has " + (kind as Whole).part.id; }
  export function choice(kind: Kind): string { return (kind as Whole).part ? "has " + (kind as Whole).part.id : "none"; }
  export function isUndefined(kind: Kind): string { if ((kind as Whole).part === undefined) return "none"; return "has " + (kind as Whole).part.id; }
`;

function testsThat(deed: string, undo: string) {
  return `
    import { test } from "bun:test";
    import { Kind, has, lacks, choice, isUndefined, type Whole } from "./kinds";
    const part = { id: 3 };
    function ask(kind: Kind) { return [has(kind), lacks(kind), choice(kind), isUndefined(kind)].join(" | "); }
    test("asked", () => {
      const bare = new Kind(4);
      const full = new Kind(4);
      (full as Whole).part = { id: 7 };
      for (let turn = 0; turn < 3; turn++) console.log(ask(bare), ask(full), ask(new Kind(turn)));
      ${deed}
      for (let turn = 0; turn < 3; turn++) console.log(ask(bare), ask(full), ask(new Kind(turn)));
      ${undo}
      for (let turn = 0; turn < 3; turn++) console.log(ask(bare), ask(full), ask(new Kind(turn)));
    });
  `;
}

test("the name is planted on Object.prototype and taken away again", async () => {
  await expectCompiledToRunAsPlain({
    "kinds.ts": kinds,
    "one.test.ts": testsThat(`(Object.prototype as any).part = part;`, `delete (Object.prototype as any).part;`),
  });
});

test("a getter under the name is planted on Object.prototype", async () => {
  await expectCompiledToRunAsPlain({
    "kinds.ts": kinds,
    "one.test.ts": testsThat(
      `Object.defineProperty(Object.prototype, "part", { get() { return part; }, configurable: true });`,
      `delete (Object.prototype as any).part;`,
    ),
  });
});

test("the class gains the name and loses it", async () => {
  await expectCompiledToRunAsPlain({
    "kinds.ts": kinds,
    "one.test.ts": testsThat(`(Kind.prototype as any).part = part;`, `delete (Kind.prototype as any).part;`),
  });
});

test("the name is planted in one file and asked for in the next", async () => {
  await expectCompiledToRunAsPlain({
    "kinds.ts": kinds,
    "one.test.ts": testsThat(`(Object.prototype as any).part = part;`, ``),
    "two.test.ts": testsThat(``, `delete (Object.prototype as any).part;`),
  });
});
