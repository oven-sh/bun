import {
  operandUses,
  protocolKeys,
  type CallMode,
  type DumpedClass,
  type DumpedEntry,
  type DumpedKey,
  type DumpedLayout,
  type DumpedOperand,
  type DumpedOverload,
  type DumpedParameter,
  type DumpedSlot,
  type DumpedType,
  type TableDump,
} from "../../../../src/codegen/builtins/dump.ts";

export type * from "../../../../src/codegen/builtins/dump.ts";
export { conversionProtocols, needsDifferentialTest, operandUses, protocolKeys } from "../../../../src/codegen/builtins/dump.ts";

export type OperandName = "this" | number;

export function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

export function unreachable(value: never): never {
  throw new Error(`unexpected value: ${Bun.inspect(value)}`);
}

export function describeOperand(operand: OperandName): string {
  return operand === "this" ? "this" : `argument ${operand}`;
}

export function covers(declared: DumpedOperand, operand: OperandName): boolean {
  if (declared === "this") return operand === "this";
  if (operand === "this") return false;
  return "argument" in declared ? declared.argument === operand : declared.argumentsFrom <= operand;
}

export function parameterOf(overload: DumpedOverload, operand: OperandName): DumpedParameter | null {
  if (operand === "this") return overload.receiver;
  return overload.parameters.find(parameter => covers(parameter.operand, operand)) ?? null;
}

export function columnOf(overload: DumpedOverload, operand: OperandName): string {
  if (operand === "this") return "receiver";
  const index = overload.parameters.findIndex(parameter => covers(parameter.operand, operand));
  return index === -1 ? "parameters" : `parameters[${index}]`;
}

export function claimsEveryUse(parameter: DumpedParameter): boolean {
  return parameter.uses.length === operandUses.length;
}

const wellKnownSymbols = new Map<symbol, string>(
  Reflect.ownKeys(Symbol).flatMap((name): [symbol, string][] => {
    const value: unknown = Reflect.get(Symbol, name);
    return typeof value === "symbol" && typeof name === "string" ? [[value, name]] : [];
  }),
);

// The spelling of a key in namedMembers, calledMembers and the names of a key: "@@iterator", "@@@nodejs.util.inspect.custom".
export function spellingOf(key: PropertyKey): string {
  if (typeof key !== "symbol") return String(key);
  const wellKnown = wellKnownSymbols.get(key);
  if (wellKnown !== undefined) return `@@${wellKnown}`;
  const registered = Symbol.keyFor(key);
  return registered === undefined ? `@@?${key.description ?? ""}` : `@@@${registered}`;
}

export function keyOfSpelling(spelling: string): PropertyKey {
  if (spelling.startsWith("@@@")) return Symbol.for(spelling.slice(3));
  if (spelling.startsWith("@@")) return Reflect.get(Symbol, spelling.slice(2)) as symbol;
  return spelling;
}

export function isIndexKey(key: PropertyKey): boolean {
  if (typeof key === "symbol") return false;
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && index <= Number.MAX_SAFE_INTEGER && String(index) === String(key);
}

export function keysOfProtocols(parameter: DumpedParameter): Set<string> {
  const keys = new Set<string>();
  for (const protocol of parameter.protocols) {
    if (protocol === "Named" || protocol === "CallsNamed") continue;
    for (const key of protocolKeys[protocol]) keys.add(key);
  }
  return keys;
}

export class Table {
  readonly dump: TableDump;
  readonly entries = new Map<string, DumpedEntry>();
  readonly classes = new Map<string, DumpedClass>();
  readonly layouts = new Map<string, DumpedLayout>();
  readonly slots = new Map<string, DumpedSlot>();

  constructor(dump: TableDump) {
    this.dump = dump;
    for (const entry of dump.entries) this.entries.set(entry.token, entry);
    for (const layout of dump.layouts) this.layouts.set(layout.token, layout);
    for (const description of dump.classes) {
      this.classes.set(description.token, description);
      for (const slot of description.slots) this.slots.set(slot.token, slot);
    }
  }

  entryOf(overload: DumpedOverload): DumpedEntry {
    const entry = this.entries.get(overload.token.slice(0, overload.token.lastIndexOf("/")));
    if (!entry) throw new Error(`${overload.token} belongs to no entry`);
    return entry;
  }

  overloadsOf(entry: DumpedEntry, mode: CallMode): DumpedOverload[] {
    return entry.overloads.filter(overload => overload.mode === mode);
  }

  ancestryOf(token: string): string[] {
    const ancestry: string[] = [];
    let current: string | null = token;
    while (current !== null && !ancestry.includes(current)) {
      ancestry.push(current);
      current = this.classes.get(current)?.parent ?? null;
    }
    return ancestry;
  }

