// A package with an N-API addon ships one file for each platform, and its loader makes the name of the file out of process.platform and process.arch.
// The build knows both, so it knows the name, and the file is in the executable.
// ./addons-named-by-the-platform/addon.c is built with the system's C compiler against the headers in src/runtime/napi, without node-gyp, and laid under the names that this machine asks for.
// Each program is built, its sources and the addon are deleted, and the executable runs in another folder: it prints what plain Bun printed while they were there.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { dirname, join, resolve } from "path";
import {
  loaderWithChain,
  loaderWithJoinedParts,
  loaderWithList,
  loaderWithNameThatGrows,
  loaderWithSwitch,
  loaderWithTable,
  targetOfRuntime,
  targets,
} from "./addons-named-by-the-platform/loaders";
import { isHardened } from "./hardened";
import { built, limitWithASAN, slot, spawned, unsupported } from "./harness/commands";
import { withReport } from "./harness/flags";

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
const here = join(import.meta.dir, "addons-named-by-the-platform");
const target = targets.find(target => target.platform === process.platform && target.arch === process.arch);

if (!systemCC)
  console.error(
    "SKIPPED: test/aot/addons-named-by-the-platform.test.ts: there is no C compiler: not in $CC, no cc, gcc or clang",
  );

const name = "`./my-app.${process.platform}-${process.arch}.node`";
const prints = (label: string, addon: string) => `console.log(${JSON.stringify(label)}, ${addon}.add(40, 2));\n`;
const beside = `my-app.${process.platform}-${process.arch}.node`;

type Program = {
  entry: string;
  /** Texts by path. */
  files: Record<string, string>;
  /** Where the addon lies. */
  addons: string[];
  /** The build follows the name to its end, and says nothing. */
  isConstant?: boolean;
};

const written = (entry: string, text: string, isConstant = true): Program => ({
  entry,
  files: { [entry]: text },
  addons: [beside],
  isConstant,
});
const manifest = (name: string, main = "index.js") => JSON.stringify({ name, main }) + "\n";
const inPackage = (
  title: string,
  name: string,
  files: Record<string, string>,
  addons: string[],
  others: Record<string, string> = {},
): Program => ({
  entry: "main.cjs",
  files: {
    "main.cjs": prints(title, `require(${JSON.stringify(name)})`),
    ...Object.fromEntries(Object.entries(files).map(([path, text]) => [`node_modules/${name}/${path}`, text])),
    ...others,
  },
  addons,
});
const names = target?.names ?? [];
const libraries = (ofLinux: string[]) => (process.platform === "linux" ? ofLinux : [""]);
/** A package for each name that this machine may ask for, whose main file is the addon. */
const packagesOfThePlatform = (packages: string[], file: (name: string) => string) => ({
  manifests: Object.fromEntries(
    packages.map(name => [`node_modules/${name}/package.json`, manifest(name, file(name))]),
  ),
  addons: packages.map(name => `node_modules/${name}/${file(name)}`),
});

