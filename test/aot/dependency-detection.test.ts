import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { run } from "./harness/run";
import { test } from "./supported";

async function build(directory: string, entryPoint: string) {
  const outfile = join(directory, "out" + (isWindows ? ".exe" : ""));
  const { stderr: said, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", entryPoint, "--outfile", outfile],
    directory,
  );
  if (exitCode) return { said, exitCode, stdout: "" };
  const { stdout } = await run([outfile], directory);
  return { said, exitCode, stdout };
}
const strict = (more: object = {}) =>
  JSON.stringify({ compilerOptions: { strict: true, typeRoots: ["./no-types-here"], ...more } });

test("an application that lies under node_modules is held to its types", async () => {
  using dir = tempDir("aot-dependency-own", {
    "node_modules/app/package.json": JSON.stringify({ name: "app" }),
    "node_modules/app/tsconfig.json": strict(),
    "node_modules/app/main.ts": `import { half } from "./half";\nconsole.log(half(4));\n`,
    "node_modules/app/half.ts": `export function half(n: number): string { return n / 2; }\n`,
  });
  const { said, exitCode } = await build(join(String(dir), "node_modules", "app"), "./main.ts");
  expect(said).toContain("TS2322");
  expect(exitCode).not.toBe(0);
}, 120_000);

test("a package that ships its TypeScript is not held to the application's rules that only report", async () => {
  using dir = tempDir("aot-dependency-rules", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ noUncheckedIndexedAccess: true, noImplicitReturns: true, noUnusedLocals: true }),
    "main.ts": `import { first } from "ships-typescript";\nconsole.log(first([3, 4]));\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": `export function first(list: number[]): number { const unused = 1; const found: number = list[0]; return found; }\n`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).not.toContain("ships-typescript");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "3\n" });
}, 120_000);

test("a package that ships its TypeScript stays typed where only the application's strictness or its newer TypeScript complains", async () => {
  using dir = tempDir("aot-dependency-lenient", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ target: "ES2019" }),
    "main.ts": `import { evens, last, size, label, big, n } from "ships-typescript";\nconsole.log(evens([1, 2, 4]), last(["a", "b"]), size(new Map([["a", { n: 1 }]]), "a"), label(2), big, n);\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/data.json": `{ "n": 7 }`,
    "node_modules/ships-typescript/index.ts": `import data from "./data.json" assert { type: "json" };
export const n: number = data.n;
export const big = 1n;
export function evens(list: number[]): number[] { const out = []; for (const n of list) if (n % 2 === 0) out.push(n); return out; }
export function last(list: string[]): string | null { let found = null; for (const s of list) found = s; return found; }
export function size(sizes: Map<string, { n: number }>, key: string): number { return sizes.get(key).n; }
export function label(n: number, text?: string): number { const shown = "" + text ?? "none"; return shown.length + n; }
`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).not.toContain("ships-typescript");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "[ 2, 4 ] b 1 11 1n 7\n" });
}, 120_000);

test("a package that ships its TypeScript stays typed where a function with a declared result has an empty return", async () => {
  using dir = tempDir("aot-dependency-empty-return", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict(),
    "main.ts": `import { half } from "ships-typescript";\nconst none: number = half(-4);\nconsole.log(half(4), typeof none, none + 1);\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": `export function half(n: number): number { if (n < 0) return; return n / 2; }\n`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).not.toContain("ships-typescript");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "2 undefined NaN\n" });
}, 120_000);

// TS2612 is the one rule that TypeScript opens WITHOUT strictNullChecks: without it the checker cannot see that the constructor fills the field.
// A build makes its types under the application's strictNullChecks, so it can see that in a package too.
test("a package that ships its TypeScript stays typed where it declares a field of its base class again and its constructor fills it", async () => {
  using dir = tempDir("aot-dependency-redeclared-field", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ target: "ESNext" }),
    "main.ts": `import { Base, Derived } from "ships-typescript";\nconst derived = new Derived(5);\nconst base: Base = derived;\nconsole.log(derived.size, base.size + 1);\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": `export class Base { size: number = 1; }\nexport class Derived extends Base { size: number; constructor(n: number) { super(); this.size = n; } }\n`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).not.toContain("ships-typescript");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "5 6\n" });
}, 120_000);

test("a package that ships its TypeScript stays typed where it defers an import and the application's module is an older one", async () => {
  using dir = tempDir("aot-dependency-deferred-import", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ module: "es2022", moduleResolution: "bundler" }),
    "main.ts": `import { later } from "ships-typescript";\nconsole.log(later(1));\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/other.ts": `export const seven: number = 7;\n`,
    "node_modules/ships-typescript/index.ts": `import defer * as other from "./other.ts";\nexport function later(n: number): number { return other.seven + n; }\n`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).not.toContain("ships-typescript");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "8\n" });
}, 120_000);

test("a package with a tsconfig.json of its own stays typed where only the application's exactOptionalPropertyTypes forbids a delete", async () => {
  using dir = tempDir("aot-dependency-exact-optional", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ exactOptionalPropertyTypes: true }),
    "main.ts": `import { clear, type Box } from "ships-typescript";\nconst box: Box = { value: 3, size: 5 };\nconsole.log(clear(box), "value" in box, box.value, Object.keys(box).join());\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
    "node_modules/ships-typescript/index.ts": `export interface Box { value: number | undefined; size: number }\nexport function clear(box: Box): number { delete box.value; return box.size * 2; }\n`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).not.toContain("ships-typescript");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "10 false undefined size\n" });
}, 120_000);

