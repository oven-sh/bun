// The binding generator to rule them all.
// Converts binding definition files (.bind.ts) into C++ and Zig code.
//
// Generated bindings are available in `bun.generated.<basename>.*` in Zig,
// or `Generated::<basename>::*` in C++ from including `Generated<basename>.h`.
import * as path from "node:path";
import {
  CodeWriter,
  TypeImpl,
  cAbiTypeInfo,
  cAbiTypeName,
  cap,
  extDispatchVariant,
  extJsFunction,
  files,
  snake,
  src,
  str,
  Struct,
  type CAbiType,
  type DictionaryField,
  type ReturnStrategy,
  type TypeKind,
  type Variant,
  typeHashToNamespace,
  typeHashToReachableType,
  zid,
  ArgStrategyChildItem,
  inspect,
  pascal,
} from "./bindgen-lib-internal";
import assert from "node:assert";
import { argParse, writeIfNotChanged } from "./helpers";

// arg parsing
let { "codegen-root": codegenRoot, debug } = argParse(["codegen-root", "debug"]);
if (debug === "false" || debug === "0" || debug == "OFF") debug = false;
if (!codegenRoot) {
  console.error("Missing --codegen-root=...");
  process.exit(1);
}

function resolveVariantStrategies(vari: Variant, name: string) {
  let argIndex = 0;
  let communicationStruct: Struct | undefined;
  for (const arg of vari.args) {
    if (arg.type.isVirtualArgument() && vari.globalObjectArg === undefined) {
      vari.globalObjectArg = argIndex;
    }
    argIndex += 1;

    // If `extern struct` can represent this type, that is the simplest way to cross the C-ABI boundary.
    const isNullable = (arg.type.flags.optional && !("default" in arg.type.flags)) || arg.type.flags.nullable;
    const abiType = !isNullable && arg.type.canDirectlyMapToCAbi();
    if (abiType) {
      arg.loweringStrategy = {
        type: cAbiTypeInfo(abiType)[0] > 8 ? "c-abi-pointer" : "c-abi-value",
        abiType,
      };
      continue;
    }

    communicationStruct ??= new Struct();
    const prefix = `${arg.name}`;
    const children = isNullable
      ? resolveNullableArgumentStrategy(arg.type, prefix, communicationStruct)
      : resolveComplexArgumentStrategy(arg.type, prefix, communicationStruct);
    arg.loweringStrategy = {
      type: "uses-communication-buffer",
      prefix,
      children,
    };
  }

  if (vari.globalObjectArg === undefined) {
    vari.globalObjectArg = "hidden";
  }

  return_strategy: {
    if (vari.ret.kind === "any") {
      vari.returnStrategy = { type: "jsvalue" };
      break return_strategy;
    }
    const abiType = vari.ret.canDirectlyMapToCAbi();
    if (abiType) {
      vari.returnStrategy = {
        type: "basic-out-param",
        abiType,
      };
      break return_strategy;
    }
  }

  communicationStruct?.reorderForSmallestSize();
  communicationStruct?.assignGeneratedName(name);
  vari.communicationStruct = communicationStruct;
}

function resolveNullableArgumentStrategy(
  type: TypeImpl,
  prefix: string,
  communicationStruct: Struct,
): ArgStrategyChildItem[] {
  assert((type.flags.optional && !("default" in type.flags)) || type.flags.nullable);
  communicationStruct.add(`${prefix}Set`, "bool");
  return resolveComplexArgumentStrategy(type, `${prefix}Value`, communicationStruct);
}

function resolveComplexArgumentStrategy(
  type: TypeImpl,
  prefix: string,
  communicationStruct: Struct,
): ArgStrategyChildItem[] {
  const abiType = type.canDirectlyMapToCAbi();
  if (abiType) {
    communicationStruct.add(prefix, abiType);
    return [
      {
        type: "c-abi-compatible",
        abiType,
      },
    ];
  }

  throw new Error(`TODO: resolveComplexArgumentStrategy for ${type.kind}`);
}

