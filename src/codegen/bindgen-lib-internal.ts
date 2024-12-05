import { expect } from "bun:test";
import type { Type, t } from "./bindgen-lib";
import * as path from "node:path";

export const src = path.join(import.meta.dirname, "../");

export type TypeKind = keyof typeof t;

export let allFunctions: Func[] = [];
export let files = new Map<string, File>();
/** A reachable type is one that is required for code generation */
export let typeHashToReachableType = new Map<string, TypeImpl>();
export let typeHashToExternStruct = new Map<string, ExternStruct>();
export let typeHashToNamespace = new Map<string, string>();
export let externStructHashToSelf = new Map<string, ExternStruct>();

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
}

export interface DictionaryField {
  key: string;
  type: TypeImpl;
}

/**
 * Implementation of the Type interface.  All types are immutable and hashable.
 * Hashes de-duplicate structure and union definitions. Flags do not account for
 * the hash, so `oneOf(A, B)` and `oneOf(A, B).optional` will point to the same
 * generated struct type, the purpose of the flags are to inform receivers like
 * `t.dictionary` and `fn` to mark uses as optional or provide default values.
 */
export class TypeImpl<K extends TypeKind = TypeKind> implements Type<any, any> {
  kind: K;
  data: TypeData<K>;
  flags: Flags;
  /** Access via .name(). */
  nameDeduplicated: string | null | undefined = undefined;
  /** Access via .hash() */
  #hash: string | undefined = undefined;
  ownerFile: string;

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
        return "f64";
      case "usize":
        return "usize";
      case "globalObject":
      case "zigVirtualMachine":
        return "*JSGlobalObject";
      case "stringEnum":
        throw new Error("TODO");
      case "zigEnum":
        throw new Error("TODO");
      case "undefined":
        return "u0";
      // classes
      case "AbortSignal":
      case "Blob":
      case "BufferSource":
      case "FormData":
      case "ReadableStream":
      case "URLSearchParams":
        throw new Error("TODO");
      case "oneOf": // `union(enum)`
      case "UTF8String": // []const u8
      case "record": // undecided how to lower records
      case "sequence": // []const T
        return null;
      case "dictionary": {
        let existing = typeHashToExternStruct.get(this.hash());
        if (existing) return existing;
        existing = new ExternStruct();
        for (const { key, type } of this.data as DictionaryField[]) {
          if (type.flags.optional && !("default" in type.flags)) {
            return null; // ?T
          }
          const repr = type.canDirectlyMapToCAbi();
          if (!repr) return null;

          existing.add(key, repr);
        }
        existing.reorderForSmallestSize();
        if(!externStructHashToSelf.has(existing.hash())) {
          externStructHashToSelf.set(existing.hash(), existing);
        }
        existing.assignName(this.name());
        typeHashToExternStruct.set(this.hash(), existing);
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

  assertDefaultIsValid(value: unknown) {
    switch(this.kind) {
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

  emitCppDefaultValue() {
    const value = this.flags.default;
    switch (this.kind) {
      case "boolean":
        return value ? "true" : "false";
      case 'f64':
        return String(value);
      default:
        throw new Error(`TODO: emit default value on type ${this.kind}`);
    }
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

function inspect(value: any) {
  return Bun.inspect(value, { colors:Bun.enableANSIColors });
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
  /** Ordered record */
  args: Arg[];
  ret: TypeImpl;
  returnStrategy?: ReturnStrategy;
  globalObjectArg?: number | "hidden";
}

export interface Arg {
  name: string;
  type: TypeImpl;
  loweringStrategy?: ArgStrategy;
  zigMappedName?: string;
}

/**  */
export type ArgStrategy =
  | { type: "c-abi-pointer"; abiType: CAbiType }
  | { type: "c-abi-value"; abiType: CAbiType };

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
  | { type: "basic-out-param"; abiType: CAbiType }

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
      variants.push({
        ...variant,
        impl: opts.name + i,
      });
      i++;
    }
  } else {
    variants.push({
      impl: opts.name,
      args: Object.entries(opts.args).map(([name, type]) => {
        if (!(type instanceof TypeImpl)) {
          throw new Error(`Expected argument type for ${name} to be a Type instance. Got ${Bun.inspect(type)}`);
        }
        return { name, type };
      }),
      ret: opts.ret,
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

type CAbiType =
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
  | ExternStruct;

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
  return ({
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
    'usize': 'size_t',
    "bun.String": "BunString",
    u0: 'void',
  } satisfies Record<Extract<CAbiType, string>, string>)[type];
}

function alignForward(size: number, alignment: number) {
  return (size + alignment - 1) & ~(alignment - 1);
}

class ExternStruct {
  fields: ExternStructField[] = [];
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
    return (this.#hash ??= String(Bun.hash(this.fields.map(f => f.type).join(","))));
  }

  name() {
    if (this.#name) return this.#name;
    const hash = this.hash();
    const existing = externStructHashToSelf.get(hash);
    if (existing && existing !== this) 
      return (this.#name = existing.name());
    return (this.#name = `anon_extern_struct_${hash}`);
  }

  toString() {
    return this.namespace ? `${this.namespace}.${this.name()}` : this.name();
  }

  assignName(name: string) {
    if (this.#name) return;
    const hash = this.hash();
    const existing = externStructHashToSelf.get(hash);
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

export interface ExternStructField {
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
