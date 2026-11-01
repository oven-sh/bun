// Whether a constructor can take the object that the class below has allocated hangs on the constructor above it, and so does the version of it that does.
// Asked and built from within one another, a row of classes took calls as deep as the row is long: at some 3,300 classes the compiler ran out of stack.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const classes = 4_000;
const row = (body: (index: number) => string) =>
  Array.from({ length: classes }, (_, index) => `class C${index + 1} extends C${index} {${body(index + 1)}}\n`).join(
    "",
  );

const programs: Record<string, string> = {
  "without-members.js": `class C0 {}\n${row(() => "")}console.log(new C${classes}() instanceof C0);\n`,
  "with-constructors.js":
    `class C0 { constructor(n) { this.n = n; } }\n` +
    row(index => ` constructor(n) { super(n + ${index % 3}); }`) +
    `console.log(new C${classes}(1).n, new C${classes >> 1}(1).n);\n`,
};

describe("compile/aot/a-row-of-thousands-of-classes", () => {
  for (const [name, program] of Object.entries(programs)) {
    // Such a build takes minutes there.
    test.skipIf(isDebug || isASAN)(
      name,
      async () => {
        using dir = tempDir("aot-a-row-of-thousands-of-classes", { [name]: program });
        const cwd = String(dir);
        built(
          await spawned([bunExe(), "build", "--compile", "--aot", name, "--outfile", join(cwd, "main")], cwd, bunEnv),
        );
        const [compiled, plain] = await Promise.all([
          spawned([join(cwd, "main")], cwd, bunEnv),
          spawned([bunExe(), name], cwd, bunEnv),
        ]);
        expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
          stdout: plain.stdout,
          exitCode: plain.exitCode,
        });
        expect(plain.exitCode).toBe(0);
      },
      600_000,
    );
  }
});