function emitCppCallToVariant(variant: Variant, dispatchFunctionName: string) {
  cpp.line(`auto& vm = JSC::getVM(global);`);
  cpp.line(`auto throwScope = DECLARE_THROW_SCOPE(vm);`);
  if (variant.minRequiredArgs > 0) {
    cpp.line(`size_t argumentCount = callFrame->argumentCount();`);
    cpp.line(`if (argumentCount < ${variant.minRequiredArgs}) {`);
    cpp.line(`    return JSC::throwVMError(global, throwScope, createNotEnoughArgumentsError(global));`);
    cpp.line(`}`);
  }
  const communicationStruct = variant.communicationStruct;
  if (communicationStruct) {
    cpp.line(`${communicationStruct.name()} buf;`);
    communicationStruct.emitCpp(cppInternal, communicationStruct.name());
  }

  let i = 0;
  for (const arg of variant.args) {
    const type = arg.type;
    if (type.isVirtualArgument()) continue;

    const strategy = arg.loweringStrategy!;
    assert(strategy);

    const get = variant.minRequiredArgs > i ? "uncheckedArgument" : "argument";
    cpp.line(`JSC::EnsureStillAliveScope arg${i} = callFrame->${get}(${i});`);

    let storageLocation;
    let needDeclare = true;
    switch (strategy.type) {
      case "c-abi-pointer":
      case "c-abi-value":
        storageLocation = "arg" + cap(arg.name);
        break;
      case "uses-communication-buffer":
        storageLocation = `buf.${strategy.prefix}`;
        needDeclare = false;
        break;
      default:
        throw new Error(`TODO: emitCppCallToVariant for ${inspect(strategy)}`);
    }

    const jsValueRef = `arg${i}.value()`;

    /** If JavaScript may pass null or undefined */
    const isOptionalToUser = type.flags.nullable || type.flags.optional || "default" in type.flags;
    /** If the final representation may include null */
    const isNullable = type.flags.nullable || (type.flags.optional && !("default" in type.flags));

    if (isOptionalToUser) {
      if (needDeclare) {
        cpp.line(`${type.cppName()} ${storageLocation};`);
      }
      if (isNullable) {
        assert(strategy.type === "uses-communication-buffer");
        cpp.line(`if ((${storageLocation}Set = !${jsValueRef}.isUndefinedOrNull())) {`);
        storageLocation = `${storageLocation}Value`;
      } else {
        cpp.line(`if (!${jsValueRef}.isUndefinedOrNull()) {`);
      }
      cpp.indent();
      emitConvertValue(storageLocation, arg.type, jsValueRef, "assign");
      cpp.dedent();
      if ("default" in type.flags) {
        cpp.line(`} else {`);
        cpp.indent();
        cpp.add(`${storageLocation} = `);
        type.emitCppDefaultValue(cpp);
        cpp.line(";");
        cpp.dedent();
      } else {
        assert(isNullable);
      }
      cpp.line(`}`);
    } else {
      emitConvertValue(storageLocation, arg.type, jsValueRef, needDeclare ? "declare" : "assign");
    }

    i += 1;
  }

  const returnStrategy = variant.returnStrategy!;
  switch (returnStrategy.type) {
    case "jsvalue":
      cpp.line(`return ${dispatchFunctionName}(`);
      break;
    case "basic-out-param":
      cpp.line(`${cAbiTypeName(returnStrategy.abiType)} out;`);
      cpp.line(`if (!${dispatchFunctionName}(`);
      break;
    default:
      throw new Error(`TODO: emitCppCallToVariant for ${inspect(returnStrategy)}`);
  }

  let emittedFirstArgument = false;
  function addCommaAfterArgument() {
    if (emittedFirstArgument) {
      cpp.line(",");
    } else {
      emittedFirstArgument = true;
    }
  }

  const totalArgs = variant.args.length;
  i = 0;
  cpp.indent();

  if (variant.globalObjectArg === "hidden") {
    addCommaAfterArgument();
    cpp.add("global");
  }

  for (const arg of variant.args) {
    i += 1;
    if (arg.type.isVirtualArgument()) {
      switch (arg.type.kind) {
        case "zigVirtualMachine":
        case "globalObject":
          addCommaAfterArgument();
          cpp.add("global");
          break;
        default:
          throw new Error(`TODO: emitCppCallToVariant for ${inspect(arg.type)}`);
      }
    } else {
      const storageLocation = `arg${cap(arg.name)}`;
      const strategy = arg.loweringStrategy!;
      switch (strategy.type) {
        case "c-abi-pointer":
          addCommaAfterArgument();
          cpp.add(`&${storageLocation}`);
          break;
        case "c-abi-value":
          addCommaAfterArgument();
          cpp.add(`${storageLocation}`);
          break;
        case "uses-communication-buffer":
          break;
        default:
          throw new Error(`TODO: emitCppCallToVariant for ${inspect(strategy)}`);
      }
    }
  }

  if (communicationStruct) {
    addCommaAfterArgument();
    cpp.add("&buf");
  }

  switch (returnStrategy.type) {
    case "jsvalue":
      cpp.dedent();
      if (totalArgs === 0) {
        cpp.trimLastNewline();
      }
      cpp.line(");");
      break;
    case "basic-out-param":
      addCommaAfterArgument();
      cpp.add("&out");
      cpp.line();
      cpp.dedent();
      cpp.line(")) {");
      cpp.line(`    return {};`);
      cpp.line("}");
      const simpleType = getSimpleIdlType(variant.ret);
      assert(simpleType); // TODO:
      cpp.line(`return JSC::JSValue::encode(WebCore::toJS<${simpleType}>(*global, out));`);
      break;
    default:
      throw new Error(`TODO: emitCppCallToVariant for ${inspect(returnStrategy)}`);
  }
}

