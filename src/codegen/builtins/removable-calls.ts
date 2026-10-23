// The calls of built-ins that do nothing a program can see when nobody uses their result, and what their operands have to be for that.
import type { Atom } from "./build-types.ts";
import { GeneratorError } from "./declarations.ts";
import { parameterAt, takes } from "./dispatch.ts";
import type {
  ModelBuiltin,
  ModelClass,
  ModelOperand,
  ModelOverload,
  ModelParameter,
  ModelType,
  ModelTypePart,
  TableModel,
} from "./model.ts";
import { conversionsFailingByValue, type Conversion, type OperandUse, type Protocol } from "./vocabulary.ts";

// NotPassed: the call has no argument at the position.
export const operandKinds = [
  "Undefined",
  "Null",
  "Boolean",
  "Number",
  "String",
  "Symbol",
  "BigInt",
  "NotPassed",
] as const;
export type OperandKind = (typeof operandKinds)[number];

// What kind of object an entry may be given for its call to be removable: none, a literal of the statement itself, an array literal, or any.
export const objectDemands = ["None", "Literal", "ArrayLiteral", "ArrayLiteralOfLiterals", "Any"] as const;
export type ObjectDemand = (typeof objectDemands)[number];

export interface OperandDemand {
  primitives: readonly OperandKind[];
  // With Number among the primitives: the number is a whole number in this range.
  integers: { minimum: number; maximum: number } | null;
  objects: ObjectDemand;
}

// A call with more arguments than parameters is not covered, unless the last parameter takes the rest.
export interface RemovableCall {
  overload: ModelOverload;
  receiver: OperandDemand | null;
  parameters: readonly OperandDemand[];
  hasRest: boolean;
}

const values: readonly OperandKind[] = operandKinds.filter(kind => kind !== "NotPassed");
const numberLike: readonly OperandKind[] = ["Undefined", "Null", "Boolean", "Number", "String"];

// The primitives that the conversion takes without an error, whatever their value.
const convertedWithoutError: Readonly<Record<Conversion, readonly OperandKind[]>> = {
  None: [],
  ToBoolean: values,
  ToNumber: numberLike,
  ToNumeric: [...numberLike, "BigInt"],
  ToString: [...numberLike, "BigInt"],
  ToPropertyKey: values,
  ToObject: ["Boolean", "Number", "String", "Symbol", "BigInt"],
  ToPrimitive: values,
  ToIntegerOrInfinity: numberLike,
  ToLength: numberLike,
  ToIndex: ["Undefined", "Null", "Boolean"],
  ToInt32: numberLike,
  ToUint32: numberLike,
  ToBigInt: ["Boolean", "BigInt"],
  Dictionary: ["Undefined", "Null"],
};

const protocolsOnObjectsOnly: readonly Protocol[] = [
  "OwnKeys",
  "OwnValues",
  "PrototypeChain",
  "Named",
  "ToJSON",
  "Thenable",
];
const usesOfCallers: readonly OperandUse[] = ["Calls", "CallsPerElement", "CallsRepeatedly", "PassesToUserCode"];
const usesBeyondTheOperand: readonly OperandUse[] = ["AppliesTransitively", "AppliesToContents"];
const changingUses: readonly OperandUse[] = [
  "WritesContents",
  "MovesElements",
  "StoresByKey",
  "DeletesByKey",
  "AssignsFrom",
  "DefinesName",
  "TakesDescriptor",
  "ChangesIntegrity",
  "ChangesPrototype",
  "BecomesPrototype",
];

const isKind = (primitive: string): primitive is OperandKind => (operandKinds as readonly string[]).includes(primitive);
const inListOrder = (kinds: ReadonlySet<OperandKind>) => operandKinds.filter(kind => kinds.has(kind));

function kindsOf(type: ModelType): readonly OperandKind[] {
  if (type.isAnything) return operandKinds;
  return type.integers === null ? type.primitives.filter(isKind) : [...type.primitives.filter(isKind), "Number"];
}