  isSameOrSubclass(derived: string, base: string): boolean {
    return this.ancestryOf(derived).includes(base);
  }
}

export type Atom = "NotPassed" | "Undefined" | "Null" | "Boolean" | "Number" | "String" | "Symbol" | "BigInt" | ObjectAtom;
export type ObjectAtom = "Function" | "OtherObject" | { class: string };

function flagsAdmit(table: Table, type: DumpedType, atom: ObjectAtom): boolean {
  if (type.hasAnyObject) return true;
  if (atom === "Function") return type.hasAnyFunction;
  if (atom === "OtherObject") return type.hasPlainData;
  if (type.hasAnyFunction && table.isSameOrSubclass(atom.class, "Function")) return true;
  return type.hasPlainData && (atom.class === "Array" || atom.class === "Object");
}

function partAdmits(table: Table, part: DumpedType["parts"][number], atom: ObjectAtom): boolean {
  switch (part.part) {
    case "Instance":
      if (atom === "OtherObject") return false;
      if (atom === "Function") return table.isSameOrSubclass(part.class, "Function");
      return table.isSameOrSubclass(atom.class, part.class);
    case "Layout":
      if (atom === "Function") return false;
      if (atom === "OtherObject") return true;
      return atom.class === (table.layouts.get(part.layout)?.isTuple ? "Array" : "Object");
    case "Builtin":
      return true;
    case "InstanceOfReceiverClass":
    case "TypedArrayOfReceiverElementType":
    case "Operand":
    case "Slot":
    case "IteratedValues":
    case "CallbackResult":
    case "Prototype":
      return false;
    default:
      return unreachable(part);
  }
}

// The generator's `admits`, on dumped types.
export function admitsAtom(table: Table, type: DumpedType, atom: Atom): boolean {
  if (type.isAnything) return true;
  if (typeof atom === "object" || atom === "Function" || atom === "OtherObject") {
    return flagsAdmit(table, type, atom) || type.parts.some(part => partAdmits(table, part, atom));
  }
  if (atom === "String") return type.primitives.includes("String") || type.stringLiterals.length > 0;
  return type.primitives.includes(atom);
}

export function takes(table: Table, parameter: DumpedParameter | null, atom: Atom): boolean {
  if (parameter === null || admitsAtom(table, parameter.accepted, atom)) return true;
  if (parameter.mode === "Rest" && atom === "NotPassed") return true;
  return parameter.conversion !== "None" && !admitsAtom(table, parameter.refused, atom);
}

export function classesNamedAt(table: Table, overloads: readonly DumpedOverload[], operand: OperandName): string[] {
  const named = new Set<string>();
  for (const overload of overloads) {
    const parameter = parameterOf(overload, operand);
    if (parameter === null) continue;
    for (const type of [parameter.accepted, parameter.refused]) {
      for (const part of type.parts) if (part.part === "Instance") named.add(part.class);
    }
  }
  return [...named].sort((left, right) => table.ancestryOf(right).length - table.ancestryOf(left).length);
}

export function isNarrowerThanItsKinds(table: Table, parameter: DumpedParameter): boolean {
  const { accepted, conversion, mode } = parameter;
  if (conversion !== "None" || accepted.isAnything) return false;
  if (mode === "Rest") return true;
  if (accepted.integers !== null || accepted.stringLiterals.length > 0) return true;
  if (accepted.hasPlainData && !accepted.hasAnyObject) return true;
  return accepted.parts.some(part => {
    if (part.part !== "Instance" || part.pristine.length > 0 || part.contents.length > 0) return true;
    // Every function is of the kind Function, and only some are instances of a class of functions.
    return !accepted.hasAnyFunction && table.isSameOrSubclass(part.class, "Function");
  });
}

export function keyCovers(
  key: DumpedKey,
  observed: PropertyKey,
  valueOfOperand: (operand: DumpedOperand) => unknown[],
): boolean {
  switch (key.key) {
    case "None":
      return false;
    case "Any":
      return true;
    case "Indexes":
      return isIndexKey(observed);
    case "Names":
      return key.names.includes(spellingOf(observed));
    // The key is what the operand converts to, and user code may have made it.
    case "Operand":
      return valueOfOperand(key.operand).some(value => isObject(value) || isSameKey(value, observed));
    case "ElementsOf":
      return true;
    default:
      return unreachable(key);
  }
}

function isSameKey(value: unknown, key: PropertyKey): boolean {
  return typeof value === "symbol" ? value === key : String(value) === String(key);
}