/** If a simple IDL type mapping exists, it also currently means there is a direct C ABI mapping */
function getSimpleIdlType(type: TypeImpl): string | undefined {
  const map: { [K in TypeKind]?: string } = {
    boolean: "WebCore::IDLBoolean",
    undefined: "WebCore::IDLUndefined",
    f64: "WebCore::IDLDouble",
    usize: "WebCore::IDLUnsignedLongLong",
    u8: "WebCore::IDLOctet",
    u16: "WebCore::IDLUnsignedShort",
    u32: "WebCore::IDLUnsignedLong",
    u64: "WebCore::IDLUnsignedLongLong",
    i8: "WebCore::IDLByte",
    i16: "WebCore::IDLShort",
    i32: "WebCore::IDLLong",
    i64: "WebCore::IDLLongLong",
  };
  let entry = map[type.kind];
  if (!entry) return;

  if (type.flags.range) {
    // TODO: when enforceRange is used, a custom adaptor should be used instead
    // of chaining both `WebCore::IDLEnforceRangeAdaptor` and custom logic.
    const rangeAdaptor = {
      "clamp": "WebCore::IDLClampAdaptor",
      "enforce": "WebCore::IDLEnforceRangeAdaptor",
    }[type.flags.range[0]];
    assert(rangeAdaptor);
    entry = `${rangeAdaptor}<${entry}>`;
  }

  return entry;
}

function emitConvertValue(storageLocation: string, type: TypeImpl, jsValueRef: string, decl: "declare" | "assign") {
  if (decl === "declare") {
    cpp.add(`${type.cppName()} `);
  }

  const simpleType = getSimpleIdlType(type);
  if (simpleType) {
    const cAbiType = type.canDirectlyMapToCAbi();
    assert(cAbiType);
    cpp.line(`${storageLocation} = WebCore::convert<${simpleType}>(*global, ${jsValueRef});`);

    if (type.flags.range && type.flags.range[1] !== "abi") {
      emitRangeModifierCheck(cAbiType, storageLocation, type.flags.range);
    }

    cpp.line(`RETURN_IF_EXCEPTION(throwScope, {});`);
  } else {
    switch (type.kind) {
      case "any":
        cpp.line(`${storageLocation} = JSC::JSValue::encode(${jsValueRef});`);
        break;
      case "USVString":
      case "DOMString":
      case "ByteString":
        cpp.line(
          `${storageLocation} = Bun::toString(WebCore::convert<WebCore::IDL${type.kind}>(*global, ${jsValueRef}));`,
        );
        cpp.line(`RETURN_IF_EXCEPTION(throwScope, {});`);
        break;
      case "dictionary": {
        if (decl === "declare") cpp.line(`${storageLocation};`);
        cpp.line(`if (!convert${type.cppName()}(&${storageLocation}, global, ${jsValueRef}))`);
        cpp.indent();
        cpp.line(`return {};`);
        cpp.dedent();
        break;
      }
      default:
        throw new Error(`TODO: emitConvertValue for Type ${type.kind}`);
    }
  }
}