// Today such a package is compiled without its types, and the build warns with TS100010.
test.todo(
  "a package that ships its TypeScript stays typed when it only disagrees with the application's ambient declarations",
  async () => {
    using dir = tempDir("aot-dependency-ambient", {
      "package.json": JSON.stringify({ name: "app" }),
      "tsconfig.json": strict(),
      "host.d.ts": `interface HostInit { name?: string; dispatcher: number }\ninterface HostThing { id: number; extra(): void }\ndeclare function describeHost(init: HostInit): string;\ndeclare function makeThing(): { id: number };\ndeclare function hostReader(): { read(): number };\n`,
      "main.ts": `(globalThis as any).describeHost = (init: object) => JSON.stringify(init);\n(globalThis as any).makeThing = () => ({ id: 7 });\n(globalThis as any).hostReader = () => ({ read: () => 1, readMany: () => 5 });\nconst { Wrapper } = await import("ships-typescript");\nconst wrapper = new Wrapper("a");\nconsole.log(wrapper.describe(), wrapper.thing().id, wrapper.init().name, wrapper.many());\n`,
      "node_modules/ships-typescript/package.json": JSON.stringify({
        name: "ships-typescript",
        main: "index.ts",
        types: "index.ts",
      }),
      "node_modules/ships-typescript/index.ts": `export class Wrapper {\n  name: string;\n  constructor(name: string) { this.name = name; }\n  describe(): string { return describeHost({ name: this.name }); }\n  thing(): HostThing { return makeThing(); }\n  init(): HostInit { const init: HostInit = { name: this.name }; return init; }\n  many(): number { return hostReader().readMany(); }\n}\n`,
    });
    const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
    expect(said).not.toContain("ships-typescript");
    expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: '{"name":"a"} 7 a 5\n' });
  },
  120_000,
);

test("a package that reads a member of globalThis that the application's lib does not declare stays typed", async () => {
  using dir = tempDir("aot-dependency-global-this", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ lib: ["ESNext"] }),
    "main.ts": `import { half, title } from "ships-typescript";\ndeclare const console: { log(...values: unknown[]): void };\nconsole.log(title(), half(4));\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": `export function title(): string { const page = globalThis.document; return page === undefined ? "none" : String(page.title); }\nexport function half(n: number): number { return n / 2; }\n`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).not.toContain("ships-typescript");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "none 2\n" });
}, 120_000);

test("the application's own read of a member of globalThis that its lib does not declare is an error", async () => {
  using dir = tempDir("aot-own-global-this", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ lib: ["ESNext"] }),
    "main.ts": `console.log(globalThis.document === undefined);\n`,
  });
  const { said, exitCode } = await build(String(dir), "./main.ts");
  expect(said).toContain("TS7017");
  expect(exitCode).not.toBe(0);
}, 120_000);

test("a type error in a file of a package that the program takes only types from leaves the package typed", async () => {
  using dir = tempDir("aot-dependency-types-only", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict(),
    "main.ts": `import { half, type Client } from "ships-typescript";\nconst client: Client = { name: "a" };\nconsole.log(half(4), client.name);\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": `export type { Client } from "./client";\nexport function half(n: number): number { return n / 2; }\n`,
    "node_modules/ships-typescript/client.ts": `import { nameOf } from "./utils";\nexport interface Client { name: string }\nexport function connect(): Client { return { name: nameOf(1) }; }\n`,
    "node_modules/ships-typescript/utils.ts": `export function nameOf(id: number): string { const wrong: string = id; return wrong; }\n`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).not.toContain("TS100009");
  expect(said).not.toContain("ships-typescript");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "2 a\n" });
}, 120_000);

