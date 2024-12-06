// While working on this file, it is important to have very rigorous errors
// and checking on input data. The goal is to allow people not aware of
// various footguns in JavaScript, C++, and the bindings generator to
// always produce correct code, or bail with an error.
import { expect } from "bun:test";
import type { Type, t } from "./bindgen-lib";
import * as path from "node:path";
import assert from "node:assert";

export const src = path.join(import.meta.dirname, "../");

export type TypeKind = keyof typeof t;

export let allFunctions: Func[] = [];
export let files = new Map<string, File>();
/** A reachable type is one that is required for code generation */
export let typeHashToReachableType = new Map<string, TypeImpl>();
export let typeHashToStruct = new Map<string, Struct>();
export let typeHashToNamespace = new Map<string, string>();
export let structHashToSelf = new Map<string, Struct>();

/** String literal */
export const str = (v: any) => JSON.stringify(v);
/** Capitalize */
export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
/** Escape a Zig Identifier */
export const zid = (s: string) => (s.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) ? s : "@" + str(s));
/** Snake Case */
export const snake = (s: string) =>
  s[0].toLowerCase() +
  s
    .slice(1)
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase();

// Return symbol names of extern values (must be equivalent between C++ and Zig)

/** The JS Host function, aka fn (*JSC.JSGlobalObject, *JSC.CallFrame) JSValue.MaybeException */
export const extJsFunction = (namespaceVar: string, fnLabel: string) =>
  `bindgen_${cap(namespaceVar)}_js${cap(fnLabel)}`;
/** Each variant gets a dispatcher function. */
export const extDispatchVariant = (namespaceVar: string, fnLabel: string, variantNumber: number) =>
  `bindgen_${cap(namespaceVar)}_dispatch${cap(fnLabel)}${variantNumber}`;

interface TypeDataDefs {
  /** The name */
  ref: string;

  sequence: {
    element: TypeImpl;
    repr: "slice";
  };
  record: {
    value: TypeImpl;
    repr: "kv-slices";
  };
  zigEnum: {
    file: string;
    impl: string;
  };
  stringEnum: string[];
  oneOf: TypeImpl[];
  dictionary: DictionaryField[];
}
type TypeData<K extends TypeKind> = K extends keyof TypeDataDefs ? TypeDataDefs[K] : any;

interface Flags {
  optional?: boolean;
  required?: boolean;
  nullable?: boolean;
  default?: any;
  range?: ["clamp" | "enforce", bigint, bigint] | ["clamp" | "enforce", "abi", "abi"];
}

export interface DictionaryField {
  key: string;
  type: TypeImpl;
}

export declare const isType: unique symbol;

/**
 * Implementation of the Type interface.  All types are immutable and hashable.
 * Hashes de-duplicate structure and union definitions. Flags do not account for
 * the hash, so `oneOf(A, B)` and `oneOf(A, B).optional` will point to the same
 * generated struct type, the purpose of the flags are to inform receivers like
 * `t.dictionary` and `fn` to mark uses as optional or provide default values.
 */
export class TypeImpl<K extends TypeKind = TypeKind> {
  kind: K;
  data: TypeData<K>;
  flags: Flags;
  /** Access via .name(). */
  nameDeduplicated: string | null | undefined = undefined;
  /** Access via .hash() */
  #hash: string | undefined = undefined;
  ownerFile: string;

  declare [isType]: true;

  constructor(kind: K, data: TypeData<K>, flags: Flags = {}) {
    this.kind = kind;
    this.data = data;
    this.flags = flags;
    this.ownerFile = path.basename(stackTraceFileName(snapshotCallerLocation()), ".bind.ts");
  }

  isVirtualArgument() {
    return this.kind === "globalObject" || this.kind === "zigVirtualMachine";
  }

  hash() {
    if (this.#hash) {
      return this.#hash;
    }
    let h = `${this.kind}:`;
    switch (this.kind) {
      case "ref":
        throw new Error("TODO");
      case "sequence":
        h += this.data.element.hash();
        break;
      case "record":
        h += this.data.value.hash();
        break;
      case "zigEnum":
        h += `${this.data.file}:${this.data.impl}`;
        break;
      case "stringEnum":
        h += this.data.join(",");
        break;
      case "oneOf":
        h += this.data.map(t => t.hash()).join(",");
        break;
      case "dictionary":
        h += this.data.map(({ key, required, type }) => `${key}:${required}:${type.hash()}`).join(",");
        break;
    }
    let hash = String(Bun.hash(h));
    this.#hash = hash;
    return hash;
  }