/**
 * The built in WebCore range adaptors do not support arbitrary ranges, but that
 * is something we want to have. They aren't common, so they are just tacked
 * onto the webkit one.
 */
function emitRangeModifierCheck(
  cAbiType: CAbiType,
  storageLocation: string,
  range: ["clamp" | "enforce", bigint, bigint],
) {
  const [kind, min, max] = range;
  if (kind === "clamp") {
    cpp.line(`if (${storageLocation} < ${min}) ${storageLocation} = ${min};`);
    cpp.line(`else if (${storageLocation} > ${max}) ${storageLocation} = ${max};`);
  } else if (kind === "enforce") {
    cpp.line(`if (${storageLocation} < ${min} || ${storageLocation} > ${max}) {`);
    cpp.indent();
    cpp.line(
      `throwTypeError(global, throwScope, rangeErrorString<${cAbiTypeName(cAbiType)}>(${storageLocation}, ${min}, ${max}));`,
    );
    cpp.line(`return {};`);
    cpp.dedent();
    cpp.line(`}`);
  } else {
    throw new Error(`TODO: range modifier ${kind}`);
  }
}

function emitConvertDictionaryFunction(type: TypeImpl) {
  assert(type.kind === "dictionary");
  const fields = type.data as DictionaryField[];

  cpp.line(
    `bool convert${type.cppName()}(${type.cppName()}* result, JSC::JSGlobalObject* global, JSC::JSValue value) {`,
  );
  cpp.indent();

  cpp.line(`auto& vm = JSC::getVM(global);`);
  cpp.line(`auto throwScope = DECLARE_THROW_SCOPE(vm);`);
  cpp.line(`bool isNullOrUndefined = value.isUndefinedOrNull();`);
  cpp.line(`auto* object = isNullOrUndefined ? nullptr : value.getObject();`);
  cpp.line(`if (UNLIKELY(!isNullOrUndefined && !object)) {`);
  cpp.line(`    throwTypeError(global, throwScope);`);
  cpp.line(`    return false;`);
  cpp.line(`}`);
  cpp.line(`JSC::JSValue propValue;`);

  for (const field of fields) {
    const { key, type: fieldType } = field;
    cpp.line("// " + key);
    cpp.line(`if (isNullOrUndefined) {`);
    cpp.line(`    propValue = JSC::jsUndefined();`);
    cpp.line(`} else {`);
    cpp.line(`    propValue = object->get(global, JSC::Identifier::fromString(vm, ${str(key)}_s));`);
    cpp.line(`    RETURN_IF_EXCEPTION(throwScope, false);`);
    cpp.line(`}`);
    cpp.line(`if (!propValue.isUndefined()) {`);
    cpp.indent();
    emitConvertValue(`result->${key}`, fieldType, "propValue", "assign");
    cpp.dedent();
    cpp.line(`} else {`);
    cpp.indent();
    if (type.flags.required) {
      cpp.line(`throwTypeError(global, throwScope);`);
      cpp.line(`return false;`);
    } else if ("default" in fieldType.flags) {
      cpp.add(`result->${key} = `);
      fieldType.emitCppDefaultValue(cpp);
      cpp.line(";");
    } else {
      throw new Error(`TODO: optional dictionary field`);
    }
    cpp.dedent();
    cpp.line(`}`);
  }

  cpp.line(`return true;`);
  cpp.dedent();
  cpp.line(`}`);
  cpp.line();
}

function emitZigStruct(type: TypeImpl) {
  zig.add(`pub const ${type.name()} = `);

  const externLayout = type.canDirectlyMapToCAbi();
  if (externLayout) {
    if (typeof externLayout === "string") {
      zig.line(externLayout + ";");
    } else {
      externLayout.emitZig(zig, "with-semi");
    }
    return;
  }

  switch (type.kind) {
    case "dictionary": {
      zig.line("struct {");
      zig.indent();
      for (const { key, type: fieldType } of type.data as DictionaryField[]) {
        zig.line(`    ${snake(key)}: ${zigTypeName(fieldType)},`);
      }
      zig.dedent();
      zig.line(`};`);
      break;
    }
    default: {
      throw new Error(`TODO: emitZigStruct for Type ${type.kind}`);
    }
  }
}

