// The binding generator to rule them all.
// Converts binding definition files (.bind.ts) into C++ and Zig code.
//
// Generated bindings are available in `bun.generated.<basename>.*` in Zig,
// or `Generated::<basename>::*` in C++ from including `Generated<basename>.h`.
import assert from "node:assert";
import fs from "node:fs";
import * as path from "node:path";
import {
  ArgStrategyChildItem,
  CodeWriter,
  Func,
  NodeValidator,
  Struct,
  TypeImpl,
  alignForward,
  cAbiIntegerLimits,
  cAbiTypeName,
  cap,
  extDispatchVariant,
  extInternalDispatchVariant,
  extJsFunction,
  files,
  inspect,
  isFunc,
  pascal,
  snake,
  src,
  str,
  typeHashToNamespace,
  typeHashToReachableType,
  zid,
  type CAbiType,
  type DictionaryField,
  type ReturnStrategy,
  type TypeKind,
  type Variant,
} from "./bindgen-lib-internal";
import { argParse, readdirRecursiveWithExclusionsAndExtensionsSync, writeIfNotChanged } from "./helpers";

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
    const isNullable = arg.type.flags.optional && !("default" in arg.type.flags);
    const abiType = !isNullable && arg.type.canDirectlyMapToCAbi();
    if (abiType) {
      arg.loweringStrategy = {
        // This does not work in release builds, possibly due to a Zig 0.13 bug
        // regarding by-value extern structs in C functions.
        // type: cAbiTypeInfo(abiType)[0] > 8 ? "c-abi-pointer" : "c-abi-value",
        // Always pass an argument by-pointer for now.
        type: abiType === "*anyopaque" || abiType === "*JSGlobalObject" ? "c-abi-value" : "c-abi-pointer",
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
    if (vari.ret.kind === "undefined") {
      vari.returnStrategy = { type: "void" };
      break return_strategy;
    }
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
  assert(type.flags.optional && !("default" in type.flags));
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

  switch (type.kind) {
    default:
      throw new Error(`TODO: resolveComplexArgumentStrategy for ${type.kind}`);
  }
}

function emitCppCallToVariant(name: string, variant: Variant, dispatchFunctionName: string) {
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
    if (type.isIgnoredUndefinedType()) {
      i += 1;
      continue;
    }

    const exceptionContext: ExceptionContext = {
      type: "argument",
      argumentIndex: i,
      name: arg.name,
      functionName: name,
    };

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
    const isOptionalToUser = type.flags.optional || "default" in type.flags;
    /** If the final representation may include null */
    const isNullable = type.flags.optional && !("default" in type.flags);

    if (isOptionalToUser) {
      if (needDeclare) {
        addHeaderForType(type);
        cpp.line(`${type.cppName()} ${storageLocation};`);
      }
      const isUndefinedOrNull = type.flags.nonNull ? "isUndefined" : "isUndefinedOrNull";
      if (isNullable) {
        assert(strategy.type === "uses-communication-buffer");
        cpp.line(`if ((${storageLocation}Set = !${jsValueRef}.${isUndefinedOrNull}())) {`);
        storageLocation = `${storageLocation}Value`;
      } else {
        cpp.line(`if (!${jsValueRef}.${isUndefinedOrNull}()) {`);
      }
      cpp.indent();
      emitConvertValue(storageLocation, arg.type, jsValueRef, exceptionContext, "assign");
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
      emitConvertValue(storageLocation, arg.type, jsValueRef, exceptionContext, needDeclare ? "declare" : "assign");
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
    case "void":
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
    if (arg.type.isIgnoredUndefinedType()) continue;

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
    case "void":
      cpp.dedent();
      cpp.line(")) {");
      cpp.line(`    return {};`);
      cpp.line("}");
      cpp.line("return JSC::JSValue::encode(JSC::jsUndefined());");
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
      if (simpleType) {
        cpp.line(`return JSC::JSValue::encode(WebCore::toJS<${simpleType}>(*global, out));`);
        break;
      }
      switch (variant.ret.kind) {
        case "UTF8String":
          throw new Error("Memory lifetime is ambiguous when returning UTF8String");
        case "DOMString":
        case "USVString":
        case "ByteString":
          cpp.line(
            `return JSC::JSValue::encode(WebCore::toJS<WebCore::IDL${variant.ret.kind}>(*global, out.toWTFString()));`,
          );
          break;
      }
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
  if (!entry) {
    switch (type.kind) {
      case "f64":
        entry = type.flags.finite //
          ? "WebCore::IDLDouble"
          : "WebCore::IDLUnrestrictedDouble";
        break;
      case "stringEnum":
        type.lowersToNamedType;
        // const cType = cAbiTypeForEnum(type.data.length);
        // entry = map[cType as IntegerTypeKind]!;
        entry = `WebCore::IDLEnumeration<${type.cppClassName()}>`;
        break;
      default:
        return;
    }
  }

  if (type.flags.range) {
    const { range, nodeValidator } = type.flags;
    if ((range[0] === "enforce" && range[1] !== "abi") || nodeValidator) {
      if (nodeValidator) assert(nodeValidator === NodeValidator.validateInteger); // TODO?

      const [abiMin, abiMax] = cAbiIntegerLimits(type.kind as CAbiType);
      let [_, min, max] = range as [string, bigint | number | "abi", bigint | number | "abi"];
      if (min === "abi") min = abiMin;
      if (max === "abi") max = abiMax;

      headers.add("BindgenCustomEnforceRange.h");
      entry = `Bun::BindgenCustomEnforceRange<${cAbiTypeName(type.kind as CAbiType)}, ${min}, ${max}, Bun::BindgenCustomEnforceRangeKind::${
        nodeValidator ? "Node" : "Web"
      }>`;
    } else {
      const rangeAdaptor = {
        "clamp": "WebCore::IDLClampAdaptor",
        "enforce": "WebCore::IDLEnforceRangeAdaptor",
      }[range[0]];
      assert(rangeAdaptor);
      entry = `${rangeAdaptor}<${entry}>`;
    }
  }

  return entry;
}

type ExceptionContext =
  | { type: "none" }
  | { type: "argument"; argumentIndex: number; name: string; functionName: string };

function emitConvertValue(
  storageLocation: string,
  type: TypeImpl,
  jsValueRef: string,
  exceptionContext: ExceptionContext,
  decl: "declare" | "assign",
) {
  if (decl === "declare") {
    addHeaderForType(type);
  }

  const simpleType = getSimpleIdlType(type);
  if (simpleType) {
    const cAbiType = type.canDirectlyMapToCAbi();
    assert(cAbiType);
    let exceptionHandler: ExceptionHandler | undefined;
    switch (exceptionContext.type) {
      case "none":
        break;
      case "argument":
        exceptionHandler = getArgumentExceptionHandler(
          type,
          exceptionContext.argumentIndex,
          exceptionContext.name,
          exceptionContext.functionName,
        );
    }

    switch (type.kind) {
    }

    if (decl === "declare") {
      cpp.add(`${type.cppName()} `);
    }

    let exceptionHandlerText = exceptionHandler ? `, ${exceptionHandler.params} { ${exceptionHandler.body} }` : "";
    cpp.line(`${storageLocation} = WebCore::convert<${simpleType}>(*global, ${jsValueRef}${exceptionHandlerText});`);

    if (type.flags.range && type.flags.range[0] === "clamp" && type.flags.range[1] !== "abi") {
      emitRangeModifierCheck(cAbiType, storageLocation, type.flags.range);
    }

    cpp.line(`RETURN_IF_EXCEPTION(throwScope, {});`);
  } else {
    switch (type.kind) {
      case "any": {
        if (decl === "declare") {
          cpp.add(`${type.cppName()} `);
        }
        cpp.line(`${storageLocation} = JSC::JSValue::encode(${jsValueRef});`);
        break;
      }
      case "USVString":
      case "DOMString":
      case "ByteString": {
        const temp = cpp.nextTemporaryName("wtfString");
        cpp.line(`WTF::String ${temp} = WebCore::convert<WebCore::IDL${type.kind}>(*global, ${jsValueRef});`);
        cpp.line(`RETURN_IF_EXCEPTION(throwScope, {});`);

        if (decl === "declare") {
          cpp.add(`${type.cppName()} `);
        }
        cpp.line(`${storageLocation} = Bun::toString(${temp});`);
        break;
      }
      case "UTF8String": {
        const temp = cpp.nextTemporaryName("wtfString");
        cpp.line(`WTF::String ${temp} = WebCore::convert<WebCore::IDLDOMString>(*global, ${jsValueRef});`);
        cpp.line(`RETURN_IF_EXCEPTION(throwScope, {});`);

        if (decl === "declare") {
          cpp.add(`${type.cppName()} `);
        }
        cpp.line(`${storageLocation} = Bun::toString(${temp});`);
        break;
      }
      case "dictionary": {
        if (decl === "declare") {
          cpp.line(`${type.cppName()} ${storageLocation};`);
        }
        cpp.line(`auto did_convert = convert${type.cppInternalName()}(&${storageLocation}, global, ${jsValueRef});`);
        cpp.line(`RETURN_IF_EXCEPTION(throwScope, {});`);
        cpp.line(`if (!did_convert) return {};`);
        break;
      }
      default:
        throw new Error(`TODO: emitConvertValue for Type ${type.kind}`);
    }
  }
}

interface ExceptionHandler {
  /** @example "[](JSC::JSGlobalObject& global, ThrowScope& scope)" */
  params: string;
  /** @example "WebCore::throwTypeError(global, scope)" */
  body: string;
}

function getArgumentExceptionHandler(type: TypeImpl, argumentIndex: number, name: string, functionName: string) {
  const { nodeValidator } = type.flags;
  if (nodeValidator) {
    switch (nodeValidator) {
      case NodeValidator.validateInteger:
        headers.add("ErrorCode.h");
        return {
          params: `[]()`,
          body: `return ${str(name)}_s;`,
        };
      default:
        throw new Error(`TODO: implement exception thrower for node validator ${nodeValidator}`);
    }
  }
  switch (type.kind) {
    case "zigEnum":
    case "stringEnum": {
      return {
        params: `[](JSC::JSGlobalObject& global, JSC::ThrowScope& scope)`,
        body: `WebCore::throwArgumentMustBeEnumError(${[
          `global`,
          `scope`,
          `${argumentIndex}`,
          `${str(name)}_s`,
          `${str(type.name())}_s`,
          `${str(functionName)}_s`,
          `WebCore::expectedEnumerationValues<${type.cppClassName()}>()`,
        ].join(", ")});`,
      };
      break;
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
  } else {
    // Implemented in BindgenCustomEnforceRange
    throw new Error(`This should not be called for 'enforceRange' types.`);
  }
}

function addHeaderForType(type: TypeImpl) {
  if (type.lowersToNamedType() && type.ownerFile) {
    headers.add(`Generated${pascal(type.ownerFile)}.h`);
  }
}

function emitConvertDictionaryFunction(type: TypeImpl) {
  assert(type.kind === "dictionary");
  const fields = type.data as DictionaryField[];

  addHeaderForType(type);

  cpp.line(`// Internal dictionary parse for ${type.name()}`);
  cpp.line(
    `bool convert${type.cppInternalName()}(${type.cppName()}* result, JSC::JSGlobalObject* global, JSC::JSValue value) {`,
  );
  cpp.indent();

  cpp.line(`auto& vm = JSC::getVM(global);`);
  cpp.line(`auto throwScope = DECLARE_THROW_SCOPE(vm);`);
  cpp.line(`bool isNullOrUndefined = value.isUndefinedOrNull();`);
  cpp.line(`auto* object = isNullOrUndefined ? nullptr : value.getObject();`);
  cpp.line(`if (!isNullOrUndefined && !object) [[unlikely]] {`);
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
    headers.add("ObjectBindings.h");
    cpp.line(
      `    propValue = Bun::getIfPropertyExistsPrototypePollutionMitigation(vm, global, object, JSC::Identifier::fromString(vm, ${str(key)}_s));`,
    );
    cpp.line(`    RETURN_IF_EXCEPTION(throwScope, false);`);
    cpp.line(`}`);
    cpp.line(`if (!propValue.isUndefined()) {`);
    cpp.indent();
    emitConvertValue(`result->${key}`, fieldType, "propValue", { type: "none" }, "assign");
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

  switch (type.kind) {
    case "zigEnum":
    case "stringEnum": {
      const signPrefix = "u";
      const tagType = `${signPrefix}${alignForward(type.data.length, 8)}`;
      zig.line(`enum(${tagType}) {`);
      zig.indent();
      for (const value of type.data) {
        zig.line(`${snake(value)},`);
      }
      zig.dedent();
      zig.line("};");
      return;
    }
  }

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

function emitCppStructHeader(w: CodeWriter, type: TypeImpl) {
  if (type.kind === "zigEnum" || type.kind === "stringEnum") {
    emitCppEnumHeader(w, type);
    return;
  }

  const externLayout = type.canDirectlyMapToCAbi();
  if (externLayout) {
    if (typeof externLayout === "string") {
      w.line(`typedef ${externLayout} ${type.name()};`);
      console.warn("should this really be done lol", type);
    } else {
      externLayout.emitCpp(w, type.name());
      w.line();
    }
    return;
  }

  switch (type.kind) {
    default: {
      throw new Error(`TODO: emitZigStruct for Type ${type.kind}`);
    }
  }
}

function emitCppEnumHeader(w: CodeWriter, type: TypeImpl) {
  assert(type.kind === "zigEnum" || type.kind === "stringEnum");

  assert(type.kind === "stringEnum"); // TODO
  assert(type.data.length > 0);
  const signPrefix = "u";
  const intBits = alignForward(type.data.length, 8);
  const tagType = `${signPrefix}int${intBits}_t`;
  w.line(`enum class ${type.name()} : ${tagType} {`);
  for (const value of type.data) {
    w.line(`    ${pascal(value)},`);
  }
  w.line(`};`);
  w.line();
}

// This function assumes in the WebCore namespace
function emitConvertEnumFunction(w: CodeWriter, type: TypeImpl) {
  assert(type.kind === "zigEnum" || type.kind === "stringEnum");
  assert(type.kind === "stringEnum"); // TODO
  assert(type.data.length > 0);

  const name = "Generated::" + type.cppName();
  headers.add("JavaScriptCore/JSCInlines.h");
  headers.add("JavaScriptCore/JSString.h");
  headers.add("wtf/NeverDestroyed.h");
  headers.add("wtf/SortedArrayMap.h");

  w.line(`String convertEnumerationToString(${name} enumerationValue) {`);
  w.indent();
  w.line(`    static const NeverDestroyed<String> values[] = {`);
  w.indent();
  for (const value of type.data) {
    w.line(`        MAKE_STATIC_STRING_IMPL(${str(value)}),`);
  }
  w.dedent();
  w.line(`    };`);
  w.line(`    return values[static_cast<size_t>(enumerationValue)];`);
  w.dedent();
  w.line(`}`);
  w.line();
  w.line(`template<> JSString* convertEnumerationToJS(JSC::JSGlobalObject& global, ${name} enumerationValue) {`);
  w.line(`    return jsStringWithCache(global.vm(), convertEnumerationToString(enumerationValue));`);
  w.line(`}`);
  w.line();
  w.line(`template<> std::optional<${name}> parseEnumerationFromString<${name}>(const String& stringValue)`);
  w.line(`{`);
  w.line(
    `    static constexpr SortedArrayMap enumerationMapping { std::to_array<std::pair<ComparableASCIILiteral, ${name}>>({`,
  );
  for (const value of type.data) {
    w.line(`        { ${str(value)}_s, ${name}::${pascal(value)} },`);
  }
  w.line(`    }) };`);
  w.line(`    if (auto* enumerationValue = enumerationMapping.tryGet(stringValue); enumerationValue) [[likely]]`);
  w.line(`        return *enumerationValue;`);
  w.line(`    return std::nullopt;`);
  w.line(`}`);
  w.line();
  w.line(
    `template<> std::optional<${name}> parseEnumeration<${name}>(JSGlobalObject& lexicalGlobalObject, JSValue value)`,
  );
  w.line(`{`);
  w.line(`    return parseEnumerationFromString<${name}>(value.toWTFString(&lexicalGlobalObject));`);
  w.line(`}`);
  w.line();
  w.line(`template<> ASCIILiteral expectedEnumerationValues<${name}>()`);
  w.line(`{`);
  w.line(`    return ${str(type.data.map(value => `${str(value)}`).join(", "))}_s;`);
  w.line(`}`);
  w.line();
}

function zigTypeName(type: TypeImpl): string {
  let name = zigTypeNameInner(type);
  if (type.flags.optional) {
    name = "?" + name;
  }
  return name;
}

function zigTypeNameInner(type: TypeImpl): string {
  if (type.lowersToNamedType()) {
    const namespace = typeHashToNamespace.get(type.hash());
    return namespace ? `${namespace}.${type.name()}` : type.name();
  }
  switch (type.kind) {
    case "USVString":
    case "DOMString":
    case "ByteString":
    case "UTF8String":
      return "bun.String";
    case "boolean":
      return "bool";
    case "usize":
      return "usize";
    case "globalObject":
    case "zigVirtualMachine":
      return "*jsc.JSGlobalObject";
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
    case "void":
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
    case "void":
      return "bool"; // true=success, false=exception
    case "jsvalue":
      return "jsc.JSValue";
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

type DistinguishablePrimitive = "undefined" | "string" | "number" | "boolean" | "object";
type DistinguishStrategy = DistinguishablePrimitive;

function typeCanDistinguish(t: TypeImpl[]) {
  const seen: Record<DistinguishablePrimitive, boolean> = {
    undefined: false,
    string: false,
    number: false,
    boolean: false,
    object: false,
  };
  let strategies: DistinguishStrategy[] = [];

  for (const type of t) {
    let primitive: DistinguishablePrimitive | null = null;
    if (type.kind === "undefined") {
      primitive = "undefined";
    } else if (type.isStringType()) {
      primitive = "string";
    } else if (type.isNumberType()) {
      primitive = "number";
    } else if (type.kind === "boolean") {
      primitive = "boolean";
    } else if (type.isObjectType()) {
      primitive = "object";
    }
    if (primitive) {
      if (seen[primitive]) {
        return null;
      }
      seen[primitive] = true;
      strategies.push(primitive);
      continue;
    }
    return null; // TODO:
  }

  return strategies;
}

/** This is an arbitrary classifier to allow consistent sorting for distinguishing arguments */
function typeDistinguishmentWeight(type: TypeImpl): number {
  if (type.kind === "undefined") {
    return 100;
  }

  if (type.isObjectType()) {
    return 10;
  }

  if (type.isStringType()) {
    return 5;
  }

  if (type.isNumberType()) {
    return 3;
  }

  if (type.kind === "boolean") {
    return -1;
  }

  return 0;
}

function getDistinguishCode(strategy: DistinguishStrategy, type: TypeImpl, value: string) {
  switch (strategy) {
    case "string":
      return { condition: `${value}.isString()`, canThrow: false };
    case "number":
      return { condition: `${value}.isNumber()`, canThrow: false };
    case "boolean":
      return { condition: `${value}.isBoolean()`, canThrow: false };
    case "object":
      return { condition: `${value}.isObject()`, canThrow: false };
    case "undefined":
      return { condition: `${value}.isUndefined()`, canThrow: false };
    default:
      throw new Error(`TODO: getDistinguishCode for ${strategy}`);
  }
}

/** The variation selector implementation decides which variation dispatch to call. */
function emitCppVariationSelector(fn: Func, namespaceVar: string) {
  let minRequiredArgs = Infinity;
  let maxArgs = 0;

  const variationsByArgumentCount = new Map<number, Variant[]>();

  const pushToList = (argCount: number, vari: Variant) => {
    assert(typeof argCount === "number");
    let list = variationsByArgumentCount.get(argCount);
    if (!list) {
      list = [];
      variationsByArgumentCount.set(argCount, list);
    }
    list.push(vari);
  };

  for (const vari of fn.variants) {
    const vmra = vari.minRequiredArgs;
    minRequiredArgs = Math.min(minRequiredArgs, vmra);
    maxArgs = Math.max(maxArgs, vari.args.length);
    const allArgCount = vari.args.filter(arg => !arg.type.isVirtualArgument()).length;
    pushToList(vmra, vari);
    if (allArgCount != vmra) {
      pushToList(allArgCount, vari);
    }
  }

  cpp.line(`auto& vm = JSC::getVM(global);`);
  cpp.line(`auto throwScope = DECLARE_THROW_SCOPE(vm);`);
  if (minRequiredArgs > 0) {
    cpp.line(`size_t argumentCount = std::min<size_t>(callFrame->argumentCount(), ${maxArgs});`);
    cpp.line(`if (argumentCount < ${minRequiredArgs}) {`);
    cpp.line(`    return JSC::throwVMError(global, throwScope, createNotEnoughArgumentsError(global));`);
    cpp.line(`}`);
  }

  const sorted = [...variationsByArgumentCount.entries()]
    .map(([key, value]) => ({ argCount: key, variants: value }))
    .sort((a, b) => b.argCount - a.argCount);
  let argCountI = 0;
  for (const { argCount, variants } of sorted) {
    argCountI++;
    const checkArgCount = argCountI < sorted.length && argCount !== minRequiredArgs;
    if (checkArgCount) {
      cpp.line(`if (argumentCount >= ${argCount}) {`);
      cpp.indent();
    }

    if (variants.length === 1) {
      cpp.line(
        `RELEASE_AND_RETURN(throwScope, ${extInternalDispatchVariant(namespaceVar, fn.name, variants[0].suffix)}(global, callFrame));`,
      );
    } else {
      let argIndex = 0;
      let strategies: DistinguishStrategy[] | null = null;
      while (argIndex < argCount) {
        strategies = typeCanDistinguish(
          variants.map(v => v.args.filter(v => !v.type.isVirtualArgument())[argIndex].type),
        );
        if (strategies) {
          break;
        }
        argIndex++;
      }
      if (!strategies) {
        const err = new Error(
          `\x1b[0mVariations with ${argCount} required arguments must have at least one argument that can distinguish between them.\n` +
            `Variations:\n${variants.map(v => `    ${inspect(v.args.filter(a => !a.type.isVirtualArgument()).map(x => x.type))}`).join("\n")}`,
        );
        err.stack = `Error: ${err.message}\n${fn.snapshot}`;
        throw err;
      }

      const getArgument = minRequiredArgs > 0 ? "uncheckedArgument" : "argument";
      cpp.line(`JSC::JSValue distinguishingValue = callFrame->${getArgument}(${argIndex});`);
      const sortedVariants = variants
        .map((v, i) => ({
          variant: v,
          type: v.args.filter(a => !a.type.isVirtualArgument())[argIndex].type,
          strategy: strategies[i],
        }))
        .sort((a, b) => typeDistinguishmentWeight(a.type) - typeDistinguishmentWeight(b.type));
      for (const { variant: v, strategy: s } of sortedVariants) {
        const arg = v.args[argIndex];
        const { condition, canThrow } = getDistinguishCode(s, arg.type, "distinguishingValue");
        cpp.line(`if (${condition}) {`);
        cpp.indent();
        cpp.line(
          `RELEASE_AND_RETURN(throwScope, ${extInternalDispatchVariant(namespaceVar, fn.name, v.suffix)}(global, callFrame));`,
        );
        cpp.dedent();
        cpp.line(`}`);
        if (canThrow) {
          cpp.line(`RETURN_IF_EXCEPTION(throwScope, {});`);
        }
      }
    }

    if (checkArgCount) {
      cpp.dedent();
      cpp.line(`}`);
    }
  }
}

// BEGIN MAIN CODE GENERATION

// Search for all .bind.ts files
const unsortedFiles = readdirRecursiveWithExclusionsAndExtensionsSync(src, ["node_modules", ".git"], [".bind.ts"]);

// Sort for deterministic output
for (const fileName of [...unsortedFiles].sort()) {
  const zigFile = path.relative(src, fileName.replace(/\.bind\.ts$/, ".zig"));
  const zigFilePath = path.join(src, zigFile);
  let file = files.get(zigFile);
  if (!fs.existsSync(zigFilePath)) {
    // It would be nice if this would generate the file with the correct boilerplate
    const bindName = path.basename(fileName);
    throw new Error(
      `${bindName} is missing a corresponding Zig file at ${zigFile}. Please create it and make sure it matches signatures in ${bindName}.`,
    );
  }
  if (!file) {
    file = { functions: [], typedefs: [] };
    files.set(zigFile, file);
  }

  const exports = import.meta.require(fileName);

  // Mark all exported TypeImpl as reachable
  for (let [key, value] of Object.entries(exports)) {
    if (value == null || typeof value !== "object") continue;

    if (value instanceof TypeImpl) {
      value.assignName(key);
      value.markReachable();
      file.typedefs.push({ name: key, type: value });
    }

    if (value[isFunc]) {
      const func = value as Func;
      func.name = key;
    }
  }

  for (const fn of file.functions) {
    if (fn.name === "") {
      const err = new Error(`This function definition needs to be exported`);
      err.stack = `Error: ${err.message}\n${fn.snapshot}`;
      throw err;
    }
  }
}

const zig = new CodeWriter();
const zigInternal = new CodeWriter();
// TODO: split each *.bind file into a separate .cpp file
const cpp = new CodeWriter();
const cppInternal = new CodeWriter();
const headers = new Set<string>();

zig.line('const bun = @import("bun");');
zig.line("const jsc = bun.jsc;");
zig.line("const JSHostFunctionType = jsc.JSHostFn;\n");

zigInternal.line("const binding_internals = struct {");
zigInternal.indent();

cpp.line("namespace Generated {");
cpp.line();

cppInternal.line('// These "Arguments" definitions are for communication between C++ and Zig.');
cppInternal.line('// Field layout depends on implementation details in "bindgen.ts", and');
cppInternal.line("// is not intended for usage outside generated binding code.");

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
  const basename = path.basename(filename, ".zig");
  let varName = basename;
  if (fileNames.has(varName)) {
    throw new Error(`File name collision: ${basename}.zig`);
  }
  fileNames.add(varName);
  fileMap.set(filename, varName);

  if (functions.length === 0) continue;

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

let needsWebCore = false;
for (const type of typeHashToReachableType.values()) {
  // Emit convert functions for compound types in the Generated namespace
  switch (type.kind) {
    case "dictionary":
      emitConvertDictionaryFunction(type);
      break;
    case "stringEnum":
    case "zigEnum":
      needsWebCore = true;
      break;
  }
}

for (const [filename, { functions, typedefs }] of files) {
  const namespaceVar = fileMap.get(filename)!;
  assert(namespaceVar, `namespaceVar not found for ${filename}, ${inspect(fileMap)}`);
  zigInternal.line(`const import_${namespaceVar} = @import(${str(path.relative(src + "/bun.js", filename))});`);

  zig.line(`/// Generated for "src/${filename}"`);
  zig.line(`pub const ${namespaceVar} = struct {`);
  zig.indent();

  for (const fn of functions) {
    cpp.line(`// Dispatch for \"fn ${zid(fn.name)}(...)\" in \"src/${fn.zigFile}\"`);
    const externName = extJsFunction(namespaceVar, fn.name);

    // C++ forward declarations
    let variNum = 1;
    for (const vari of fn.variants) {
      resolveVariantStrategies(
        vari,
        `${pascal(namespaceVar)}${pascal(fn.name)}Arguments${fn.variants.length > 1 ? variNum : ""}`,
      );
      const dispatchName = extDispatchVariant(namespaceVar, fn.name, variNum);
      const internalDispatchName = extInternalDispatchVariant(namespaceVar, fn.name, variNum);

      const args: string[] = [];

      if (vari.globalObjectArg === "hidden") {
        args.push("JSC::JSGlobalObject*");
      }
      for (const arg of vari.args) {
        if (arg.type.isIgnoredUndefinedType()) continue;
        const strategy = arg.loweringStrategy!;
        switch (strategy.type) {
          case "c-abi-pointer":
            addHeaderForType(arg.type);
            args.push(`const ${arg.type.cppName()}*`);
            break;
          case "c-abi-value":
            addHeaderForType(arg.type);
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

      if (fn.variants.length > 1) {
        // Emit separate variant dispatch functions
        cpp.line(
          `extern "C" SYSV_ABI JSC::EncodedJSValue ${internalDispatchName}(JSC::JSGlobalObject* global, JSC::CallFrame* callFrame)`,
        );
        cpp.line(`{`);
        cpp.indent();
        cpp.resetTemporaries();
        emitCppCallToVariant(fn.name, vari, dispatchName);
        cpp.dedent();
        cpp.line(`}`);
      }
      variNum += 1;
    }

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
    cpp.resetTemporaries();

    if (fn.variants.length === 1) {
      emitCppCallToVariant(fn.name, fn.variants[0], extDispatchVariant(namespaceVar, fn.name, 1));
    } else {
      emitCppVariationSelector(fn, namespaceVar);
    }

    cpp.dedent();
    cpp.line(`}`);
    cpp.line();

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
        args.push(`global: *jsc.JSGlobalObject`);
        globalObjectArg = "global";
      }
      let argNum = 0;
      for (const arg of vari.args) {
        if (arg.type.isIgnoredUndefinedType()) continue;
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

      zigInternal.line(
        `if (!@hasDecl(import_${namespaceVar}${fn.zigPrefix.length > 0 ? "." + fn.zigPrefix.slice(0, -1) : ""}, ${str(fn.name + vari.suffix)}))`,
      );
      zigInternal.line(
        `    @compileError(${str(`Missing binding declaration "${fn.zigPrefix}${fn.name + vari.suffix}" in "${path.basename(filename)}"`)});`,
      );

      for (const arg of vari.args) {
        if (arg.type.kind === "UTF8String") {
          zigInternal.line(`const ${arg.zigMappedName}_utf8 = ${arg.zigMappedName}.toUTF8(bun.default_allocator);`);
          zigInternal.line(`defer ${arg.zigMappedName}_utf8.deinit();`);
        }
      }

      switch (returnStrategy.type) {
        case "jsvalue":
          zigInternal.add(`return jsc.toJSHostCall(${globalObjectArg}, @src(), `);
          break;
        case "basic-out-param":
          zigInternal.add(`out.* = @as(bun.JSError!${returnStrategy.abiType}, `);
          break;
        case "void":
          zigInternal.add(`@as(bun.JSError!void, `);
          break;
      }

      zigInternal.add(`${zid("import_" + namespaceVar)}.${fn.zigPrefix}${fn.name + vari.suffix}`);
      if (returnStrategy.type === "jsvalue") {
        zigInternal.line(", .{");
      } else {
        zigInternal.line("(");
      }
      zigInternal.indent();
      for (const arg of vari.args) {
        const argName = arg.zigMappedName!;

        if (arg.type.isIgnoredUndefinedType()) continue;

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
            if (arg.type.kind === "UTF8String") {
              zigInternal.line(`${argName}_utf8.slice(),`);
              break;
            }
            zigInternal.line(`${argName}.*,`);
            break;
          case "c-abi-value":
            zigInternal.line(`${argName},`);
            break;
          case "uses-communication-buffer":
            const prefix = `buf.${snake(arg.name)}`;
            const type = arg.type;
            const isNullable = type.flags.optional && !("default" in type.flags);
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
          zigInternal.line(`});`);
          break;
        case "basic-out-param":
        case "void":
          zigInternal.line(`)) catch |err| switch (err) {`);
          zigInternal.line(`    error.JSError => return false,`);
          zigInternal.line(`    error.OutOfMemory => ${globalObjectArg}.throwOutOfMemory() catch return false,`);
          zigInternal.line(`    error.JSTerminated => return false,`);
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
    zig.line(`pub fn ${wrapperName}(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {`);
    zig.line(
      `    return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static(${str(fn.name)}), ${minArgCount}, js${cap(fn.name)}, false, null);`,
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

cpp.line("} // namespace Generated");
cpp.line();
if (needsWebCore) {
  cpp.line(`namespace WebCore {`);
  cpp.line();
  for (const [type, reachableType] of typeHashToReachableType) {
    switch (reachableType.kind) {
      case "zigEnum":
      case "stringEnum":
        emitConvertEnumFunction(cpp, reachableType);
        break;
    }
  }
  cpp.line(`} // namespace WebCore`);
  cpp.line();
}

zigInternal.dedent();
zigInternal.line("};");
zigInternal.line();
zigInternal.line("comptime {");
zigInternal.line(`    if (bun.Environment.export_cpp_apis) {`);
zigInternal.line('        for (@typeInfo(binding_internals).@"struct".decls) |decl| {');
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
  const headerIncludes = new Set<string>();
  let needsWebCoreNamespace = false;

  headerIncludes.add("root.h");

  header.line(`namespace {`);
  header.line();
  for (const fn of functions) {
    const externName = extJsFunction(namespaceVar, fn.name);
    header.line(`extern "C" SYSV_ABI JSC::EncodedJSValue ${externName}(JSC::JSGlobalObject*, JSC::CallFrame*);`);
  }
  header.line();
  header.line(`} // namespace`);
  header.line();

  header.line(`namespace Generated {`);
  header.line();
  header.line(`/// Generated binding code for src/${filename}`);
  header.line(`namespace ${namespaceVar} {`);
  header.line();
  for (const td of typedefs) {
    emitCppStructHeader(header, td.type);

    switch (td.type.kind) {
      case "zigEnum":
      case "stringEnum":
      case "dictionary":
        needsWebCoreNamespace = true;
        break;
    }
  }
  for (const fn of functions) {
    const externName = extJsFunction(namespaceVar, fn.name);
    header.line(`constexpr auto* js${cap(fn.name)} = &${externName};`);
  }
  header.line();
  header.line(`} // namespace ${namespaceVar}`);
  header.line();
  header.line(`} // namespace Generated`);
  header.line();

  if (needsWebCoreNamespace) {
    header.line(`namespace WebCore {`);
    header.line();
    for (const td of typedefs) {
      switch (td.type.kind) {
        case "zigEnum":
        case "stringEnum":
          headerIncludes.add("JSDOMConvertEnumeration.h");
          const basename = td.type.name();
          const name = `Generated::${namespaceVar}::${basename}`;
          header.line(`// Implement WebCore::IDLEnumeration trait for ${basename}`);
          header.line(`String convertEnumerationToString(${name});`);
          header.line(`template<> JSC::JSString* convertEnumerationToJS(JSC::JSGlobalObject&, ${name});`);
          header.line(`template<> std::optional<${name}> parseEnumerationFromString<${name}>(const String&);`);
          header.line(
            `template<> std::optional<${name}> parseEnumeration<${name}>(JSC::JSGlobalObject&, JSC::JSValue);`,
          );
          header.line(`template<> ASCIILiteral expectedEnumerationValues<${name}>();`);
          header.line();
          break;
        case "dictionary":
          // TODO:
          // header.line(`// Implement WebCore::IDLDictionary trait for ${td.type.name()}`);
          // header.line(
          //   "template<> FetchRequestInit convertDictionary<FetchRequestInit>(JSC::JSGlobalObject&, JSC::JSValue);",
          // );
          // header.line();
          break;
        default:
      }
    }
    header.line(`} // namespace WebCore`);
  }

  header.buffer =
    "#pragma once\n" + [...headerIncludes].map(name => `#include ${str(name)}\n`).join("") + "\n" + header.buffer;

  writeIfNotChanged(path.join(codegenRoot, `Generated${pascal(namespaceVar)}.h`), header.buffer);
}