  lowersToStruct() {
    switch (this.kind) {
      case "ref":
        throw new Error("TODO");
      case "sequence":
      case "record":
      case "oneOf":
      case "dictionary":
        return true;
      default:
        return false;
    }
  }

  canDirectlyMapToCAbi(): CAbiType | null {
    let kind = this.kind;
    switch (kind) {
      case "ref":
        throw new Error("TODO");
      case "any":
        return "JSValue";
      case "ByteString":
        return "bun.String";
      case "DOMString":
        return "bun.String";
      case "USVString":
        return "bun.String";
      case "boolean":
        return "bool";
      case "strictBoolean":
        return "bool";
      case "f64":
      case "i8":
      case "i16":
      case "i32":
      case "i64":
      case "u8":
      case "u16":
      case "u32":
      case "u64":
      case "usize":
        return kind;
      case "globalObject":
      case "zigVirtualMachine":
        return "*JSGlobalObject";
      case "stringEnum":
        throw new Error("TODO");
      case "zigEnum":
        throw new Error("TODO");
      case "undefined":
        return "u0";
      case "oneOf": // `union(enum)`
      case "UTF8String": // []const u8
      case "record": // undecided how to lower records
      case "sequence": // []const T
        return null;
      case "externalClass":
        throw new Error("TODO");
        return "*anyopaque";
      case "dictionary": {
        let existing = typeHashToStruct.get(this.hash());
        if (existing) return existing;
        existing = new Struct();
        for (const { key, type } of this.data as DictionaryField[]) {
          if (type.flags.optional && !("default" in type.flags)) {
            return null; // ?T
          }
          const repr = type.canDirectlyMapToCAbi();
          if (!repr) return null;

          existing.add(key, repr);
        }
        existing.reorderForSmallestSize();
        if (!structHashToSelf.has(existing.hash())) {
          structHashToSelf.set(existing.hash(), existing);
        }
        existing.assignName(this.name());
        typeHashToStruct.set(this.hash(), existing);
        return existing;
      }
      case "sequence": {
        return null;
      }
      default: {
        throw new Error("unexpected: " + (kind satisfies never));
      }
    }
  }

  name() {
    if (this.nameDeduplicated) {
      return this.nameDeduplicated;
    }
    const hash = this.hash();
    const existing = typeHashToReachableType.get(hash);
    if (existing) return (this.nameDeduplicated = existing.nameDeduplicated ??= this.#generateName());
    return (this.nameDeduplicated = `anon_${this.kind}_${hash}`);
  }

  cppName() {
    const name = this.name();
    const cAbiType = this.canDirectlyMapToCAbi();
    if (cAbiType) {
      return cAbiTypeName(cAbiType);
    }
    const namespace = typeHashToNamespace.get(this.hash());
    return namespace ? `${namespace}${cap(name)}` : name;
  }

  #generateName() {
    return `anon_${this.ownerFile}_${this.hash()}`;
  }

  /**
   * Name assignment is done to give readable names.
   * The first name to a unique hash wins.
   */
  assignName(name: string) {
    if (this.nameDeduplicated) return;
    const hash = this.hash();
    const existing = typeHashToReachableType.get(hash);
    if (existing) {
      this.nameDeduplicated = existing.nameDeduplicated ??= name;
      return;
    }
    this.nameDeduplicated = name;
  }

  markReachable() {
    if (!this.lowersToStruct()) return;
    const hash = this.hash();
    const existing = typeHashToReachableType.get(hash);
    this.nameDeduplicated ??= existing?.name() ?? `anon_${this.kind}_${hash}`;
    if (!existing) typeHashToReachableType.set(hash, this);

    switch (this.kind) {
      case "ref":
        throw new Error("TODO");
      case "sequence":
        this.data.element.markReachable();
        break;
      case "record":
        this.data.value.markReachable();
        break;
      case "oneOf":
        for (const type of this.data as TypeImpl[]) {
          type.markReachable();
        }
        break;
      case "dictionary":
        for (const { type } of this.data as DictionaryField[]) {
          type.markReachable();
        }
        break;
    }
  }

