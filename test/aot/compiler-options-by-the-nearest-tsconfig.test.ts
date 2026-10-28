// A compiler option of a file is that of the tsconfig.json nearest to it, whatever the entry point's says.
import { expect } from "bun:test";
import { expectSameAnswerAsBunRun, expectWhatEachProjectReports, type Files } from "./harness/projects";
import { test } from "./supported";

const shared = {
  target: "esnext",
  module: "preserve",
  moduleResolution: "bundler",
  noEmit: true,
  allowImportingTsExtensions: true,
  strict: true,
  skipLibCheck: true,
};
const options = (compilerOptions: object) => JSON.stringify({ compilerOptions: { ...shared, ...compilerOptions } });
const manifest = (name: string) => JSON.stringify({ name, version: "1.0.0", main: "./index.js" });

const printsValue = `import { value } from "./inner/lib.ts";\n(globalThis as any).console.log(value);\n`;
const untypedPackage = {
  "node_modules/pkg/index.js": `exports.kept = function (x) { return x; };\nexports.text = function () { return "text"; };\n`,
  "node_modules/pkg/package.json": manifest("pkg"),
};

/** `files` lie in the folder. They have the error under `refuses` and none under `accepts`. */
type Row = [option: string, error: string, refuses: object, accepts: object, files: Files, main?: string];

const rows: Row[] = [
  [
    "exactOptionalPropertyTypes",
    "TS2375",
    { exactOptionalPropertyTypes: true },
    {},
    { "lib.ts": `const o: { a?: number } = { a: undefined };\nconsole.log(o);\n` },
  ],
  [
    "exactOptionalPropertyTypes, in a store",
    "TS2412",
    { exactOptionalPropertyTypes: true },
    {},
    { "lib.ts": `const o: { a?: number } = {};\no.a = undefined;\nconsole.log(o);\n` },
  ],
  [
    "strictBindCallApply",
    "TS2345",
    {},
    { strictBindCallApply: false },
    { "lib.ts": `function f(n: number) { return n; }\nconsole.log(f.call(undefined, "x"));\n` },
  ],
  [
    "strictBuiltinIteratorReturn",
    "TS2322",
    {},
    { strictBuiltinIteratorReturn: false },
    {
      "lib.ts": `const r = [1].values().next();\nif (r.done) { const s: string = r.value; console.log(s); }\nconsole.log(r.done);\n`,
    },
  ],
  [
    "strictFunctionTypes",
    "TS2322",
    {},
    { strictFunctionTypes: false },
    { "lib.ts": `const f: (x: string | number) => void = (x: string) => { console.log(x); };\nf("a");\n` },
  ],
  [
    "noImplicitAny, where null is widened",
    "TS7010",
    { strictNullChecks: false },
    { strictNullChecks: false, noImplicitAny: false },
    { "lib.ts": `export function f() { return null; }\nconsole.log(f());\n` },
  ],
  [
    "lib, a later edition",
    "TS2550",
    { lib: ["es2020", "dom"] },
    { lib: ["esnext", "dom"] },
    { "lib.ts": `console.log([1].at(0));\n` },
  ],
  [
    "lib, as the target implies it",
    "TS2550",
    { target: "es2020" },
    { target: "esnext" },
    { "lib.ts": `console.log([1].at(0));\n` },
  ],
  [
    "lib, dom",
    "TS2584",
    { lib: ["esnext"] },
    { lib: ["esnext", "dom"] },
    { "lib.ts": `export const value = typeof document;\n` },
    printsValue,
  ],
  [
    "allowJs",
    "TS2305",
    { noImplicitAny: false },
    { allowJs: true, noImplicitAny: false },
    {
      "lib.ts": `import { f } from "./between.ts";\nconsole.log(f(1));\n`,
      "between.ts": `export * from "./code.js";\n`,
      "code.js": `export function f(x) { return x; }\n`,
    },
  ],
  [
    "maxNodeModuleJsDepth, behind a star",
    "TS2305",
    { allowJs: true, noImplicitAny: false },
    { allowJs: true, noImplicitAny: false, maxNodeModuleJsDepth: 2 },
    {
      "lib.ts": `import { kept } from "./between.ts";\nconsole.log(kept(1));\n`,
      "between.ts": `export * from "pkg";\n`,
      ...untypedPackage,
    },
  ],
  [
    "maxNodeModuleJsDepth, a result that is inferred",
    "TS2322",
    { allowJs: true, noImplicitAny: false, maxNodeModuleJsDepth: 2 },
    { allowJs: true, noImplicitAny: false },
    { "lib.ts": `import { text } from "pkg";\nconst n: number = text();\nconsole.log(n);\n`, ...untypedPackage },
  ],
  [
    "resolveJsonModule",
    "TS2732",
    { resolveJsonModule: false },
    {},
    { "lib.ts": `import data from "./data.json";\nconsole.log(data.a);\n`, "data.json": `{ "a": 1 }\n` },
  ],
  [
    "allowArbitraryExtensions",
    "TS6263",
    {},
    { allowArbitraryExtensions: true },
    {
      "lib.ts": `import text from "./note.txt";\nconst t: "declared" = text;\nconsole.log(typeof t);\n`,
      "note.txt": `words\n`,
      "note.d.txt.ts": `declare const text: "declared";\nexport default text;\n`,
    },
  ],
];