const programs: Record<string, Program> = {
  "a template": written("main.cjs", `const addon = require(${name});\n` + prints("a template", "addon")),
  "texts that are added": written(
    "main.cjs",
    `const addon = require("./my-app." + process.platform + "-" + process.arch + ".node");\n` +
      prints("texts that are added", "addon"),
  ),
  "a constant holds a part of the name": written(
    "main.cjs",
    "const target = `my-app.${process.platform}-${process.arch}`;\n" +
      `const addon = require("./" + target + ".node");\n` +
      prints("a constant holds a part of the name", "addon"),
  ),
  "in a function": written(
    "main.cjs",
    `function load() {\n  return require(${name});\n}\n` + prints("in a function", "load()"),
  ),
  "in TypeScript": written(
    "main.ts",
    `const addon: { add(left: number, right: number): number } = require(${name});\n` +
      prints("in TypeScript", "addon"),
  ),
  "a require made for an ES module": written(
    "main.mjs",
    `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\n` +
      `const addon = require(${name});\n` +
      prints("a require made for an ES module", "addon"),
  ),
  "import.meta.require": written(
    "main.mjs",
    `const addon = import.meta.require(${name});\n` + prints("import.meta.require", "addon"),
  ),
  "module.require": written("main.cjs", `const addon = module.require(${name});\n` + prints("module.require", "addon")),
  "behind __dirname": written(
    "main.cjs",
    "const addon = require(`${__dirname}/my-app.${process.platform}-${process.arch}.node`);\n" +
      prints("behind __dirname", "addon"),
  ),
  "joined to __dirname": written(
    "main.cjs",
    `const { join } = require("node:path");\n` +
      "const addon = require(join(__dirname, `my-app.${process.platform}-${process.arch}.node`));\n" +
      prints("joined to __dirname", "addon"),
  ),
  "one of two templates": written(
    "main.cjs",
    'const addon = require(process.platform === "win32" ? `./my-app.win32-${process.arch}.node` : ' +
      `${name});\n` +
      prints("one of two templates", "addon"),
  ),
  "process.dlopen of what require.resolve answers": written(
    "main.cjs",
    `const holder = { exports: {} };\nprocess.dlopen(holder, require.resolve(${name}));\n` +
      prints("process.dlopen of what require.resolve answers", "holder.exports"),
  ),
  "names taken out of process by a pattern": written(
    "main.cjs",
    "const { platform, arch } = process;\nconst addon = require(`./my-app.${platform}-${arch}.node`);\n" +
      prints("names taken out of process by a pattern", "addon"),
    false,
  ),
  "what node:os answers": written(
    "main.cjs",
    `const os = require("node:os");\n` +
      "const addon = require(`./my-app.${os.platform()}-${os.arch()}.node`);\n" +
      prints("what node:os answers", "addon"),
    false,
  ),
  "a template in a package": inPackage(
    "a template in a package",
    "my-app",
    { "package.json": manifest("my-app"), "index.js": `module.exports = require(${name});\n` },
    [`node_modules/my-app/${beside}`],
  ),
  "a template in a package that an ES module imports": {
    entry: "main.mjs",
    files: {
      "main.mjs":
        `import addon from "my-app";\n` + prints("a template in a package that an ES module imports", "addon"),
      "node_modules/my-app/package.json": manifest("my-app"),
      "node_modules/my-app/index.js": `module.exports = require(${name});\n`,
    },
    addons: [`node_modules/my-app/${beside}`],
  },
  "a switch finds the file beside it": inPackage(
    "a switch finds the file beside it",
    "my-switch",
    { "package.json": manifest("my-switch"), "index.js": loaderWithSwitch("my-switch", "@my") },
    names.map(name => `node_modules/my-switch/my-switch.${name}.node`),
  ),
  "a chain finds the file beside it": inPackage(
    "a chain finds the file beside it",
    "my-chain",
    { "package.json": manifest("my-chain"), "index.js": loaderWithChain("my-chain", "@my") },
    names.map(name => `node_modules/my-chain/my-chain.${name}.node`),
  ),
  "a chain behind a require that the file makes for itself": inPackage(
    "a chain behind a require that the file makes for itself",
    "my-chain",
    {
      "package.json": manifest("my-chain"),
      "index.js": loaderWithChain("my-chain", "@my", { replacesRequire: true }),
    },
    names.map(name => `node_modules/my-chain/my-chain.${name}.node`),
  ),
};
for (const [kind, loader] of [
  ["a switch", loaderWithSwitch],
  ["a chain", loaderWithChain],
] as const) {
  const title = `${kind} finds the package of the platform`;
  const packages = packagesOfThePlatform(
    names.map(name => `@my/my-optional-${name}`),
    name => name.replace("@my/my-optional-", "my-optional.") + ".node",
  );
  programs[title] = inPackage(
    title,
    "my-optional",
    { "package.json": manifest("my-optional"), "index.js": loader("my-optional", "@my") },
    packages.addons,
    packages.manifests,
  );
}

// The start of the name of a package is enough: the executable holds every installed package whose name begins so.
{
  const ofJoined = packagesOfThePlatform(
    names.map(name => `my-joined-${name}`),
    name => name.replace("my-joined-", "my-joined.") + ".node",
  );
  programs["parts that are pushed onto a list and joined"] = inPackage(
    "parts that are pushed onto a list and joined",
    "my-joined",
    { "package.json": manifest("my-joined", "node/index.js"), "node/index.js": loaderWithJoinedParts("my-joined") },
    ofJoined.addons,
    ofJoined.manifests,
  );
}

