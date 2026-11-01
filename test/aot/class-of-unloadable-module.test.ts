// child.ts imports a package that cannot be resolved, so its load fails and nothing of it runs: base.ts, which only it imports, is in no program.
// A file that runs names the class of child.ts all the same: it comes to child.ts by `import()`, or by `import type`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const said = `console.log((e as Error).name, String((e as Error).message).replace(/ from .*/, ""));`;
const shared = {
  "package.json": `{ "name": "z" }`,
  "node_modules/unbuilt/package.json": `{ "name": "unbuilt", "main": "./dist/index.js" }`,
  "base.ts": `
    export class Base {
      size: number;
      constructor(options: { size: number }) {
        this.size = options.size;
      }
    }`,
  "child.ts": `import "unbuilt";\nimport { Base } from "./base";\nexport class Child extends Base {}\n`,
  "main.ts": `
    try {
      const { Child } = await import("./child");
      console.log(new Child({ size: 1 }) instanceof Child);
    } catch (e) {
      ${said}
    }`,
};
const forms: Record<string, Record<string, string>> = {
  "a declaration": {},
  "a class expression, and one in a function": {
    "child.ts": `
      import "unbuilt";
      import { Base } from "./base";
      export const Child = class extends Base {};
      export function make() {
        return class extends Base {};
      }`,
  },
  "the load fails in a file between": {
    "middle.ts": `import "unbuilt";\nimport { Base } from "./base";\nexport class Middle extends Base {}\n`,
    "child.ts": `import { Middle } from "./middle";\nexport class Child extends Middle {}\n`,
  },
  "a class of the file that runs extends it": {
    "main.ts": `
      try {
        const { Child } = await import("./child");
        class Grand extends Child {}
        console.log(new Grand({ size: 1 }).size);
      } catch (e) {
        ${said}
      }`,
  },
  "it is the type of a variable": {
    "main.ts": `
      import type { Child } from "./child";
      let held: Child | undefined;
      try {
        held = new (await import("./child")).Child({ size: 1 });
      } catch (e) {
        ${said}
      }
      console.log(held?.size);`,
  },
};

for (const [form, files] of Object.entries(forms))
  test.concurrent(
    `an executable: ${form}`,
    async () => {
      using dir = tempDir("class-of-unloadable-module", { ...shared, ...files });
      const plain = await run([bunExe(), "run", "./main.ts"], String(dir));
      expect(plain.stdout).toStartWith("ResolveMessage Cannot find package 'unbuilt'");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "./main"],
        String(dir),
      );
      expect(built.stderr + built.stdout).not.toContain("error");
      expect(built.exitCode).toBe(0);
      const compiled = await run([join(String(dir), "main")], String(dir));
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    },
    240_000,
  );

// Since a test file of Vitest's runs its imports in turn, its statements are such calls.
test.concurrent(
  "a test file that imports from vitest",
  async () => {
    using dir = tempDir("class-of-unloadable-module-vitest", {
      ...shared,
      "a.test.ts": `
        import "unbuilt";
        import { expect, test } from "vitest";
        import { Child } from "./child";
        test("a", () => {
          expect(new Child({ size: 1 })).toBeInstanceOf(Child);
        });`,
      "b.test.ts": `import { expect, test } from "bun:test";\ntest("b", () => { expect(1 + 1).toBe(2); });\n`,
    });
    const counts = (text: string) => text.split("\n").filter(line => /^ *\d+ (pass|fail|error)/.test(line));
    const env = { ...bunEnv, NO_COLOR: "1" };
    const plain = await run([bunExe(), "test", "./a.test.ts", "./b.test.ts"], String(dir), env);
    expect(counts(plain.stderr)).toEqual([" 1 pass", " 1 fail", " 1 error"]);
    const compiled = await run([bunExe(), "test", "--aot", "./a.test.ts", "./b.test.ts"], String(dir), env);
    expect({ counts: counts(compiled.stderr), exitCode: compiled.exitCode }).toEqual({
      counts: counts(plain.stderr),
      exitCode: plain.exitCode,
    });
  },
  240_000,
);
