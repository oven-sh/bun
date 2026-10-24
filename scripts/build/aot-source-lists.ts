import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { evaluateCMake } from "./cmake.ts";
import { BuildError } from "./error.ts";
import { writeIfChanged } from "./fs.ts";

/** Paths are relative to JavaScriptCore, with `/`, in ascending order by code unit. */
export interface AotSourceLists {
  /** Without those that are compiled for size: people keep that list. */
  librarySources: string[];
  testSources: string[];
  includeDirectories: string[];
  exportedHeaders: string[];
  /** Names: a build writes them into one folder of its own. */
  schemaExportedHeaders: string[];
}

export interface DeclaredAotLists {
  sourcesCompiledForSize: string[];
  generatedSources: string[];
  generatedHeaders: string[];
  programSources: string[];
  shellSources: string[];
  tableExportedHeaders: string[];
  /** Names: a build writes them into one folder of its own. */
  tableExportedGeneratedHeaders: string[];
}

export interface WrittenAotLists extends AotSourceLists, DeclaredAotLists {}

const sourcesTxt = "aot/Sources.txt";
const sourcesCompiledForSizeTxt = "aot/SourcesCompiledForSize.txt";
const aotCMake = "aot/AOT.cmake";
const headerExtensions = [".h", ".def", ".inc"];
const includedAotHeader = /#\s*include\s+["<](?:JavaScriptCore\/)?(AOT[\w+]*\.(?:h|def|inc))[">]/g;

/** Stands for a build's folder of generated files, which the lists name by absolute path. */
const derivedSources = "/DerivedSources";
const isInBuildFolder = (path: string): boolean => path.startsWith(`${derivedSources}/`);

const listOpeners = {
  includeDirectories: "list(APPEND JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES",
  exportedHeaders: "set(JavaScriptCore_AOT_EXPORTED_HEADERS",
  schemaExportedHeaders: "set(JavaScriptCore_AOT_SCHEMA_EXPORTED_HEADERS",
  testSources: "set(JavaScriptCore_AOT_TEST_SOURCES",
} as const;

function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function filesUnder(root: string, directory: string, isWanted: (name: string) => boolean): string[] {
  const found: string[] = [];
  const pending = [join(root, directory)];
  for (const current of pending) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") pending.push(path);
      } else if (isWanted(entry.name)) found.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return found.sort(byCodeUnit);
}

const isHeader = (name: string): boolean =>
  name.startsWith("AOT") && headerExtensions.some(extension => name.endsWith(extension));
const isTestSource = (path: string): boolean => path.startsWith("aot/tests/");

function includedAotHeadersOf(text: string): string[] {
  return [...text.matchAll(includedAotHeader)].map(match => match[1]!);
}

function includedAotHeaders(file: string): string[] {
  return includedAotHeadersOf(readFileSync(file, "utf8"));
}

export function readWrittenAotLists(javaScriptCore: string): WrittenAotLists {
  const evaluated = evaluateCMake(join(javaScriptCore, aotCMake), {
    variables: { JAVASCRIPTCORE_DIR: javaScriptCore, JavaScriptCore_DERIVED_SOURCES_DIR: derivedSources },
  });
  const linesOf = (list: string): string[] =>
    readFileSync(join(javaScriptCore, list), "utf8")
      .split(/\r?\n/)
      .filter(line => line !== "");
  return {
    librarySources: linesOf(sourcesTxt),
    sourcesCompiledForSize: linesOf(sourcesCompiledForSizeTxt),
    testSources: evaluated.list("JavaScriptCore_AOT_TEST_SOURCES"),
    includeDirectories: evaluated
      .list("JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES")
      .filter(directory => !isInBuildFolder(directory))
      .map(directory => relative(javaScriptCore, directory).replaceAll("\\", "/")),
    exportedHeaders: evaluated.list("JavaScriptCore_AOT_EXPORTED_HEADERS"),
    schemaExportedHeaders: evaluated.list("JavaScriptCore_AOT_SCHEMA_EXPORTED_HEADERS").map(path => basename(path)),
    generatedSources: [
      ...evaluated.list("JavaScriptCore_AOT_SCHEMA_GENERATED_SOURCES"),
      ...evaluated.list("JavaScriptCore_AOT_SCHEMA_GENERATED_TEST_SOURCES"),
      ...evaluated.list("JavaScriptCore_AOT_BUILTIN_TABLE_GENERATED_SOURCES"),
      ...evaluated.list("JavaScriptCore_AOT_BUILTIN_TABLE_DATA_SOURCES"),
    ],
    generatedHeaders: [
      ...evaluated.list("JavaScriptCore_AOT_SCHEMA_GENERATED_HEADERS"),
      ...evaluated.list("JavaScriptCore_AOT_BUILTIN_TABLE_GENERATED_HEADERS"),
      ...evaluated.list("JavaScriptCore_AOT_VECTOR_GENERATED_HEADERS"),
    ],
    programSources: evaluated.list("JavaScriptCore_AOT_PROGRAM_SOURCES"),
    shellSources: evaluated.list("JavaScriptCore_AOT_SHELL_SOURCES"),
    tableExportedHeaders: evaluated.list("JavaScriptCore_AOT_BUILTIN_TABLE_EXPORTED_HEADERS"),
    tableExportedGeneratedHeaders: [
      ...evaluated.list("JavaScriptCore_AOT_BUILTIN_TABLE_EXPORTED_GENERATED_HEADERS"),
      ...evaluated.list("JavaScriptCore_AOT_VECTOR_GENERATED_HEADERS"),
    ].map(path => basename(path)),
  };
}

