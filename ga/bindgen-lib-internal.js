// @bun
// src/codegen/bindgen-lib-internal.ts
var {expect } = globalThis.Bun.jest(import.meta.path);
import * as path from "path";
import assert from "assert";
var src = path.join(import.meta.dirname, "../");
var allFunctions = [];
var files = new Map;
var typeHashToReachableType = new Map;
var typeHashToStruct = new Map;
var typeHashToNamespace = new Map;
var structHashToSelf = new Map;
var str = (v) => JSON.stringify(v);
var cap = (s) => s[0].toUpperCase() + s.slice(1);
var zid = (s) => s.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/) ? s : "@" + str(s);
var snake = (s) => s[0].toLowerCase() + s.slice(1).replace(/([A-Z])/g, "_$1").toLowerCase();
var extJsFunction = (namespaceVar, fnLabel) => `bindgen_${cap(namespaceVar)}_js${cap(fnLabel)}`;
var extDispatchVariant = (namespaceVar, fnLabel, variantNumber) => `bindgen_${cap(namespaceVar)}_dispatch${cap(fnLabel)}${variantNumber}`;

class TypeImpl {
  kind;
  data;
  flags;
  nameDeduplicated = undefined;
  #hash = undefined;
  ownerFile;
  constructor(kind, data, flags = {}) {
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
        h += this.data.map((t) => t.hash()).join(",");
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
  canDirectlyMapToCAbi() {
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
      case "AbortSignal":
      case "Blob":
      case "BufferSource":
      case "FormData":
      case "ReadableStream":
      case "URLSearchParams":
        throw new Error("TODO");
      case "oneOf":
      case "UTF8String":
      case "record":
      case "sequence":
        return null;
      case "dictionary": {
        let existing = typeHashToStruct.get(this.hash());
        if (existing)
          return existing;
        existing = new Struct;
        for (const { key, type } of this.data) {
          if (type.flags.optional && !("default" in type.flags)) {
            return null;
          }
          const repr = type.canDirectlyMapToCAbi();
          if (!repr)
            return null;
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
        throw new Error("unexpected: " + kind);
      }
    }
  }
  name() {
    if (this.nameDeduplicated) {
      return this.nameDeduplicated;
    }
    const hash = this.hash();
    const existing = typeHashToReachableType.get(hash);
    if (existing)
      return this.nameDeduplicated = existing.nameDeduplicated ??= this.#generateName();
    return this.nameDeduplicated = `anon_${this.kind}_${hash}`;
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
  assignName(name) {
    if (this.nameDeduplicated)
      return;
    const hash = this.hash();
    const existing = typeHashToReachableType.get(hash);
    if (existing) {
      this.nameDeduplicated = existing.nameDeduplicated ??= name;
      return;
    }
    this.nameDeduplicated = name;
  }
  markReachable() {
    if (!this.lowersToStruct())
      return;
    const hash = this.hash();
    const existing = typeHashToReachableType.get(hash);
    this.nameDeduplicated ??= existing?.name() ?? `anon_${this.kind}_${hash}`;
    if (!existing)
      typeHashToReachableType.set(hash, this);
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
        for (const type of this.data) {
          type.markReachable();
        }
        break;
      case "dictionary":
        for (const { type } of this.data) {
          type.markReachable();
        }
        break;
    }
  }
  get optional() {
    if (this.flags.required) {
      throw new Error("Cannot derive optional on a required type");
    }
    if (this.flags.default) {
      throw new Error("Cannot derive optional on a something with a default value (default implies optional)");
    }
    return new TypeImpl(this.kind, this.data, {
      ...this.flags,
      optional: true
    });
  }
  get nullable() {
    return new TypeImpl(this.kind, this.data, {
      ...this.flags,
      nullable: true
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
      required: true
    });
  }
  assertDefaultIsValid(value) {
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
        const range = cAbiNumberLimits(this.kind);
        if (typeof value === "number") {
          if (value % 1 !== 0) {
            throw new Error(`Expected integer, got ${inspect(value)}`);
          }
          if (value >= Number.MAX_SAFE_INTEGER || value <= Number.MIN_SAFE_INTEGER) {
            throw new Error(`Specify default ${this.kind} outside of max safe integer range as a BigInt to avoid precision loss`);
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
        for (const { key, type } of this.data) {
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
  emitCppDefaultValue(w) {
    const value = this.flags.default;
    switch (this.kind) {
      case "boolean":
        w.add(value ? "true" : "false");
        break;
      case "f64":
        w.add(String(value));
        break;
      case "usize":
        const str2 = String(value);
        w.add(`${str2}ULL`);
        break;
      default:
        console.log({ this: this });
        const struct = this.structType();
        w.line(`${this.cppName()} {`);
        break;
    }
  }
  structType() {
    const direct = this.canDirectlyMapToCAbi();
    assert(typeof direct !== "string");
    if (direct)
      return direct;
    throw new Error("TODO: generate non-extern struct for representing this data type");
  }
  default(def) {
    if ("default" in this.flags) {
      throw new Error("This type already has a default value");
    }
    if (this.flags.required) {
      throw new Error("Cannot derive default on a required type");
    }
    this.assertDefaultIsValid(def);
    return new TypeImpl(this.kind, this.data, {
      ...this.flags,
      default: def
    });
  }
  [Symbol.toStringTag] = "Type";
  [Bun.inspect.custom](depth, options, inspect) {
    return `${options.stylize("Type", "special")} ${this.nameDeduplicated ? options.stylize(JSON.stringify(this.nameDeduplicated), "string") + " " : ""}${options.stylize(`[${this.kind}${["required", "optional", "nullable"].filter((k) => this.flags[k]).map((x) => ", " + x).join("")}]`, "regexp")}` + (this.data ? " " + inspect(this.data, {
      ...options,
      depth: options.depth === null ? null : options.depth - 1
    }).replace(/\n/g, `
`) : "");
  }
}
function cAbiNumberLimits(type) {
  switch (type) {
    case "f64":
      return [-Infinity, Infinity];
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
function inspect(value) {
  return Bun.inspect(value, { colors: Bun.enableANSIColors });
}
function oneOfImpl(types) {
  const out = [];
  for (const type of types) {
    if (type.kind === "oneOf") {
      out.push(...type.data);
    } else {
      if (type.flags.nullable) {
        throw new Error("Union type cannot include nullable");
      }
      if (type.flags.default) {
        throw new Error("Union type cannot include a default value. Instead, set a default value on the union type itself");
      }
      if (type.isVirtualArgument()) {
        throw new Error(`t.${type.kind} can only be used as a function argument type`);
      }
      out.push(type);
    }
  }
  return new TypeImpl("oneOf", out);
}
function dictionaryImpl(record) {
  const out = [];
  for (const key in record) {
    const type = record[key];
    if (type.isVirtualArgument()) {
      throw new Error(`t.${type.kind} can only be used as a function argument type`);
    }
    out.push({
      key,
      type
    });
  }
  return new TypeImpl("dictionary", out);
}
function registerFunction(opts) {
  const snapshot = snapshotCallerLocation();
  const filename = stackTraceFileName(snapshot);
  expect(filename).toEndWith(".bind.ts");
  const zigFile = path.relative(src, filename.replace(/\.bind\.ts$/, ".zig"));
  let file = files.get(zigFile);
  if (!file) {
    file = { functions: [], typedefs: [] };
    files.set(zigFile, file);
  }
  const variants = [];
  if ("variants" in opts) {
    let i = 1;
    for (const variant of opts.variants) {
      const { minRequiredArgs } = validateVariant(variant);
      variants.push({
        ...variant,
        impl: opts.name + i,
        minRequiredArgs
      });
      i++;
    }
  } else {
    const { minRequiredArgs } = validateVariant(opts);
    variants.push({
      impl: opts.name,
      args: Object.entries(opts.args).map(([name, type]) => ({ name, type })),
      ret: opts.ret,
      minRequiredArgs
    });
  }
  const func = {
    name: opts.name,
    snapshot,
    zigFile,
    variants
  };
  allFunctions.push(func);
  file.functions.push(func);
}
function validateVariant(variant) {
  let minRequiredArgs = 0;
  let seenOptionalArgument = false;
  let i = 0;
  console.log(variant);
  for (const [name, type] of Object.entries(variant.args)) {
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
function snapshotCallerLocation() {
  const stack = new Error().stack;
  const lines = stack.split(`
`);
  let i = 1;
  for (;i < lines.length; i++) {
    if (!lines[i].includes(import.meta.dir)) {
      return lines[i];
    }
  }
  throw new Error("Couldn't find caller location in stack trace");
}
function stackTraceFileName(line) {
  return / \(((?:[A-Za-z]:)?.*?)[:)]/.exec(line)[1].replaceAll("\\", "/");
}
function cAbiTypeInfo(type) {
  if (typeof type !== "string") {
    return type.abiInfo();
  }
  switch (type) {
    case "u0":
      return [0, 0];
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
      return [8, 8];
    case "bun.String":
      return [24, 8];
    default:
      throw new Error("unexpected: " + type);
  }
}
function cAbiTypeName(type) {
  if (typeof type !== "string") {
    return type.name();
  }
  return {
    "*anyopaque": "void*",
    "*JSGlobalObject": "JSC::JSGlobalObject*",
    JSValue: "JSValue",
    "JSValue.MaybeException": "JSValue",
    bool: "bool",
    u8: "uint8_t",
    u16: "uint16_t",
    u32: "uint32_t",
    u64: "uint64_t",
    i8: "int8_t",
    i16: "int16_t",
    i32: "int32_t",
    i64: "int64_t",
    f64: "double",
    usize: "size_t",
    "bun.String": "BunString",
    u0: "void"
  }[type];
}
function alignForward(size, alignment) {
  return size + alignment - 1 & ~(alignment - 1);
}

class Struct {
  fields = [];
  #hash;
  #name;
  namespace;
  abiInfo() {
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
    return this.#hash ??= String(Bun.hash(this.fields.map((f) => {
      if (f.type instanceof Struct) {
        return f.name + `:` + f.type.hash();
      }
      return f.name + `:` + f.type;
    }).join(",")));
  }
  name() {
    if (this.#name)
      return this.#name;
    const hash = this.hash();
    const existing = structHashToSelf.get(hash);
    if (existing && existing !== this)
      return this.#name = existing.name();
    return this.#name = `anon_extern_struct_${hash}`;
  }
  toString() {
    return this.namespace ? `${this.namespace}.${this.name()}` : this.name();
  }
  assignName(name) {
    if (this.#name)
      return;
    const hash = this.hash();
    const existing = structHashToSelf.get(hash);
    if (existing && existing.#name)
      name = existing.#name;
    this.#name = name;
    if (existing)
      existing.#name = name;
  }
  add(name, cType) {
    const [size, naturalAlignment] = cAbiTypeInfo(cType);
    this.fields.push({ name, type: cType, size, naturalAlignment });
  }
  emitZig(zig, semi) {
    zig.line("extern struct {");
    zig.indent();
    for (const field of this.fields) {
      zig.line(`${snake(field.name)}: ${field.type},`);
    }
    zig.dedent();
    zig.line("}" + (semi === "with-semi" ? ";" : ""));
  }
  emitCpp(cpp, structName) {
    cpp.line(`struct ${structName} {`);
    cpp.indent();
    for (const field of this.fields) {
      cpp.line(`${cAbiTypeName(field.type)} ${field.name};`);
    }
    cpp.dedent();
    cpp.line("};");
  }
}

class CodeWriter {
  level = 0;
  buffer = "";
  line(s) {
    this.add((s ?? "") + `
`);
  }
  add(s) {
    this.buffer += (this.buffer.endsWith(`
`) ? "    ".repeat(this.level) : "") + s;
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
export {
  zid,
  typeHashToStruct,
  typeHashToReachableType,
  typeHashToNamespace,
  structHashToSelf,
  str,
  src,
  snake,
  registerFunction,
  oneOfImpl,
  files,
  extJsFunction,
  extDispatchVariant,
  dictionaryImpl,
  cap,
  cAbiTypeName,
  cAbiTypeInfo,
  allFunctions,
  TypeImpl,
  CodeWriter
};

//# debugId=66889C711D1FD57564756E2164756E21
//# sourceMappingURL=bindgen-lib-internal.js.map
