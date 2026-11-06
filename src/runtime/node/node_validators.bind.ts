// The native functions of src/js/internal/validators.ts. Their bodies are C++: src/jsc/bindings/NodeValidatorBodies.h.
import * as b from "../../codegen/bindgen-lib.ts";
import * as table from "../../codegen/builtins/lib.ts";

type Operands = Record<string, b.Type>;
type Uses = Record<string, readonly table.UseSpec[]>;

/** It converts the operand to a string, reads its constructor.name, or prints it the way console.log does. */
const describedInMessage = [table.printedByFormatter("constructor")];
/** The name is described after a bound is converted and before the value is, so no conversion can be moved in front of the call. */
const convertedToNumber = [table.runs("ToPrimitive")];

const operand = b.any.orAbsent;

const validator = (name: string, args: Operands, uses: Uses, returns?: b.Type, length = 0) =>
  b.fn({
    args,
    returns,
    length,
    cppSymbol: `Bun__NodeValidator__${name}`,
    cppInlineBody: { name: `Bun::NodeValidators::${name}`, header: "NodeValidatorBodies.h" },
    capability: "js",
    throws: true,
    runsOnlyOperandCode: true,
    uses: uses as table.SignatureColumns["uses"],
    reads: [],
    writes: [],
  });

const valueAndName = { value: operand, name: operand };
const usesOfValueAndName = { value: describedInMessage, name: describedInMessage };
const withBounds = { ...valueAndName, min: operand, max: operand };
const usesWithBounds = { ...usesOfValueAndName, min: convertedToNumber, max: convertedToNumber };

export const validateInteger = validator("validateInteger", withBounds, usesWithBounds);
export const validateNumber = validator("validateNumber", withBounds, usesWithBounds);
export const validateInt32 = validator("validateInt32", withBounds, usesWithBounds);
export const validateUint32 = validator(
  "validateUint32",
  { ...valueAndName, positive: operand },
  { ...usesOfValueAndName, positive: table.inspected },
);
export const validateFiniteNumber = validator("validateFiniteNumber", valueAndName, usesOfValueAndName, b.bool);

/** The number, or `fallback` for `undefined` and `NaN`. */
export const checkRangesOrGetDefault = validator(
  "checkRangesOrGetDefault",
  { ...valueAndName, lower: operand, upper: operand, fallback: operand },
  { ...usesOfValueAndName, lower: convertedToNumber, upper: convertedToNumber, fallback: [table.returned] },
  b.any,
);

/** A string counts for the number that it converts to. */
export const validatePort = validator(
  "validatePort",
  { ...valueAndName, allowZero: operand },
  { ...usesOfValueAndName, allowZero: table.inspected },
  b.u16,
);

/** `options` is a sum of kValidateObjectAllowNullable, kValidateObjectAllowArray and kValidateObjectAllowFunction. */
export const validateObject = validator(
  "validateObject",
  { ...valueAndName, options: operand },
  { ...usesOfValueAndName, options: table.inspected },
  undefined,
  2,
);

export const validateBuffer = validator("validateBuffer", valueAndName, usesOfValueAndName);

/** An object that is no `AbortSignal` passes for one if it has a property `aborted`, its own or inherited. */
export const validateAbortSignal = validator("validateAbortSignal", valueAndName, {
  ...usesOfValueAndName,
  value: [table.runs(table.named("aborted"), "PrototypeChain"), ...describedInMessage],
});

export const validateArray = validator(
  "validateArray",
  { ...valueAndName, minLength: operand },
  {
    ...usesOfValueAndName,
    value: [table.runsTransitively("ToPrimitive", table.named("length")), ...describedInMessage],
    minLength: convertedToNumber,
  },
);

export const validateOneOf = validator(
  "validateOneOf",
  { ...valueAndName, oneOf: operand },
  { ...usesOfValueAndName, oneOf: [table.readsContents(), ...describedInMessage] },
);

/** Data that is to be read as "hex" has an even length. */
export const validateEncoding = validator(
  "validateEncoding",
  { data: operand, encoding: operand },
  {
    data: [table.readsContents(), table.runsTransitively("ToPrimitive", table.named("length"))],
    encoding: describedInMessage,
  },
);