async function withoutBundler(directory: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], directory);
  return { said: stdout + stderr, stdout, exitCode };
}
const takesFromClient = (index: string, name = "", use = "") => ({
  "package.json": JSON.stringify({ name: "app" }),
  "tsconfig.json": strict(),
  "main.ts": `import { half, type Client${name} } from "ships-typescript";\nconst client: Client = { name: "a" };\nconsole.log(half(4), client.name${use});\n`,
  "node_modules/ships-typescript/package.json": JSON.stringify({
    name: "ships-typescript",
    version: "1.0.0",
    main: "index.ts",
    types: "index.ts",
  }),
  "node_modules/ships-typescript/index.ts": `${index}\nexport function half(n: number): number { return n / 2; }\n`,
  "node_modules/ships-typescript/client.ts": `import { nameOf } from "./utils";\nexport interface Client { name: string }\nexport function connect(): Client { return { name: nameOf(1) }; }\n`,
  "node_modules/ships-typescript/utils.ts": `export function nameOf(id: number): string { const wrong: string = id; return wrong; }\n`,
});

test("bun check --aot and bun run --aot say the same of such a package as the build", async () => {
  using dir = tempDir("aot-dependency-types-only", takesFromClient(`export type { Client } from "./client";`));
  const checked = await withoutBundler(String(dir), "check", "--aot", "main.ts");
  expect(checked.said).not.toContain("TS100009");
  expect(checked.said).not.toContain("ships-typescript");
  expect(checked.exitCode).toBe(0);
  const ran = await withoutBundler(String(dir), "run", "--aot", "main.ts");
  expect(ran.said).not.toContain("TS100009");
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: "2 a\n", exitCode: 0 });
}, 120_000);

test.each([
  [
    "beside its types",
    `export type { Client } from "./client";\nexport { connect } from "./client";`,
    ", connect",
    ", connect().name",
  ],
  [
    "by import()",
    `export type { Client } from "./client";\nexport const later = () => import("./client");`,
    ", later",
    ", typeof later()",
  ],
  ["among its types", `export { type Client, connect } from "./client";`, ", connect", ", connect().name"],
])(
  "a package that the program takes code from %s is tried by bun check --aot",
  async (_, index, name, use) => {
    using dir = tempDir("aot-dependency-code-too", takesFromClient(index, name, use));
    const checked = await withoutBundler(String(dir), "check", "--aot", "main.ts");
    expect(checked.said).toContain("TS100009");
    expect(checked.said).toContain("ships-typescript");
  },
  120_000,
);

test("bun check --aot compiles the classes of a typed package, as the build and bun run --aot do", async () => {
  using dir = tempDir("aot-dependency-classes", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict(),
    "main.ts": `import { Context } from "ships-typescript";\nconst context = new Context();\nconsole.log(context.request.param());\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": `export { Context } from "./context";\n`,
    "node_modules/ships-typescript/context.ts": `import { Request } from "./request";\nexport class Context {\n  #request: Request | undefined;\n  get request(): Request { return (this.#request ??= new Request("a")); }\n}\n`,
    "node_modules/ships-typescript/request.ts": `export class Request {\n  name: string;\n  constructor(name: string) { this.name = name; }\n  param(): string { return this.name; }\n}\n`,
  });
  const built = await build(String(dir), "./main.ts");
  expect({ exitCode: built.exitCode, stdout: built.stdout }).toEqual({ exitCode: 0, stdout: "a\n" });
  const ran = await withoutBundler(String(dir), "run", "--aot", "main.ts");
  expect({ exitCode: ran.exitCode, stdout: ran.stdout }).toEqual({ exitCode: 0, stdout: "a\n" });
  const checked = await withoutBundler(String(dir), "check", "--aot", "main.ts");
  expect(checked.said).toContain("No type errors");
  expect(checked.said).not.toContain("does not support");
  expect(checked.exitCode).toBe(0);
}, 120_000);

const untypedArea = `export function area(side) { return side * side; }\n`;
const untypedTwice = `function twice(n) { return n * 2; }\n`;
const typedTwice = `import type { int32 } from "bun";\nfunction twice(n: int32): number { return n * 2; }\n`;

const codesOf = (said: string) =>
  [...new Set([...said.matchAll(/\b(?:error|warn|warning):? (TS\d+)/g)].map(match => match[1]))].sort();

/** Builds and checks main.ts: the codes each of the two reports, and how many files under an "aot" condition it compiled with their types. */
async function buildAndCheck(directory: string) {
  const answers: Record<string, { codes: string[]; exitCode: number; aotFiles: number }> = {};
  for (const [name, command] of Object.entries({
    build: ["build", "--compile", "--aot", "./main.ts", "--outfile", join(directory, "out")],
    check: ["check", "--aot", "main.ts"],
  })) {
    const report = join(directory, name + ".json");
    const { said, exitCode } = await withoutBundler(directory, ...command, "--aot-report=" + report);
    answers[name] = { codes: codesOf(said), exitCode, aotFiles: readBuildReport(report).statistics.TypedVersionsUsed };
  }
  return answers;
}

