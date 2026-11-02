// Entries written for a test, for functions written for the test, whose behavior is therefore known.
import { aotBuiltinEntries } from "bun:internal-for-testing";
import { checkCall } from "./check-call";
import type { Difference } from "./compare";
import { Realm } from "./members";
import {
  Table,
  type BuiltinFlag,
  type CallMode,
  type DumpedCallback,
  type DumpedEntry,
  type DumpedOperand,
  type DumpedOverload,
  type DumpedParameter,
  type DumpedPlace,
  type DumpedPropertyAction,
  type DumpedType,
  type Mutability,
  type Primitive,
} from "./table-description";

export const never: DumpedType = {
  isAnything: false,
  hasAnyObject: false,
  hasAnyFunction: false,
  hasPlainData: false,
  primitives: [],
  integers: null,
  stringLiterals: [],
  freshness: "No",
  parts: [],
};
export const anything: DumpedType = { ...never, isAnything: true };
export const anyObject: DumpedType = { ...never, hasAnyObject: true };
export const anyFunction: DumpedType = { ...never, hasAnyFunction: true };
export const primitive = (...primitives: Primitive[]): DumpedType => ({ ...never, primitives });
export const integers = (minimum: number, maximum: number): DumpedType => ({
  ...never,
  primitives: ["Number"],
  integers: { minimum, maximum },
});
export const instanceOf = (className: string, changes: Partial<DumpedType> = {}): DumpedType => ({
  ...never,
  parts: [{ part: "Instance", class: className, pristine: [], contents: [] }],
  ...changes,
});
export const operandType = (operand: DumpedOperand): DumpedType => ({ ...never, parts: [{ part: "Operand", operand }] });

export const argument = (index: number): DumpedOperand => ({ argument: index });
export const noPlace: DumpedPlace = { place: "None" };
export const operandPlace = (operand: DumpedOperand): DumpedPlace => ({ place: "Operand", operand });
export const newValue = (type: DumpedType): DumpedPlace => ({ place: "NewValue", type });

export function parameter(operand: DumpedOperand, changes: Partial<DumpedParameter> = {}): DumpedParameter {
  const accepted = changes.accepted ?? anything;
  return {
    operand,
    mode: "Required",
    accepted,
    conversion: "None",
    converted: accepted,
    refused: never,
    admitted: null,
    uses: ["Inspects"],
    roles: [],
    protocols: [],
    namedMembers: [],
    calledMembers: [],
    ...changes,
  };
}

export function callback(callee: DumpedOperand, changes: Partial<DumpedCallback> = {}): DumpedCallback {
  return {
    callee,
    times: "Once",
    constructs: false,
    newTarget: noPlace,
    thisValue: noPlace,
    arguments: [],
    spreadArguments: noPlace,
    resultUse: "Ignored",
    resultTo: noPlace,
    ...changes,
  };
}

export function action(changes: Pick<DumpedPropertyAction, "action" | "object"> & Partial<DumpedPropertyAction>): DumpedPropertyAction {
  return { key: { key: "None" }, value: noPlace, integrityLevel: null, ...changes };
}

const doubleToken = "Double";
const doublePath = "%Double%";

export function overload(changes: Partial<DumpedOverload> = {}): DumpedOverload {
  return {
    token: `${doubleToken}/0`,
    path: doublePath,
    mode: "Call",
    isProvenByConstruction: false,
    isUndeclared: false,
    receiver: null,
    parameters: [],
    result: {
      type: primitive("Undefined"),
      rangeRule: "None",
      rangeOperand: null,
      substringOf: null,
      typedResultForm: "None",
      typedResultSource: null,
      iteratedOperand: null,
      iterationKind: null,
      prototypeSource: null,
    },
    capability: "js",
    throws: false,
    onlyPropagatesErrors: false,
    runsOnlyOperandCode: true,
    readsStateBeforeConversions: false,
    reads: [],
    writes: [],
    transfers: [],
    callbacks: [],
    propertyActions: [],
    handlerCalls: [],
    implementation: { how: "HostCall", otherwise: null, callee: "Function", inlineBuiltin: null, maximumArgumentCount: null, function: null },
    model: null,
    ...changes,
  };
}

export const otherwise = overload({ isUndeclared: true, parameters: [parameter({ argumentsFrom: 0 }, { mode: "Rest" })], throws: true });

export const returning = (type: DumpedType): Pick<DumpedOverload, "result"> => ({ result: { ...overload().result, type } });

export type EntryChanges = { flags?: BuiltinFlag[]; mutability?: Mutability; kind?: DumpedEntry["kind"] };

function entryOf(overloads: DumpedOverload[], { flags = [], mutability = "ConstantUnlessWritten", kind = "Function" }: EntryChanges): DumpedEntry {
  return {
    id: -1,
    token: doubleToken,
    path: doublePath,
    kind,
    origin: "Engine",
    scope: "Realm",
    mutability,
    platforms: [],
    flags,
    holder: null,
    name: doublePath,
    isSymbolName: false,
    prototypeLink: "Unknown",
    inheritsFrom: null,
    instanceClass: null,
    sameObjectAs: null,
    overloads,
  };
}

const dump = aotBuiltinEntries();

// Where what the function does is more than what the overloads declare.
export async function differencesOf(double: Function, overloads: DumpedOverload[], changes: EntryChanges = {}): Promise<Difference[]> {
  const numbered = overloads.map((declared, index) => ({ ...declared, token: `${doubleToken}/${index}` }));
  const entry = entryOf(numbered, changes);
  const realm = new Realm(new Table({ ...dump, entries: [...dump.entries, entry] }));
  realm.register(doublePath, double);
  const mode: CallMode = numbered[0].mode;
  const report = await checkCall(realm, { entry, mode, overloads: numbered });
  return report.overloads.flatMap(({ differences }) => differences);
}

export async function differingColumnsOf(double: Function, overloads: DumpedOverload[], changes: EntryChanges = {}): Promise<string[]> {
  return (await differencesOf(double, overloads, changes)).map(({ column }) => column);
}
