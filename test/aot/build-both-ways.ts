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
//   alone      the case has builds of its own
//
// The cases of a file that ask for nothing of the whole build or of the whole run share two builds and two runs: each lies in a folder
// of its own, one program loads them one after the other, and the hooks of a case hear only of what its own files import.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { slot, spawned } from "./harness/commands";
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
  alone?: true;
};

const tsconfig = JSON.stringify({
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
});

// Hooks run on several threads' behalf, so the order in which different modules come up is not part of what is compared. What one
// module or one import is told by several plugins stays in order: the sort is stable and its key is the hook and the path.
// A file that imports one specifier twice asks once or twice.
const tools = `import { basename, dirname, join, sep } from "path";
const [outfile, how] = process.argv.slice(2);
function listen(folder: string) {
  const told: [string, string][] = [];
  function tell(hook: string, args: Record<string, unknown> = {}) {
    const shown = Object.entries(args).map(([name, value]) => name + "=" + (typeof value === "function" ? "function" : JSON.stringify(value)));
    told.push([hook + " " + String(args.path ?? ""), hook + " " + shown.join(" ")]);
  }
  // On Windows the folder has backslashes, which JSON.stringify doubles.
  const tidy = (line: string) => line.replaceAll(JSON.stringify(folder).slice(1, -1), "<folder>").replace(/<folder>[^"]*/g, path => path.replace(/\\\\+/g, "/"));
  function lines() {
    told.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return told.map(entry => tidy(entry[1])).filter((line, index, all) => line !== all[index - 1]);
  }
  return { tell, lines };
}
async function build(options: any) {
  try {
    const result = await Bun.build(options);
    return { success: result.success, messages: result.logs.filter(log => log.level === "error").map(log => String(log.message)), outputs: result.outputs.map(output => output.kind) };
  } catch (error: any) {
    return { success: false, messages: ["Bun.build rejected: " + (error?.message ?? error), ...(error?.errors ?? []).map((inner: any) => String(inner?.message ?? inner))], outputs: [] };
  }
}
`;
const listOfPlugins = (plugins: string[]) =>
  `[${plugins.map((setup, index) => `{ name: "plugin ${index + 1}", async setup(build: any) {\n${setup}\n} }`).join(", ")}]`;

function buildScript({ plugins = [], options = "", compile = "" }: Case) {
  return `${tools}const folder = import.meta.dir;
const { tell, lines } = listen(folder);
const plugins = ${listOfPlugins(plugins)};
const built = await build({ entrypoints: ["./main.ts"], plugins, throw: false, ${options}${options && ","} compile: { outfile, aot: how === "aot", ${compile} } });
console.log(JSON.stringify({ ...built, told: lines() }));
`;
}

// A hook of a case hears of the files in the folder of the case and of the modules in its namespaces. The names of those and the paths in them get a mark.
function sharedBuildScript(cases: Case[]) {
  return `${tools}function only(build: any, folder: string, name: string) {
  const mark = name + ":";
  const isFile = (namespace: unknown) => namespace === undefined || namespace === "" || namespace === "file";
  const within = (constraints: any) => (isFile(constraints.namespace) ? constraints : { ...constraints, namespace: constraints.namespace + "-" + name });
  const isOwn = (path: string) => path.startsWith(folder + sep) || path.startsWith(mark);
  const bare = (path: string) => (path.startsWith(mark) ? path.slice(mark.length) : path);
  const answer = (result: any) => (typeof result?.path === "string" && !isFile(result.namespace) ? { ...result, namespace: result.namespace + "-" + name, path: mark + result.path } : result);
  return {
    onLoad(constraints: any, callback: any) {
      build.onLoad(within(constraints), (args: any) => (isOwn(args.path) ? callback(isFile(args.namespace) ? args : { ...args, path: bare(args.path), namespace: args.namespace.slice(0, -mark.length) }) : undefined));
      return this;
    },
    onResolve(constraints: any, callback: any) {
      build.onResolve(within(constraints), (args: any) => {
        if (!isOwn(args.importer)) return undefined;
        const result = callback({ ...args, importer: bare(args.importer) });
        return typeof result?.then === "function" ? result.then(answer) : answer(result);
      });
      return this;
    },
  };
}
const cases = [${cases
    .map(
      ({ plugins = [] }, index) => `(() => {
const folder = join(import.meta.dir, "case${index}");
const { tell, lines } = listen(folder);
return { folder, lines, plugins: ${listOfPlugins(plugins)} };
})()`,
    )
    .join(", ")}];
const plugins = cases.flatMap(({ folder, plugins }, index) => plugins.map(plugin => ({ name: plugin.name + " of case " + index, setup: (build: any) => plugin.setup(only(build, folder, "case" + index)) })));
const built = await build({ entrypoints: ["./main.ts"], plugins, throw: false, compile: { outfile, aot: how === "aot" } });
console.log(JSON.stringify({ ...built, told: cases.map(({ lines }) => lines()) }));
`;
}

