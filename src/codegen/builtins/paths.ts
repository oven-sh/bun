import { GeneratorError } from "./declarations.ts";
import type { NameKind } from "./model.ts";
import { cap } from "./support.ts";
import type { BuiltinPath, NativeCallKind } from "./vocabulary.ts";

export const symbolPrefix = "@@";
export const registeredSymbolPrefix = "@@@";
export const globalThisPath = "globalThis";

const componentSeparator = ".";
const hiddenRootMark = "%";
const nativeBindingPrefix = "native:";
const tokenSeparators = /[.:/\-[\]@%\s()"]+/;
const reservedRustIdentifiers: ReadonlySet<string> = new Set(["Self", "_", "ALL", "COUNT"]);
const punctuationWords: Readonly<Record<string, string>> = {
  $: "Dollar",
  "&": "Ampersand",
  "'": "Apostrophe",
  "*": "Asterisk",
  "+": "Plus",
  "`": "Backtick",
};

const cppIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const cppMacroCasePattern = /^[A-Z0-9_]+$|^[A-Z][A-Z0-9]*_\w*$/;
const cppKeywords: ReadonlySet<string> = new Set(
  `alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl
   concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete
   do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable
   namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast
   requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw
   true try typedef typeid typename typeof union unsigned using virtual void volatile wchar_t while xor xor_eq`.split(
    /\s+/,
  ),
);
const systemHeaderMacros: ReadonlySet<string> = new Set([
  "assert",
  "errno",
  "stdin",
  "stdout",
  "stderr",
  "small",
  "near",
  "far",
  "interface",
  "linux",
  "unix",
]);

export function compareBytes(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

export function parsePath(path: BuiltinPath): string[] {
  if (path.startsWith(nativeBindingPrefix)) return [path];
  const keyStart = path.indexOf(`${componentSeparator}${registeredSymbolPrefix}`);
  const holder = keyStart === -1 ? path : path.slice(0, keyStart);
  const registeredSymbol = keyStart === -1 ? [] : [path.slice(keyStart + componentSeparator.length)];
  const components = [...holder.split(componentSeparator), ...registeredSymbol];
  if (components.includes("")) throw new GeneratorError(`the path ${JSON.stringify(path)} has an empty component`);
  return components;
}

export function joinPath(components: readonly string[]): BuiltinPath {
  return components.join(componentSeparator);
}

export function memberPathOf(holder: BuiltinPath, name: string): BuiltinPath {
  return holder === globalThisPath ? name : joinPath([...parsePath(holder), name]);
}

export function holderPathOf(path: BuiltinPath): BuiltinPath | null {
  const components = parsePath(path);
  return components.length === 1 ? null : joinPath(components.slice(0, -1));
}

export function isHiddenRootComponent(component: string): boolean {
  return (
    component.length > 2 * hiddenRootMark.length &&
    component.startsWith(hiddenRootMark) &&
    component.endsWith(hiddenRootMark)
  );
}

export function textOfPath(components: readonly string[]): string {
  return components
    .map((component, index) => {
      if (component.startsWith(registeredSymbolPrefix)) {
        return `[Symbol.for(${JSON.stringify(component.slice(registeredSymbolPrefix.length))})]`;
      }
      if (component.startsWith(symbolPrefix)) return `[Symbol.${component.slice(symbolPrefix.length)}]`;
      return index === 0 ? component : `${componentSeparator}${component}`;
    })
    .join("");
}

function splitIntoTokenParts(text: string): string[] {
  return text
    .split(tokenSeparators)
    .filter(part => part !== "")
    .map(part => part.replace(/[$&'*+`]/g, character => punctuationWords[character]));
}

export function tokenOf(components: readonly string[]): string {
  const token = splitIntoTokenParts(textOfPath(components)).map(cap).join("");
  return /^[0-9]/.test(token) || reservedRustIdentifiers.has(token) ? `_${token}` : token;
}

export function qualifiedTokenOf(components: readonly string[]): string {
  const holder = components.slice(0, -1);
  if (holder.length === 0) return `${tokenOf(components)}_`;
  return [tokenOf(holder), ...splitIntoTokenParts(textOfPath(components.slice(-1)))].join("_");
}

export function cppConstantOfName(text: string, kind: NameKind): string | null {
  if (!cppIdentifierPattern.test(text)) return null;
  switch (kind) {
    case "Text":
      if (cppKeywords.has(text)) return `${text}Keyword`;
      return systemHeaderMacros.has(text) || cppMacroCasePattern.test(text) ? null : text;
    case "WellKnownSymbol":
      return `${text}Symbol`;
    case "RegisteredSymbol":
      return null;
  }
}

export function pathOfNativeBinding(kind: NativeCallKind, file: string, symbol: string): BuiltinPath {
  return `${nativeBindingPrefix}${kind}:${file}:${symbol}`;
}

// No object holds the functions that native bindings make. Each has an entry here, which the entry of its binding names.
export const nativeFunctionsPath: BuiltinPath = "%NativeFunctions%";

export function pathOfNativeFunction(file: string, symbol: string): BuiltinPath {
  return joinPath([nativeFunctionsPath, tokenOf([`${file}:${symbol}`])]);
}

export function pathOfClassMember(classPath: BuiltinPath, side: "static" | "proto", name: string): BuiltinPath {
  return joinPath(side === "static" ? [classPath, name] : [classPath, "prototype", name]);
}
