import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
const USED = 'note: "shapes" 1.2.3 is compiled from its full types in node_modules/shapes';

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
  const build = await spawned([bunExe(), "compile", "./app.ts"], app, env);
  const said = (build.stdout + build.stderr)
    .split(/\r?\n/)
    .filter(line => /^(note|warn|error): /.test(line) && !/ full types, and /.test(line));
  const ran = build.exitCode === 0 ? await spawned([join(app, isWindows ? "app.exe" : "app")], app, env) : undefined;
  return { said, exitCode: build.exitCode, signal: build.signal, stdout: ran?.stdout };
}

describe.concurrent("a program compiled against a package that bun compile --library wrote", () => {
  test(
    "uses the full-types files of every entry point, without any setup",
    () =>
      slot(async () => {
        using dir = tempDir("aot-library-typed-file", library);
        await install(String(dir));
        expect(await compile(String(dir))).toEqual({ said: [USED], exitCode: 0, signal: null, stdout: "7 1.2.3\n" });
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
    "an application whose tsconfig.json %s gets the same full-types files",
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
        expect(await compile(String(dir))).toEqual({ said: [USED], exitCode: 0, signal: null, stdout: "7 1.2.3\n" });
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
    "%s keeps the full-types files in use",
    (_, replacement) =>
      slot(async () => {
        using dir = tempDir("aot-library-typed-file-printed-otherwise", {
          ...library,
          "library/src/area.ts": library["library/src/area.ts"].replace("return shape", replacement),
        });
        await install(String(dir));
        expect(await compile(String(dir))).toEqual({ said: [USED], exitCode: 0, signal: null, stdout: "7 1.2.3\n" });
      }),
    600_000,
  );

  test(
    "a namespace that holds nothing but types keeps the full-types files in use",
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
        expect(await compile(String(dir))).toEqual({ said: [USED], exitCode: 0, signal: null, stdout: "7 1.2.3\n" });
      }),
    600_000,
  );

  test(
    "a patched file is compiled without types, with a warning",
    () =>
      slot(async () => {
        using dir = tempDir("aot-library-typed-file-patched", library);
        await install(String(dir));
        const path = join(String(dir), "app/node_modules/shapes/index.js");
        writeFileSync(path, readFileSync(path, "utf8").replace("3 * shape.size", "4 * shape.size"));
        expect(await compile(String(dir))).toEqual({
          said: [
            `warn: "shapes" is compiled without types, because its full types in node_modules/shapes can't be used: index.full.ts without its types doesn't match index.js. Was the package patched?`,
          ],
          exitCode: 0,
          signal: null,
          stdout: "8 1.2.3\n",
        });
      }),
    600_000,
  );
});
