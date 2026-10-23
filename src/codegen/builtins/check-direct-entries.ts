import { describeOverload } from "./check-overloads.ts";
import type { Problems } from "./declarations.ts";
import type { ModelOverload, ModelParameter, ModelType, TableModel } from "./model.ts";
import {
  directValueTypes,
  maximumDirectParameterCount,
  type DirectParameterSpec,
  type Primitive,
} from "./vocabulary.ts";

const cIdentifierPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const int32Range = { minimum: -(2 ** 31), maximum: 2 ** 31 - 1 };
const maximumGeneralRegisterCount = 6;

function holdsOnlyPrimitive(type: ModelType, primitive: Primitive): boolean {
  const { isAnything, hasAnyObject, hasAnyFunction, hasPlainData, primitives, integers, stringLiterals, parts } = type;
  if (isAnything || hasAnyObject || hasAnyFunction || hasPlainData || parts.length > 0) return false;
  return integers === null && stringLiterals.length === 0 && primitives.every(held => held === primitive);
}

function holdsOnlyInt32(type: ModelType): boolean {
  const { primitives, integers } = type;
  if (integers === null || primitives.length > 0 || !holdsOnlyPrimitive({ ...type, integers: null }, "Number"))
    return false;
  return integers.minimum.value >= int32Range.minimum && integers.maximum.value <= int32Range.maximum;
}

function holdsOnlyInstances({
  isAnything,
  hasAnyObject,
  hasAnyFunction,
  hasPlainData,
  primitives,
  integers,
  stringLiterals,
  parts,
}: ModelType): boolean {
  if (isAnything || hasAnyObject || hasAnyFunction || hasPlainData || integers !== null) return false;
  return (
    primitives.length === 0 &&
    stringLiterals.length === 0 &&
    parts.length > 0 &&
    parts.every(({ part }) => part === "Instance")
  );
}

const takesReceiver = ({ value }: DirectParameterSpec) =>
  value === "NativeObjectOfReceiver" || value === "Receiver" || value === "FrameOfValues";
const takesArgument = (parameter: DirectParameterSpec) =>
  parameter.value === "FrameOfValues" || (parameter.value !== "Realm" && !takesReceiver(parameter));

// The address of a cell is handed over where the function declares a pointer, so nothing else may come.
function fitsPointer(cppType: string, accepted: ModelType): boolean {
  const { isAnything, hasAnyObject, hasAnyFunction, hasPlainData, integers, parts } = accepted;
  const primitives = accepted.primitives.filter(primitive => primitive !== "NotPassed");
  const holdsObjects = hasAnyObject || hasAnyFunction || hasPlainData || parts.length > 0;
  if (isAnything || integers !== null) return false;
  switch (cppType) {
    case "JSC::JSString*":
      return !holdsObjects && primitives.every(primitive => primitive === "String");
    case "JSC::JSObject*":
      return primitives.length === 0 && accepted.stringLiterals.length === 0;
    default:
      return primitives.every(primitive => primitive === "String" || primitive === "Symbol");
  }
}

function isHandedOverAs({ value, cppType }: DirectParameterSpec, { accepted }: ModelParameter): boolean {
  switch (value) {
    case "Value":
    case "ValueOrEmpty":
      return cppType === "JSC::EncodedJSValue" || fitsPointer(cppType, accepted);
    case "Boolean":
      return holdsOnlyPrimitive(accepted, "Boolean");
    case "Int32":
      return holdsOnlyInt32(accepted);
    case "Double":
      return holdsOnlyPrimitive(accepted, "Number") || holdsOnlyInt32(accepted);
    default:
      return true;
  }
}

function findArgumentProblems(direct: DirectParameterSpec, parameter: ModelParameter, isLast: boolean): string[] {
  const problems: string[] = [];
  if (parameter.conversion !== "None") {
    problems.push(`${parameter.name} is converted, and the function takes its operands as they are`);
  }
  if ((parameter.mode === "Rest") !== (direct.value === "RestOfValues") || (parameter.mode === "Rest" && !isLast)) {
    problems.push(`${parameter.name}: RestOfValues is for the operands that are left, and for nothing else`);
  }
  if ((parameter.mode === "Optional") !== (direct.value === "ValueOrEmpty")) {
    problems.push(`${parameter.name}: ValueOrEmpty is for an operand that can be left out, and for nothing else`);
  }
  if (!isHandedOverAs(direct, parameter))
    problems.push(`${parameter.name} can be something that ${direct.value} does not hand over`);
  return problems;
}

