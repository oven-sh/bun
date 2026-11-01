// `bun test` takes of tsconfig.json what it can read and runs the tests, so under --aot a fault in it is a warning.
// An executable isn't built: there every type error stops the build.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const project = {
  "package.json": `{ "name": "faulty-tsconfig" }`,
  "node_modules/@types/bun/package.json": `{ "name": "@types/bun", "version": "1.0.0", "types": "index.d.ts" }`,
  "node_modules/@types/bun/index.d.ts": `declare module "bun:test" {
  export function test(name: string, run: () => void): void;
  export function expect(value: unknown): { toBe(expected: unknown): void };
}
declare var console: { log(...data: unknown[]): void };
`,
  "src/add.ts": `export function add(a: number, b: number): number { return a + b; }\n`,
  "src/add.test.ts": `import { expect, test } from "bun:test";
import { add } from "@/add";
test("adds", () => { expect(add(1, 2)).toBe(3); });
`,
  "src/main.ts": `import { add } from "@/add";\nconsole.log(add(1, 2));\n`,
};

const faults: [string, string, (paths: object) => object][] = [
  [
    `"types" names a package that isn't installed`,
    "TS2688",
    paths => ({ compilerOptions: { strict: true, paths, types: ["not-installed"] } }),
  ],
  [
    `"extends" names a file that isn't there`,
    "TS5083",
    paths => ({ extends: "./missing.json", compilerOptions: { strict: true, paths } }),
  ],
  [
    "an option that TypeScript doesn't know",
    "TS5023",
    paths => ({ compilerOptions: { strict: true, paths, nothingOfThisName: true } }),
  ],
];
const places: [string, (config: (paths: object) => object) => Record<string, string>][] = [
  ["of the project", config => ({ "tsconfig.json": JSON.stringify(config({ "@/*": ["./src/*"] })) })],
  [
    "of the folder of the tests",
    config => ({
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
      "src/tsconfig.json": JSON.stringify(config({ "@/*": ["./*"] })),
    }),
  ],
];
const forms: [string, string, string[]][] = [
  ["as the run is built by itself", "", []],
  ["one program", "TestRunLayers:0", []],
  ["three layers", "TestRunLayers:3", ["--isolate"]],
];

for (const [fault, code, config] of faults) {
  for (const [place, files] of places) {
    for (const [form, words, flags] of forms) {
      test.concurrent(`${fault}, in the tsconfig.json ${place}: the tests run, ${form}`, async () => {
        using dir = tempDir("faulty-tsconfig", { ...project, ...files(config) });
        await using run = Bun.spawn({
          cmd: [bunExe(), "test", "--aot", ...flags],
          env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" },
          cwd: String(dir),
          stdout: "ignore",
          stderr: "pipe",
        });
        const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
        expect(stderr.split("\n").filter(line => line.startsWith("error"))).toEqual([]);
        expect(stderr).toContain(`warn: ${code}`);
        expect(stderr).not.toContain("AOT build starts over");
        expect(stderr).toContain(" 1 pass");
        expect(exitCode).toBe(0);
      });
    }
  }

  test.concurrent(`${fault}: no executable is built`, async () => {
    using dir = tempDir("faulty-tsconfig", { ...project, ...places[0][1](config) });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--aot", "src/main.ts", "--outfile", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "ignore",
      stderr: "pipe",
    });
    const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
    expect(stderr).toContain(`error: ${code}`);
    expect(exitCode).toBe(1);
  });
}