  // Interface definition API
  get optional() {
    if (this.flags.required) {
      throw new Error("Cannot derive optional on a required type");
    }
    if (this.flags.default) {
      throw new Error("Cannot derive optional on a something with a default value (default implies optional)");
    }
    return new TypeImpl(this.kind, this.data, {
      ...this.flags,
      optional: true,
    });
  }

  get nullable() {
    return new TypeImpl(this.kind, this.data, {
      ...this.flags,
      nullable: true,
    });
  }

  get required() {
    if (this.flags.required) {
      throw new Error("This type already has required set");
    }
    if (this.flags.required) {
      throw new Error("Cannot derive required on an optional type");
    }
    return new TypeImpl(this.kind, this.data, {
      ...this.flags,
      required: true,
    });
  }

  clamp(min?: number | bigint, max?: number | bigint) {
    return this.#rangeModifier(min, max, "clamp");
  }

  enforceRange(min?: number | bigint, max?: number | bigint) {
    return this.#rangeModifier(min, max, "enforce");
  }

  #rangeModifier(min: undefined | number | bigint, max: undefined | number | bigint, kind: "clamp" | "enforce") {
    if (this.flags.range) {
      throw new Error("This type already has a range modifier set");
    }

    // cAbiIntegerLimits throws on non-integer types
    const range = cAbiIntegerLimits(this.kind as CAbiType);
    const abiMin = BigInt(range[0]);
    const abiMax = BigInt(range[1]);
    if (min === undefined) {
      min = abiMin;
      max = abiMax;
    } else {
      if (max === undefined) {
        throw new Error("Expected min and max to be both set or both unset");
      }
      min = BigInt(min);
      max = BigInt(max);

      if (min < abiMin || min > abiMax) {
        throw new Error(`Expected integer in range ${range}, got ${inspect(min)}`);
      }
      if (max < abiMin || max > abiMax) {
        throw new Error(`Expected integer in range ${range}, got ${inspect(max)}`);
      }
      if (min > max) {
        throw new Error(`Expected min <= max, got ${inspect(min)} > ${inspect(max)}`);
      }
    }

    return new TypeImpl(this.kind, this.data, {
      ...this.flags,
      range: min === BigInt(range[0]) && max === BigInt(range[1]) ? [kind, "abi", "abi"] : [kind, min, max],
    });
  }

  assertDefaultIsValid(value: unknown) {
    switch (this.kind) {
      case "DOMString":
      case "ByteString":
      case "USVString":
      case "UTF8String":
        if (typeof value !== "string") {
          throw new Error(`Expected string, got ${inspect(value)}`);
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          throw new Error(`Expected boolean, got ${inspect(value)}`);
        }
        break;
      case "f64":
        if (typeof value !== "number") {
          throw new Error(`Expected number, got ${inspect(value)}`);
        }
        break;
      case "usize":
        // case "u8":
        // case "u16":
        // case "u32":
        // case "u64":
        // case "i8":
        // case "i16":
        // case "i32":
        // case "i64":
        const range = cAbiIntegerLimits(this.kind);
        if (typeof value === "number") {
          if (value % 1 !== 0) {
            throw new Error(`Expected integer, got ${inspect(value)}`);
          }
          if (value >= Number.MAX_SAFE_INTEGER || value <= Number.MIN_SAFE_INTEGER) {
            throw new Error(
              `Specify default ${this.kind} outside of max safe integer range as a BigInt to avoid precision loss`,
            );
          }
          if (value < Number(range[0]) || value > Number(range[1])) {
            throw new Error(`Expected integer in range ${range}, got ${inspect(value)}`);
          }
        } else if (typeof value === "bigint") {
          if (value < BigInt(range[0]) || value > BigInt(range[1])) {
            throw new Error(`Expected integer in range ${range}, got ${inspect(value)}`);
          }
        } else {
          throw new Error(`Expected integer, got ${inspect(value)}`);
        }
        break;
      case "dictionary":
        if (typeof value !== "object" || value === null) {
          throw new Error(`Expected object, got ${inspect(value)}`);
        }
        for (const { key, type } of this.data as DictionaryField[]) {
          if (key in value) {
            type.assertDefaultIsValid(value[key]);
          } else if (type.flags.required) {
            throw new Error(`Missing key ${key} in dictionary`);
          }
        }
        break;
      default:
        throw new Error(`TODO: set default value on type ${this.kind}`);
    }
  }

  emitCppDefaultValue(w: CodeWriter) {
    const value = this.flags.default;
    switch (this.kind) {
      case "boolean":
        w.add(value ? "true" : "false");
        break;
      case "f64":
        w.add(String(value));
        break;
      case "usize":
        const str = String(value);
        w.add(`${str}ULL`);
        break;
      case "dictionary":
        const struct = this.structType();
        w.line(`${this.cppName()} {`);
        w.indent();
        for (const { name } of struct.fields) {
          w.add(`.${name} = `);
          const type = this.data.find(f => f.key === name)!.type;
          type.emitCppDefaultValue(w);
          w.line(",");
        }
        w.dedent();
        w.add(`}`);
        break;
      case "DOMString":
      case "ByteString":
      case "USVString":
      case "UTF8String":
        if (typeof value === "string") {
          w.add("Bun::BunStringEmpty");
        } else {
          throw new Error(`TODO: non-empty string default`);
        }
        break;
      default:
        throw new Error(`TODO: set default value on type ${this.kind}`);
    }
  }

  structType() {
    const direct = this.canDirectlyMapToCAbi();
    assert(typeof direct !== "string");
    if (direct) return direct;
    throw new Error("TODO: generate non-extern struct for representing this data type");
  }

  default(def: any) {
    if ("default" in this.flags) {
      throw new Error("This type already has a default value");
    }
    if (this.flags.required) {
      throw new Error("Cannot derive default on a required type");
    }
    this.assertDefaultIsValid(def);
    return new TypeImpl(this.kind, this.data, {
      ...this.flags,
      default: def,
    });
  }

  [Symbol.toStringTag] = "Type";
  [Bun.inspect.custom](depth, options, inspect) {
    return (
      `${options.stylize("Type", "special")} ${
        this.nameDeduplicated ? options.stylize(JSON.stringify(this.nameDeduplicated), "string") + " " : ""
      }${options.stylize(
        `[${this.kind}${["required", "optional", "nullable"]
          .filter(k => this.flags[k])
          .map(x => ", " + x)
          .join("")}]`,
        "regexp",
      )}` +
      (this.data
        ? " " +
          inspect(this.data, {
            ...options,
            depth: options.depth === null ? null : options.depth - 1,
          }).replace(/\n/g, "\n")
        : "")
    );
  }
}

