import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "./with-compiler";

const tsconfig = JSON.stringify({
  compilerOptions: {
    strict: true,
    module: "esnext",
    moduleResolution: "bundler",
    target: "esnext",
    types: [],
    lib: ["esnext", "dom"],
    skipLibCheck: true,
  },
});

const library = {
  "library/tsconfig.json": tsconfig,
  "library/package.json": JSON.stringify({ name: "shapes", version: "1.2.3" }),
  "library/src/index.ts": `import { area } from "./area";
export interface Shape {
  kind: "circle" | "square";
  size: number;
}
export function total(shapes: Shape[]): number {
  let sum = 0;
  for (const shape of shapes) sum += area(shape);
  return sum;
}
`,
  "library/src/area.ts": `import type { Shape } from "./index";
export function area(shape: Shape): number {
  return shape.kind === "circle" ? 3 * shape.size ** 2 : shape.size ** 2;
}
`,
  "library/src/version.ts": `export const version: string = "1.2.3";\n`,
  "app/tsconfig.json": tsconfig,
  "app/package.json": JSON.stringify({ name: "app", dependencies: { shapes: "1.2.3" } }),
  "app/app.ts": `import { total } from "shapes";
import { version } from "shapes/version";
console.log(total([{ kind: "square", size: 2 }, { kind: "circle", size: 1 }]), version);
`,
};

const env = { ...bunEnv, NO_COLOR: "1" };

async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}
// app.ts, index.aot.ts and version.aot.ts are compiled with their types, and the build has nothing to say about them.
const USED = { said: [], typedFiles: 3, exitCode: 0, signal: null, stdout: "7 1.2.3\n" };

