import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { functionsOfUnit, readUnit, type FoundFunction, type FoundReference, type Unit } from "./definitions.ts";
import type { FetchedVersion } from "./fetch.ts";
import { compareVersions, folderNameOf, minorOf, toolOf } from "./packages.ts";
import { loadSwc } from "./readers/swc.ts";
import { loadTypeScript, transpile } from "./readers/typescript.ts";
import type { Reference, Table, TableEntry } from "./table.ts";

interface Program {
  readonly name: string;
  readonly about: string;
  readonly files: readonly (readonly [string, string])[];
}

const programsFolder = path.join(import.meta.dir, "fixture-programs");

const fixturePrograms: readonly Program[] = readdirSync(programsFolder)
  .filter(file => file.endsWith(".txt"))
  .sort()
  .map(file => {
    const parts = readFileSync(path.join(programsFolder, file), "utf8").split(/^\/\/\/\/ (.+)\n/m);
    const files: [string, string][] = [];
    for (let index = 1; index < parts.length; index += 2) files.push([parts[index], parts[index + 1]]);
    return { name: file.slice(0, -".txt".length), about: parts[0].trim(), files };
  });

type Emitted = Map<string, string>;

interface Build {
  readonly tool: string;
  readonly version: string;
  readonly label: string;
  readonly settings: string;
  readonly programs: readonly string[];
  readonly emit: (folder: string, program: Program) => Emitted | undefined | Promise<Emitted | undefined>;
}

const toolNames: Record<string, { readonly folder: string; readonly title: string }> = {
  "typescript": { folder: "typescript", title: "TypeScript" },
  "esbuild": { folder: "esbuild", title: "esbuild" },
  "bun": { folder: "bun", title: "Bun" },
  "rolldown": { folder: "rolldown", title: "Rolldown" },
  "@babel/core": { folder: "babel", title: "Babel" },
  "@swc/core": { folder: "swc", title: "SWC" },
};

function emitEachFile(
  program: Program,
  emitFile: (name: string, text: string) => string | undefined,
): Emitted | undefined {
  const emitted: Emitted = new Map();
  for (const [name, text] of program.files) {
    const output = name.endsWith(".cjs") ? text : emitFile(name, text);
    if (output === undefined) return undefined;
    emitted.set(name === "main.js" ? "main.cjs" : name, output);
  }
  emitted.set("package.json", '{ "type": "commonjs" }\n');
  return emitted;
}