function cAbiIntegerLimits(type: CAbiType) {
  switch (type) {
    case "u8":
      return [0, 255];
    case "u16":
      return [0, 65535];
    case "u32":
      return [0, 4294967295];
    case "u64":
      return [0, 18446744073709551615n];
    case "usize":
      return [0, 18446744073709551615n];
    case "i8":
      return [-128, 127];
    case "i16":
      return [-32768, 32767];
    case "i32":
      return [-2147483648, 2147483647];
    case "i64":
      return [-9223372036854775808n, 9223372036854775807n];
    default:
      throw new Error(`Unexpected type ${type}`);
  }
}

function inspect(value: any) {
  return Bun.inspect(value, { colors: Bun.enableANSIColors });
}

export function oneOfImpl(types: TypeImpl[]): TypeImpl {
  const out: TypeImpl[] = [];
  for (const type of types) {
    if (type.kind === "oneOf") {
      out.push(...type.data);
    } else {
      if (type.flags.nullable) {
        throw new Error("Union type cannot include nullable");
      }
      if (type.flags.default) {
        throw new Error(
          "Union type cannot include a default value. Instead, set a default value on the union type itself",
        );
      }
      if (type.isVirtualArgument()) {
        throw new Error(`t.${type.kind} can only be used as a function argument type`);
      }
      out.push(type);
    }
  }
  return new TypeImpl("oneOf", out);
}

export function dictionaryImpl(record: Record<string, TypeImpl>): TypeImpl {
  const out: DictionaryField[] = [];
  for (const key in record) {
    const type = record[key];
    if (type.isVirtualArgument()) {
      throw new Error(`t.${type.kind} can only be used as a function argument type`);
    }
    out.push({
      key,
      type: type,
    });
  }
  return new TypeImpl("dictionary", out);
}

export interface Func {
  name: string;
  snapshot: string;
  zigFile: string;
  variants: Variant[];
}

export interface Variant {
  impl: string;
  args: Arg[];
  ret: TypeImpl;
  returnStrategy?: ReturnStrategy;
  globalObjectArg?: number | "hidden";
  minRequiredArgs: number;
}

