// Runs alone: it judges by the processor seconds of builds.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { reads } from "./harness/reads";
import { describe, test } from "./supported";

// A build lists the fields that the constructors above a class store. It climbed the whole row for each class of it, and searched all that it had passed at each step.
const upTo = (count: number, line: (index: number) => string) =>
  Array.from({ length: count }, (_, index) => line(index));

const shapes: Record<string, (count: number) => string[]> = {
  "classes that are tested by a method of the foot": count => [
    "class C0 { m() { return 0; } static [Symbol.hasInstance](value) { return Function.prototype[Symbol.hasInstance].call(this, value); } }",
    ...upTo(count - 1, i => `class C${i + 1} extends C${i} {}`),
    `const last = new C${count - 1}();`,
    `console.log(last.m(), last instanceof C0, last instanceof C${count >> 1});`,
  ],
  "classes with constructors that only call the one above": count => [
    "class C0 { constructor(a) { this.a = a; } m() { return this.a; } static [Symbol.hasInstance](value) { return true; } }",
    ...upTo(count - 1, i => `class C${i + 1} extends C${i} { constructor(a) { super(a); } }`),
    `console.log(new C${count - 1}(3).m(), ({}) instanceof C0);`,
  ],
};

async function build(folder: string, lines: string[], count: number) {
  writeFileSync(join(folder, `${count}.cjs`), [...lines, ""].join("\n"));
  await using built = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `./${count}.cjs`,
      "--outfile",
      join(folder, count + (isWindows ? ".exe" : "")),
    ],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
    timeout: 90_000,
  });
  const [stderr, exitCode] = await Promise.all([built.stderr.text(), built.exited]);
  expect({ stderr: stderr.split("\n").filter(line => line.startsWith("error")), exitCode }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  return Number(built.resourceUsage()!.cpuTime.user) / 1e6;
}

describe("a build of four times as long a row of classes", () => {
  test.each(Object.keys(shapes))(
    "%s",
    async name => {
      using dir = tempDir("aot-row-of-classes", {});
      const few = await build(String(dir), shapes[name](1250), 1250);
      const many = await build(String(dir), shapes[name](5000), 5000);
      reads(name, many / few, 8, "times the processor seconds");
      if (!isASAN && !isDebug) expect(many / few).toBeLessThan(8);
    },
    240_000,
  );
});
