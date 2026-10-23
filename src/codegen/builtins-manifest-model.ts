import fs from "node:fs";
import path from "node:path";
import { builtinFunctionIds } from "./builtin-function-ids";
import { registerNativeCall } from "./generate-js2native";
import { createInternalModuleRegistry } from "./internal-module-registry-scanner";

const BASE = path.join(import.meta.dir, "../js");
export const { moduleList, nativeStartIndex } = createInternalModuleRegistry(BASE);
export const sourceFiles = moduleList.slice(0, nativeStartIndex);

/** Modules that are compiled with a program that imports them and that the registry does not have. Their ids follow the registry's. */
export const helperModules: { id: number; path: string; specifier?: string; source: string; isEsModule: boolean }[] = [
  {
    id: moduleList.length,
    path: "runtime.bun.js",
    specifier: "bun:wrap",
    source: path.join(BASE, "../runtime.bun.js"),
    isEsModule: true,
  },
  { id: moduleList.length + 1, path: "runtime.js", source: path.join(BASE, "../runtime.js"), isEsModule: true },
];

const thirdPartySpecifiers: Record<string, string> = { "thirdparty/vercel_fetch.js": "@vercel/fetch" };

export function specifierOf(file: string): string | undefined {
  if (file === "internal-for-testing.ts") return "bun:internal-for-testing";
  if (file.startsWith("thirdparty/")) {
    return thirdPartySpecifiers[file] ?? file.slice("thirdparty/".length, file.lastIndexOf("."));
  }
  const prefix = file.startsWith("node/")
    ? "node:"
    : file.startsWith("bun/")
      ? "bun:"
      : file.startsWith("internal/")
        ? "internal/"
        : undefined;
  return prefix && prefix + file.slice(prefix.length).replaceAll(".", "/").slice(0, -3);
}

export const functionFiles = fs
  .readdirSync(path.join(BASE, "builtins"))
  .filter(file => file.endsWith(".ts") && !file.endsWith(".d.ts"))
  .sort()
  .map(file => "builtins/" + file);
export const functionIds = builtinFunctionIds(path.join(BASE, "builtins"));

/** Where the text that the compiler reads under the name `file` is. A module may have a second text for the compiler, under the same name in src/js/ahead-of-time. */
export function locate(file: string): string {
  const helper = helperModules.find(helper => helper.path === file);
  if (helper) return helper.source;
  const forCompiler = path.join(BASE, "ahead-of-time", file);
  return fs.existsSync(forCompiler) ? forCompiler : path.join(BASE, file);
}

/** `aot_engine_functions.json`, which src/codegen/builtins/index.ts writes: JavaScriptCore's own functions, as the compiler reads them. */
export interface EngineFunctions {
  files: { name: string; text: string }[];
  /** `file` is the name of one of `files`. */
  functions: { id: number; file: string; name: string; exportName: string }[];
}

export interface NativeCall {
  /** null: a `$bindgen` of a schema this build only takes types from. js2native does not number it. */
  id: number | null;
  macro: "cpp" | "newCppFunction" | "bindgen";
  file: string;
  symbol: string;
}

export function typesOnlySchemas(argv: readonly string[]): ReadonlySet<string> {
  const prefix = "--types-only=";
  const flag = argv.find(argument => argument.startsWith(prefix));
  return new Set(
    flag
      ?.slice(prefix.length)
      .split(",")
      .filter(schema => schema !== ""),
  );
}

const nativeMacros: Record<NativeCall["macro"], { kind: "cpp" | "bind"; takesLength: boolean }> = {
  cpp: { kind: "cpp", takesLength: false },
  newCppFunction: { kind: "cpp", takesLength: true },
  bindgen: { kind: "bind", takesLength: false },
};
const nativeCall =
  /\$(cpp|newCppFunction|bindgen)\(\s*(["'])([^"'\n]+)\2\s*,\s*(["'])([^"'\n]+)\4\s*(?:,\s*(\d+)\s*)?,?\s*\)/g;
const keyOf = (match: RegExpMatchArray) => `${match[1]}\t${match[3]}\t${match[5]}`;

/** generate-js2native.ts keeps one numbering per process: only a process's first call returns the ids of a build. */
export function nativeCalls(typesOnly: ReadonlySet<string>): NativeCall[] {
  const transpiler = new Bun.Transpiler({ loader: "ts" });
  const seen = new Set<string>();
  const list: NativeCall[] = [];
  for (const file of [...sourceFiles, ...functionFiles].map(file => path.join(BASE, file))) {
    const source = fs.readFileSync(file, "utf8");
    const calls = new Set(transpiler.transformSync(source).matchAll(nativeCall).map(keyOf));
    for (const match of source.matchAll(nativeCall)) {
      const key = keyOf(match);
      if (!calls.has(key)) continue;
      const [, , , nativeFile, , symbol, length] = match;
      const macro = match[1] as NativeCall["macro"];
      const { kind, takesLength } = nativeMacros[macro];
      if (takesLength !== (length !== undefined)) {
        throw new Error(`${file}: $${macro} takes ${takesLength ? "three" : "two"} arguments, but got '${match[0]}'`);
      }
      const isTypesOnly = macro === "bindgen" && typesOnly.has(nativeFile);
      const id = isTypesOnly
        ? null
        : registerNativeCall(kind, nativeFile, symbol, length === undefined ? null : Number(length));
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ id, macro, file: nativeFile, symbol });
    }
  }
  return list;
}
