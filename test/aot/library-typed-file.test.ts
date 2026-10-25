import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readBuildReport } from "./harness/build-report";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

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
// index.aot.ts and version.aot.ts are compiled, and the build has nothing to say about them.
const USED = { said: [], aotFiles: 2, exitCode: 0, signal: null, stdout: "7 1.2.3\n" };

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
  const report = join(app, "report.json");
  const build = await spawned([bunExe(), "compile", "./app.ts", "--aot-report=" + report], app, env);
  const said = (build.stdout + build.stderr).split(/\r?\n/).filter(line => /^(note|warn|error): /.test(line));
  const ran = build.exitCode === 0 ? await spawned([join(app, isWindows ? "app.exe" : "app")], app, env) : undefined;
  const aotFiles = build.exitCode === 0 ? readBuildReport(report).statistics.TypedVersionsUsed : undefined;
  return { said, aotFiles, exitCode: build.exitCode, signal: build.signal, stdout: ran?.stdout };
}

describe.concurrent("a program compiled against a package that bun compile --library wrote", () => {
  test(
    "compiles the .aot.ts file of every entry point, without any setup",
    () =>
      slot(async () => {
        using dir = tempDir("aot-library-typed-file", library);
        await install(String(dir));
        expect(await compile(String(dir))).toEqual(USED);
        expect(await spawned([bunExe(), "app.ts"], join(String(dir), "app"), env)).toMatchObject({
          stdout: "7 1.2.3\n",
          exitCode: 0,
        });
      }),
    600_000,
  );

  test.each([
    ["is not strict", { strict: false, skipLibCheck: true, target: "es2017", lib: ["es2017", "dom"] }],
    ["asks for more than strict", { strict: true, noUncheckedIndexedAccess: true, noImplicitOverride: true }],
  ])(
    "an application whose tsconfig.json %s compiles the same .aot.ts files",
    (_, compilerOptions) =>
      slot(async () => {
        using dir = tempDir("aot-library-typed-file-options", {
          ...library,
          "library/src/area.ts": library["library/src/area.ts"].replace(
            "return shape",
            "const sizes = [shape.size];\n  if (sizes[0].valueOf() < 0) return 0;\n  return shape",
          ),
          "app/tsconfig.json": JSON.stringify({
            compilerOptions: { module: "esnext", moduleResolution: "bundler", types: [], ...compilerOptions },
          }),
        });
        await install(String(dir));
        expect(await compile(String(dir))).toEqual(USED);
      }),
    600_000,
  );

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
  ])(
    "%s is written into an .aot.ts file that compiles",
    (_, replacement) =>
      slot(async () => {
        using dir = tempDir("aot-library-typed-file-printed-otherwise", {
          ...library,
          "library/src/area.ts": library["library/src/area.ts"].replace("return shape", replacement),
        });
        await install(String(dir));
        expect(await compile(String(dir))).toEqual(USED);
      }),
    600_000,
  );

  test(
    "a namespace that holds nothing but types is written into an .aot.ts file that compiles",
    () =>
      slot(async () => {
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
      }),
    600_000,
  );

  test(
    "does not read index.js, so a change to it reaches plain Bun alone",
    () =>
      slot(async () => {
        using dir = tempDir("aot-library-typed-file-patched", library);
        await install(String(dir));
        const path = join(String(dir), "app/node_modules/shapes/index.js");
        writeFileSync(path, readFileSync(path, "utf8").replace("3 * shape.size", "4 * shape.size"));
        expect(await compile(String(dir))).toEqual(USED);
        expect(await spawned([bunExe(), "app.ts"], join(String(dir), "app"), env)).toMatchObject({
          stdout: "8 1.2.3\n",
          exitCode: 0,
        });
      }),
    600_000,
  );
});
