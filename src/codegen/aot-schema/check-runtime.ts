import { kindText } from "./hash.ts";
import type { InlineBuiltin, RuntimeOperation, RuntimeParameter, Schema, SchemaEnum } from "./model.ts";
import type { ErrorList } from "./source.ts";

export const runtimeValueKinds: ReadonlyMap<string, string> = new Map([
  ["void", "Void"],
  ["size_t", "Size"],
  ["int32_t", "Int32"],
  ["uint32_t", "UInt32"],
  ["int64_t", "Int64"],
  ["uint64_t", "UInt64"],
  ["double", "Double"],
  ["EncodedJSValue", "EncodedJSValue"],
  ["JSCell*", "Cell"],
  ["UGPRPair", "Pair"],
  ["SiteCache", "SiteCache"],
]);

export const argumentBufferPointees: ReadonlyMap<string, boolean> = new Map([
  ["EncodedJSValue", true],
  ["uint32_t", true],
  ["uint64_t", true],
  ["JSCell", false],
  ["UniquedStringImpl", false],
  ["Latin1Character", false],
  ["char16_t", false],
  ["uint8_t", false],
  ["void", false],
]);

const pointerTypes: ReadonlySet<string> = new Set([
  "UniquedStringImpl*",
  "void*",
  "uint8_t*",
  "const uint8_t*",
  "const Latin1Character*",
  "const char16_t*",
  "EncodedJSValue*",
  "const EncodedJSValue*",
  "uint64_t*",
  "const uint64_t*",
  "uint32_t*",
  "const uint32_t*",
]);

const resultOnlyTypes: ReadonlySet<string> = new Set(["void", "UGPRPair"]);
const constPrefix = "const ";
const maxRuntimeParameters = 6;
const maxDoubleParameters = 4;
const maxInlineParameters = 4;
const maxInlineEnumMembers = 256;
const maxInlineFlagWordMembers = 8;

function isListedType(type: string): boolean {
  return runtimeValueKinds.has(type) || pointerTypes.has(type);
}

export function pointeeOf(type: string): string | null {
  if (!type.endsWith("*")) return null;
  const pointee = type.slice(0, -1);
  return pointee.startsWith(constPrefix) ? pointee.slice(constPrefix.length) : pointee;
}

function checkRuntimeParameter(
  operation: RuntimeOperation,
  parameter: RuntimeParameter,
  position: number,
  errors: ErrorList,
): void {
  const { type } = parameter;
  const description = `parameter ${parameter.name ?? position} of runtime ${operation.name}`;
  const pointee = pointeeOf(type);
  if (type === "void") {
    errors.add(operation.location, `${description} is void`);
  } else if (pointee !== null && !argumentBufferPointees.has(pointee)) {
    const problem = `points to ${pointee}, which is not listed as inside or outside the argument buffer`;
    errors.add(operation.location, `${description} ${problem}`);
  } else if (!isListedType(type) || resultOnlyTypes.has(type)) {
    errors.add(operation.location, `type ${type} of runtime ${operation.name} is not a listed C type`);
  }
}

function checkLeafEffects(operation: RuntimeOperation, errors: ErrorList): void {
  const { effects, location, name } = operation;
  if (effects.isUnknownCode || effects.throws || effects.collects) {
    errors.add(location, `leaf runtime operation ${name} throws, collects or calls unknown code`);
  }
  for (const { heap } of effects.writes) {
    if (!heap.marks.has("holdsValues")) continue;
    errors.add(location, `leaf runtime operation ${name} writes ${heap.name}, which holds values`);
  }
}

function checkRuntimeOperation(operation: RuntimeOperation, errors: ErrorList): void {
  const { location, name, parameters, resultType } = operation;
  if (!isListedType(resultType)) errors.add(location, `type ${resultType} of runtime ${name} is not a listed C type`);
  parameters.forEach((parameter, index) => checkRuntimeParameter(operation, parameter, index + 1, errors));
  if (parameters.length > maxRuntimeParameters) {
    errors.add(location, `runtime ${name} has more than ${maxRuntimeParameters} parameters`);
  }
  if (parameters.filter(parameter => parameter.type === "double").length > maxDoubleParameters) {
    errors.add(location, `runtime ${name} has more than ${maxDoubleParameters} double parameters`);
  }
  if (operation.isLeaf) checkLeafEffects(operation, errors);
}

function checkInlineBuiltin(builtin: InlineBuiltin, parameterTypes: Set<SchemaEnum>, errors: ErrorList): void {
  const { location, name, parameterKinds } = builtin;
  if (parameterKinds.length > maxInlineParameters) {
    errors.add(location, `inline ${name} has more than ${maxInlineParameters} parameters`);
  }
  for (const kind of parameterKinds) {
    const isByte = kind.tag === "Scalar" && kind.scalar === "UInt8";
    const isExternalEnum = kind.tag === "External" && kind.external.form === "enum";
    if (kind.tag === "Enum" || kind.tag === "Flags") {
      parameterTypes.add(kind.type);
    } else if (kind.tag === "External" && isExternalEnum && kind.external.below === null) {
      errors.add(location, `inline ${name}: external ${kind.external.name} has no below`);
    } else if (!isByte && !isExternalEnum) {
      errors.add(location, `unknown parameter kind ${kindText(kind)} of inline ${name}`);
    }
  }
}

function checkInlineParameterType(type: SchemaEnum, errors: ErrorList): void {
  const limit = type.isFlags ? maxInlineFlagWordMembers : maxInlineEnumMembers;
  if (type.members.length <= limit) return;
  const description = type.isFlags ? "flag word" : "enum";
  errors.add(type.location, `inline parameter ${description} ${type.name} has more than ${limit} members`);
}

export function checkRuntime(schema: Schema, errors: ErrorList): void {
  for (const operation of schema.runtimeOperations) checkRuntimeOperation(operation, errors);
  const parameterTypes = new Set<SchemaEnum>();
  for (const builtin of schema.inlineBuiltins) checkInlineBuiltin(builtin, parameterTypes, errors);
  for (const type of parameterTypes) checkInlineParameterType(type, errors);
}
