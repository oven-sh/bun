import util from "node:util";
import type { NullableType, OptionalType } from "./optional";

/** Default is "compact". */
export type CodeStyle = "compact" | "pretty";

export abstract class Type {
  /** Treats `undefined` as a not-provided value. */
  get optional(): OptionalType {
    return require("./optional").optional(this);
  }

  /** Treats `null` or `undefined` as a not-provided value. */
  get nullable(): NullableType {
    return require("./optional").nullable(this);
  }

  abstract readonly idlType: string;
  abstract readonly bindgenType: string;

  /**
   * This can be overridden to make the generated code clearer. If overridden, it must return an
   * expression that evaluates to the same type as `${this.bindgenType}.ZigType`; it should not
   * actually change the type.
   */
  zigType(style?: CodeStyle): string {
    return this.bindgenType + ".ZigType";
  }

  /** This must be overridden if bindgen.zig defines a custom `OptionalZigType`. */
  optionalZigType(style?: CodeStyle): string {
    return `?${this.zigType(style)}`;
  }

  /** Converts a JS value into a C++ expression. Used for default values. */
  abstract toCpp(value: any): string;

  /** Other types that this type contains or otherwise depends on. */
  get dependencies(): readonly Type[] {
    return [];
  }

  /** Headers required by users of this type. */
  getHeaders(result: Set<string>): void {
    for (const type of this.dependencies) {
      type.getHeaders(result);
    }
  }
}

export abstract class NamedType extends Type {
  abstract readonly name: string;
  get cppHeader(): string | null {
    return null;
  }
  get cppSource(): string | null {
    return null;
  }
  get zigSource(): string | null {
    return null;
  }
  // These getters are faster than `.cppHeader != null` etc.
  get hasCppHeader(): boolean {
    return false;
  }
  get hasCppSource(): boolean {
    return false;
  }
  get hasZigSource(): boolean {
    return false;
  }
  getHeaders(result: Set<string>): void {
    result.add(`Generated${this.name}.h`);
  }
}

export function validateName(name: string): void {
  const reservedPrefixes = ["IDL", "Bindgen", "Extern", "Generated", "MemberType"];
  const reservedNames = ["Bun", "WTF", "JSC", "WebCore", "Self"];
  if (!/^[A-Z]/.test(name)) {
    throw RangeError(`name must start with a capital letter: ${name}`);
  }
  if (/[^a-zA-Z0-9_]/.test(name)) {
    throw RangeError(`name may only contain letters, numbers, and underscores: ${name}`);
  }
  if (reservedPrefixes.some(s => name.startsWith(s))) {
    throw RangeError(`name starts with reserved prefix: ${name}`);
  }
  if (reservedNames.includes(name)) {
    throw RangeError(`cannot use reserved name: ${name}`);
  }
}

export function headersForTypes(types: readonly Type[]): string[] {
  const headers = new Set<string>();
  for (const type of types) {
    type.getHeaders(headers);
  }
  return Array.from(headers);
}

export function dedent(text: string): string {
  const commonIndent = Math.min(
    ...Array.from(text.matchAll(/\n( *)[^ \n]/g) ?? []).map(m => m[1].length),
  );
  text = text.trim();
  if (commonIndent > 0 && commonIndent !== Infinity) {
    text = text.replaceAll("\n" + " ".repeat(commonIndent), "\n");
  }
  return text.replace(/^ +$/gm, "");
}

/** Converts indents from 2 spaces to 4. */
export function reindent(text: string): string {
  return dedent(text).replace(/^ +/gm, "$&$&");
}

/** Does not indent the first line. */
export function addIndent(amount: number, text: string): string {
  return text.replaceAll("\n", "\n" + " ".repeat(amount));
}

export function joinIndented(amount: number, pieces: readonly string[]): string {
  return addIndent(amount, pieces.map(dedent).join("\n"));
}

export function toQuotedLiteral(value: string): string {
  return `"${util.inspect(value).slice(1, -1).replaceAll('"', '\\"')}"`;
}

export function toASCIILiteral(value: string): string {
  if (value[Symbol.iterator]().some(c => c.charCodeAt(0) >= 128)) {
    throw RangeError(`string must be ASCII: ${util.inspect(value)}`);
  }
  return `${toQuotedLiteral(value)}_s`;
}