test.each([
  ["that type checks", untypedArea, `export function area(side: number): number { return side * side; }\n`, []],
  [
    "with a type error",
    untypedArea,
    `export function area(side: number): string { return side * side; }\n`,
    ["TS100009"],
  ],
  [
    "with an int32 that is not proven",
    untypedTwice + `export function area(side) { return (twice(side) * side) / 2; }\n`,
    typedTwice + `export function area(side: number): number { return (twice(side) * side) / 2; }\n`,
    ["TS100066"],
  ],
  [
    "whose int32 is proven",
    untypedTwice + `export function area(side) { return (twice(1) * side * side) / 2; }\n`,
    typedTwice + `export function area(side: number): number { return (twice(1) * side * side) / 2; }\n`,
    [],
  ],
  [
    "with an int32 that is not proven as its module is evaluated",
    untypedTwice + `export const start = twice(size);\n` + untypedArea,
    typedTwice +
      `declare const size: number;\nexport const start: number = twice(size);\nexport function area(side: number): number { return side * side; }\n`,
    ["TS100066"],
  ],
])(
  "bun check --aot says of a file under the aot condition %s what the build says",
  async (_, javascript, typed, codes) => {
    using dir = tempDir("aot-dependency-aot-condition", {
      "package.json": JSON.stringify({ name: "app" }),
      "tsconfig.json": strict(),
      "main.ts": `import { area } from "shapes";\nconsole.log(area(2));\n`,
      "node_modules/shapes/package.json": JSON.stringify({
        name: "shapes",
        version: "1.0.0",
        type: "module",
        exports: { ".": { types: "./index.d.ts", aot: "./index.aot.ts", default: "./index.js" } },
      }),
      "node_modules/shapes/index.js": javascript,
      "node_modules/shapes/index.d.ts": `export declare function area(side: number): number;\n`,
      "node_modules/shapes/index.aot.ts": typed,
    });
    const expected = { codes, exitCode: 0, aotFiles: codes.includes("TS100009") ? 0 : 1 };
    expect(await buildAndCheck(String(dir))).toEqual({ build: expected, check: expected });
  },
  120_000,
);

test("bun check --aot reads the file under the aot condition of a package whose declarations are in @types", async () => {
  using dir = tempDir("aot-dependency-aot-condition", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, types: [] } }),
    "main.ts": `import { area } from "shapes";\nconsole.log(area(2));\n`,
    "node_modules/shapes/package.json": JSON.stringify({
      name: "shapes",
      version: "1.0.0",
      type: "module",
      exports: { ".": { aot: "./index.aot.ts", default: "./index.js" } },
    }),
    "node_modules/shapes/index.js": untypedArea,
    "node_modules/@types/shapes/index.d.ts": `export declare function area(side: number): number;\n`,
    "node_modules/shapes/index.aot.ts": `export function area(side: number): string { return side * side; }\n`,
  });
  const expected = { codes: ["TS100009"], exitCode: 0, aotFiles: 0 };
  expect(await buildAndCheck(String(dir))).toEqual({ build: expected, check: expected });
}, 120_000);

test("a type error beside a decorated class of a dependency does not stop the build either", async () => {
  using dir = tempDir("aot-dependency-decorated", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ experimentalDecorators: true }),
    "main.ts": `import { Marked } from "decorates";\nconsole.log(new Marked().two(), JSON.stringify((Marked.prototype as any).marked));\n`,
    "node_modules/decorates/package.json": JSON.stringify({
      name: "decorates",
      version: "1.0.0",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/decorates/index.ts": `function mark(target: any, key: string) { (target.marked ??= []).push(key); }\nexport class Marked { @mark two(): number { const wrong: string = 2; return 2; } }\n`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).toContain("TS100009");
  expect(said).toContain("decorates");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: '2 ["two"]\n' });
}, 120_000);

test("a workspace package imported by its name is a dependency", async () => {
  using dir = tempDir("aot-dependency-workspace", {
    "apps/web/package.json": JSON.stringify({ name: "web" }),
    "apps/web/tsconfig.json": strict(),
    "apps/web/main.ts": `import { half } from "shared";\nconsole.log(half(4));\n`,
    "packages/shared/package.json": JSON.stringify({ name: "shared", main: "index.ts", types: "index.ts" }),
    "packages/shared/index.ts": `export function half(n: number): number { const wrong: string = n; return n / 2; }\n`,
  });
  mkdirSync(join(String(dir), "apps", "web", "node_modules"));
  symlinkSync(
    join(String(dir), "packages", "shared"),
    join(String(dir), "apps", "web", "node_modules", "shared"),
    "junction",
  );
  const { said, exitCode, stdout } = await build(join(String(dir), "apps", "web"), "./main.ts");
  // A manifest without a version names no package, so the message is about the file.
  expect(said).toContain("TS100010");
  expect(said).toContain("shared");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "2\n" });
}, 120_000);