function emitCppStruct(type: TypeImpl) {
  const externLayout = type.canDirectlyMapToCAbi();
  if (externLayout) {
    if (typeof externLayout === "string") {
      zig.line(`typedef ${externLayout} ${type.name()};`);
      console.warn("should this really be done lol", type);
    } else {
      externLayout.emitCpp(cpp, type.name());
      cpp.line();
    }
    return;
  }

  switch (type.kind) {
    default: {
      throw new Error(`TODO: emitZigStruct for Type ${type.kind}`);
    }
  }
}

function zigTypeName(type: TypeImpl): string {
  let name = zigTypeNameInner(type);
  if (type.flags.optional) {
    name = "?" + name;
  }
  return name;
}

function zigTypeNameInner(type: TypeImpl): string {
  if (type.lowersToStruct()) {
    const namespace = typeHashToNamespace.get(type.hash());
    return namespace ? `${namespace}.${type.name()}` : type.name();
  }
  switch (type.kind) {
    case "USVString":
    case "DOMString":
    case "ByteString":
      return "bun.String";
    case "boolean":
      return "bool";
    case "usize":
      return "usize";
    case "UTF8String":
      return "[]const u8";
    case "globalObject":
    case "zigVirtualMachine":
      return "*JSC.JSGlobalObject";
    default:
      const cAbiType = type.canDirectlyMapToCAbi();
      if (cAbiType) {
        if (typeof cAbiType === "string") {
          return cAbiType;
        }
        return cAbiType.name();
      }
      throw new Error(`TODO: emitZigTypeName for Type ${type.kind}`);
  }
}

function returnStrategyCppType(strategy: ReturnStrategy): string {
  switch (strategy.type) {
    case "basic-out-param":
      return "bool"; // true=success, false=exception
    case "jsvalue":
      return "JSC::EncodedJSValue";
    default:
      throw new Error(
        `TODO: returnStrategyCppType for ${Bun.inspect(strategy satisfies never, { colors: Bun.enableANSIColors })}`,
      );
  }
}

function returnStrategyZigType(strategy: ReturnStrategy): string {
  switch (strategy.type) {
    case "basic-out-param":
      return "bool"; // true=success, false=exception
    case "jsvalue":
      return "JSC.JSValue";
    default:
      throw new Error(
        `TODO: returnStrategyZigType for ${Bun.inspect(strategy satisfies never, { colors: Bun.enableANSIColors })}`,
      );
  }
}

function emitNullableZigDecoder(w: CodeWriter, prefix: string, type: TypeImpl, children: ArgStrategyChildItem[]) {
  assert(children.length > 0);
  const indent = children[0].type !== "c-abi-compatible";
  w.add(`if (${prefix}_set)`);
  if (indent) {
    w.indent();
  } else {
    w.add(` `);
  }
  emitComplexZigDecoder(w, prefix + "_value", type, children);
  if (indent) {
    w.line();
    w.dedent();
  } else {
    w.add(` `);
  }
  w.add(`else`);
  if (indent) {
    w.indent();
  } else {
    w.add(` `);
  }
  w.add(`null`);
  if (indent) w.dedent();
}

function emitComplexZigDecoder(w: CodeWriter, prefix: string, type: TypeImpl, children: ArgStrategyChildItem[]) {
  assert(children.length > 0);
  if (children[0].type === "c-abi-compatible") {
    w.add(`${prefix}`);
    return;
  }

  switch (type.kind) {
    default:
      throw new Error(`TODO: emitComplexZigDecoder for Type ${type.kind}`);
  }
}

// BEGIN MAIN CODE GENERATION

// Search for all .bind.ts files
const unsortedFiles = new Bun.Glob("**/*.bind.ts").scanSync({
  onlyFiles: true,
  absolute: true,
  cwd: src,
});
// Sort for deterministic output
for (const file of [...unsortedFiles].sort()) {
  const exports = import.meta.require(file);

  // Mark all exported TypeImpl as reachable
  const zigFile = path.relative(src, file.replace(/\.bind\.ts$/, ".zig"));
  for (const [key, value] of Object.entries(exports)) {
    if (value instanceof TypeImpl) {
      const file = files.get(zigFile);
      value.assignName(key);
      value.markReachable();
      const td = { name: key, type: value };
      if (!file) {
        files.set(zigFile, { functions: [], typedefs: [td] });
      } else {
        file.typedefs.push(td);
      }
    }
  }
}