async function buildAndRun(folder: string, how: "plain" | "aot", it: Case) {
  const env = { ...bunEnv, ...it.env };
  const executable = join(folder, how + (isWindows ? ".exe" : ""));
  const build = await spawned([bunExe(), "build.ts", executable, how], folder, env);
  let answer: { success: boolean; messages: string[]; outputs: string[]; told: string[] | string[][] };
  try {
    answer = JSON.parse(build.stdout.slice(build.stdout.lastIndexOf("\n", build.stdout.length - 2) + 1));
  } catch {
    return {
      how,
      died: { stdout: build.stdout, stderr: build.stderr, exitCode: build.exitCode, signal: build.signal },
    };
  }
  if (!answer.success) return { how, ...answer };
  const ran = await spawned(
    [executable, ...(it.arguments ?? [])],
    folder,
    how === "aot" && !it.interprets ? { ...env, BUN_JSC_crashIfInterpreterIsUsed: "1" } : env,
  );
  return {
    how,
    ...answer,
    stdout: ran.stdout,
    stderr: ran.exitCode === 0 ? "" : ran.stderr,
    exitCode: ran.exitCode,
    signal: ran.signal,
  };
}

// The text of a failure is each build's own. That of an uncaught error names paths, which differ between the two.
function compared({ how, messages, stderr, ...rest }: Record<string, any>) {
  return rest;
}

function check(it: Case, plain: Record<string, any>, aot: Record<string, any>) {
  if (it.fails !== undefined) {
    for (const built of [plain, aot])
      expect(built).toMatchObject({
        success: false,
        messages: expect.arrayContaining([expect.stringContaining(it.fails)]),
      });
  } else {
    expect(plain).toMatchObject({
      success: true,
      messages: [],
      ...(it.prints === undefined ? {} : { stdout: it.prints }),
    });
    if (it.refused !== undefined)
      return void expect(aot).toMatchObject({
        success: false,
        messages: expect.arrayContaining([expect.stringContaining(it.refused)]),
      });
    expect(aot).toMatchObject({ success: true, messages: [] });
  }
  expect(compared(aot)).toEqual({ ...compared(plain), ...it.differs });
}

const entryPointOf = ({ options = "" }: Case) =>
  options === "" ? "main.ts" : /^entrypoints: \["\.\/([^"]+)"\]$/.exec(options)?.[1];
const asksForTheWholeBuild: (keyof Case)[] = [
  "alone",
  "compile",
  "fails",
  "differs",
  "refused",
  "interprets",
  "arguments",
  "env",
];
const sharesBuilds = (it: Case) =>
  asksForTheWholeBuild.every(name => it[name] === undefined) &&
  entryPointOf(it) !== undefined &&
  !it.plugins?.some(setup => /\bbuild\.(?!onLoad\b|onResolve\b)|\.defer\(/.test(setup)) &&
  !Object.values(it.files).some(text => /\b(import\.meta|require|Bun)\.main\b|\bmodule\.parent\b/.test(text));

const startOf = (index: number) => `case ${index}:`;

async function buildTogether(cases: Case[]) {
  using dir = tempDir("aot-build-both-ways", {
    "tsconfig.json": JSON.stringify({ ...JSON.parse(tsconfig), files: ["main.ts"] }),
    "main.ts": cases
      .map((it, index) => `console.log("${startOf(index)}");\nawait import("./case${index}/${entryPointOf(it)}");\n`)
      .join(""),
    "build.ts": sharedBuildScript(cases),
    ...Object.assign(
      {},
      ...cases.map((it, index) =>
        Object.fromEntries(
          Object.entries({ "tsconfig.json": tsconfig, ...it.files }).map(([name, text]) => [
            `case${index}/${name}`,
            text,
          ]),
        ),
      ),
    ),
  });
  const of = ({ told, stdout, ...rest }: Record<string, any>, index: number) => ({
    ...rest,
    ...(told && { told: told[index] }),
    ...(stdout !== undefined && {
      stdout: stdout.split(startOf(index) + "\n")[1]?.split(startOf(index + 1) + "\n")[0],
    }),
  });
  const all = { interprets: cases[0].interprets } as Case;
  const plain = await buildAndRun(String(dir), "plain", all);
  const aot = await buildAndRun(String(dir), "aot", all);
  return cases.map((_, index) => [of(plain, index), of(aot, index)]);
}

export function buildBothWays(title: string, cases: Record<string, Case>) {
  describe.concurrent(title, () => {
    // An executable that loads code at run time holds far more than one that does not.
    const groups = Map.groupBy(Object.values(cases).filter(sharesBuilds), it => !!it.interprets);
    const built = new Map<Case[], ReturnType<typeof buildTogether>>();
    for (const [name, it] of Object.entries(cases)) {
      test(
        name,
        async () => {
          const together = groups.get(!!it.interprets);
          if (together && together.length > 1 && together.includes(it)) {
            const all = await built.getOrInsertComputed(together, () => slot(() => buildTogether(together)));
            const [plain, aot] = all[together.indexOf(it)];
            return check(it, plain, aot);
          }
          await slot(async () => {
            using dir = tempDir("aot-build-both-ways", {
              "tsconfig.json": tsconfig,
              ...it.files,
              "build.ts": buildScript(it),
            });
            const folder = String(dir);
            check(it, await buildAndRun(folder, "plain", it), await buildAndRun(folder, "aot", it));
          });
        },
        600_000,
      );
    }
  });
}
