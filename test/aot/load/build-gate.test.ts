import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned } from "../run-programs";
import { describe, test } from "../supported";

type Files = Record<string, string>;
type Verdict = (result: Awaited<ReturnType<typeof run>>) => void;

function expectNoSignal({ signal, stderr }: Awaited<ReturnType<typeof spawned>>) {
  expect({ signal, stderr: signal ? stderr : "" }).toEqual({ signal: null, stderr: "" });
}

async function run(folder: string, entry: string, flags: string[] = [], argument = "") {
  const program = join(folder, isWindows ? "program.exe" : "program");
  const command = [bunExe(), "build", "--compile", "--aot", ...flags, "./" + entry, "--outfile", program];
  const build = await spawned(command, folder, { ...bunEnv, NO_COLOR: "1" });
  expectNoSignal(build);
  const lines = (build.stdout + build.stderr).split(/\r?\n/);
  const messages = (prefix: string) =>
    lines.filter(line => line.startsWith(prefix)).map(line => line.slice(prefix.length));
  let stdout: string | undefined;
  if (build.exitCode === 0) {
    const ran = await spawned([program, argument], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expectNoSignal(ran);
    stdout = ran.stdout;
  }
  return {
    errors: messages("error: "),
    warnings: messages("warn: "),
    notes: messages("note: "),
    output: lines.join("\n"),
    exitCode: build.exitCode,
    wroteExecutable: existsSync(program),
    stdout,
  };
}

const codes = (lines: string[]) => lines.map(line => /^TS\d+/.exec(line)?.[0] ?? line);

const tsconfig = (compilerOptions: object = {}) =>
  JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ESNext",
      module: "Preserve",
      moduleResolution: "bundler",
      noEmit: true,
      types: [],
      lib: ["ESNext", "DOM"],
      skipLibCheck: false,
      ...compilerOptions,
    },
  });

// The value comes from the command line: a constant of the wrong type would be a build error.
const probe = (imports: string, calls: string[]) => `${imports}declare const process: { argv: string[] };
const input: any = process.argv[2];
function attempt(run: () => unknown): unknown {
  try {
    return run();
  } catch (error) {
    return (error as Error).name;
  }
}
console.log(${calls.map(call => `attempt(() => ${call})`).join(", ")});
`;

const stops =
  (...expected: string[]): Verdict =>
  ({ errors, exitCode, wroteExecutable }) =>
    expect({ codes: [...new Set(codes(errors))], exitCode, wroteExecutable }).toEqual({
      codes: expected,
      exitCode: 1,
      wroteExecutable: false,
    });

const stopsWithAnyCode: Verdict = ({ errors, exitCode, wroteExecutable }) =>
  expect({ hasErrors: errors.length > 0, exitCode, wroteExecutable }).toEqual({
    hasErrors: true,
    exitCode: 1,
    wroteExecutable: false,
  });

const builds =
  (stdout: string): Verdict =>
  result =>
    expect(result).toMatchObject({ errors: [], warnings: [], exitCode: 0, wroteExecutable: true, stdout });

const DEMOTED =
  /^TS100009: 'dep' has 1 type error \(the first at .*node_modules[\\/]dep[\\/]index\.ts:2:9\), so 1 of its 1 files are compiled without their types\. They still work, but run slower\.$/;

const buildsWithoutTypes: Verdict = result =>
  expect(result).toMatchObject({
    errors: [],
    warnings: [expect.stringMatching(DEMOTED)],
    exitCode: 0,
    wroteExecutable: true,
    stdout: "6\n",
  });

const ANYWHERE = /(?:)/;
const CHECK_JS = { allowJs: true, checkJs: true };

const TYPE_ERROR = 'const n: number = "text";\nconsole.log(n);\n';
const JSDOC_TYPE_ERROR = '/** @type {number} */\nconst n = "text";\nconsole.log(n);\n';
const OPTIONAL_BEFORE_REQUIRED = "function last(a?: number, b: number) {\n  return b;\n}\nconsole.log(last(1, 2));\n";
const UNUSED_LOCAL = "function two() {\n  const unused = 1;\n  return 2;\n}\nconsole.log(two());\n";
const TWO_CONSTRUCTORS = "class Twice {\n  constructor() {}\n  constructor() {}\n}\nconsole.log(Twice.name);\n";

const withDeclarationFile = (declaration: string): Files => ({
  "main.ts": 'import type { T } from "./types";\nconst t: T = 1;\nconsole.log(t);\n',
  "types.d.ts": "export type T = number;\n" + declaration,
});

type Cell = [name: string, compilerOptions: object, files: Files, entry: string, verdict: Verdict, location?: RegExp];

