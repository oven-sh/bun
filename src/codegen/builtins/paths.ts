// How an entry of the table of built-ins is named, as far as guards.ts asks.
import type { BuiltinPath, NativeCallKind } from "./vocabulary.ts";

export class GeneratorError extends Error {}

const symbolPrefix = "@@";
const registeredSymbolPrefix = "@@@";
const nativeBindingPrefix = "native:";

export function parsePath(path: BuiltinPath): string[] {
  if (path.startsWith(nativeBindingPrefix)) return [path];
  const keyStart = path.indexOf(`.${registeredSymbolPrefix}`);
  const components =
    keyStart === -1 ? path.split(".") : [...path.slice(0, keyStart).split("."), path.slice(keyStart + 1)];
  if (components.includes("")) throw new GeneratorError(`the path ${JSON.stringify(path)} has an empty component`);
  return components;
}

export function joinPath(components: readonly string[]): BuiltinPath {
  return components.join(".");
}

export function memberPathOf(holder: BuiltinPath, name: string): BuiltinPath {
  return holder === "globalThis" ? name : joinPath([...parsePath(holder), name]);
}

export function isHiddenRootComponent(component: string): boolean {
  return component.length > 2 && component.startsWith("%") && component.endsWith("%");
}

export function textOfPath(components: readonly string[]): string {
  return components
    .map((component, index) => {
      if (component.startsWith(registeredSymbolPrefix)) {
        return `[Symbol.for(${JSON.stringify(component.slice(registeredSymbolPrefix.length))})]`;
      }
      if (component.startsWith(symbolPrefix)) return `[Symbol.${component.slice(symbolPrefix.length)}]`;
      return index === 0 ? component : `.${component}`;
    })
    .join("");
}

export function pathOfNativeBinding(kind: NativeCallKind, file: string, symbol: string): BuiltinPath {
  return `${nativeBindingPrefix}${kind}:${file}:${symbol}`;
}

export function pathOfClassMember(classPath: BuiltinPath, side: "static" | "proto", name: string): BuiltinPath {
  return joinPath(side === "static" ? [classPath, name] : [classPath, "prototype", name]);
}