async function install(root: string) {
  const built = await spawned(
    [bunExe(), "compile", "--library", "src/index.ts", "src/version.ts"],
    join(root, "library"),
    env,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  cpSync(join(root, "library/dist"), join(root, "app/node_modules/shapes"), { recursive: true });
}

async function compile(root: string) {
  const app = join(root, "app");
  const build = await spawned([bunExe(), "compile", "./app.ts", "--explain=statistics"], app, env);
  const said = (build.stdout + build.stderr).split(/\r?\n/).filter(line => /^(note|warn|error): /.test(line));
  const ran = build.exitCode === 0 ? await spawned([join(app, isWindows ? "app.exe" : "app")], app, env) : undefined;
  const typedFiles = Number(/^SourceFilesChecked (\d+)$/m.exec(build.stderr)?.[1]);
  return { said, typedFiles, exitCode: build.exitCode, signal: build.signal, stdout: ran?.stdout };
}

describe.concurrent("a program compiled against a package that bun compile --library wrote", () => {
  test("compiles the .aot.ts file of every entry point, without any setup", async () => {
    using dir = tempDir("aot-library-typed-file", library);
    await install(String(dir));
    expect(await compile(String(dir))).toEqual(USED);
    expect(await spawned([bunExe(), "app.ts"], join(String(dir), "app"), env)).toMatchObject({
      stdout: "7 1.2.3\n",
      exitCode: 0,
    });
  });

  test.each([
    [
      "a member that is named like the variable it is cast from",
      "const size: unknown = shape.size;\n  shape = { kind: shape.kind, size: size as number };\n  return shape",
    ],
    [
      "a cast of an optional chain in parentheses",
      "const other: { shape?: { size: unknown } } = { shape };\n  shape = { kind: shape.kind, size: (other.shape?.size as number) ?? 1 };\n  return shape",
    ],
    [
      "a cast of an optional chain that another chain starts from",
      'const other: { shape?: { size: unknown } } = { shape };\n  if ((other.shape?.size as number | undefined)?.toFixed() === "") return 0;\n  return shape',
    ],
  ])("%s is written into an .aot.ts file that compiles", async (_, replacement) => {
    using dir = tempDir("aot-library-typed-file-printed-otherwise", {
      ...library,
      "library/src/area.ts": library["library/src/area.ts"].replace("return shape", replacement),
    });
    await install(String(dir));
    expect(await compile(String(dir))).toEqual(USED);
  });

  test("a type guard whose parameter the bundle renames is written into an .aot.ts file that compiles", async () => {
    using dir = tempDir("aot-library-typed-file-renamed-guard", {
      ...library,
      "library/src/fallback.ts": `import type { Shape } from "./index";
export const shape: Shape = { kind: "square", size: 1 };
`,
      // The bundle calls the fallback `shape`, and so each parameter `shape` of a function that reads it `shape2`. It reads the
      // global `document` too, and so calls a parameter of that name `document2`.
      "library/src/guards.ts": `import { shape as fallback } from "./fallback";
import type { Shape } from "./index";
export function isShape(shape: unknown): shape is Shape {
  return typeof shape === "object" && shape !== null && "size" in shape && fallback.size > 0;
}
export const isSize = (shape: unknown): shape is number => typeof shape === "number" && fallback.size > 0;
export class Guards {
  isKind(shape: unknown): shape is Shape["kind"] {
    return (shape === "circle" || shape === "square") && fallback.size > 0;
  }
}
export function assertShape(shape: unknown): asserts shape is Shape {
  if (!isShape(shape) || fallback.size < 0) throw new TypeError("not a shape");
}
export function assertGiven(shape: Shape | undefined): asserts shape {
  if (!shape || fallback.size < 0) throw new TypeError("not given");
}
export function isSameShape(shape: unknown, other: typeof shape): shape is Shape {
  return isShape(shape) && other === shape && fallback.size > 0;
}
export function isSizeOf(shape: unknown, size: unknown): size is number {
  return isShape(shape) && size === shape.size && fallback.size > 0;
}
export function isTitle(document: unknown): document is string {
  return typeof document === "string";
}
export const title: string = typeof document === "undefined" ? "none" : document.title;
`,
      "library/src/index.ts": library["library/src/index.ts"] + `export * from "./guards";\n`,
      "app/app.ts": `import { assertGiven, assertShape, Guards, isSameShape, isShape, isSize, isSizeOf, isTitle, title, total, type Shape } from "shapes";
import { version } from "shapes/version";
const [first, second, third, fourth, fifth, sixth]: unknown[] = [{ kind: "square", size: 2 }, 3, "circle", { kind: "circle", size: 1 }, "t", 2];
const given: Shape | undefined = [{ kind: "square", size: 4 } satisfies Shape].pop();
assertShape(fourth);
assertGiven(given);
console.log(
  isShape(first) ? total([first]) : -1,
  isSize(second) ? second.toFixed(1) : "",
  new Guards().isKind(third) ? third.length : -1,
  fourth.kind,
  given.size,
  isSameShape(first, first) ? first.size : -1,
  isSizeOf(first, sixth) ? sixth + 1 : -1,
  isTitle(fifth) ? fifth.length : -1,
  title,
  version,
);
`,
    });
    await install(String(dir));
    const typed = readFileSync(join(String(dir), "app/node_modules/shapes/index.aot.ts"), "utf8");
    expect(typed.match(/\(\w+: [^)]+\): (?:asserts \w+(?: is \S+)?|\w+ is \S+)/g)).toEqual([
      "(shape2: unknown): shape2 is Shape",
      "(shape2: unknown): shape2 is number",
      '(shape2: unknown): shape2 is Shape["kind"]',
      "(shape2: unknown): asserts shape2 is Shape",
      "(shape2: Shape | undefined): asserts shape2",
      "(shape2: unknown, other: typeof shape2): shape2 is Shape",
      "(shape2: unknown, size: unknown): size is number",
      "(document2: unknown): document2 is string",
    ]);
    expect(await compile(String(dir))).toEqual({ ...USED, stdout: "4 3.0 6 circle 4 2 3 1 none 1.2.3\n" });
  });

  test("a namespace that holds nothing but types is written into an .aot.ts file that compiles", async () => {
    using dir = tempDir("aot-library-typed-file-namespace-of-types", {
      ...library,
      "library/src/area.ts": `import type { Shape } from "./index";
export namespace Sizes {
  export type Size = number;
  export namespace Named {
    export interface Pair {
      name: string;
      size: Size;
    }
  }
}
export function area(shape: Shape): Sizes.Size {
  const pair: Sizes.Named.Pair = { name: shape.kind, size: shape.size };
  return pair.name === "circle" ? 3 * pair.size ** 2 : pair.size ** 2;
}
`,
    });
    await install(String(dir));
    expect(await compile(String(dir))).toEqual(USED);
  });

  test("does not read index.js, so a change to it reaches plain Bun alone", async () => {
    using dir = tempDir("aot-library-typed-file-patched", library);
    await install(String(dir));
    const path = join(String(dir), "app/node_modules/shapes/index.js");
    writeFileSync(path, readFileSync(path, "utf8").replace("3 * shape.size", "4 * shape.size"));
    expect(await compile(String(dir))).toEqual(USED);
    expect(await spawned([bunExe(), "app.ts"], join(String(dir), "app"), env)).toMatchObject({
      stdout: "8 1.2.3\n",
      exitCode: 0,
    });
  });
});