function layOut([, , , , files, main]: Row, entryPoint: object | undefined, folder: object): Files {
  const laidOut: Files = { "main.ts": main ?? `import "./inner/lib.ts";\n`, "inner/tsconfig.json": options(folder) };
  if (entryPoint) laidOut["tsconfig.json"] = options(entryPoint);
  for (const [path, text] of Object.entries(files)) laidOut["inner/" + path] = text;
  return laidOut;
}

test.each(rows)(
  "%s: a folder without the error below an entry point whose tsconfig.json has it",
  async (...row) => {
    expect(await expectWhatEachProjectReports(layOut(row, row[2], row[3]))).toEqual([]);
  },
  240_000,
);

test.each(rows)(
  "%s: a folder with the error below an entry point whose tsconfig.json has none",
  async (...row) => {
    expect(await expectWhatEachProjectReports(layOut(row, row[3], row[2]))).toContain("inner/lib.ts " + row[1]);
  },
  240_000,
);

test("JavaScript of a package is read as deep as the folder says, below an entry point without a tsconfig.json", async () => {
  const row = rows.find(([option]) => option === "maxNodeModuleJsDepth, behind a star")!;
  await expectSameAnswerAsBunRun(layOut(row, undefined, row[3]));
}, 240_000);

const shapes = `export class Shape {
  name: string;
  sides?: number;
  constructor(name: string, sides?: number) {
    this.name = name;
    if (sides !== undefined) this.sides = sides;
  }
  describe(): string {
    return this.name + ":" + ("sides" in this ? this.sides : "none");
  }
}
export function area(size: { width: number; height?: number }): number {
  return size.width * (size.height ?? size.width);
}
export function count(shapes: Shape[]): number {
  let sides = 0;
  for (const shape of shapes) sides += shape.sides ?? 0;
  return sides;
}
`;

const calls = `import { Shape, area } from "../shapes/lib.ts";
import { keep } from "../scripts/lib.ts";
export class Named extends Shape {
  constructor() {
    super("named", 3);
  }
  describe(): string {
    return "named " + super.describe();
  }
}
function add(a: number, b: number): number {
  return a + b;
}
export function callLoosely(): unknown {
  return [add.call(undefined, "1", 2), add.apply(undefined, [1]), add.bind(undefined, "a")("b")];
}
export function withoutSides(): Shape {
  const shape = new Shape("loose", 4);
  shape.sides = undefined;
  return shape;
}
export function areaOfNothing(): number {
  return area({ width: 2, height: undefined });
}
export const keptShape: Shape = keep(new Named());
`;

const scripts = `import { double } from "./code.js";
import { kept, text } from "./between.ts";
export function twice(n: number): number {
  return double(n);
}
export function keep<T>(value: T): T {
  return kept(value);
}
export function word(): string {
  return text();
}
`;

const usesThreeProjects = `import { Shape, area, count } from "./shapes/lib.ts";
import { Named, areaOfNothing, callLoosely, keptShape, withoutSides } from "./calls/lib.ts";
import { keep, twice, word } from "./scripts/lib.ts";
class Square extends Named {
  describe(): string {
    return "square " + super.describe();
  }
}
const shapes: Shape[] = [new Shape("point"), new Shape("line", 2), new Named(), new Square(), withoutSides(), keptShape];
for (const shape of shapes) console.log(shape.describe(), Object.keys(shape).join());
console.log(count(shapes), area({ width: 3 }), area({ width: 3, height: 2 }), areaOfNothing());
console.log(callLoosely());
console.log(keep(5), word(), twice(4));
`;

test("three folders that answer three options otherwise than the entry point, and name each other's classes", async () => {
  await expectSameAnswerAsBunRun({
    "main.ts": usesThreeProjects,
    "tsconfig.json": options({}),
    "shapes/lib.ts": shapes,
    "shapes/tsconfig.json": options({ exactOptionalPropertyTypes: true }),
    "calls/lib.ts": calls,
    "calls/tsconfig.json": options({ strictBindCallApply: false }),
    "scripts/lib.ts": scripts,
    "scripts/between.ts": `export * from "pkg";\n`,
    "scripts/code.js": `export function double(n) { return n * 2; }\n`,
    "scripts/tsconfig.json": options({ allowJs: true, maxNodeModuleJsDepth: 1 }),
    "scripts/node_modules/pkg/index.js": untypedPackage["node_modules/pkg/index.js"],
    "scripts/node_modules/pkg/package.json": untypedPackage["node_modules/pkg/package.json"],
  });
}, 240_000);