const zig = new CodeWriter();
const zigInternal = new CodeWriter();
const cpp = new CodeWriter();
const cppInternal = new CodeWriter();
const headers = new Set<string>();

zig.line('const bun = @import("root").bun;');
zig.line("const JSC = bun.JSC;");
zig.line("const JSHostFunctionType = JSC.JSHostFunctionType;\n");

zigInternal.line();
zigInternal.line("const binding_internals = struct {");
zigInternal.indent();

cpp.buffer +=
  /* cpp */
  `template<typename T>
static String rangeErrorString(T value, T min, T max)
{
    return makeString("Value "_s, value, " is outside the range ["_s, min, ", "_s, max, ']');
}

`;

headers.add("root.h");
headers.add("IDLTypes.h");
headers.add("JSDOMBinding.h");
headers.add("JSDOMConvertBase.h");
headers.add("JSDOMConvertBoolean.h");
headers.add("JSDOMConvertNumbers.h");
headers.add("JSDOMConvertStrings.h");
headers.add("JSDOMExceptionHandling.h");
headers.add("JSDOMOperation.h");

/**
 * Indexed by `zigFile`, values are the generated zig identifier name, without
 * collisions.
 */
const fileMap = new Map<string, string>();
const fileNames = new Set<string>();

for (const [filename, { functions, typedefs }] of files) {
  if (functions.length === 0) continue;

  const basename = path.basename(filename, ".zig");
  let varName = basename;
  if (fileNames.has(varName)) {
    throw new Error(`File name collision: ${basename}.zig`);
  }
  fileNames.add(varName);
  fileMap.set(filename, varName);

  for (const td of typedefs) {
    typeHashToNamespace.set(td.type.hash(), varName);
  }

  for (const fn of functions) {
    for (const vari of fn.variants) {
      for (const arg of vari.args) {
        arg.type.markReachable();
      }
    }
  }
}

for (const type of typeHashToReachableType.values()) {
  emitCppStruct(type);

  // Emit convert functions for compound types
  switch (type.kind) {
    case "dictionary":
      emitConvertDictionaryFunction(type);
      break;
  }
}

