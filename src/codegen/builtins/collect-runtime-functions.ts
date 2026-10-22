import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { evaluateCMake } from "../../../scripts/build/cmake.ts";
import { windowsOnlyBuiltinFunctions } from "../builtin-function-ids.ts";
import { cap } from "../helpers.ts";
import {
  GeneratorError,
  type Problems,
  type RuntimeFunctionRole,
  type Source,
  type SourcedDeclaration,
} from "./declarations.ts";
import { compareBytes } from "./paths.ts";
import { targetPlatforms, type FunctionRef, type Origin, type TargetPlatform } from "./vocabulary.ts";

export interface EngineFunction {
  file: string;
  name: string;
  cppCodeName: string;
  index: number;
}

export interface RuntimeFunctionInput {
  javaScriptCore: string | null;
  bunRoot: string;
  declared: readonly SourcedDeclaration[];
  hostFunctionIds: ReadonlyMap<string, number>;
}

interface FunctionBounds {
  start: number;
  end: number;
  name: string;
}

interface FoundFunction {
  function: FunctionRef;
  exportName: string;
  source: Source;
}

interface EngineHalf {
  builtins: SourcedDeclaration[];
  compilerFunctions: FoundFunction[];
}

type Replacements = readonly (readonly [from: string, to: string])[];

const firstCompilerFunctionId = 0x20000;

const engineSourceListName = "JavaScriptCore_BUILTINS_SOURCES";
const tableListFile = "aot/builtins/AOTBuiltinTable.cmake";
const handwrittenListName = "JavaScriptCore_AOT_BUILTIN_TABLE_HANDWRITTEN_FUNCTIONS";
const modelListName = "JavaScriptCore_AOT_BUILTIN_TABLE_MODEL_FUNCTIONS";
const handwrittenDirectory = "aot/builtins/handwritten";
const preludeDirectory = "src/aot/prelude";
const hostFunctionDirectory = "src/js/builtins";

const windowsOnly: readonly TargetPlatform[] = ["Windows"];