async function inWorkFolder<T>(program: Program, use: (work: string) => T | Promise<T>): Promise<T> {
  const work = mkdtempSync(path.join(tmpdir(), "known-helpers-"));
  try {
    for (const [name, text] of program.files) writeFileSync(path.join(work, name), text);
    return await use(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function run(
  command: string[],
  options: { cwd?: string; input?: string; env?: Record<string, string> },
): string | undefined {
  const result = Bun.spawnSync(command, {
    cwd: options.cwd,
    env: options.env,
    stdin: options.input === undefined ? "ignore" : Buffer.from(options.input),
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 ? result.stdout.toString() : undefined;
}

function bundleOf(format: "cjs" | "esm", text: string | undefined): Emitted | undefined {
  return text === undefined ? undefined : new Map([[format === "esm" ? "main.mjs" : "main.cjs", text]]);
}

function typescript(version: string, target: string, programs: readonly string[], downlevelIteration = false): Build {
  const flags = [
    "--target",
    target,
    ...(downlevelIteration ? ["--downlevelIteration"] : []),
    "--module",
    "CommonJS",
    "--esModuleInterop",
  ];
  return {
    tool: "typescript",
    version,
    label: target.toLowerCase(),
    settings: flags.join(" "),
    programs,
    emit(folder, program) {
      const ts = loadTypeScript(folder);
      if (ts === undefined) return undefined;
      const compilerOptions = {
        target: ts.ScriptTarget[target],
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        downlevelIteration,
        newLine: ts.NewLineKind.LineFeed,
      };
      return emitEachFile(program, (name, text) => transpile(ts, text, name.replace(/\.js$/, ".ts"), compilerOptions));
    },
  };
}

function esbuild(version: string, target: string, programs: readonly string[], bundleFormat?: "cjs" | "esm"): Build {
  const flags =
    bundleFormat === undefined
      ? ["--format=cjs", `--target=${target}`]
      : ["--bundle", `--format=${bundleFormat}`, "--platform=node", `--target=${target}`];
  return {
    tool: "esbuild",
    version,
    label: bundleFormat === undefined ? `cjs-${target}` : `bundle-${bundleFormat}`,
    settings: flags.join(" "),
    programs,
    emit(folder, program) {
      const binary = path.join(folder, "bin/esbuild");
      if (bundleFormat === undefined)
        return emitEachFile(program, (_, text) =>
          run([binary, "--loader=js", ...flags, "--log-level=error"], { input: text }),
        );
      return inWorkFolder(program, work =>
        bundleOf(bundleFormat, run([binary, "main.js", ...flags, "--log-level=error"], { cwd: work })),
      );
    },
  };
}

function bun(version: string, format: "cjs" | "esm", programs: readonly string[]): Build {
  const flags = [`--format=${format}`, "--target=node"];
  return {
    tool: "bun",
    version,
    label: `bundle-${format}`,
    settings: `bun build ${flags.join(" ")}`,
    programs,
    emit(folder, program) {
      const command = [path.join(folder, "bin/bun"), "build", "main.js", ...flags];
      return inWorkFolder(program, work =>
        bundleOf(format, run(command, { cwd: work, env: { PATH: "", HOME: work } })),
      );
    },
  };
}

function rolldown(version: string, format: "cjs" | "esm", programs: readonly string[]): Build {
  const extension = format === "esm" ? "mjs" : "cjs";
  return {
    tool: "rolldown",
    version,
    label: `bundle-${format}`,
    settings: `platform: "node", format: "${format}"`,
    programs,
    emit(folder, program) {
      return inWorkFolder(program, async work => {
        const loaded = await import(Bun.resolveSync("rolldown", folder));
        const bundle = await loaded.rolldown({
          input: path.join(work, "main.js"),
          cwd: work,
          platform: "node",
          logLevel: "silent",
        });
        const generated = await bundle.generate({
          format,
          entryFileNames: `[name].${extension}`,
          chunkFileNames: `[name].${extension}`,
        });
        await bundle.close?.();
        const emitted: Emitted = new Map();
        for (const chunk of generated.output) if (chunk.type === "chunk") emitted.set(chunk.fileName, chunk.code);
        return emitted;
      });
    },
  };
}

const babelPlugins = [
  "@babel/plugin-proposal-class-static-block",
  "@babel/plugin-proposal-class-properties",
  "@babel/plugin-proposal-private-methods",
  "@babel/plugin-proposal-private-property-in-object",
  "@babel/plugin-proposal-export-namespace-from",
];

function resolveFrom(folder: string, name: string): string | undefined {
  try {
    return Bun.resolveSync(name, folder);
  } catch {
    return undefined;
  }
}

function babel(version: string, engine: string, engineVersion: string, programs: readonly string[]): Build {
  const presetOptions = { targets: { [engine]: engineVersion }, modules: "commonjs" };
  return {
    tool: "@babel/core",
    version,
    label: `${engine}-${engineVersion}`,
    settings: `@babel/preset-env ${JSON.stringify(presetOptions)}`,
    programs,
    async emit(folder, program) {
      const loaded = await import(Bun.resolveSync("@babel/core", folder));
      const transformSync = loaded.transformSync ?? loaded.default.transformSync;
      const presets = [[Bun.resolveSync("@babel/preset-env", folder), presetOptions]];
      const plugins = babelPlugins.flatMap(name => resolveFrom(folder, name) ?? []);
      const options = { babelrc: false, configFile: false, sourceType: "module", presets, plugins };
      return emitEachFile(
        program,
        (name, text) => transformSync(text, { ...options, filename: path.join(folder, name) })?.code ?? undefined,
      );
    },
  };
}

function swc(version: string, target: string, programs: readonly string[]): Build {
  return {
    tool: "@swc/core",
    version,
    label: target,
    settings: `jsc.target: "${target}", module.type: "commonjs"`,
    programs,
    async emit(folder, program) {
      const transformSync = await loadSwc(folder);
      const options = { swcrc: false, jsc: { parser: { syntax: "typescript" }, target }, module: { type: "commonjs" } };
      return emitEachFile(
        program,
        (name, text) => transformSync(text, { ...options, filename: name.replace(/\.js$/, ".ts") }).code,
      );
    },
  };
}

const modulePrograms = ["barrel"];
const newerModulePrograms = ["barrel", "namespace-reexport"];
const oldSyntaxPrograms = ["async-functions", "derived-classes", "spreads-and-rests"];
const privatePrograms = ["private-fields", "private-methods-and-statics"];

const builds: readonly Build[] = [
  typescript("2.9", "ES5", [...modulePrograms, ...oldSyntaxPrograms]),
  typescript("3.8", "ES5", [...modulePrograms, ...oldSyntaxPrograms], true),
  typescript("3.8", "ES2015", ["private-fields", "namespace-reexport", "async-functions"]),
  typescript("3.9", "ES2017", [...newerModulePrograms, "spreads-and-rests"]),
  typescript("4.2", "ES2015", [...modulePrograms, "private-fields", "async-functions"]),
  typescript("4.2", "ES5", ["derived-classes", "spreads-and-rests"]),
  typescript("4.5", "ES2020", [...modulePrograms, ...privatePrograms]),
  typescript("5.6", "ES2021", [...newerModulePrograms, ...privatePrograms]),
  typescript("5.9", "ES5", [...modulePrograms, ...oldSyntaxPrograms], true),
  typescript("5.9", "ES2021", [...newerModulePrograms, ...privatePrograms]),
  esbuild("0.13", "es2019", [...modulePrograms, "private-fields"]),
  esbuild("0.14", "es2016", [...modulePrograms, ...privatePrograms, "async-functions", "spreads-and-rests"]),
  esbuild("0.20", "es2020", [...newerModulePrograms, ...privatePrograms]),
  esbuild("0.25", "es2020", [...newerModulePrograms, ...privatePrograms]),
  esbuild("0.25", "es2020", [...newerModulePrograms, ...privatePrograms], "cjs"),
  esbuild("0.25", "es2016", [...modulePrograms, "async-functions", "spreads-and-rests"], "esm"),
  bun("1.1", "esm", newerModulePrograms),
  bun("1.2", "cjs", newerModulePrograms),
  bun("1.2", "esm", newerModulePrograms),
  bun("1.3", "cjs", newerModulePrograms),
  bun("1.3", "esm", newerModulePrograms),
  rolldown("1.0", "cjs", newerModulePrograms),
  rolldown("1.0", "esm", newerModulePrograms),
  babel("7.8", "node", "6", [...modulePrograms, "private-fields", "async-functions", "spreads-and-rests"]),
  babel("7.14", "node", "10", [...newerModulePrograms, ...privatePrograms]),
  babel("7.28", "ie", "11", [...modulePrograms, ...oldSyntaxPrograms]),
  babel("7.28", "node", "12", [...newerModulePrograms, ...privatePrograms]),
  swc("1.3", "es5", [...modulePrograms, ...oldSyntaxPrograms]),
  swc("1.3", "es2019", [...newerModulePrograms, ...privatePrograms]),
  swc("1.13", "es5", [...modulePrograms, ...oldSyntaxPrograms]),
  swc("1.13", "es2019", [...newerModulePrograms, ...privatePrograms]),
];

function countKnownFunctionsOf(unit: Unit, entryOfTree: ReadonlyMap<string, TableEntry>): number {
  const functions = functionsOfUnit(unit, () => true);
  const verdicts = new Map<FoundFunction, boolean>();
  const agrees = (expected: Reference, found: FoundReference): boolean => {
    if (expected.kind === "global") return found.kind === "global" && found.path.join(".") === expected.path.join(".");
    if (expected.kind !== "helper") return found.kind === expected.kind;
    if (found.kind !== "definition") return false;
    const held = functions.filter(other => other.publishedName === found.publishedName);
    return (
      held.length > 0 &&
      held.every(other => isKnown(other) && entryOfTree.get(other.tree)!.line.helper === expected.helper)
    );
  };
  const isKnown = (one: FoundFunction): boolean => {
    const verdict = verdicts.get(one);
    if (verdict !== undefined) return verdict;
    verdicts.set(one, false);
    const references = entryOfTree.get(one.tree)?.references;
    const isAccepted =
      references?.length === one.references.length &&
      references.every(([, expected], index) => agrees(expected, one.references[index]));
    verdicts.set(one, isAccepted);
    return isAccepted;
  };
  return functions.filter(isKnown).length;
}

function countKnownFunctions(emitted: Emitted, table: Table): number {
  const entryOfTree = new Map(table.entries.map(entry => [entry.tree.tree, entry] as const));
  let count = 0;
  for (const [name, text] of emitted) {
    const unit = name.endsWith(".json") ? undefined : readUnit(name, text);
    if (unit !== undefined) count += countKnownFunctionsOf(unit, entryOfTree);
  }
  return count;
}

function findVersion(fetched: readonly FetchedVersion[], build: Build): FetchedVersion | undefined {
  return fetched
    .filter(one => toolOf(one.name) === build.tool && minorOf(one.version) === build.version)
    .sort((a, b) => compareVersions(a.version, b.version))
    .at(-1);
}

function removeWrittenFixtures(into: string): void {
  const folders = new Set(Object.values(toolNames).map(names => names.folder));
  for (const name of existsSync(into) ? readdirSync(into) : []) {
    const tool = /^(.+)-\d+\.\d+$/.exec(name)?.[1];
    if (tool !== undefined && folders.has(tool)) rmSync(path.join(into, name), { recursive: true, force: true });
  }
}

function runsUnderPlainBun(folder: string, main: string): boolean {
  const result = Bun.spawnSync([process.execPath, "run", `./${main}`], {
    cwd: folder,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
    timeout: 30_000,
  });
  return result.exitCode === 0;
}

export async function writeFixtures(
  packages: string,
  fetched: readonly FetchedVersion[],
  table: Table,
  into: string,
): Promise<string[]> {
  const written: string[] = [];
  removeWrittenFixtures(into);
  for (const build of builds) {
    const { folder: toolFolder, title } = toolNames[build.tool];
    const version = findVersion(fetched, build);
    if (version === undefined) {
      written.push(`${title} ${build.version} was not fetched`);
      continue;
    }
    const folder = path.resolve(packages, folderNameOf(version.name, version.version));
    for (const name of build.programs) {
      const program = fixturePrograms.find(program => program.name === name)!;
      const label = `${toolFolder}-${build.version}/${name}-${build.label}`;
      let emitted: Emitted | undefined;
      let complaint = "";
      try {
        emitted = await build.emit(folder, program);
      } catch (error) {
        complaint = `: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`;
      }
      const main = emitted && [...emitted.keys()].find(file => /^main\.[cm]js$/.test(file));
      if (emitted === undefined || main === undefined) {
        written.push(`${label}: the tool refused it${complaint}`);
        continue;
      }
      const count = countKnownFunctions(emitted, table);
      const head = `// ${program.about} Emitted by ${title} ${version.version}: ${build.settings}.\n// STATISTIC: KnownHelperFunctions >= ${count}\n`;
      const target = path.join(into, label);
      mkdirSync(target, { recursive: true });
      for (const [file, text] of emitted)
        writeFileSync(path.join(target, file), (file === main ? head : "") + text + (text.endsWith("\n") ? "" : "\n"));
      if (runsUnderPlainBun(target, main)) written.push(`${label}: ${emitted.size} files, ${count} known functions`);
      else {
        rmSync(target, { recursive: true, force: true });
        written.push(`${label}: not kept, it fails under plain Bun`);
      }
    }
  }
  return written;
}