for (const [filename, { functions, typedefs }] of files) {
  const namespaceVar = fileMap.get(filename)!;
  assert(namespaceVar);
  zigInternal.line(`const import_${namespaceVar} = @import(${str(path.relative(src + "/bun.js", filename))});`);

  zig.line(`/// Generated for src/${filename}`);
  zig.line(`pub const ${namespaceVar} = struct {`);
  zig.indent();

  for (const fn of functions) {
    const externName = extJsFunction(namespaceVar, fn.name);

    // C++ forward declarations
    let variNum = 1;
    for (const vari of fn.variants) {
      resolveVariantStrategies(
        vari,
        `${pascal(namespaceVar)}${pascal(fn.name)}Arguments${fn.variants.length > 1 ? variNum : ""}`,
      );
      const dispatchName = extDispatchVariant(namespaceVar, fn.name, variNum);

      const args: string[] = [];

      let argNum = 0;
      if (vari.globalObjectArg === "hidden") {
        args.push("JSC::JSGlobalObject*");
      }
      for (const arg of vari.args) {
        argNum += 1;
        const strategy = arg.loweringStrategy!;
        switch (strategy.type) {
          case "c-abi-pointer":
            args.push(`const ${arg.type.cppName()}*`);
            break;
          case "c-abi-value":
            args.push(arg.type.cppName());
            break;
          case "uses-communication-buffer":
            break;
          default:
            throw new Error(`TODO: C++ dispatch function for ${inspect(strategy)}`);
        }
      }
      const { communicationStruct } = vari;
      if (communicationStruct) {
        args.push(`${communicationStruct.name()}*`);
      }
      const returnStrategy = vari.returnStrategy!;
      if (returnStrategy.type === "basic-out-param") {
        args.push(cAbiTypeName(returnStrategy.abiType) + "*");
      }

      cpp.line(`extern "C" ${returnStrategyCppType(vari.returnStrategy!)} ${dispatchName}(${args.join(", ")});`);

      variNum += 1;
    }
    cpp.line();

    // Public function
    zig.line(
      `pub const ${zid("js" + cap(fn.name))} = @extern(*const JSHostFunctionType, .{ .name = ${str(externName)} });`,
    );

    // Generated JSC host function
    cpp.line(
      `extern "C" SYSV_ABI JSC::EncodedJSValue ${externName}(JSC::JSGlobalObject* global, JSC::CallFrame* callFrame)`,
    );
    cpp.line(`{`);
    cpp.indent();

    if (fn.variants.length === 1) {
      emitCppCallToVariant(fn.variants[0], extDispatchVariant(namespaceVar, fn.name, 1));
    } else {
      throw new Error(`TODO: multiple variant dispatch`);
    }

    cpp.dedent();
    cpp.line(`}`);

    // Generated Zig dispatch functions
    variNum = 1;
    for (const vari of fn.variants) {
      const dispatchName = extDispatchVariant(namespaceVar, fn.name, variNum);
      const args: string[] = [];
      const returnStrategy = vari.returnStrategy!;
      const { communicationStruct } = vari;
      if (communicationStruct) {
        zigInternal.add(`const ${communicationStruct.name()} = `);
        communicationStruct.emitZig(zigInternal, "with-semi");
      }

      assert(vari.globalObjectArg !== undefined);

      let globalObjectArg = "";
      if (vari.globalObjectArg === "hidden") {
        args.push(`global: *JSC.JSGlobalObject`);
        globalObjectArg = "global";
      }
      let argNum = 0;
      for (const arg of vari.args) {
        let argName = `arg_${snake(arg.name)}`;
        if (vari.globalObjectArg === argNum) {
          if (arg.type.kind !== "globalObject") {
            argName = "global";
          }
          globalObjectArg = argName;
        }
        argNum += 1;
        arg.zigMappedName = argName;
        const strategy = arg.loweringStrategy!;
        switch (strategy.type) {
          case "c-abi-pointer":
            args.push(`${argName}: *const ${zigTypeName(arg.type)}`);
            break;
          case "c-abi-value":
            args.push(`${argName}: ${zigTypeName(arg.type)}`);
            break;
          case "uses-communication-buffer":
            break;
          default:
            throw new Error(`TODO: zig dispatch function for ${inspect(strategy)}`);
        }
      }
      assert(globalObjectArg, `globalObjectArg not found from ${vari.globalObjectArg}`);

      if (communicationStruct) {
        args.push(`buf: *${communicationStruct.name()}`);
      }

      if (returnStrategy.type === "basic-out-param") {
        args.push(`out: *${zigTypeName(vari.ret)}`);
      }

      zigInternal.line(`export fn ${zid(dispatchName)}(${args.join(", ")}) ${returnStrategyZigType(returnStrategy)} {`);
      zigInternal.indent();

      zigInternal.line(`if (!@hasDecl(import_${namespaceVar}, ${str(vari.impl)}))`);
      zigInternal.line(
        `    @compileError(${str(`Missing binding declaration "${vari.impl}" in "${path.basename(filename)}"`)});`,
      );

      switch (returnStrategy.type) {
        case "jsvalue":
          zigInternal.add(`return JSC.toJSHostValue(${globalObjectArg}, `);
          break;
        case "basic-out-param":
          zigInternal.add(`out.* = @as(bun.JSError!${returnStrategy.abiType}, `);
          break;
      }

      zigInternal.line(`${zid("import_" + namespaceVar)}.${vari.impl}(`);
      zigInternal.indent();
      for (const arg of vari.args) {
        const argName = arg.zigMappedName!;

        if (arg.type.isVirtualArgument()) {
          switch (arg.type.kind) {
            case "zigVirtualMachine":
              zigInternal.line(`${argName}.bunVM(),`);
              break;
            case "globalObject":
              zigInternal.line(`${argName},`);
              break;
            default:
              throw new Error("unexpected");
          }
          continue;
        }

        const strategy = arg.loweringStrategy!;
        switch (strategy.type) {
          case "c-abi-pointer":
            zigInternal.line(`${argName}.*,`);
            break;
          case "c-abi-value":
            zigInternal.line(`${argName},`);
            break;
          case "uses-communication-buffer":
            const prefix = `buf.${snake(arg.name)}`;
            const type = arg.type;
            const isNullable = (type.flags.optional && !("default" in type.flags)) || type.flags.nullable;
            if (isNullable) emitNullableZigDecoder(zigInternal, prefix, type, strategy.children);
            else emitComplexZigDecoder(zigInternal, prefix, type, strategy.children);
            zigInternal.line(`,`);
            break;
          default:
            throw new Error(`TODO: zig dispatch function for ${inspect(strategy satisfies never)}`);
        }
      }
      zigInternal.dedent();
      switch (returnStrategy.type) {
        case "jsvalue":
          zigInternal.line(`));`);
          break;
        case "basic-out-param":
          zigInternal.line(`)) catch |err| switch (err) {`);
          zigInternal.line(`    error.JSError => return false,`);
          zigInternal.line(`    error.OutOfMemory => ${globalObjectArg}.throwOutOfMemory() catch return false,`);
          zigInternal.line(`};`);
          zigInternal.line(`return true;`);
          break;
      }
      zigInternal.dedent();
      zigInternal.line(`}`);
      variNum += 1;
    }
  }
  if (functions.length > 0) {
    zig.line();
  }
  for (const fn of functions) {
    // Wrapper to init JSValue
    const wrapperName = zid("create" + cap(fn.name) + "Callback");
    const minArgCount = fn.variants.reduce((acc, vari) => Math.min(acc, vari.args.length), Number.MAX_SAFE_INTEGER);
    zig.line(`pub fn ${wrapperName}(global: *JSC.JSGlobalObject) JSC.JSValue {`);
    zig.line(
      `    return JSC.NewRuntimeFunction(global, JSC.ZigString.static(${str(fn.name)}), ${minArgCount}, js${cap(fn.name)}, false, false, null);`,
    );
    zig.line(`}`);
  }

  if (typedefs.length > 0) {
    zig.line();
  }
  for (const td of typedefs) {
    emitZigStruct(td.type);
  }

  zig.dedent();
  zig.line(`};`);
  zig.line();
}

