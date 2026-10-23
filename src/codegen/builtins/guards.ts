import type { BuiltinEntry, BuiltinUses } from "../../../scripts/build/trim/types.ts";
import { GeneratorError } from "./declarations.ts";
import {
  isHiddenRootComponent,
  joinPath,
  memberPathOf,
  parsePath,
  pathOfClassMember,
  pathOfNativeBinding,
  textOfPath,
} from "./paths.ts";
import type { BuiltinPath, NativeCallKind } from "./vocabulary.ts";

export interface Guard {
  feature: string;
  builtin: number;
}

type ClassSide = "static" | "proto" | "constructor";

let classPathsOf: (guards: Guards, className: string) => Iterable<BuiltinPath>;

export class Guards {
  readonly #guardsByPath = new Map<string, Guard>();
  readonly #guardsByModule = new Map<string, Guard>();
  readonly #textsByNativeSymbol = new Map<string, string>();
  readonly #classPaths = new Map<string, Set<BuiltinPath>>();

  static {
    classPathsOf = (guards, className) => guards.#classPaths.get(className) ?? [];
  }

  constructor(uses: BuiltinUses) {
    for (const entry of uses.entries) this.#add(entry);
  }

  ofPath(text: string): Guard | null {
    return this.#guardsByPath.get(text) ?? null;
  }

  ofModule(specifier: string): Guard | null {
    return this.#guardsByModule.get(specifier) ?? null;
  }

  textOfNativeSymbol(symbol: string): string | null {
    return this.#textsByNativeSymbol.get(symbol) ?? null;
  }

  #add(entry: BuiltinEntry): void {
    const use = entry.uses.find(({ isConditional }) => !isConditional);
    const guard = use === undefined ? null : { feature: use.feature, builtin: entry.id };
    const symbols =
      entry.creationSymbol === undefined ? entry.nativeSymbols : [...entry.nativeSymbols, entry.creationSymbol];
    for (const symbol of symbols) {
      if (!this.#textsByNativeSymbol.has(symbol)) this.#textsByNativeSymbol.set(symbol, entry.path);
    }
    switch (entry.kind) {
      case "Module":
      case "InternalModule":
        if (guard !== null) this.#guardsByModule.set(entry.path, guard);
        return;
      case "Constructor":
        this.#addClassPath(parsePath(entry.path));
        break;
      case "Prototype":
        this.#addClassPath(parsePath(entry.path).slice(0, -1));
        break;
      case "Function":
      case "Method":
      case "Namespace":
      case "Accessor":
      case "DataProperty":
      case "Constant":
      case "NativeBinding":
        break;
    }
    if (guard !== null) this.#guardsByPath.set(entry.path, guard);
  }

  #addClassPath(components: readonly string[]): void {
    const component = components.at(-1);
    if (component === undefined) return;
    const className = isHiddenRootComponent(component) ? component.slice(1, -1) : component;
    const classPaths = this.#classPaths.get(className) ?? new Set<BuiltinPath>();
    classPaths.add(joinPath(components));
    this.#classPaths.set(className, classPaths);
  }
}

const textOf = (path: BuiltinPath): string => textOfPath(parsePath(path));

export function textOfStaticTableEntry(holderText: string, key: string): string {
  return textOf(memberPathOf(holderText, key));
}

function pathsInClass(classPath: BuiltinPath, side: ClassSide, name: string | null): BuiltinPath[] {
  if (side === "constructor") return [classPath, pathOfClassMember(classPath, "static", "prototype")];
  if (name === null) throw new GeneratorError(`a ${side} member of ${classPath} needs a name`);
  return [pathOfClassMember(classPath, side, name)];
}

export function textOfClassMember(className: string, side: ClassSide, name: string | null, guards: Guards): string {
  const classPaths = [className, `%${className}%`, ...classPathsOf(guards, className)];
  const texts = classPaths.flatMap(classPath => pathsInClass(classPath, side, name)).map(textOf);
  return texts.find(text => guards.ofPath(text) !== null) ?? texts[0];
}

export function textOfNativeSymbol(symbol: string, guards: Guards): string | null {
  return guards.textOfNativeSymbol(symbol);
}

export function textOfNativeBinding(kind: NativeCallKind, file: string, symbol: string): string {
  return textOf(pathOfNativeBinding(kind, file, symbol));
}
