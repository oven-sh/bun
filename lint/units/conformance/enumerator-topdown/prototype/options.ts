// Research probe: the option declarations of tsoptions/declscompiler.go, the enum maps, and the harness lists.
import decls from "./decls.json";

export type OptionKind = "String" | "Number" | "Boolean" | "Object" | "List" | "ListOrElement" | "Enum";
export interface CommandLineOption {
  name: string;
  kind: OptionKind;
  isFilePath: boolean;
  isCommandLineOnly: boolean;
  isTSConfigOnly: boolean;
  affects: string[];
  line?: number;
}

export const optionsDeclarations: CommandLineOption[] = (decls as any[]).map(d => ({
  name: d.name, kind: d.kind, isFilePath: d.isFilePath, isCommandLineOnly: d.isCommandLineOnly,
  isTSConfigOnly: d.isTSConfigOnly, affects: d.affects, line: d.line,
}));

function extra(name: string): CommandLineOption {
  return { name, kind: "Boolean", isFilePath: false, isCommandLineOnly: false, isTSConfigOnly: false, affects: [] };
}
// harnessutil.go:319-339
export const compilerOptions: CommandLineOption[] = [
  ...optionsDeclarations,
  extra("allowNonTsExtensions"), extra("noErrorTruncation"), extra("suppressOutputPathCheck"), extra("noCheck"),
];
function h(name: string, kind: OptionKind): CommandLineOption {
  return { name, kind, isFilePath: false, isCommandLineOnly: false, isTSConfigOnly: false, affects: [] };
}
// harnessutil.go:341-397
export const harnessCommandLineOptions: CommandLineOption[] = [
  h("useCaseSensitiveFileNames", "Boolean"), h("baselineFile", "String"), h("includeBuiltFile", "String"),
  h("fileName", "String"), h("libFiles", "List"), h("noImplicitReferences", "Boolean"),
  h("currentDirectory", "String"), h("symlink", "String"), h("link", "String"),
  h("noTypesAndSymbols", "Boolean"), h("fullEmitPaths", "Boolean"), h("reportDiagnostics", "Boolean"),
  h("captureSuggestions", "Boolean"),
];

const byLower = new Map<string, CommandLineOption>();
for (const o of compilerOptions) if (!byLower.has(o.name.toLowerCase())) byLower.set(o.name.toLowerCase(), o);
const harnessByLower = new Map<string, CommandLineOption>();
for (const o of harnessCommandLineOptions) harnessByLower.set(o.name.toLowerCase(), o);

// Directive names are ASCII (Go \w), so a lowercase compare equals strings.EqualFold.
export function getCommandLineOption(name: string): CommandLineOption | undefined {
  return byLower.get(name.toLowerCase());
}
export function getHarnessOption(name: string): CommandLineOption | undefined {
  return harnessByLower.get(name.toLowerCase());
}

// core/compileroptions.go
export const ModuleKind = { None: 0, CommonJS: 1, AMD: 2, UMD: 3, System: 4, ES2015: 5, ES2020: 6, ES2022: 7, ESNext: 99, Node16: 100, Node18: 101, Node20: 102, NodeNext: 199, Preserve: 200 } as const;
export const ModuleResolutionKind = { Unknown: 0, Classic: 1, Node10: 2, Node16: 3, NodeNext: 99, Bundler: 100 } as const;
export const ScriptTarget = { None: 0, ES5: 1, ES2015: 2, ES2016: 3, ES2017: 4, ES2018: 5, ES2019: 6, ES2020: 7, ES2021: 8, ES2022: 9, ES2023: 10, ES2024: 11, ES2025: 12, ESNext: 99, JSON: 100 } as const;

// tsoptions/enummaps.go, in declaration order
export const enumMaps: Record<string, [string, number][]> = {
  moduleResolution: [["node16", 3], ["nodenext", 99], ["bundler", 100], ["classic", 1], ["node", 2], ["node10", 2]],
  target: [["es5", 1], ["es6", 2], ["es2015", 2], ["es2016", 3], ["es2017", 4], ["es2018", 5], ["es2019", 6], ["es2020", 7], ["es2021", 8], ["es2022", 9], ["es2023", 10], ["es2024", 11], ["es2025", 12], ["esnext", 99]],
  module: [["commonjs", 1], ["amd", 2], ["system", 4], ["umd", 3], ["es6", 5], ["es2015", 5], ["es2020", 6], ["es2022", 7], ["esnext", 99], ["node16", 100], ["node18", 101], ["node20", 102], ["nodenext", 199], ["preserve", 200]],
  moduleDetection: [["auto", 1], ["legacy", 2], ["force", 3]],
  jsx: [["preserve", 1], ["react-native", 2], ["react-jsx", 4], ["react-jsxdev", 5], ["react", 3]],
  newLine: [["crlf", 1], ["lf", 2]],
};
export function enumMapOf(option: CommandLineOption): [string, number][] | undefined {
  return option.kind === "Enum" ? enumMaps[option.name] : undefined;
}

// compiler_runner.go:163-188
export function getCompilerVaryByMap(): Set<string> {
  const s = new Set<string>();
  for (const o of optionsDeclarations) {
    if (!o.isCommandLineOnly && (o.kind === "Boolean" || o.kind === "Enum") && o.affects.length > 0) s.add(o.name.toLowerCase());
  }
  s.add("noemit");
  s.add("isolatedmodules");
  return s;
}
export const compilerVaryBy = getCompilerVaryByMap();
if (import.meta.main) {
  console.log("declared", optionsDeclarations.length, "vary", compilerVaryBy.size);
  console.log([...compilerVaryBy].sort().join(" "));
  console.log("enum options declared:", optionsDeclarations.filter(o => o.kind === "Enum").map(o => o.name));
  console.log("moduleDetection values check / jsx: see core");
}