type InstancePart = Extract<ModelTypePart, { part: "Instance" }>;

const holdsOnlyObjects = ({ contents }: InstancePart): boolean =>
  contents.length > 0 &&
  contents.every(({ type }) => !type.isAnything && type.primitives.length === 0 && type.stringLiterals.length === 0);

const takesNothing = ({ primitives, objects }: OperandDemand) => primitives.length === 0 && objects === "None";

const flagsOfOtherCode: readonly ModelBuiltin["flags"][number][] = [
  "StartsInstance",
  "LoadsModuleByName",
  "EvaluatesText",
  "RunsUnseenCode",
  "IsCompilerHelper",
];

function leavesNoTrace(overload: ModelOverload): boolean {
  const { flags, effects, flow, builtin } = overload;
  if (flags.includes("IsUndeclared") || flagsOfOtherCode.some(flag => builtin.flags.includes(flag))) return false;
  if (effects.capability === "js" && !flags.includes("RunsOnlyOperandCode")) return false;
  if (flags.includes("Throws") && !flags.includes("OnlyPropagatesErrors")) return false;
  if (effects.writes.length > 0 || flow.callbacks.length > 0 || flow.handlerCalls.length > 0) return false;
  // Another entry hands out what lies in a native cell.
  return flow.transfers.every(({ to }) => to.place !== "NativeCell");
}

interface Position {
  operand: ModelOperand;
  demand: OperandDemand;
  replace(demand: OperandDemand): void;
}

class Derivation {
  readonly #arrayClass: ModelClass;

  constructor(model: TableModel) {
    const arrayClass = model.classes.find(({ token }) => token === "Array");
    if (arrayClass === undefined) throw new GeneratorError("the table has no class Array");
    this.#arrayClass = arrayClass;
  }

  #findArrayPart(type: ModelType): InstancePart | undefined {
    return type.parts.find((part): part is InstancePart => part.part === "Instance" && part.class === this.#arrayClass);
  }

  #objectDemandOf(parameter: ModelParameter, type: ModelType): ObjectDemand {
    const { protocols, uses } = parameter;
    const has = (...wanted: readonly OperandUse[]) => wanted.some(use => uses.includes(use));
    if (has(...usesOfCallers)) return "None";

