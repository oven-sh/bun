// Native plugins of `Bun.build` (onBeforeParse) and the loader "napi", without `aot` and with `compile: { aot: true }`. Each case
// states what both builds yield: whether the build succeeds, its messages, what the hooks are told and what the executable prints.
// A build is what costs: the cases whose filters name a folder lie in one program, each in its folder, and that program is built
// twice and run twice for all of them. A filter that names no folder reaches every file of a build, and a build that fails has
// nothing to run: such a case is a program of its own. The shared builds of build-both-ways.ts take plugins of onLoad and
// onResolve only.
// ./build-plugins-native/shout.c is built with the system's C compiler against the headers in src/runtime/napi, without node-gyp.
// Runs alone: one build of CI measures where the time of this file goes on macOS x64. This line and what says TIMES go again.
import { afterAll, beforeAll, expect } from "bun:test";
import { copyFileSync, rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { cpus, loadavg, release } from "os";
import { join, resolve } from "path";
import { slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

type Case = {
  /** Its folder in the program that it shares. A case without one is a program of its own. */
  folder?: string;
  /** "main.ts" is where the case starts. */
  files: Record<string, string>;
  /** The body of `setup(build)`. `napiModule` is the addon, `addon` is its path, and `tell(hook, args)` records what a hook was told. */
  plugin: string;
  /** What both executables print. */
  prints?: string;
  /** What the hooks of both builds are told. "<folder>" stands for the folder of the program. */
  told?: string[];
  /** Both builds fail, with these messages. */
  fails?: string[];
};

// As in build-both-ways.ts.
const tsconfig = {
  compilerOptions: {
    strict: true,
    module: "preserve",
    moduleResolution: "bundler",
    resolveJsonModule: true,
    allowJs: true,
    allowImportingTsExtensions: true,
    noEmit: true,
    jsx: "react-jsx",
    types: [],
  },
  exclude: ["build.ts"],
};

// TIMES: each child process says when it started, in ms from the start of the file, and how long it took.
const began = performance.now();
const machine = () =>
  `${process.platform} ${process.arch} ${release()}, ${cpus().length} processors, load ${loadavg()
    .map(load => load.toFixed(1))
    .join(" ")}`;
function says(start: number, what: string) {
  const ms = (time: number) => String(Math.round(time)).padStart(7);
  console.error(`TIMES ${ms(start - began)} +${ms(performance.now() - start)} ms  ${what}`);
}
async function timed<T>(what: string, work: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    says(start, what);
  }
}

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
if (!systemCC || isWindows)
  console.error(
    "SKIPPED: test/aot/build-plugins-native.test.ts: it needs a C compiler ($CC, cc, gcc or clang), and is not written for Windows",
  );
else {
  const folder = String(tempDir("aot-build-plugins-native", {}));
  const addon = join(folder, "shout.node");
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  afterAll(() => says(began, `the whole file, on ${machine()}`));
  const cc = (output: string) =>
    spawned(
      [
        systemCC,
        "-shared",
        "-fPIC",
        ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
        "-I" + resolve(import.meta.dir, "../../src/runtime/napi"),
        "-I" + resolve(import.meta.dir, "../../packages/bun-native-bundler-plugin-api"),
        join(import.meta.dir, "build-plugins-native", "shout.c"),
        "-o",
        output,
      ],
      folder,
      bunEnv,
    );
  beforeAll(async () => {
    console.error(`TIMES on ${machine()}`);
    const compile = await timed("cc", () => cc(addon));
    expect({ stderr: compile.stderr, exitCode: compile.exitCode }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });
  });

  const files = {
    "main.ts": `import { a } from "./a"; import text from "./note.txt"; console.log("quiet main", a, text);`,
    "a.ts": `export const a: string = "quiet a";`,
    "note.txt": "quiet text",
    "types.d.ts": `declare module "*.txt" { const text: string; export default text; }`,
  };

  const cases: Record<string, Case> = {
    "onBeforeParse changes the text of the files that match": {
      folder: "match",
      files,
      plugin: `build.onBeforeParse({ filter: /match\\/a\\.ts$/ }, { napiModule, symbol: "shout" });`,
      prints: "quiet main LOUD! a quiet text\n",
    },
    "onBeforeParse for every file": {
      files,
      plugin: `build.onBeforeParse({ filter: /.*/ }, { napiModule, symbol: "shout" });`,
      prints: "LOUD! main LOUD! a LOUD! text\n",
    },
    // A module that onLoad answers for has its text, so the step that reads a file, which is the one that calls onBeforeParse, is
    // left out for it: schedule_with_options in src/bundler/ThreadPool.rs. Every module of a namespace has its text from onLoad.
    "onBeforeParse does not change the text that onLoad yields": {
      folder: "yielded",
      files,
      plugin: `build.onBeforeParse({ filter: /yielded\\/a\\.ts$/ }, { napiModule, symbol: "shout" });
build.onLoad({ filter: /yielded\\/a\\.ts$/ }, () => ({ contents: 'export const a: string = "quiet from onLoad";', loader: "ts" }));`,
      prints: "quiet main quiet from onLoad quiet text\n",
    },
    "onBeforeParse in a namespace does not change the text that onLoad yields": {
      folder: "namespace",
      files: { "main.ts": `// @ts-ignore\nimport { a } from "virtual:a"; console.log(a);` },
      plugin: `build.onBeforeParse({ filter: /.*/, namespace: "virtual" }, { napiModule, symbol: "shout" });
build.onResolve({ filter: /^virtual:/ }, (args: any) => ({ path: args.path.slice(8), namespace: "virtual" }));
build.onLoad({ filter: /.*/, namespace: "virtual" }, () => ({ contents: 'export const a = "quiet virtual";', loader: "js" }));`,
      prints: "quiet virtual\n",
    },
    "the external value, and how many files the plugin sees": {
      files,
      plugin: `const external = napiModule.createCounter();
build.onBeforeParse({ filter: /\\.ts$/ }, { napiModule, symbol: "count", external });
build.onEnd(() => tell("onEnd", { seen: napiModule.readCounter(external) }));`,
      prints: "LOUD! main LOUD! a quiet text\n",
      told: ["onEnd seen=2"],
    },
    "the loader napi: an addon whose bytes onLoad yields": {
      folder: "napi",
      files: {
        "main.ts": `// @ts-nocheck\nimport addon from "bytes:addon.node"; const required = require("./empty.node"); const counter = addon.createCounter(); console.log(typeof addon.createCounter, addon.readCounter(counter), typeof required.readCounter);`,
        "empty.node": "",
      },
      plugin: `const bytes = () => ({ contents: require("fs").readFileSync(addon), loader: "napi" });
build.onResolve({ filter: /^bytes:/ }, (args: any) => ({ path: args.path.slice(6), namespace: "bytes" }));
build.onLoad({ filter: /.*/, namespace: "bytes" }, bytes);
build.onLoad({ filter: /napi\\/empty\\.node$/ }, (args: any) => { tell("onLoad", args); return bytes(); });`,
      prints: "function 0 function\n",
      told: ['onLoad path="<folder>/napi/empty.node" namespace="file" loader="napi" defer=function side="server"'],
    },
    "an error that the native plugin logs": {
      files,
      plugin: `build.onBeforeParse({ filter: /a\\.ts$/ }, { napiModule, symbol: "refuse" });`,
      fails: ["the native plugin refuses this file"],
    },
    "a symbol that the addon does not have": {
      files,
      plugin: `build.onBeforeParse({ filter: /a\\.ts$/ }, { napiModule, symbol: "missing" });`,
      fails: ['Bun.build rejected: Could not find the symbol "missing" in the given napi module.'],
    },
  };

  // `bun build.ts <outfile> plain|aot` builds the program and prints, on its last line, what the build yields and what the hooks of
  // each case were told.
  const buildScript = (program: Case[]) => `const [outfile, how] = process.argv.slice(2);
const addon = ${JSON.stringify(addon)};
const began = performance.now();
const napiModule = require(addon);
const required = performance.now();
const told: string[][] = [${program.map(() => "[]").join(", ")}];
const shown = (value: unknown) => (typeof value === "function" ? "function" : JSON.stringify(value));
const plugins = [${program
    .map(
      ({ plugin }, index) => `{ name: "plugin ${index + 1}", async setup(build: any) {
const tell = (hook: string, args: Record<string, unknown>) =>
  told[${index}].push((hook + " " + Object.entries(args).map(([name, value]) => name + "=" + shown(value)).join(" ")).replaceAll(import.meta.dir, "<folder>"));
${plugin}
} }`,
    )
    .join(", ")}];
let built: { success: boolean; messages: string[]; outputs: string[] };
try {
  const result = await Bun.build({ entrypoints: ["./main.ts"], plugins, throw: false, compile: { outfile, aot: how === "aot" } });
  built = { success: result.success, messages: result.logs.filter(log => log.level === "error").map(log => String(log.message)), outputs: result.outputs.map(output => output.kind) };
} catch (error: any) {
  built = { success: false, messages: ["Bun.build rejected: " + error.message], outputs: [] };
}
console.log(JSON.stringify({ ...built, told, ms: [Math.round(required - began), Math.round(performance.now() - required)] }));
`;

  // A program of several cases starts each in turn, behind a line that names its folder.
  function filesOf(program: Case[]) {
    const own = (it: Case) => ({ "tsconfig.json": JSON.stringify(tsconfig), ...it.files });
    if (!program[0].folder) return own(program[0]);
    return {
      "tsconfig.json": JSON.stringify({ ...tsconfig, files: ["main.ts"] }),
      "main.ts": program.map(it => `console.log("${it.folder}:");\nawait import("./${it.folder}/main.ts");\n`).join(""),
      ...Object.fromEntries(
        program.flatMap(it => Object.entries(own(it)).map(([name, text]) => [`${it.folder}/${name}`, text])),
      ),
    };
  }

  async function buildAndRun(program: string, how: "plain" | "aot", label: string) {
    const executable = join(program, how);
    const started = performance.now();
    const build = await timed(`${label}: build ${how}`, () =>
      spawned([bunExe(), "build.ts", executable, how], program, bunEnv),
    );
    let answer:
      { success: boolean; messages: string[]; outputs: string[]; told: string[][]; ms?: number[] } | undefined;
    try {
      answer = JSON.parse(build.stdout.slice(build.stdout.lastIndexOf("\n", build.stdout.length - 2) + 1));
    } catch {}
    if (answer?.ms) {
      says(
        started,
        `${label}: build ${how}, of which require(addon) ${answer.ms[0]} ms and Bun.build ${answer.ms[1]} ms`,
      );
      delete answer.ms;
    }
    // A build that answers and then ends with anything but 0 has died too.
    if (!answer || build.exitCode !== 0) return { how, died: build };
    if (!answer.success) return { how, ...answer };
    // An executable that was built with `aot` ends where it would interpret.
    const env = how === "aot" ? { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" } : bunEnv;
    const ran = await timed(`${label}: run ${how}`, () => spawned([executable], program, env));
    await timed(`${label}: run ${how} once more`, () => spawned([executable], program, env));
    return { how, ...answer, ...ran };
  }

  async function bothWays(program: Case[], label: string) {
    using dir = tempDir("aot-build-plugins-native", { ...filesOf(program), "build.ts": buildScript(program) });
    return [await buildAndRun(String(dir), "plain", label), await buildAndRun(String(dir), "aot", label)];
  }

  /** What the build of a program and its run yield for one of its cases. */
  function of({ told, stdout, ...rest }: Record<string, any>, program: Case[], index: number) {
    const printed = (all: string) => {
      if (!program[index].folder) return all;
      const parts = all.split(new RegExp(`^(?:${program.map(it => it.folder).join("|")}):\n`, "m"));
      // A program of several cases names each folder once, in turn, and prints nothing in front of the first. Where it prints
      // anything else, no part is a case's own, and each case is shown all of it.
      return program.map((it, at) => `${it.folder}:\n${parts[at + 1]}`).join("") === all ? parts[index + 1] : all;
    };
    return { ...rest, ...(told && { told: told[index] }), ...(stdout !== undefined && { stdout: printed(stdout) }) };
  }

  describe.concurrent("compile/aot/native plugins of Bun.build", () => {
    const together = Object.values(cases).filter(it => it.folder);
    const built = new Map<Case, ReturnType<typeof bothWays>>();
    test.each(Object.entries(cases))(
      "%s",
      async (name, it) => {
        const program = it.folder ? together : [it];
        const label = it.folder ? together.map(one => one.folder).join("+") : name;
        const asked = performance.now();
        const both = await built.getOrInsertComputed(program[0], () =>
          slot(() => (says(asked, `${label}: waited for a slot`), bothWays(program, label))),
        );
        const yields = it.fails
          ? { success: false, messages: it.fails, outputs: [], told: [] }
          : {
              success: true,
              messages: [],
              outputs: ["entry-point"],
              told: it.told ?? [],
              stdout: it.prints,
              stderr: "",
              exitCode: 0,
              signal: null,
            };
        expect(both.map(one => of(one, program, program.indexOf(it)))).toEqual([
          { how: "plain", ...yields },
          { how: "aot", ...yields },
        ]);
      },
      // The limit that build-both-ways.ts gives its tests, which wait for the same four children. This folder's default of 120 s
      // is below the 240 s at which spawned() ends one child under a sanitizer: a test could end with its child still running.
      600_000,
    );
  });

  // TIMES: what it costs a process on macOS to load an addon that it has not seen, without a signature and with one.
  describe("TIMES", () => {
    test.skipIf(process.platform !== "darwin")(
      "what loading a new addon costs",
      async () => {
        const isLate = () => performance.now() - began > 100_000;
        const copy = (name: string) => (copyFileSync(addon, join(folder, name)), join(folder, name));
        const load = async (what: string, file: string) => {
          const start = performance.now();
          const loaded = await spawned([bunExe(), "-e", "require(process.argv[1])", file], folder, bunEnv);
          says(
            start,
            `${what}: exit code ${loaded.exitCode}${loaded.stderr && `, stderr ${JSON.stringify(loaded.stderr.slice(0, 200))}`}`,
          );
        };
        console.error(`TIMES on ${machine()}`);
        await timed("bun -e 0", () => spawned([bunExe(), "-e", "0"], folder, bunEnv));
        await timed("cc once more", () => cc(join(folder, "again.node")));
        await load("load shout.node, which the builds have loaded", addon);
        for (const name of ["unsigned-1.node", "unsigned-2.node"])
          if (!isLate()) await load("load a new copy without a signature", copy(name));
        if (!isLate()) await load("load the first of those copies once more", join(folder, "unsigned-1.node"));
        for (const name of ["signed-1.node", "signed-2.node"]) {
          if (isLate()) break;
          const file = copy(name);
          const start = performance.now();
          const signed = await spawned(["codesign", "--force", "--sign", "-", file], folder, bunEnv);
          says(start, `codesign --force --sign -: exit code ${signed.exitCode}`);
          await load("load a new copy with an ad hoc signature", file);
        }
        if (!isLate()) await load("load the first signed copy once more", join(folder, "signed-1.node"));
      },
      600_000,
    );
  });
}