function findFormProblems(symbol: string, direct: readonly DirectParameterSpec[]): string[] {
  const problems: string[] = [];
  for (const { value, cppType } of direct) {
    const types: readonly string[] | undefined = directValueTypes[value];
    if (types === undefined) problems.push(`${value} is not one of ${Object.keys(directValueTypes).join(", ")}`);
    else if (!types.includes(cppType)) problems.push(`${cppType} is not handed over as ${value}`);
  }
  if (direct.length > maximumDirectParameterCount) {
    problems.push(`${symbol} has more than ${maximumDirectParameterCount} parameters`);
  }
  const generalRegisters = direct.reduce(
    (count, { value }) => count + (value === "Double" ? 0 : value === "RestOfValues" ? 2 : 1),
    0,
  );
  if (generalRegisters > maximumGeneralRegisterCount) {
    problems.push(`${symbol} takes more than fits the ${maximumGeneralRegisterCount} general argument registers`);
  }
  return problems;
}

function findReceiverProblems({ mode, receiver, code: { directEntry } }: ModelOverload): string[] {
  const { symbol, parameters, offsetOfNativeObject } = directEntry!;
  const takesNativeObject = parameters.some(({ value }) => value === "NativeObjectOfReceiver");
  if (takesNativeObject !== (offsetOfNativeObject !== undefined)) {
    return [`${symbol}: offsetOfNativeObject goes with a parameter that is NativeObjectOfReceiver`];
  }
  if (!parameters.some(takesReceiver)) {
    return mode === "Call" && receiver === null ? [] : [`${symbol} takes the arguments of a call and no receiver`];
  }
  if (receiver === null) return [`${symbol} takes the receiver, and the overload has none`];
  if (takesNativeObject && (receiver.conversion !== "None" || !holdsOnlyInstances(receiver.accepted))) {
    return [`${symbol} takes what the receiver wraps, so the receiver is an instance of a class`];
  }
  return [];
}

function findProblems(overload: ModelOverload): string[] {
  const {
    builtin,
    parameters,
    code: { directEntry, implementation },
  } = overload;
  if (directEntry === null) return [];
  const { symbol } = directEntry;
  const problems = [...findFormProblems(symbol, directEntry.parameters), ...findReceiverProblems(overload)];
  if (!cIdentifierPattern.test(symbol)) problems.push(`${JSON.stringify(symbol)} is not the name of a C function`);
  if (builtin.scope === "Module" && builtin.attachments.nativeFunction === null) {
    problems.push(
      `compiled code knows the function that ${symbol} stands in for by its native code, so the entry has functionObjectCode`,
    );
  }
  if (builtin.origin !== "Host") {
    problems.push(`${symbol} is bound with the functions of the host, and the entry is the engine's`);
  }
  if (implementation.how !== "HostCall")
    problems.push(`${symbol} stands in for native code of the host, so the overload is a call of the host`);
  const taken = directEntry.parameters.filter(takesArgument);
  if (taken.length === 1 && taken[0].value === "FrameOfValues") return problems;
  if (taken.length !== parameters.length) {
    return [...problems, `${symbol} takes ${taken.length} arguments, and the overload has ${parameters.length}`];
  }
  return [
    ...problems,
    ...parameters.flatMap((parameter, index) =>
      findArgumentProblems(taken[index], parameter, index === parameters.length - 1),
    ),
  ];
}

// Compiled code enters the C function where it would have called the function object, which stays the way in for every other caller.
export function checkDirectEntries({ overloads }: Pick<TableModel, "overloads">, problems: Problems): void {
  for (const overload of overloads) {
    // What is written for a native binding describes the function that it makes, whose entry has the same overloads.
    if (overload.builtin.kind === "NativeBinding") continue;
    for (const problem of findProblems(overload))
      problems.add(overload.source, `${describeOverload(overload)}: ${problem}`);
  }
}