    const arrayPart = this.#findArrayPart(type);
    const others = protocols.filter(protocol => !protocolsOnObjectsOnly.includes(protocol));
    if (others.length > 0) {
      // The iterator of an array literal is the engine's, and no other iterable is known by its syntax.
      const iteratesAdmittedArray = others.every(protocol => protocol === "Iterate") && parameter.admitted !== null;
      if (!iteratesAdmittedArray || arrayPart === undefined) return "None";
      return holdsOnlyObjects(arrayPart)
        ? "ArrayLiteralOfLiterals"
        : has(...usesBeyondTheOperand)
          ? "None"
          : "ArrayLiteral";
    }
    if (has(...usesBeyondTheOperand)) return "None";
    if (!type.isAnything && !type.hasAnyObject) return arrayPart === undefined ? "None" : "ArrayLiteral";
    return protocols.length > 0 || has(...changingUses) ? "Literal" : "Any";
  }

  #demandOf(parameter: ModelParameter): OperandDemand {
    const { accepted, admitted, conversion, refused, mode, operand } = parameter;
    const type = admitted ?? accepted;
    const kinds = new Set(conversionsFailingByValue.includes(conversion) && admitted === null ? [] : kindsOf(type));
    // One of a few texts: the front end does not compare them.
    if (type.stringLiterals.length > 0) kinds.delete("String");
    if (admitted === null) for (const kind of convertedWithoutError[conversion]) kinds.add(kind);
    for (const kind of kindsOf(refused)) kinds.delete(kind);
    // As the effects have it: what the entry itself converts has to have both a string and a number.
    if (admitted === null && conversion === "None" && parameter.protocols.includes("ToPrimitive")) {
      for (const kind of ["Symbol", "BigInt"] as const) kinds.delete(kind);
    }
    if (operand.operand === "Receiver") {
      // As the effects have it: a call on nothing throws.
      for (const kind of ["Undefined", "Null", "NotPassed"] as const) kinds.delete(kind);
    } else if (mode !== "Required" || kinds.has("Undefined")) {
      kinds.add("NotPassed");
    }
    const integers =
      type.integers === null ? null : { minimum: type.integers.minimum.value, maximum: type.integers.maximum.value };
    return { primitives: inListOrder(kinds), integers, objects: this.#objectDemandOf(parameter, type) };
  }

  #objectAtomsOf(objects: ObjectDemand): readonly Atom[] {
    switch (objects) {
      case "None":
        return [];
      case "Literal":
        return [this.#arrayClass, "OtherObject"];
      case "ArrayLiteral":
      case "ArrayLiteralOfLiterals":
        return [this.#arrayClass];
      case "Any":
        return [this.#arrayClass, "Function", "OtherObject"];
    }
  }

  // What is left of the demand where the earlier overload does not take the operand.
  #without(demand: OperandDemand, earlier: ModelParameter | null): OperandDemand {
    const namesClass = earlier !== null && earlier.accepted.parts.some(part => part.part === "Instance");
    const takesObject =
      (demand.objects === "Any" && namesClass) ||
      this.#objectAtomsOf(demand.objects).some(atom => takes(earlier, atom));
    return {
      primitives: demand.primitives.filter(kind => !takes(earlier, kind)),
      integers: demand.integers,
      objects: takesObject ? "None" : demand.objects,
    };
  }

  // The first overload that takes the operands of a call is the one that describes it.
  #excludeOperandsOf(earlier: ModelOverload, positions: readonly Position[], hasRest: boolean): boolean {
    const argumentCount = positions.filter(({ operand }) => operand.operand !== "Receiver").length;
    if (!hasRest && earlier.parameters.slice(argumentCount).some(parameter => !takes(parameter, "NotPassed")))
      return true;

    const remaining = positions.map(({ operand, demand }) => this.#without(demand, parameterAt(earlier, operand)));
    const isWhole = (left: OperandDemand, { demand }: Position) =>
      left.primitives.length === demand.primitives.length && left.objects === demand.objects;
    if (remaining.some((left, index) => isWhole(left, positions[index]))) return true;
    const narrowed = remaining.findIndex(left => !takesNothing(left));
    if (narrowed < 0) return false;
    positions[narrowed].replace(remaining[narrowed]);
    return true;
  }

  derive(overload: ModelOverload, earlierOverloads: readonly ModelOverload[]): RemovableCall | null {
    if (!leavesNoTrace(overload)) return null;
    let receiver = overload.receiver === null ? null : this.#demandOf(overload.receiver);
    const parameters = overload.parameters.map(parameter => this.#demandOf(parameter));
    const hasRest = overload.parameters.at(-1)?.mode === "Rest";

    const positions: Position[] = parameters.map((_, index) => ({
      operand: { operand: "Argument", index },
      get demand() {
        return parameters[index];
      },
      replace: demand => void (parameters[index] = demand),
    }));
    if (receiver !== null) {
      positions.unshift({
        operand: { operand: "Receiver" },
        get demand() {
          return receiver!;
        },
        replace: demand => void (receiver = demand),
      });
    }
    for (const earlier of earlierOverloads) {
      if (!this.#excludeOperandsOf(earlier, positions, hasRest)) return null;
    }
    if (positions.some(({ demand }) => takesNothing(demand))) return null;
    return { overload, receiver, parameters, hasRest };
  }
}

export function findRemovableCalls(model: TableModel): RemovableCall[] {
  const derivation = new Derivation(model);
  return model.builtins.flatMap(builtin =>
    (["Call", "Construct"] as const).flatMap(mode => {
      const overloads = builtin.overloads.filter(overload => overload.mode === mode);
      return overloads.flatMap((overload, index) => derivation.derive(overload, overloads.slice(0, index)) ?? []);
    }),
  );
}
