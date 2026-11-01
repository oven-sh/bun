// Over layers a program of test files reads none of the files in the images below it: `declare module "*";` stands for them, so that what a test file
// imports has any type. TypeScript binds an import from such a module to the module itself, which is `any` as a value and an error as a type:
// "TS2709: Cannot use namespace 'Axis' as a type". A file with an error of type is compiled without its types, so a test file that wrote one imported
// type was compiled otherwise over layers than as one program: `let held: int32 = 1.5` beside it was refused in a small run and accepted in a large one.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const forms = {
  "no import": ``,
  "a value": `import { value } from "./axis"; console.log(value);`,
  "an enum": `import { Axis } from "./axis"; let k: Axis = Axis.Y; console.log(k);`,
  "an interface": `import type { Shape } from "./axis"; let k: Shape = { side: 1 }; console.log(k);`,
  "an alias": `import { type Name } from "./axis"; let k: Name = "a"; console.log(k);`,
  "a class": `import { Box } from "./axis"; let k: Box = new Box(); console.log(k);`,
  "a default import": `import Main from "./axis"; let k: Main = new Main(); console.log(k);`,
};

test.concurrent.each(Object.entries(forms))(
  "%s",
  async (_, form) => {
    using dir = tempDir("aot-an-imported-type-over-layers", {
      "package.json": `{ "name": "p" }`,
      "axis.ts": `export enum Axis { X, Y }\nexport interface Shape { side: number }\nexport type Name = string;\nexport class Box { side = 1 }\nexport const value = 1;\nexport default class Main { side = 2 }\n`,
      "a.test.ts": `import { test } from "bun:test";\nimport type { int32 } from "bun";\n${form}\nlet held: int32 = 1.5;\ntest("a", () => { console.error("RAN", held); });\n`,
    });
    const seen = async (words: string) => {
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
      const { stderr, exitCode } = await run([bunExe(), "test", "--aot"], String(dir), env);
      return { lines: stderr.split("\n").filter(line => /^RAN|^error: TS/.test(line)), exitCode };
    };
    const refused = {
      lines: ["error: TS100032: 'held' is declared 'int32', but '1.5' is not an int32: it has a fraction."],
      exitCode: 1,
    };
    expect(await seen("TestRunLayers:0")).toEqual(refused);
    expect(await seen("TestRunLayers:1")).toEqual(refused);
  },
  120_000,
);

// However the type is written, the checker has nothing to say about it, and the file is none of those that are compiled without their types.
const ways = {
  "a namespace import": `import * as ns from "./axis"; let k: ns.Shape = { side: 3 }; const seen = k.side;`,
  "a list of an interface": `import type { Shape } from "./axis"; let k: Array<Shape> = [{ side: 4 }]; const seen = k[0].side;`,
  "extends a class": `import { Box } from "./axis"; class Mine extends Box { more = 5 } const seen = new Mine().side + new Mine().more;`,
  "implements an interface": `import type { Shape } from "./axis"; class Mine implements Shape { side = 6 } const seen = new Mine().side;`,
  "typeof a value": `import { value } from "./axis"; let k: typeof value = 1; const seen = k;`,
  "keyof an interface": `import type { Shape } from "./axis"; let k: keyof Shape = "side"; const seen = k;`,
  "a member of an enum": `import { Axis } from "./axis"; let k: Axis.X = Axis.X; const seen = k;`,
  "a type inside a namespace": `import { Inner } from "./axis"; let k: Inner.Deep = { a: 7 }; const seen = k.a;`,
  "type arguments of a call": `import { twice, type Shape } from "./axis"; const seen = twice<Shape>({ side: 8 })[1].side;`,
  "type arguments of a call of a member": `import * as ns from "./axis"; const seen = ns.twice<ns.Shape>({ side: 8 })[1].side;`,
  "type arguments of new": `import { Held } from "./axis"; const seen = new Held<number>(9).held;`,
  "import() as a type": `let k: import("./axis").Shape = { side: 9 }; const seen = k.side;`,
  "a type handed on": `import type { Shape } from "./axis"; export type { Shape }; type Two = Shape & { more: number }; let k: Two = { side: 1, more: 2 }; const seen = k.more;`,
  "satisfies and as": `import type { Shape } from "./axis"; const seen = (({ side: 3 }) satisfies Shape as Shape).side;`,
};

test.concurrent.each(Object.entries(ways))(
  "%s",
  async (_, way) => {
    using dir = tempDir("aot-an-imported-type-over-layers", {
      "package.json": `{ "name": "p" }`,
      "axis.ts": `export enum Axis { X, Y }\nexport interface Shape { side: number }\nexport class Box { side = 1 }\nexport const value = 1;\nexport function twice<T>(x: T): T[] { return [x, x]; }\nexport class Held<T> { constructor(public held: T) {} }\nexport namespace Inner { export interface Deep { a: number } }\n`,
      "a.test.ts": `import { test } from "bun:test";\n${way}\ntest("a", () => { process.stderr.write("RAN " + String(seen) + "\\n"); });\n`,
    });
    const seen = async (flags: string[], words: string) => {
      const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" };
      const { stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), env);
      // The project has no package of types for the run time: `process` is a name that nobody declares (2591).
      const lines = stderr.split("\n").filter(line => /^RAN|^(warn|error): TS(?!2591)/.test(line));
      return { lines, exitCode };
    };
    const plain = await seen([], "");
    expect(plain).toEqual({ lines: [expect.stringMatching(/^RAN \w+$/)], exitCode: 0 });
    expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await seen(["--aot"], "TestRunLayers:1")).toEqual(plain);
  },
  120_000,
);
