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

async function install(root: string, args = ["src/index.ts", "src/version.ts"]) {
  const built = await spawned([bunExe(), "compile", "--library", ...args], join(root, "library"), env);
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

// The bundles of such a package start with `// @bun`, and Bun runs a file with that line as it is written. Its .aot.ts files are TypeScript.
describe.concurrent("a package that bun compile --library --target=bun wrote", () => {
  const printed = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signal: null });

  test("runs from its .aot.ts files under bun run --aot, bun --aot, --conditions=aot and bun test --aot", async () => {
    using dir = tempDir("aot-library-typed-file-for-bun", {
      ...library,
      "app/app.test.ts": `import { expect, test } from "bun:test";
import { total } from "shapes";
test("total", () => expect(total([{ kind: "circle", size: 1 }])).toBe(3));
`,
    });
    await install(String(dir), ["src/index.ts", "src/version.ts", "--target=bun"]);
    const app = join(String(dir), "app");
    const path = join(app, "node_modules/shapes/index.js");
    expect(readFileSync(path, "utf8")).toStartWith("// @bun\n");
    writeFileSync(path, readFileSync(path, "utf8").replace("3 * shape.size", "4 * shape.size"));
    for (const flags of [["run", "--aot"], ["--aot"], ["--conditions=aot"]])
      expect(await spawned([bunExe(), ...flags, "app.ts"], app, env)).toEqual(printed("7 1.2.3\n"));
    expect(await spawned([bunExe(), "app.ts"], app, env)).toEqual(printed("8 1.2.3\n"));
    const tested = await spawned([bunExe(), "test", "--aot", "app.test.ts"], app, env);
    expect(tested.stderr).toMatch(/ 1 pass\r?\n 0 fail\r?\n/);
    expect(tested.exitCode).toBe(0);
  });

  test("is transpiled like any TypeScript, by bun run --aot as for an executable", async () => {
    using dir = tempDir("aot-library-typed-file-for-bun-transpiled", {
      ...library,
      // Bun moves this class to the start of a file that it transpiles. Where the file runs as it is written, read() throws.
      "library/src/version.ts": `export const version: string = read();
function read(): string {
  return new Version().text;
}
class Version {
  text: string = "1.2.3";
}
`,
    });
    await install(String(dir), ["src/index.ts", "src/version.ts", "--target=bun"]);
    expect(await compile(String(dir))).toEqual(USED);
    expect(await spawned([bunExe(), "run", "--aot", "app.ts"], join(String(dir), "app"), env)).toEqual(
      printed("7 1.2.3\n"),
    );
  });
});