export interface Arg {
  name: string;
  type: TypeImpl;
  loweringStrategy?: ArgStrategy;
  zigMappedName?: string;
}

/**  */
export type ArgStrategy = { type: "c-abi-pointer"; abiType: CAbiType } | { type: "c-abi-value"; abiType: CAbiType };

/**
 * In addition to moving a payload over, an additional bit of information
 * crosses the ABI boundary indicating if the function threw an exception.
 *
 * For simplicity, the possibility of any Zig binding returning an error/calling
 * `throw` is assumed and there isnt a way to disable the exception check.
 */
export type ReturnStrategy =
  // JSValue is special cased because it encodes exception as 0x0
  | { type: "jsvalue" }
  // For primitives and simple structures where direct assignment into a
  // pointer is possible. function returns a boolean indicating success/error.
  | { type: "basic-out-param"; abiType: CAbiType };

export interface File {
  functions: Func[];
  typedefs: TypeDef[];
}

export interface TypeDef {
  name: string;
  type: TypeImpl;
}

export function registerFunction(opts: any) {
  const snapshot = snapshotCallerLocation();
  const filename = stackTraceFileName(snapshot);
  expect(filename).toEndWith(".bind.ts");
  const zigFile = path.relative(src, filename.replace(/\.bind\.ts$/, ".zig"));
  let file = files.get(zigFile);
  if (!file) {
    file = { functions: [], typedefs: [] };
    files.set(zigFile, file);
  }
  const variants: Variant[] = [];
  if ("variants" in opts) {
    let i = 1;
    for (const variant of opts.variants) {
      const { minRequiredArgs } = validateVariant(variant);
      variants.push({
        ...variant,
        impl: opts.name + i,
        minRequiredArgs,
      });
      i++;
    }
  } else {
    const { minRequiredArgs } = validateVariant(opts);
    variants.push({
      impl: opts.name,
      args: Object.entries(opts.args).map(([name, type]) => ({ name, type })) as Arg[],
      ret: opts.ret,
      minRequiredArgs,
    });
  }

  const func: Func = {
    name: opts.name,
    snapshot,
    zigFile,
    variants,
  };
  allFunctions.push(func);
  file.functions.push(func);
}

function validateVariant(variant: any) {
  let minRequiredArgs = 0;
  let seenOptionalArgument = false;
  let i = 0;

  for (const [name, type] of Object.entries(variant.args) as [string, TypeImpl][]) {
    if (!(type instanceof TypeImpl)) {
      throw new Error(`Expected type for argument ${name}, got ${inspect(type)}`);
    }
    i += 1;
    if (type.isVirtualArgument()) {
      continue;
    }
    if (!type.flags.optional && !("default" in type.flags)) {
      if (seenOptionalArgument) {
        throw new Error(`Required argument ${name} cannot follow an optional argument`);
      }
      minRequiredArgs++;
    } else {
      seenOptionalArgument = true;
    }
  }

  return { minRequiredArgs };
}

function snapshotCallerLocation(): string {
  const stack = new Error().stack!;
  const lines = stack.split("\n");
  let i = 1;
  for (; i < lines.length; i++) {
    if (!lines[i].includes(import.meta.dir)) {
      return lines[i];
    }
  }
  throw new Error("Couldn't find caller location in stack trace");
}

function stackTraceFileName(line: string): string {
  return / \(((?:[A-Za-z]:)?.*?)[:)]/.exec(line)![1].replaceAll("\\", "/");
}

export type CAbiType =
  | "*anyopaque"
  | "*JSGlobalObject"
  | "JSValue"
  | "JSValue.MaybeException"
  | "u0"
  | "bun.String"
  | "bool"
  | "u8"
  | "u16"
  | "u32"
  | "u64"
  | "usize"
  | "i8"
  | "i16"
  | "i32"
  | "i64"
  | "f64"
  | Struct;

export function cAbiTypeInfo(type: CAbiType): [size: number, align: number] {
  if (typeof type !== "string") {
    return type.abiInfo();
  }
  switch (type) {
    case "u0":
      return [0, 0]; // no-op
    case "bool":
    case "u8":
    case "i8":
      return [1, 1];
    case "u16":
    case "i16":
      return [2, 2];
    case "u32":
    case "i32":
      return [4, 4];
    case "usize":
    case "u64":
    case "i64":
    case "f64":
      return [8, 8];
    case "*anyopaque":
    case "*JSGlobalObject":
    case "JSValue":
    case "JSValue.MaybeException":
      return [8, 8]; // pointer size
    case "bun.String":
      return [24, 8];
    default:
      throw new Error("unexpected: " + (type satisfies never));
  }
}

