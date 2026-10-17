import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { test } from "./supported";

async function build(directory: string, entryPoint: string) {
  const outfile = join(directory, "out" + (isWindows ? ".exe" : ""));
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", entryPoint, "--outfile", outfile],
    cwd: directory,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [said, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  if (exitCode) return { said, exitCode, stdout: "" };
  await using ran = Bun.spawn({ cmd: [outfile], cwd: directory, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout] = await Promise.all([ran.stdout.text(), ran.exited]);
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

test("a package that ships its TypeScript stays typed when it only disagrees with the application's ambient declarations", async () => {
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
}, 120_000);

test("a package that reads a member of globalThis that the application's lib does not declare stays typed", async () => {
  using dir = tempDir("aot-dependency-global-this", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ lib: ["ESNext"] }),
    "main.ts": `import { half, title } from "ships-typescript";\nconsole.log(title(), half(4));\n`,
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

test("a type error beside a decorated class of a dependency does not stop the build either", async () => {
  using dir = tempDir("aot-dependency-decorated", {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": strict({ experimentalDecorators: true }),
    "main.ts": `import { Marked } from "decorates";\nconsole.log(new Marked().two(), JSON.stringify((Marked.prototype as any).marked));\n`,
    "node_modules/decorates/package.json": JSON.stringify({ name: "decorates", main: "index.ts", types: "index.ts" }),
    "node_modules/decorates/index.ts": `function mark(target: any, key: string) { (target.marked ??= []).push(key); }\nexport class Marked { @mark two(): number { const wrong: string = 2; return 2; } }\n`,
  });
  const { said, exitCode, stdout } = await build(String(dir), "./main.ts");
  expect(said).toContain("TS100009");
  expect(said).toContain("decorates");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: '2 ["two"]\n' });
}, 120_000);

test.skipIf(isWindows)(
  "a workspace package imported by its name is a dependency",
  async () => {
    using dir = tempDir("aot-dependency-workspace", {
      "apps/web/package.json": JSON.stringify({ name: "web" }),
      "apps/web/tsconfig.json": strict(),
      "apps/web/main.ts": `import { half } from "shared";\nconsole.log(half(4));\n`,
      "packages/shared/package.json": JSON.stringify({ name: "shared", main: "index.ts", types: "index.ts" }),
      "packages/shared/index.ts": `export function half(n: number): number { const wrong: string = n; return n / 2; }\n`,
    });
    mkdirSync(join(String(dir), "apps", "web", "node_modules"));
    symlinkSync(join(String(dir), "packages", "shared"), join(String(dir), "apps", "web", "node_modules", "shared"));
    const { said, exitCode, stdout } = await build(join(String(dir), "apps", "web"), "./main.ts");
    expect(said).toContain("TS100009");
    expect(said).toContain("shared");
    expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "2\n" });
  },
  120_000,
);
