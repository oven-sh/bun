import { createRequire } from "node:module";
import util from "node:util";
import type { NullableType, OptionalType } from "./optional.ts";

// optional.ts imports this module, so the getters below load it when they run.
const require = createRequire(import.meta.url);

/** How a type appears in the generated Rust. `size` and `align` are those of `extern`, in bytes. */
export interface RustType {
  /** The `#[repr(C)]` type that C++ writes. */
  readonly extern: string;
  readonly size: number;
  readonly align: number;
  /** The type of a dictionary member. */
  readonly member: string;
  /** Converts the extern expression `e` to `member`. */
  fromExtern(e: string): string;
  /** The payload of a union arm when it is not `member`. `null` is an arm with no payload. */
  readonly arm?: RustArm | null;
  /** The form of `optional` and `nullable` when C++ has its own: a pointer that can be null. */
  readonly optional?: RustType;
}

export interface RustArm {
  readonly type: string;
  fromExtern(e: string): string;
  /** The function that gives up the reference the payload holds. */
  readonly release?: string;
}

/** An extern struct as both sides see it. The layout checks of C++ and Rust come from it. */
export interface RustLayout {
  readonly cpp: string;
  readonly rust: string;
  readonly size: number;
  readonly align: number;
  readonly fields: readonly {
    readonly cpp: string;
    readonly rust: string;
    readonly offset: number;
  }[];
}

export abstract class Type {
  /** Treats `undefined` as a not-provided value. */
  get optional(): OptionalType {
    return require("./optional.ts").optional(this);
  }

  /** Treats `null` or `undefined` as a not-provided value. */
  get nullable(): NullableType {
    return require("./optional.ts").nullable(this);
  }

  abstract readonly idlType: string;
  abstract readonly rust: RustType;

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
  // These getters are faster than `.cppHeader != null` etc.
  get hasCppHeader(): boolean {
    return false;
  }
  get hasCppSource(): boolean {
    return false;
  }
  get rustSource(): string | null {
    return null;
  }
  get rustLayout(): RustLayout | null {
    return null;
  }
  getHeaders(result: Set<string>): void {
    result.add(`Generated${this.name}.h`);
  }
}

/** A type whose extern form is the value itself. */
export function trivialRust(name: string, size: number): RustType {
  return { extern: name, size, align: size, member: name, fromExtern: e => e };
}

/** Clippy wants a `Copy` value of 8 bytes or less by value, and more than 64 bytes by reference. */
export function borrowed(size: number): "" | "&" {
  return size > 8 ? "&" : "";
}

export function unsupportedInRust(what: string): never {
  throw RangeError(`${what} has no Rust output`);
}

export function alignUp(offset: number, align: number): number {
  return Math.ceil(offset / align) * align;
}

/** The layout of C++ `ExternVariant`: a union of the arms, then a `u8` tag. */
export function variantLayout(arms: readonly RustType[]): {
  size: number;
  align: number;
  tag: number;
} {
  const align = Math.max(...arms.map(arm => arm.align));
  const tag = alignUp(Math.max(...arms.map(arm => arm.size)), align);
  return { size: alignUp(tag + 1, align), align, tag };
}

export function structLayout(members: readonly RustType[]): {
  size: number;
  align: number;
  offsets: number[];
} {
  const align = Math.max(1, ...members.map(member => member.align));
  let end = 0;
  const offsets = members.map(member => {
    const offset = alignUp(end, member.align);
    end = offset + member.size;
    return offset;
  });
  return { size: alignUp(end, align), align, offsets };
}

export function pascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(piece => piece)
    .map(piece => piece[0].toUpperCase() + piece.slice(1))
    .join("");
}

export function snakeCase(name: string): string {
  return name
    .replace(/([^A-Z_])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

const rustKeywords = new Set(
  (
    "abstract as async await become box break const continue crate do dyn else enum extern false final fn for gen " +
    "if impl in let loop macro match mod move mut override priv pub ref return self static struct super trait true " +
    "try type typeof unsafe unsized use virtual where while yield"
  ).split(" "),
);

/** A keyword gets a trailing underscore, as `unix_` has in SocketConfig.bindv2.ts and as cppbind.ts does. */
export function rustField(name: string): string {
  return rustKeywords.has(name) ? name + "_" : name;
}

/** The variants of one enum, checked: each is an identifier and no two are equal. */
export function rustVariants(owner: string, names: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const name of names) {
    if (!/^[A-Z][A-Za-z0-9]*$/.test(name) || name === "Self") {
      throw RangeError(`${owner}: \`${name}\` cannot be the name of a Rust variant`);
    }
    if (seen.size === seen.add(name).size) {
      throw RangeError(`${owner}: two members have the Rust name \`${name}\``);
    }
  }
  return [...names];
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