zigInternal.dedent();
zigInternal.line("};");
zigInternal.line();
zigInternal.line("comptime {");
zigInternal.line(`    if (bun.Environment.export_cpp_apis) {`);
zigInternal.line("        for (@typeInfo(binding_internals).Struct.decls) |decl| {");
zigInternal.line("            _ = &@field(binding_internals, decl.name);");
zigInternal.line("        }");
zigInternal.line("    }");
zigInternal.line("}");

writeIfNotChanged(
  path.join(codegenRoot, "GeneratedBindings.cpp"),
  [...headers].map(name => `#include ${str(name)}\n`).join("") + "\n" + cppInternal.buffer + "\n" + cpp.buffer,
);
writeIfNotChanged(path.join(src, "bun.js/bindings/GeneratedBindings.zig"), zig.buffer + zigInternal.buffer);

// Headers
for (const [filename, { functions, typedefs }] of files) {
  const namespaceVar = fileMap.get(filename)!;
  const header = new CodeWriter();
  header.line("#pragma once");
  header.line();
  header.line(`#include "root.h"`);

  header.line(`namespace {`);
  header.line();
  for (const fn of functions) {
    const externName = extJsFunction(namespaceVar, fn.name);
    header.line(`extern "C" SYSV_ABI JSC::EncodedJSValue ${externName}(JSC::JSGlobalObject*, JSC::CallFrame*);`);
  }
  header.line();
  header.line(`} // namespace`);

  header.line(`namespace Generated {`);
  header.line();
  header.line(`namespace ${namespaceVar} {`);
  header.line();
  for (const fn of functions) {
    const externName = extJsFunction(namespaceVar, fn.name);
    header.line(`const auto& js${cap(fn.name)} = ${externName};`);
  }
  header.line();
  header.line(`} // namespace ${namespaceVar}`);
  header.line();
  header.line(`} // namespace Generated`);
  header.line();

  writeIfNotChanged(path.join(codegenRoot, `Generated${namespaceVar}.h`), header.buffer);
}
