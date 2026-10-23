// One call of `Bun.build` with `compile`, made twice: without `aot` and with it. The build without `aot` says what is right:
// both builds succeed or both fail, the plugins are told the same things, and both executables print the same and exit alike.
//
//   files      the folder of the program. "main.ts" is the entry point unless `options` names others
//   plugins    the body of `setup(build)` of each plugin, in order. `tell(hook, args)` records what a hook was told
//   options    more properties for the object that Bun.build gets, as text. `folder` is the folder of the program
//   compile    more properties for its `compile`, as text
//   prints     what both executables print
//   fails      the build fails both ways, and the messages of both hold this text
//   differs    where the executable built with `aot` is meant to differ from the other one, and the case says why: what it prints,
//              its exit code, what the plugins are told ("<folder>" stands for the folder of the program)
//   refused    the build with `aot` fails, and one of its messages holds this text; the other build succeeds
//   interprets the executable loads code at run time, so it is not run with BUN_JSC_crashIfInterpreterIsUsed=1
//   arguments  the arguments of the executable
//   env        more variables for the builds and for the executables
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

export type Case = {
  files: Record<string, string>;
  plugins?: string[];
  options?: string;
  compile?: string;
  prints?: string;
  fails?: string;
  differs?: { stdout?: string; exitCode?: number; told?: string[]; outputs?: string[] };
  refused?: string;
  interprets?: true;
  arguments?: string[];
  env?: Record<string, string>;
};

const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, module: "preserve", moduleResolution: "bundler", resolveJsonModule: true, allowJs: true, allowImportingTsExtensions: true, noEmit: true, jsx: "react-jsx", types: [] },
  exclude: ["build.ts"],
});

// Hooks run on several threads' behalf, so the order in which different modules come up is not part of what is compared. What one
// module or one import is told by several plugins stays in order: the sort is stable and its key is the hook and the path.
// A file that imports one specifier twice asks once or twice.
function buildScript({ plugins = [], options = "", compile = "" }: Case) {
  return `import { basename, dirname, join } from "path";
const [outfile, how] = process.argv.slice(2);
const folder = import.meta.dir;
const told: [string, string][] = [];
function tell(hook: string, args: Record<string, unknown> = {}) {
  const shown = Object.entries(args).map(([name, value]) => name + "=" + (typeof value === "function" ? "function" : JSON.stringify(value)));
  told.push([hook + " " + String(args.path ?? ""), hook + " " + shown.join(" ")]);
}
const plugins = [${plugins.map((setup, index) => `{ name: "plugin ${index + 1}", async setup(build: any) {\n${setup}\n} }`).join(", ")}];
let success = false;
let messages: string[] = [];
let outputs: string[] = [];
try {
  const result = await Bun.build({ entrypoints: ["./main.ts"], plugins, throw: false, ${options}${options && ","} compile: { outfile, aot: how === "aot", ${compile} } });
  success = result.success;
  messages = result.logs.filter(log => log.level === "error").map(log => String(log.message));
  outputs = result.outputs.map(output => output.kind);
} catch (error: any) {
  messages = ["Bun.build rejected: " + (error?.message ?? error), ...(error?.errors ?? []).map((inner: any) => String(inner?.message ?? inner))];
}
told.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
// On Windows the folder has backslashes, which JSON.stringify doubles.
const tidy = (line: string) => line.replaceAll(JSON.stringify(folder).slice(1, -1), "<folder>").replace(/<folder>[^"]*/g, path => path.replace(/\\\\+/g, "/"));
const lines = told.map(entry => tidy(entry[1])).filter((line, index, all) => line !== all[index - 1]);
console.log(JSON.stringify({ success, messages, outputs, told: lines }));
`;
}

async function buildAndRun(folder: string, how: "plain" | "aot", it: Case) {
  const env = { ...bunEnv, ...it.env };
  const executable = join(folder, how + (isWindows ? ".exe" : ""));
  const build = await spawned([bunExe(), "build.ts", executable, how], folder, env);
  let answer: { success: boolean; messages: string[]; outputs: string[]; told: string[] };
  try {
    answer = JSON.parse(build.stdout.slice(build.stdout.lastIndexOf("\n", build.stdout.length - 2) + 1));
  } catch {
    return { how, died: { stdout: build.stdout, stderr: build.stderr, exitCode: build.exitCode, signal: build.signal } };
  }
  if (!answer.success) return { how, ...answer };
  const ran = await spawned([executable, ...(it.arguments ?? [])], folder, how === "aot" && !it.interprets ? { ...env, BUN_JSC_crashIfInterpreterIsUsed: "1" } : env);
  return { how, ...answer, stdout: ran.stdout, stderr: ran.exitCode === 0 ? "" : ran.stderr, exitCode: ran.exitCode, signal: ran.signal };
}

// The text of a failure is each build's own. That of an uncaught error names paths, which differ between the two.
function compared({ how, messages, stderr, ...rest }: Record<string, any>) {
  return rest;
}

export function buildBothWays(title: string, cases: Record<string, Case>) {
  describe.concurrent(title, () => {
    for (const [name, it] of Object.entries(cases)) {
      test(
        name,
        () =>
          slot(async () => {
            using dir = tempDir("aot-build-both-ways", { "tsconfig.json": tsconfig, ...it.files, "build.ts": buildScript(it) });
            const folder = String(dir);
            const plain = await buildAndRun(folder, "plain", it);
            const aot = await buildAndRun(folder, "aot", it);
            if (it.fails !== undefined) {
              for (const built of [plain, aot]) expect(built).toMatchObject({ success: false, messages: expect.arrayContaining([expect.stringContaining(it.fails)]) });
            } else {
              expect(plain).toMatchObject({ success: true, messages: [], ...(it.prints === undefined ? {} : { stdout: it.prints }) });
              if (it.refused !== undefined) return void expect(aot).toMatchObject({ success: false, messages: expect.arrayContaining([expect.stringContaining(it.refused)]) });
              expect(aot).toMatchObject({ success: true, messages: [] });
            }
            expect(compared(aot)).toEqual({ ...compared(plain), ...it.differs });
          }),
        600_000,
      );
    }
  });
}