const cells: Cell[] = [
  ["Semantic, Checked", {}, { "main.ts": TYPE_ERROR }, "main.ts", stops("TS2322"), /main\.ts:1:7/],
  ["Semantic, Inferred", CHECK_JS, { "main.js": JSDOC_TYPE_ERROR }, "main.js", builds("text\n")],
  [
    "Semantic, declaration file",
    {},
    withDeclarationFile("export declare const broken: Missing;\n"),
    "main.ts",
    builds("1\n"),
  ],
  ["TypeScriptGrammar, Checked", {}, { "main.ts": OPTIONAL_BEFORE_REQUIRED }, "main.ts", stops("TS1016")],
  [
    "TypeScriptGrammar, declaration file",
    {},
    withDeclarationFile("export declare function last(a?: number, b: number): number;\n"),
    "main.ts",
    builds("1\n"),
  ],
  [
    "Style on, Checked",
    { noUnusedLocals: true },
    { "main.ts": UNUSED_LOCAL },
    "main.ts",
    stops("TS6133"),
    /main\.ts:2:9/,
  ],
  ["Style off, Checked", {}, { "main.ts": UNUSED_LOCAL }, "main.ts", builds("2\n")],
  ["Style on, Inferred", { ...CHECK_JS, noUnusedLocals: true }, { "main.js": UNUSED_LOCAL }, "main.js", builds("2\n")],
  ["EarlyError, Checked", {}, { "main.ts": TWO_CONSTRUCTORS }, "main.ts", stops("TS2392")],
  ["EarlyError, Inferred", {}, { "main.js": TWO_CONSTRUCTORS }, "main.js", stopsWithAnyCode, /main\.js:[23]:/],
  [
    "EarlyError, Inferred import",
    { allowJs: true },
    {
      "main.ts": 'import { one } from "./lib.js";\nconsole.log(one);\n',
      "lib.js": "export const one = 1;\nlet twice;\nlet twice;\n",
    },
    "main.ts",
    stopsWithAnyCode,
    /lib\.js:3:/,
  ],
  [
    "EarlyError, declaration file",
    {},
    withDeclarationFile("export declare function broken(: number): void;\n"),
    "main.ts",
    stopsWithAnyCode,
    /types\.d\.ts:2:/,
  ],
  ["no file", { target: "es1" }, { "main.ts": "console.log(1);\n" }, "main.ts", stops("TS6046")],
];

const callsTwice = (specifier: string) => probe(`import { twice } from "${specifier}";\n`, ["twice(input)"]);
const twice = (line: string) => `export function twice(n: number): number {\n${line}  return n * 2;\n}\n`;
const MISTYPED_LOCAL = "  const text: string = n;\n";

type DependencyCase = [name: string, compilerOptions: object, line: string, verdict: Verdict, location?: RegExp];

const dependencyCases: DependencyCase[] = [
  ["no warning when it has no errors", {}, "", builds("6\n")],
  ["a type error demotes it", {}, MISTYPED_LOCAL, buildsWithoutTypes],
  [
    "a style rule of the application does not demote it",
    { noUnusedLocals: true },
    "  const unused = 1;\n",
    builds("6\n"),
  ],
  ["an early error stops the build", {}, "  let twice;\n  let twice;\n", stopsWithAnyCode, /index\.ts:3:/],
];

describe.concurrent("compile/aot/load/build-gate", () => {
  // A default keeps `location` out of the callback's length: bun:test passes `done` to a callback longer than its case.
  test.each(cells)(
    "%s",
    (_, compilerOptions, files, entry, verdict, location = ANYWHERE) =>
      slot(async () => {
        using dir = tempDir("aot-build-gate", { "tsconfig.json": tsconfig(compilerOptions), ...files });
        const result = await run(String(dir), entry);
        verdict(result);
        expect(result.output).toMatch(location);
      }),
    600_000,
  );

  test.each(dependencyCases)(
    "a dependency: %s",
    (_, compilerOptions, line, verdict, location = ANYWHERE) =>
      slot(async () => {
        using dir = tempDir("aot-build-gate", {
          "tsconfig.json": tsconfig(compilerOptions),
          "main.ts": callsTwice("dep"),
          "node_modules/dep/package.json": JSON.stringify({ name: "dep", version: "1.0.0", main: "index.ts" }),
          "node_modules/dep/index.ts": twice(line),
        });
        const result = await run(String(dir), "main.ts", [], "3");
        verdict(result);
        expect(result.output).toMatch(location);
      }),
    600_000,
  );

  test(
    "the same type error in the program's own file stops the build",
    () =>
      slot(async () => {
        using dir = tempDir("aot-build-gate", {
          "tsconfig.json": tsconfig(),
          "main.ts": callsTwice("./dep/index.ts"),
          "dep/index.ts": twice(MISTYPED_LOCAL),
        });
        const result = await run(String(dir), "main.ts", [], "3");
        stops("TS2322")(result);
        expect(result.warnings).toEqual([]);
      }),
    600_000,
  );
});