function aotHeadersByName(javaScriptCore: string): Map<string, string> {
  const byName = new Map<string, string>();
  for (const path of filesUnder(javaScriptCore, "aot", isHeader)) {
    if (path.startsWith("aot/tests/")) continue;
    const other = byName.get(basename(path));
    if (other !== undefined) throw new BuildError(`${other} and ${path} have the same name`);
    byName.set(basename(path), path);
  }
  return byName;
}

function exportRoots(javaScriptCore: string, bunRoot: string): Set<string> {
  const roots = new Set<string>();
  const isNativeOrGenerator = (name: string): boolean => /\.(?:cpp|h|mm|ts)$/.test(name);
  for (const path of filesUnder(bunRoot, "src", isNativeOrGenerator)) {
    if (path.endsWith(".ts") && !path.startsWith("src/codegen/")) continue;
    for (const name of includedAotHeaders(join(bunRoot, path))) roots.add(name);
  }
  for (const entry of readdirSync(javaScriptCore, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "aot") continue;
    for (const path of filesUnder(javaScriptCore, entry.name, name => name.endsWith(".h"))) {
      for (const name of includedAotHeaders(join(javaScriptCore, path))) roots.add(name);
    }
  }
  return roots;
}

function exportedHeaderClosure(
  javaScriptCore: string,
  bunRoot: string,
  tableExportedHeaders: string[],
  schemaHeaders: ReadonlyMap<string, string>,
): Pick<AotSourceLists, "exportedHeaders" | "schemaExportedHeaders"> {
  const byName = aotHeadersByName(javaScriptCore);
  const tableNames = new Set(tableExportedHeaders.map(path => basename(path)));
  const reached = new Set<string>();
  const pending = [...exportRoots(javaScriptCore, bunRoot), ...tableNames];
  for (const name of pending) {
    if (reached.has(name)) continue;
    const path = byName.get(name);
    const text =
      schemaHeaders.get(name) ?? (path === undefined ? undefined : readFileSync(join(javaScriptCore, path), "utf8"));
    if (text === undefined) continue;
    reached.add(name);
    pending.push(...includedAotHeadersOf(text));
  }
  const names = [...reached].filter(name => !tableNames.has(name));
  return {
    exportedHeaders: names
      .filter(name => !schemaHeaders.has(name))
      .map(name => byName.get(name)!)
      .sort(byCodeUnit),
    schemaExportedHeaders: names.filter(name => schemaHeaders.has(name)).sort(byCodeUnit),
  };
}

function headerDirectories(javaScriptCore: string, generatedHeaders: string[]): string[] {
  const headers = [
    ...filesUnder(javaScriptCore, "aot", isHeader),
    ...generatedHeaders.filter(path => !isInBuildFolder(path)),
  ];
  return [...new Set(headers.map(path => dirname(path)))].sort(byCodeUnit);
}

