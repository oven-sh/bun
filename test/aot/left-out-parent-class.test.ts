// lib.ts has no side effects and exports a class that nothing makes, so the statement of the class is left out, and with it base.ts, which only that statement needs.
// A file that runs names the class in a type all the same.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const base = `
  export class Base {
    size: number;
    constructor(options: { size: number }) {
      this.size = options.size;
    }
  }`;
const lib = `import { Base } from "./base";\nexport class Unused extends Base {}\nexport const used = 1;\n`;
const shared = {
  "package.json": `{ "name": "z", "sideEffects": false }`,
  "base.ts": base,
  "lib.ts": lib,
  "main.ts": `
    import { used } from "./lib";
    import type { Unused } from "./lib";
    let held: Unused | undefined;
    console.log(used, held?.size);`,
};
const forms: Record<string, Record<string, string>> = {
  "the type of a variable": {},
  "the type of a parameter": {
    "main.ts": `
      import { used } from "./lib";
      import type { Unused } from "./lib";
      function sizes(all: Unused[]) {
        let sum = 0;
        for (const one of all) sum += one.size;
        return sum;
      }
      console.log(used, sizes([]));`,
  },
  "handed on as its parent": {
    "main.ts": `
      import { used } from "./lib";
      import type { Unused } from "./lib";
      import type { Base } from "./base";
      let held: Unused | undefined;
      const wider: Base | undefined = held;
      function size(one: Base | undefined) {
        return one?.size;
      }
      console.log(used, size(wider), size(held));`,
  },
  "the parent has a parent": {
    "middle.ts": `import { Base } from "./base";\nexport class Middle extends Base {}\n`,
    "lib.ts": `import { Middle } from "./middle";\nexport class Unused extends Middle {}\nexport const used = 1;\n`,
  },
  "the parent stands behind a type assertion": {
    "lib.ts": `import { Base } from "./base";\nexport class Unused extends (Base as any) {}\nexport const used = 1;\n`,
    "main.ts": `
      import { used } from "./lib";
      import type { Unused } from "./lib";
      let held: Unused | undefined;
      console.log(used, held === undefined);`,
  },
  "a class in a function that nobody calls": {
    "lib.ts": `
      import { Base } from "./base";
      export const used = 1;
      export function never() {
        return class extends Base {};
      }`,
    "main.ts": `
      import { used } from "./lib";
      import type { never } from "./lib";
      let made: InstanceType<ReturnType<typeof never>> | undefined;
      console.log(used, made?.size);`,
  },
  "in a package": {
    "package.json": `{ "name": "z" }`,
    "node_modules/lib/package.json": `{ "name": "lib", "sideEffects": false, "main": "./lib.ts", "types": "./lib.ts" }`,
    "node_modules/lib/base.ts": base,
    "node_modules/lib/lib.ts": lib,
    "main.ts": `
      import { used } from "lib";
      import type { Unused } from "lib";
      let held: Unused | undefined;
      console.log(used, held?.size);`,
  },
  // The parent keeps its place where something else needs its file.
  "the file that runs makes the parent": {
    "main.ts": `
      import { used } from "./lib";
      import type { Unused } from "./lib";
      import { Base } from "./base";
      let held: Unused | Base = new Base({ size: 3 });
      console.log(used, held.size, held instanceof Base);`,
  },
  "the class is made after all": {
    "main.ts": `
      import { used, Unused } from "./lib";
      import { Base } from "./base";
      const held = new Unused({ size: 4 });
      console.log(used, held.size, held instanceof Base);`,
  },
};

for (const [form, files] of Object.entries(forms))
  test.concurrent(
    form,
    async () => {
      using dir = tempDir("left-out-parent-class", { ...shared, ...files });
      const plain = await run([bunExe(), "run", "./main.ts"], String(dir));
      expect(plain.stdout).toStartWith("1 ");
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
