import { GeneratorError } from "./declarations.ts";
import { bitsOfDouble } from "./double-bits.ts";
import {
  emitSlice,
  fileHeader,
  formatBuiltinId,
  formatBuiltinName,
  formatLinkTimeConstant,
  formatRuntimeFunction,
  formatWellKnownSymbol,
  sortStrictly,
} from "./emit-rust-ids.ts";
import type {
  ModelIntrinsic,
  ModelIntrinsicMeaning,
  ModelNativeBinding,
  ModelPrefixedGlobal,
  TableModel,
} from "./model.ts";
import { intrinsicPositions, nativeCallKinds, type NativeCallKind } from "./vocabulary.ts";

const maxUint32 = 2 ** 32 - 1;

function emitOrderChecks(rustType: string, variants: readonly string[]): string {
  return variants
    .map((variant, position) => `const _: () = assert!(${rustType}::${variant} as usize == ${position});\n`)
    .join("");
}

export function emitRustSyntax(model: TableModel): string {
  const { intrinsics, prefixedGlobals, nativeBindings } = model.syntax;
  return [
    fileHeader,
    emitOrderChecks("IntrinsicPosition", intrinsicPositions),
    emitOrderChecks("NativeCallKind", nativeCallKinds),
    emitSlice("static INTRINSICS: &[(BuiltinName, IntrinsicPosition, Intrinsic)]", formatIntrinsics(intrinsics)),
    emitSlice("static PREFIXED_GLOBALS: &[(BuiltinName, Intrinsic)]", formatPrefixedGlobals(prefixedGlobals)),
    emitSlice(
      "static NATIVE_BINDINGS: &[(NativeCallKind, BuiltinName, BuiltinName, Intrinsic)]",
      formatNativeBindings(nativeBindings),
    ),
  ].join("");
}

function formatIntrinsics(intrinsics: readonly ModelIntrinsic[]): string[] {
  const sorted = sortStrictly(
    intrinsics,
    (a, b) =>
      a.name.number - b.name.number || intrinsicPositions.indexOf(a.position) - intrinsicPositions.indexOf(b.position),
    ({ name, position }) => `$${name.text} has two intrinsics in position ${position}`,
  );
  return sorted.map(({ name, position, meaning }) => {
    return `(${formatBuiltinName(name.number)}, IntrinsicPosition::${position}, ${formatIntrinsic(meaning)})`;
  });
}

function formatPrefixedGlobals(globals: readonly ModelPrefixedGlobal[]): string[] {
  const sorted = sortStrictly(
    globals,
    (a, b) => a.name.number - b.name.number,
    ({ name }) => `the prefixed global ${name.text} is listed twice`,
  );
  return sorted.map(({ name, meaning }) => `(${formatBuiltinName(name.number)}, ${formatIntrinsic(meaning)})`);
}

function formatNativeBindings(bindings: readonly ModelNativeBinding[]): string[] {
  const sorted = sortStrictly(
    bindings,
    (a, b) =>
      nativeCallKinds.indexOf(a.kind) - nativeCallKinds.indexOf(b.kind) ||
      a.file.number - b.file.number ||
      a.symbol.number - b.symbol.number,
    ({ kind, file, symbol }) => `the native binding ${kind}(${file.text}, ${symbol.text}) is listed twice`,
  );
  return sorted.map(({ kind, file, symbol, builtin }) => {
    const key = [formatNativeCallKind(kind), formatBuiltinName(file.number), formatBuiltinName(symbol.number)];
    const meaning: ModelIntrinsicMeaning =
      builtin === null ? { intrinsic: "Undefined" } : { intrinsic: "NativeBinding", builtin };
    return `(${key.join(", ")}, ${formatIntrinsic(meaning)})`;
  });
}

function formatNativeCallKind(kind: NativeCallKind): string {
  return `NativeCallKind::${kind}`;
}

function formatInteger(value: number, minimum: number, maximum: number): string {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new GeneratorError(`${value} is not an integer from ${minimum} to ${maximum}`);
  }
  return String(value);
}

function formatDouble(value: number): string {
  return `f64::from_bits(0x${bitsOfDouble(value).toString(16).padStart(16, "0")})`;
}

function formatIntrinsic(meaning: ModelIntrinsicMeaning): string {
  switch (meaning.intrinsic) {
    case "Operation":
      return `Intrinsic::Operation(Opcode::${meaning.opcode})`;
    case "Conversion":
      return `Intrinsic::Conversion(Conversion::${meaning.conversion})`;
    case "Throw":
      return `Intrinsic::Throw(ErrorKind::${meaning.error})`;
    case "SymbolKey":
      return `Intrinsic::SymbolKey(${formatWellKnownSymbol(meaning.symbol)})`;
    case "HasJSType":
      return `Intrinsic::HasJSType { first: CheckedJSType::${meaning.first}, last: CheckedJSType::${meaning.last} }`;
    case "Builtin":
    case "Construct":
    case "NativeBinding":
      return `Intrinsic::${meaning.intrinsic}(${formatBuiltinId(meaning.builtin)})`;
    case "LinkTimeConstant":
      return `Intrinsic::LinkTimeConstant(${formatLinkTimeConstant(meaning.constant)})`;
    case "NativeCall":
      return `Intrinsic::NativeCall(${formatNativeCallKind(meaning.kind)})`;
    case "Int":
      return `Intrinsic::Int(${formatInteger(meaning.value, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)})`;
    case "Bool":
      return `Intrinsic::Bool(${meaning.value})`;
    case "Double":
      return `Intrinsic::Double(${formatDouble(meaning.value)})`;
    case "Call":
      return `Intrinsic::Call { is_never_inlined: ${meaning.isNeverInlined} }`;
    case "PutByValDirect":
    case "GetOwnProperty":
      return `Intrinsic::${meaning.intrinsic} { private_key: ${meaning.privateKey} }`;
    case "Directive":
      return `Intrinsic::Directive(DirectiveKind::${meaning.directive})`;
    case "PrependArgument": {
      const callee = formatBuiltinName(meaning.callee.number);
      const argument = formatInteger(meaning.argument, 0, maxUint32);
      return `Intrinsic::PrependArgument { callee: ${callee}, argument: ${argument} }`;
    }
    case "HasPromiseStatus":
      return `Intrinsic::HasPromiseStatus(PromiseStatus::${meaning.status})`;
    case "LinkedFunction":
      return `Intrinsic::LinkedFunction(${formatRuntimeFunction(meaning.function.id)})`;
    case "IfAbruptCloseIterator":
    case "IsNullish":
    case "IsObject":
    case "IsCallable":
    case "Undefined":
    case "Apply":
    case "ArrayPush":
    case "ArgumentCount":
    case "Argument":
    case "PrivateGlobal":
    case "ReplaceablePrivateGlobal":
    case "PrivateName":
    case "Erased":
    case "BundleError":
      return `Intrinsic::${meaning.intrinsic}`;
    default: {
      const unhandled: never = meaning;
      throw new GeneratorError(`unknown intrinsic ${(unhandled as ModelIntrinsicMeaning).intrinsic}`);
    }
  }
}