export function cAbiTypeName(type: CAbiType) {
  if (typeof type !== "string") {
    return type.name();
  }
  return (
    {
      "*anyopaque": "void*",
      "*JSGlobalObject": "JSC::JSGlobalObject*",
      "JSValue": "JSValue",
      "JSValue.MaybeException": "JSValue",
      "bool": "bool",
      "u8": "uint8_t",
      "u16": "uint16_t",
      "u32": "uint32_t",
      "u64": "uint64_t",
      "i8": "int8_t",
      "i16": "int16_t",
      "i32": "int32_t",
      "i64": "int64_t",
      "f64": "double",
      "usize": "size_t",
      "bun.String": "BunString",
      u0: "void",
    } satisfies Record<Extract<CAbiType, string>, string>
  )[type];
}

function alignForward(size: number, alignment: number) {
  return (size + alignment - 1) & ~(alignment - 1);
}

class Struct {
  fields: StructField[] = [];
  #hash?: string;
  #name?: string;
  namespace?: string;

  abiInfo(): [size: number, align: number] {
    let size = 0;
    let align = 0;
    for (const field of this.fields) {
      size = alignForward(size, field.naturalAlignment);
      size += field.size;
      align = Math.max(align, field.naturalAlignment);
    }
    return [size, align];
  }

  reorderForSmallestSize() {
    // for conistency sort by alignment, then size, then name
    this.fields.sort((a, b) => {
      if (a.naturalAlignment !== b.naturalAlignment) {
        return a.naturalAlignment - b.naturalAlignment;
      }
      if (a.size !== b.size) {
        return a.size - b.size;
      }
      return a.name.localeCompare(b.name);
    });
  }

  hash() {
    return (this.#hash ??= String(
      Bun.hash(
        this.fields
          .map(f => {
            if (f.type instanceof Struct) {
              return f.name + `:` + f.type.hash();
            }
            return f.name + `:` + f.type;
          })
          .join(","),
      ),
    ));
  }

  name() {
    if (this.#name) return this.#name;
    const hash = this.hash();
    const existing = structHashToSelf.get(hash);
    if (existing && existing !== this) return (this.#name = existing.name());
    return (this.#name = `anon_extern_struct_${hash}`);
  }

  toString() {
    return this.namespace ? `${this.namespace}.${this.name()}` : this.name();
  }

  assignName(name: string) {
    if (this.#name) return;
    const hash = this.hash();
    const existing = structHashToSelf.get(hash);
    if (existing && existing.#name) name = existing.#name;
    this.#name = name;
    if (existing) existing.#name = name;
  }

  add(name: string, cType: CAbiType) {
    const [size, naturalAlignment] = cAbiTypeInfo(cType);
    this.fields.push({ name, type: cType, size, naturalAlignment });
  }

  emitZig(zig: CodeWriter, semi: "with-semi" | "no-semi") {
    zig.line("extern struct {");
    zig.indent();
    for (const field of this.fields) {
      zig.line(`${snake(field.name)}: ${field.type},`);
    }
    zig.dedent();
    zig.line("}" + (semi === "with-semi" ? ";" : ""));
  }

  emitCpp(cpp: CodeWriter, structName: string) {
    cpp.line(`struct ${structName} {`);
    cpp.indent();
    for (const field of this.fields) {
      cpp.line(`${cAbiTypeName(field.type)} ${field.name};`);
    }
    cpp.dedent();
    cpp.line("};");
  }
}

export interface StructField {
  /** camel case */
  name: string;
  type: CAbiType;
  size: number;
  naturalAlignment: number;
}

export class CodeWriter {
  level = 0;
  buffer = "";

  line(s?: string) {
    this.add((s ?? "") + "\n");
  }

  add(s: string) {
    this.buffer += (this.buffer.endsWith("\n") ? "    ".repeat(this.level) : "") + s;
  }

  indent() {
    this.level += 1;
  }

  dedent() {
    this.level -= 1;
  }

  trimLastNewline() {
    this.buffer = this.buffer.trimEnd();
  }
}