// No folding makes one text of these names. Each is one of a few: an entry of a table, what a function returns, an element of a list that a loop walks, a variable that grows in one arm of a condition. The build follows every one of them, and of one that it knows in part it takes the start and the end.
const oneOfFew: Record<string, Program> = {
  "a name out of a table under the platform": written(
    "main.cjs",
    "const names = {\n" +
      ["linux", "darwin", "win32", "freebsd", "android"]
        .map(platform => `  ${platform}: \`./my-app.${platform}-\${process.arch}.node\`,\n`)
        .join("") +
      "};\nconst addon = require(names[process.platform]);\n" +
      prints("a name out of a table under the platform", "addon"),
    false,
  ),
  // Of the files beside it the executable holds the one that the table names. The other one is no program, and a build that took it in would say so.
  "a name out of a table, joined to __dirname": {
    entry: "main.cjs",
    files: {
      "main.cjs":
        `const { join } = require("node:path");\nconst names = {\n` +
        ["linux", "darwin", "win32", "freebsd", "android"]
          .map(platform => `  ${platform}: \`my-app.${platform}-\${process.arch}.node\`,\n`)
          .join("") +
        "};\nconst addon = require(join(__dirname, names[process.platform]));\n" +
        prints("a name out of a table, joined to __dirname", "addon"),
      "no-program.js": "this is no program (\n",
    },
    addons: [beside],
  },
  "names that a list hands to a function, made of what node:os answers": {
    entry: "main.cjs",
    files: {
      "main.cjs":
        `const os = require("node:os");\nlet addon;\n` +
        "[`nothing.${os.platform()}`, `my-app.${os.platform()}-${os.arch()}`].forEach(name => {\n" +
        "  try {\n    addon ??= require(`./${name}.node`);\n  } catch {}\n});\n" +
        prints("names that a list hands to a function, made of what node:os answers", "addon"),
      "no-program.js": "this is no program (\n",
    },
    addons: [beside],
  },
  "a table of targets, and the file beside it": inPackage(
    "a table of targets, and the file beside it",
    "my-table",
    { "package.json": manifest("my-table"), "index.js": loaderWithTable("my-table", "@my") },
    names.map(name => `node_modules/my-table/my-table.${name}.node`),
  ),
};
{
  const ofTable = packagesOfThePlatform(
    names.map(name => `@my/my-table-${name}`),
    name => name.replace("@my/my-table-", "my-table.") + ".node",
  );
  oneOfFew["a table of targets, and the package of the platform"] = inPackage(
    "a table of targets, and the package of the platform",
    "my-table",
    { "package.json": manifest("my-table"), "index.js": loaderWithTable("my-table", "@my") },
    ofTable.addons,
    ofTable.manifests,
  );
  const ofList = packagesOfThePlatform(
    libraries(["", "musl"]).map(library => `@my/my-list-${process.platform}${library}-${process.arch}`),
    () => "my-list.node",
  );
  oneOfFew["a list of names that a loop tries"] = inPackage(
    "a list of names that a loop tries",
    "my-list",
    {
      "package.json": manifest("my-list", "lib/index.js"),
      "lib/index.js": loaderWithList("my-list", "@my"),
      "lib/target.js": targetOfRuntime,
    },
    ofList.addons,
    ofList.manifests,
  );
  const ofGrown = packagesOfThePlatform(
    libraries(["-glibc", "-musl"]).map(library => `@my/my-grown-${process.platform}-${process.arch}${library}`),
    () => "my-grown.node",
  );
  oneOfFew["a name that grows in one arm of a condition"] = inPackage(
    "a name that grows in one arm of a condition",
    "my-grown",
    { "package.json": manifest("my-grown"), "index.js": loaderWithNameThatGrows("my-grown", "@my") },
    ofGrown.addons,
    ofGrown.manifests,
  );
}

// Programs share a build only where each entry point of a build begins a program of its own and an executable starts at any of them.
// A hardened Bun makes one program of a build, and only a canary build reads BUN_AOT_START_AT. Any other Bun builds each program alone.
const sharesBuilds =
  !isHardened && Bun.spawnSync([bunExe(), "--revision"], { env: bunEnv }).stdout.toString().includes("-canary");