export function computeAotSourceLists(
  javaScriptCore: string,
  bunRoot: string,
  declared: DeclaredAotLists,
  schemaHeaders: ReadonlyMap<string, string>,
): AotSourceLists {
  const listedElsewhere = new Set([
    ...declared.generatedSources,
    ...declared.programSources,
    ...declared.shellSources,
    ...declared.sourcesCompiledForSize,
  ]);
  const sources = filesUnder(javaScriptCore, "aot", name => name.endsWith(".cpp")).filter(
    path => !listedElsewhere.has(path),
  );
  return {
    librarySources: sources.filter(path => !isTestSource(path)),
    testSources: sources.filter(isTestSource),
    includeDirectories: headerDirectories(javaScriptCore, declared.generatedHeaders),
    ...exportedHeaderClosure(javaScriptCore, bunRoot, declared.tableExportedHeaders, schemaHeaders),
  };
}

function describeDifference(list: string, written: string[], expected: string[]): string[] {
  const writtenSet = new Set(written);
  const expectedSet = new Set(expected);
  const problems = [
    ...expected.filter(path => !writtenSet.has(path)).map(path => `${path}: not in ${list}`),
    ...written.filter(path => !expectedSet.has(path)).map(path => `${path}: in ${list}, and does not belong there`),
  ];
  if (problems.length > 0) return problems;
  if (written.length !== expected.length) return [`${list}: an entry is listed more than once`];
  return written.every((path, index) => path === expected[index]) ? [] : [`${list}: not in ascending order`];
}

/** A generated file may be missing: a step of the graph that is being configured writes it. */
export function findAotSourceListProblems(javaScriptCore: string): string[] {
  const written = readWrittenAotLists(javaScriptCore);
  const listedElsewhere = new Set([
    ...written.generatedSources,
    ...written.programSources,
    ...written.shellSources,
    ...written.sourcesCompiledForSize,
  ]);
  const present = filesUnder(javaScriptCore, "aot", name => name.endsWith(".cpp"));
  const sources = present.filter(path => !listedElsewhere.has(path));

  const exported = [...written.exportedHeaders, ...written.tableExportedHeaders];
  const exportedNames = new Set([
    ...exported.map(path => basename(path)),
    ...written.schemaExportedHeaders,
    ...written.tableExportedGeneratedHeaders,
  ]);
  const problems = [
    ...describeDifference(
      sourcesTxt,
      written.librarySources,
      sources.filter(path => !isTestSource(path)),
    ),
    ...describeDifference("JavaScriptCore_AOT_TEST_SOURCES", written.testSources, sources.filter(isTestSource)),
    ...describeDifference(
      "JavaScriptCore_PRIVATE_INCLUDE_DIRECTORIES",
      written.includeDirectories,
      headerDirectories(javaScriptCore, written.generatedHeaders),
    ),
    ...[...written.programSources, ...written.shellSources, ...written.sourcesCompiledForSize]
      .filter(path => !present.includes(path))
      .map(path => `${path}: listed, and there is no such file`),
    ...written.sourcesCompiledForSize
      .filter(isTestSource)
      .map(path => `${path}: in ${sourcesCompiledForSizeTxt}, and is a source of testaot`),
    ...(written.sourcesCompiledForSize.every((path, index, all) => index === 0 || all[index - 1]! < path)
      ? []
      : [`${sourcesCompiledForSizeTxt}: not in ascending order`]),
  ];
  const librarySources = sources.filter(path => !isTestSource(path));
  if (
    problems.length === 0 &&
    readFileSync(join(javaScriptCore, sourcesTxt), "utf8") !== formatSourcesTxt(librarySources)
  ) {
    problems.push(`${sourcesTxt}: a line is a path and nothing else`);
  }
  for (const header of exported) {
    if (!existsSync(join(javaScriptCore, header))) {
      if (!written.generatedHeaders.includes(header)) problems.push(`${header}: exported, and there is no such file`);
      continue;
    }
    for (const name of includedAotHeaders(join(javaScriptCore, header))) {
      if (!exportedNames.has(name)) problems.push(`${header}: is exported and includes ${name}, which is not`);
    }
  }
  return problems;
}

export function aotDirectories(javaScriptCore: string): string[] {
  const directories = [join(javaScriptCore, "aot")];
  for (const directory of directories) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) directories.push(join(directory, entry.name));
    }
  }
  return directories.sort(byCodeUnit);
}

