import {
  emitArray,
  formatAggregate,
  formatEnumerator,
  formatId,
  formatInt64,
  formatName,
  formatOperand,
  formatOptionSet,
  formatUnlessDefault,
  joinBlocks,
  Pool,
  wrapFile,
  type AggregateMember,
} from "./emit-cpp-support.ts";
import { dumpType } from "./emit-dump.ts";
import type { ModelSlotContents, ModelType, ModelTypePart, TableModel } from "./model.ts";

interface TypePools {
  slotContents: Pool;
  typeParts: Pool;
  literals: Pool;
}

function formatSlotContents(contents: ModelSlotContents): string {
  return formatAggregate([
    ["slot", formatId("BuiltinSlotID", contents.slot)],
    ["type", formatId("BuiltinTypeID", contents.type)],
  ]);
}

function formatTypePart(part: ModelTypePart, pools: TypePools): string {
  const kind: AggregateMember = ["kind", formatEnumerator("BuiltinTypePartKind", part.part)];
  switch (part.part) {
    case "Instance":
      return formatAggregate([
        kind,
        ["pristine", formatOptionSet("PristineAspects", part.pristine)],
        ["builtinClass", formatId("BuiltinClassID", part.class)],
        ["contents", pools.slotContents.addStretch(part.contents.map(formatSlotContents))],
        ["isOfClassItself", part.isOfClassItself ? "true" : null],
      ]);
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
      return formatAggregate([kind]);
    case "Layout":
      return formatAggregate([kind, ["layout", formatId("BuiltinLayoutID", part.layout)]]);
    case "Builtin":
      return formatAggregate([kind, ["builtin", formatId("BuiltinID", part.builtin)]]);
    case "Operand":
    case "CallbackResult":
    case "Prototype":
      return formatAggregate([kind, ["operand", formatOperand(part.operand)]]);
    case "IteratedValues":
      return formatAggregate([
        kind,
        ["operand", formatOperand(part.operand)],
        ["isSettled", part.isSettled ? "true" : null],
      ]);
    case "Slot":
      return formatAggregate([
        kind,
        ["operand", formatOperand(part.operand)],
        ["slot", formatId("BuiltinSlotID", part.slot)],
      ]);
  }
}

function formatTypeFlags(type: ModelType): string {
  const flags: readonly (readonly [flag: string, isSet: boolean])[] = [
    ["IsAnything", type.isAnything],
    ["HasAnyObject", type.hasAnyObject],
    ["HasAnyFunction", type.hasAnyFunction],
    ["HasPlainData", type.hasPlainData],
    ["HasOnlyIntegers", type.integers !== null],
  ];
  const set = flags.filter(([, isSet]) => isSet).map(([flag]) => flag);
  return formatOptionSet("BuiltinTypeFlag", set) ?? "{ }";
}

function formatIntegers(integers: ModelType["integers"]): string {
  if (integers === null) return formatAggregate([]);
  return formatAggregate([
    ["minimum", formatInt64(integers.minimum.value)],
    ["maximum", formatInt64(integers.maximum.value)],
  ]);
}

function formatType(type: ModelType, pools: TypePools): string {
  return formatAggregate([
    ["flags", formatTypeFlags(type)],
    ["primitives", formatOptionSet("BuiltinPrimitive", dumpType(type).primitives)],
    ["freshness", formatUnlessDefault("BuiltinFreshness", type.freshness, "No")],
    ["integers", formatIntegers(type.integers)],
    ["stringLiterals", pools.literals.addStretch(type.stringLiterals.map(name => formatName(name)))],
    ["parts", pools.typeParts.addStretch(type.parts.map(part => formatTypePart(part, pools)))],
  ]);
}

export function emitCppTypes(model: TableModel): string {
  const pools: TypePools = {
    slotContents: new Pool("BuiltinSlotContents", "builtinTableSlotContents", true),
    typeParts: new Pool("BuiltinTypePart", "builtinTableTypeParts", true),
    literals: new Pool("BuiltinName", "builtinTableTypeLiterals", true),
  };
  const types = model.types.map(type => formatType(type, pools));
  const body = joinBlocks([
    pools.slotContents.emit(),
    pools.typeParts.emit(),
    pools.literals.emit(),
    emitArray("constinit const BuiltinType builtinTableTypes", types),
  ]);
  return wrapFile(["AOTBuiltinTable.h", "AOTBuiltinTableArrays.h"], body);
}