describe.skipIf(!systemCC || !target || !!unsupported)("compile/aot/addons-named-by-the-platform", () => {
  const folder = String(tempDir("aot-addons-named-by-the-platform", {}));
  /** The builds that beforeAll has started. A run that takes only some of the tests waits for the others before their folder goes. */
  const started: Promise<unknown>[] = [];
  afterAll(async () => {
    await Promise.all(started);
    rmSync(folder, { recursive: true, force: true });
  }, 600_000);
  const addon = join(folder, "addon.node");
  const away = join(folder, "away");

  beforeAll(async () => {
    mkdirSync(away);
    const functionsOfTheHost = join(folder, "functions-of-the-host.h");
    if (isWindows) {
      const called = new Set(readFileSync(join(here, "addon.c"), "utf8").match(/\bnapi_\w+(?=\()/g));
      writeFileSync(
        functionsOfTheHost,
        `#include <node_api.h>\nvoid* GetModuleHandleW(const void*);\nvoid* GetProcAddress(void*, const char*);\n#define HOST(function) ((__typeof__(&function))GetProcAddress(GetModuleHandleW(NULL), #function))\n` +
          [...called].map(name => `#define ${name} HOST(${name})\n`).join(""),
      );
    }
    const compile = await spawned(
      [
        systemCC!,
        "-shared",
        ...(isWindows ? ["-include", functionsOfTheHost] : ["-fPIC"]),
        ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
        "-I" + resolve(import.meta.dir, "../../src/runtime/napi"),
        join(here, "addon.c"),
        "-o",
        addon,
      ],
      here,
      bunEnv,
    );
    expect({ stderr: compile.stderr, exitCode: compile.exitCode }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });
    // bun test runs twenty of these tests at a time, five with a sanitizer, and each waits for its build. Where programs share builds, every build starts here.
    // The test that waits for a build sees how it ended.
    if (sharesBuilds) for (const start of new Set(builds.values())) started.push(start().catch(() => {}));
  });

  // The name of the file is what the build has to find. A program that imports no built-in module is built without them, which takes a fifth of the time. On Windows a function of the library makes process.env.
  const usesABuiltInModule = ({ files }: Program) =>
    Object.values(files).some(text =>
      /(\brequire\(|\bfrom |\bimport\()["'](node:|path|os|fs|module|url)\b|\bprocess\.env\b/.test(text),
    );

  type Case = {
    /** The folder of its sources, and the name of its executable where it is built alone. */
    file: string;
    program: Program;
    passesAddons: boolean;
  };
  const fileOf = (title: string, passesAddons: boolean) =>
    title.replaceAll(/[^a-z]+/gi, "-") + (passesAddons ? "-passed" : "");
  const cases: Case[] = [
    ...Object.entries(programs).map(([title, program]) => ({
      file: fileOf(title, false),
      program,
      passesAddons: false,
    })),
    ...Object.entries(oneOfFew).flatMap(([title, program]) =>
      [true, false].map(passesAddons => ({ file: fileOf(title, passesAddons), program, passesAddons })),
    ),
  ];
  const said = ({ stdout, stderr, exitCode, signal }: Awaited<ReturnType<typeof spawned>>) => ({
    stdout,
    stderr,
    exitCode,
    signal,
  });
  type Said = ReturnType<typeof said>;

  /**
   * One build of the programs of `group`: what plain Bun printed for each while its sources were there, what the build said, and what each printed out of the executable.
   * It starts when it is first asked for, and holds one slot from its first command to its last.
   */
  function buildOf(group: Case[], index: number) {
    const isShared = group.length > 1;
    const executable = join(away, (isShared ? `programs-${index}` : group[0].file) + (isWindows ? ".exe" : ""));
    const report = join(away, `programs-${index}.json`);
    // A build of several programs has the longest limit of a build of one, and a quarter of a minute more for each further program.
    const limit = isShared ? limitWithASAN + 15_000 * (group.length - 1) : undefined;
    // A program that is built alone is built as anybody builds it: in its folder.
    const pathOf = (file: string, path: string) => (isShared ? `./${file}/${path}` : join(folder, file, path));
    let results:
      | Promise<{ plain: Map<string, Said>; build: Said; compiled: Map<string, Said>; programsCompiled?: number }>
      | undefined;
    return () =>
      (results ??= slot(async () => {
        const [plain, compiled] = [new Map<string, Said>(), new Map<string, Said>()];
        for (const { file, program } of group) {
          const sources = join(folder, file);
          for (const [path, text] of Object.entries(program.files)) {
            mkdirSync(dirname(join(sources, path)), { recursive: true });
            writeFileSync(join(sources, path), text);
          }
          for (const path of program.addons) {
            mkdirSync(dirname(join(sources, path)), { recursive: true });
            copyFileSync(addon, join(sources, path));
          }
          plain.set(file, said(await spawned([bunExe(), "run", join(sources, program.entry)], sources, bunEnv)));
        }
        const build = await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            ...(isShared ? ["--aot-separate-programs", "--root=.", ...withReport(report, "summary")] : []),
            ...(group.some(({ program }) => usesABuiltInModule(program)) ? [] : ["--no-builtin-modules"]),
            ...group.flatMap(({ file, program, passesAddons }) => [
              pathOf(file, program.entry),
              ...(passesAddons ? program.addons.map(path => pathOf(file, path)) : []),
            ]),
            "--outfile",
            executable,
          ],
          isShared ? folder : join(folder, group[0].file),
          bunEnv,
          limit,
        );
        for (const { file } of group) rmSync(join(folder, file), { recursive: true, force: true });
        if (build.exitCode === 0) {
          for (const { file, program } of group) {
            const env = isShared ? { ...bunEnv, BUN_AOT_START_AT: `${file}/${program.entry}` } : bunEnv;
            compiled.set(file, said(await spawned([executable], away, env)));
          }
        }
        if (!isWindows) rmSync(executable, { force: true });
        // How many programs the build has compiled, also those that it compiled again. A build that makes one program of its entry points compiles one.
        const programsCompiled =
          isShared && build.exitCode === 0
            ? (JSON.parse(readFileSync(report, "utf8")).statistics.EngineRuns as number)
            : undefined;
        return { plain, build: said(build), compiled, programsCompiled };
      }));
  }

  // A build costs, and so does the first start of each executable on macOS, where it can wait for seconds. So programs are the entry points of one build,
  // each a program of its own as when it is built alone, and BUN_AOT_START_AT says which of them a run starts.
  // A build with an addon among its entry points is one program, so a program that passes its addon is built alone.
  // A build compiles its programs one after another, and each that imports a built-in module takes it a second: those are dealt out four to a build.
  const shared = cases.filter(it => sharesBuilds && !it.passesAddons);
  const withModules = shared.filter(it => usesABuiltInModule(it.program));
  const parts = Math.ceil(withModules.length / 4);
  const builds = new Map(
    [
      ...cases.filter(it => !shared.includes(it)).map(it => [it]),
      shared.filter(it => !withModules.includes(it)),
      ...Array.from({ length: parts }, (_, part) => withModules.filter((_, at) => at % parts === part)),
    ]
      .filter(group => group.length > 0)
      .flatMap((group, index) => {
        const results = buildOf(group, index);
        return group.map(({ file }) => [file, results] as const);
      }),
  );

  /**
   * What a build said, without its messages about the files of `others`, the other programs of the build. A message ends with the line that says where, and an empty line follows it.
   * So a build of one program has said all of it about that program, and a message that names no program counts for each of them.
   */
  const saidBut = (stderr: string, others: string[]) =>
    stderr
      .split("\n\n")
      .filter(message => !others.some(file => new RegExp(`^\\s+at (?:.*[\\\\/])?${file}[\\\\/]`, "m").test(message)))
      .join("\n\n")
      .trim();

  async function run(title: string, { passesAddons = false } = {}) {
    const file = fileOf(title, passesAddons);
    const { plain, build, compiled, programsCompiled } = await builds.get(file)!();
    // Each program prints its title: an executable of several programs has started the one that was asked for.
    expect(plain.get(file)).toEqual({ stdout: `${title} 42\n`, stderr: "", exitCode: 0, signal: null });
    built(build);
    // Each program of a shared build is compiled as when it is built alone, so the build has compiled no fewer programs than it holds.
    if (plain.size > 1) expect(programsCompiled).toBeGreaterThanOrEqual(plain.size);
    const others = [...plain.keys()].filter(other => other !== file);
    return { plain: plain.get(file), messages: saidBut(build.stderr, others), compiled: compiled.get(file) };
  }

  test.concurrent.each(Object.keys(programs))(
    "%s",
    async title => {
      const { plain, messages, compiled } = await run(title);
      expect(compiled).toEqual(plain);
      if (programs[title].isConstant) expect(messages).toBe("");
    },
    600_000,
  );

  test.concurrent.each(Object.keys(oneOfFew))(
    "%s, with the addon passed as another entry point",
    async title => {
      const { plain, messages, compiled } = await run(title, { passesAddons: true });
      expect(messages).toContain("isn't a constant");
      expect(compiled).toEqual(plain);
    },
    600_000,
  );

  test.concurrent.each(Object.keys(oneOfFew))(
    "%s",
    async title => {
      const { plain, compiled } = await run(title);
      expect(compiled).toEqual(plain);
    },
    600_000,
  );
});