const functionHeadPattern = /(?:@[\w|=\[\] "\.]+\s*\n)*(?:async\s+)?function\s+(\w+)\s*\(.*?\)/gs;
const constructorAnnotationPattern = /^@(?:constructor|nakedConstructor)/m;

const upperFirstReplacements: Replacements = [
  ["Xml", "XML"],
  ["Svg", "SVG"],
];

const lowerFirstReplacements: Replacements = [
  ["dOM", "dom"],
  ["uRL", "url"],
  ["jS", "js"],
  ["xML", "xml"],
  ["xSLT", "xslt"],
  ["cSS", "css"],
  ["rTC", "rtc"],
];

const reservedWords: ReadonlySet<string> = new Set(
  (
    "break case catch class const continue debugger default delete do else enum export extends false finally for " +
    "function if import in instanceof new null return super switch this throw true try typeof var void while with " +
    "yield let static await"
  ).split(" "),
);

export function exportedNameOf(name: string): string {
  return reservedWords.has(name) ? `${name}_` : name;
}

function functionNameOf(exportName: string): string {
  const name = exportName.slice(0, -1);
  return exportedNameOf(name) === exportName ? name : exportName;
}

const keyOf = ({ file, name }: FunctionRef): string => `${file}\t${name}`;

const compareFunctions = (left: FunctionRef, right: FunctionRef): number =>
  compareBytes(left.file, right.file) || compareBytes(left.name, right.name);

const sourceOf = (file: string, origin: Origin): Source => ({ file, line: null, origin, proof: "Structure" });

export function engineBuiltinSources(javaScriptCore: string): string[] {
  const file = join(javaScriptCore, "CMakeLists.txt");
  const sources = evaluateCMake(file, {
    variables: { JAVASCRIPTCORE_DIR: javaScriptCore, JavaScriptCore_LIBRARY_TYPE: "STATIC" },
  }).list(engineSourceListName);
  if (sources.length === 0) throw new GeneratorError(`${file}: there is no list ${engineSourceListName}`);
  return sources;
}

function blankComments(text: string): string {
  return text
    .replace(/\/\/.*?\n/gs, comment => `//${" ".repeat(comment.length - 3)}\n`)
    .replace(/\/\*.*?\*\//gs, comment => `/*${" ".repeat(comment.length - 4)}*/`);
}

function findBodyEnd(text: string, bodyStart: number, name: string): number {
  let end = bodyStart;
  let depth = 1;
  let isEscaped = false;
  let quote: string | null = null;
  while (depth > 0) {
    end++;
    if (end === text.length) throw new GeneratorError(`the body of the function ${name} has no end`);
    const character = text[end];
    if (isEscaped) {
      isEscaped = false;
    } else if (character === "`" || character === "'" || character === '"') {
      if (quote === null) quote = character;
      else if (character === quote) quote = null;
    } else if (character === "\\" && quote !== null) {
      isEscaped = true;
    } else if (character === "\n" && quote !== "`") {
      quote = null;
    } else if (quote === null) {
      depth += Number(character === "{") - Number(character === "}");
    }
  }
  return end + 1;
}

function findFunctions(blankedText: string): FunctionBounds[] {
  const bounds: FunctionBounds[] = [];
  let end = 0;
  for (const head of blankedText.matchAll(functionHeadPattern)) {
    if (head.index < end) continue;
    const name = head[1];
    const bodyStart = blankedText.indexOf("{", head.index + head[0].length);
    if (bodyStart === -1) throw new GeneratorError(`the function ${name} has no body`);
    end = findBodyEnd(blankedText, bodyStart, name);
    bounds.push({ start: head.index, end, name });
  }
  return bounds;
}

export function functionBounds(text: string): { start: number; end: number; name: string }[] {
  return findFunctions(blankComments(text));
}

const replaceEach = (text: string, replacements: Replacements): string =>
  replacements.reduce((replaced, [from, to]) => replaced.replaceAll(from, to), text);

const upperFirst = (text: string): string => replaceEach(cap(text), upperFirstReplacements);

const lowerFirst = (text: string): string =>
  replaceEach(text.slice(0, 1).toLowerCase() + text.slice(1), lowerFirstReplacements);

function cppCodeNameOf(object: string, name: string, blankedSource: string): string {
  const objectName = object.replace(/\.[a-z]/gi, match => match[1].toUpperCase());
  const suffix = constructorAnnotationPattern.test(blankedSource) ? "Constructor" : "";
  return `${lowerFirst(objectName + upperFirst(name) + suffix)}Code`;
}

function findEngineFunctions(sources: readonly string[]): EngineFunction[] {
  const files = sources.filter(file => file.endsWith(".js")).sort(compareBytes);
  const found = files.flatMap(file => {
    const object = basename(file, ".js");
    const text = blankComments(readFileSync(file, "utf8"));
    return findFunctions(text).map(({ start, end, name }) => ({
      file: object,
      name,
      cppCodeName: cppCodeNameOf(object, name, text.slice(start, end)),
    }));
  });
  return found
    .sort((left, right) => compareBytes(left.name, right.name))
    .map((engineFunction, index) => ({ ...engineFunction, index }));
}

export function engineFunctions(javaScriptCore: string): EngineFunction[] {
  return findEngineFunctions(engineBuiltinSources(javaScriptCore));
}

export function exportedFunctionsOf(file: string): string[] {
  return new Bun.Transpiler({ loader: "ts" }).scan(readFileSync(file, "utf8")).exports;
}

function findExportedFunctions(root: string, path: string, file: string, origin: Origin): FoundFunction[] {
  return exportedFunctionsOf(join(root, path)).map(exportName => ({
    function: { file, name: functionNameOf(exportName) },
    exportName,
    source: sourceOf(path, origin),
  }));
}

function declarationOf(
  found: FoundFunction,
  id: number,
  role: RuntimeFunctionRole,
  cppCodeName: string | null,
  platforms: readonly TargetPlatform[] = targetPlatforms,
): SourcedDeclaration {
  return {
    declaration: {
      declares: "RuntimeFunction",
      id,
      role,
      function: found.function,
      exportName: found.exportName,
      cppCodeName,
      isHiddenInStackTraces: role !== "HostBuiltin",
      isNeverInlined: false,
      platforms,
    },
    source: found.source,
  };
}

function removeExcludedFunctions(
  upstreamFunctions: readonly EngineFunction[],
  declared: readonly SourcedDeclaration[],
  problems: Problems,
): EngineFunction[] {
  const upstreamKeys = new Set(upstreamFunctions.map(keyOf));
  const excludedKeys = new Set<string>();
  for (const { declaration, source } of declared) {
    if (declaration.declares !== "ExcludedFunction" || source.origin !== "Engine") continue;
    const key = keyOf(declaration.function);
    if (!upstreamKeys.has(key)) {
      problems.add(source, `${declaration.function.file}.js has no function ${declaration.function.name}`);
    }
    excludedKeys.add(key);
  }
  return upstreamFunctions.filter(upstream => !excludedKeys.has(keyOf(upstream)));
}

function findHandwrittenFiles(declared: readonly SourcedDeclaration[], problems: Problems): Map<string, Source> {
  const files = new Map<string, Source>();
  for (const { declaration, source } of declared) {
    if (declaration.declares !== "HandwrittenFile") continue;
    if (files.has(declaration.file)) problems.add(source, `handwritten ${declaration.file} is declared twice`);
    else files.set(declaration.file, source);
  }
  return files;
}

function collectHandwrittenFile(
  javaScriptCore: string,
  file: string,
  replacedFunctions: readonly EngineFunction[],
  declarationSource: Source,
  problems: Problems,
): EngineHalf {
  const half: EngineHalf = { builtins: [], compilerFunctions: [] };
  const path = `${handwrittenDirectory}/${file}.ts`;
  if (!existsSync(join(javaScriptCore, path))) {
    problems.add(declarationSource, `there is no ${path}`);
    return half;
  }
  const found = findExportedFunctions(javaScriptCore, path, file, "Engine");
  const exportNames = new Set(found.map(({ exportName }) => exportName));
  const upstreamByExportName = new Map(replacedFunctions.map(upstream => [exportedNameOf(upstream.name), upstream]));
  for (const exportName of upstreamByExportName.keys()) {
    if (exportNames.has(exportName)) continue;
    problems.add(declarationSource, `${path} has no \`export function ${exportName}\``);
  }
  for (const handwritten of found) {
    const upstream = upstreamByExportName.get(handwritten.exportName);
    if (upstream === undefined) half.compilerFunctions.push(handwritten);
    else half.builtins.push(declarationOf(handwritten, upstream.index, "EngineBuiltin", upstream.cppCodeName));
  }
  return half;
}

function collectModelFunctions(javaScriptCore: string, listed: readonly string[], problems: Problems): FoundFunction[] {
  return listed.flatMap(path => {
    if (existsSync(join(javaScriptCore, path))) {
      return findExportedFunctions(javaScriptCore, path, `models/${basename(path, ".ts")}`, "Engine");
    }
    problems.add(sourceOf(tableListFile, "Engine"), `${modelListName} lists ${path}, which does not exist`);
    return [];
  });
}

function collectEngineHalf(
  javaScriptCore: string,
  declared: readonly SourcedDeclaration[],
  problems: Problems,
): EngineHalf {
  const sources = engineBuiltinSources(javaScriptCore);
  const pathByObject = new Map(
    sources.map(file => [basename(file, ".js"), relative(javaScriptCore, file).split(sep).join("/")]),
  );
  const includedFunctions = removeExcludedFunctions(findEngineFunctions(sources), declared, problems);
  const handwrittenFiles = findHandwrittenFiles(declared, problems);
  const lists = evaluateCMake(join(javaScriptCore, tableListFile), { variables: {} });
  const listedHandwrittenFiles = new Set(lists.list(handwrittenListName));

  const half: EngineHalf = {
    builtins: [],
    compilerFunctions: collectModelFunctions(javaScriptCore, lists.list(modelListName), problems),
  };
  for (const { file, name, cppCodeName, index } of includedFunctions) {
    if (handwrittenFiles.has(file)) continue;
    const found = {
      function: { file, name },
      exportName: exportedNameOf(name),
      source: sourceOf(pathByObject.get(file)!, "Engine"),
    };
    half.builtins.push(declarationOf(found, index, "EngineBuiltin", cppCodeName));
  }
  for (const [file, declarationSource] of handwrittenFiles) {
    if (!listedHandwrittenFiles.has(`${handwrittenDirectory}/${file}.ts`)) {
      problems.add(declarationSource, `handwritten ${file} is missing from ${handwrittenListName} in ${tableListFile}`);
    }
    const replacedFunctions = includedFunctions.filter(upstream => upstream.file === file);
    const handwritten = collectHandwrittenFile(javaScriptCore, file, replacedFunctions, declarationSource, problems);
    half.builtins.push(...handwritten.builtins);
    half.compilerFunctions.push(...handwritten.compilerFunctions);
  }
  return half;
}

function collectPreludeFunctions(bunRoot: string): FoundFunction[] {
  return readdirSync(join(bunRoot, preludeDirectory))
    .filter(name => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .sort(compareBytes)
    .flatMap(name =>
      findExportedFunctions(bunRoot, `${preludeDirectory}/${name}`, `prelude/${basename(name, ".ts")}`, "Host"),
    );
}

function numberCompilerFunctions(
  found: readonly FoundFunction[],
  declaredFunctions: readonly FunctionRef[],
): SourcedDeclaration[] {
  const foundFunctions = found.map(compilerFunction => compilerFunction.function);
  const ordered = [...foundFunctions, ...declaredFunctions].sort(compareFunctions);
  const idByKey = new Map(ordered.map((ref, position) => [keyOf(ref), firstCompilerFunctionId + position]));
  return found.map(compilerFunction =>
    declarationOf(compilerFunction, idByKey.get(keyOf(compilerFunction.function))!, "CompilerFunction", null),
  );
}

function findExcludedHostFunctions(
  hostFunctions: readonly FunctionRef[],
  declared: readonly SourcedDeclaration[],
  problems: Problems,
): Set<string> {
  const hostKeys = new Set(hostFunctions.map(keyOf));
  const excludedKeys = new Set<string>();
  for (const { declaration, source } of declared) {
    if (declaration.declares !== "ExcludedFunction" || source.origin !== "Host") continue;
    const { file, name } = declaration.function;
    if (!hostKeys.has(keyOf(declaration.function))) problems.add(source, `src/js/${file}.ts has no function ${name}`);
    excludedKeys.add(keyOf(declaration.function));
  }
  return excludedKeys;
}

function collectHostFunctions(
  hostFunctionIds: ReadonlyMap<string, number>,
  declared: readonly SourcedDeclaration[],
  problems: Problems,
): SourcedDeclaration[] {
  const hostFunctions = Array.from(hostFunctionIds, ([key, id]) => {
    const [fileName, name] = key.split("\t");
    const found = {
      function: { file: `builtins/${basename(fileName, ".ts")}`, name },
      exportName: name,
      source: sourceOf(`${hostFunctionDirectory}/${fileName}`, "Host"),
    };
    return { found, id, platforms: windowsOnlyBuiltinFunctions.has(key) ? windowsOnly : targetPlatforms };
  });
  const excludedKeys = findExcludedHostFunctions(
    hostFunctions.map(({ found }) => found.function),
    declared,
    problems,
  );
  return hostFunctions
    .filter(({ found }) => !excludedKeys.has(keyOf(found.function)))
    .map(({ found, id, platforms }) => declarationOf(found, id, "HostBuiltin", null, platforms));
}

export function collectRuntimeFunctions(input: RuntimeFunctionInput, problems: Problems): SourcedDeclaration[] {
  const { javaScriptCore, bunRoot, declared, hostFunctionIds } = input;
  const engine: EngineHalf =
    javaScriptCore === null
      ? { builtins: [], compilerFunctions: [] }
      : collectEngineHalf(javaScriptCore, declared, problems);
  const declaredCompilerFunctions = declared.flatMap(({ declaration }) =>
    declaration.declares === "RuntimeFunction" && declaration.role === "CompilerFunction" ? [declaration.function] : [],
  );
  const compilerFunctions = [...engine.compilerFunctions, ...collectPreludeFunctions(bunRoot)];
  return [
    ...engine.builtins,
    ...numberCompilerFunctions(compilerFunctions, declaredCompilerFunctions),
    ...collectHostFunctions(hostFunctionIds, declared, problems),
  ];
}