export function handwrittenAotFiles(javaScriptCore: string): string[] {
  return filesUnder(javaScriptCore, "aot", name => name.endsWith(".cpp") || name.endsWith(".h"))
    .filter(path => !path.includes("/generated/"))
    .map(path => join(javaScriptCore, path));
}

export function formatSourcesTxt(librarySources: string[]): string {
  return librarySources.map(path => `${path}\n`).join("");
}

export function replaceListBody(text: string, opener: string, entries: string[]): string {
  const lines = text.split("\n");
  const start = lines.indexOf(opener);
  const end = lines.indexOf(")", start);
  if (start < 0 || end < 0) throw new BuildError(`${aotCMake}: no list that starts with ${opener}`);
  return [...lines.slice(0, start + 1), ...entries.map(entry => `    ${entry}`), ...lines.slice(end)].join("\n");
}

export function formatAotCMake(text: string, lists: AotSourceLists): string {
  const directories = lists.includeDirectories.map(directory => `"\${JAVASCRIPTCORE_DIR}/${directory}"`);
  const withDirectories = replaceListBody(text, listOpeners.includeDirectories, directories);
  const withHeaders = replaceListBody(withDirectories, listOpeners.exportedHeaders, lists.exportedHeaders);
  const withSchemaHeaders = replaceListBody(
    withHeaders,
    listOpeners.schemaExportedHeaders,
    lists.schemaExportedHeaders.map(name => `"\${JavaScriptCore_AOT_GENERATED_DIR}/${name}"`),
  );
  return replaceListBody(withSchemaHeaders, listOpeners.testSources, lists.testSources);
}

/** The headers that the schema's generator writes, by name, with their text. No build is needed: the generator is asked. */
export async function schemaHeadersOf(javaScriptCore: string): Promise<Map<string, string>> {
  const ir = join(javaScriptCore, "aot", "ir");
  const { loadSchemaModel } = await import(join(ir, "generator", "load.ts"));
  const { engineOutputs } = await import(join(ir, "generator", "outputs.ts"));
  const files: { name: string; lines: readonly string[] }[] = engineOutputs(loadSchemaModel(join(ir, "AOTSchema.def")));
  return new Map(files.filter(file => isHeader(file.name)).map(file => [file.name, file.lines.join("\n")]));
}

/** Returns the files it changed, or with `check` the files it would change. */
export async function writeAotSourceLists(javaScriptCore: string, bunRoot: string, check: boolean): Promise<string[]> {
  const lists = computeAotSourceLists(
    javaScriptCore,
    bunRoot,
    readWrittenAotLists(javaScriptCore),
    await schemaHeadersOf(javaScriptCore),
  );
  const files: Array<[path: string, text: string]> = [
    [join(javaScriptCore, sourcesTxt), formatSourcesTxt(lists.librarySources)],
    [join(javaScriptCore, aotCMake), formatAotCMake(readFileSync(join(javaScriptCore, aotCMake), "utf8"), lists)],
  ];
  const changed = files.filter(([path, text]) => readFileSync(path, "utf8") !== text);
  if (!check) for (const [path, text] of changed) writeIfChanged(path, text);
  return changed.map(([path]) => path);
}

async function main(args: string[]): Promise<number> {
  const bunRoot = resolve(import.meta.dirname, "..", "..");
  let webkit = process.env.BUN_WEBKIT_PATH || join(bunRoot, "vendor", "WebKit");
  let check = false;
  for (const arg of args) {
    if (arg === "--check") check = true;
    else if (arg.startsWith("--webkit=")) webkit = resolve(arg.slice("--webkit=".length));
    else {
      console.error("usage: bun scripts/build/aot-source-lists.ts [--webkit=<checkout>] [--check]");
      return 1;
    }
  }
  const changed = await writeAotSourceLists(join(webkit, "Source", "JavaScriptCore"), bunRoot, check);
  for (const path of changed) console.log(check ? `${path} is not what this tool writes` : `wrote ${path}`);
  return check && changed.length > 0 ? 1 : 0;
}

if (import.meta.main) {
  try {
    process.exit(await main(process.argv.slice(2)));
  } catch (error) {
    if (!(error instanceof BuildError)) throw error;
    process.stderr.write(error.format());
    process.exit(1);
  }
}
