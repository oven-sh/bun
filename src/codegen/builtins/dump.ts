import { createHash } from "node:crypto";
import type { BuiltinFlag, ImplementationKind, InstanceTest, PropertyActionKind, PrototypeLink } from "./model.ts";
import type {
  BuiltinKind,
  CallbackResultUse,
  CallbackTimes,
  CalleeKind,
  CallMode,
  Capability,
  ContentsSlot,
  Conversion,
  Freshness,
  Heap,
  IntegrityLevel,
  IterationKind,
  Mutability,
  OperandRole,
  OperandUse,
  Origin,
  ParameterMode,
  Primitive,
  PristineAspect,
  PristineTest,
  Protocol,
  RangeRule,
  Scope,
  TargetPlatform,
  TypedResultForm,
} from "./vocabulary.ts";

export { builtinFlags, implementationKinds, instanceTests, propertyActionKinds, prototypeLinks } from "./model.ts";
export type { BuiltinFlag, ImplementationKind, InstanceTest, PropertyActionKind, PrototypeLink } from "./model.ts";
export {
  builtinKinds,
  callbackResultUses,
  callbackTimes,
  calleeKinds,
  callModes,
  capabilities,
  contentsSlots,
  conversionProtocols,
  conversions,
  freshnesses,
  integrityLevels,
  iterationKinds,
  mutabilities,
  operandRoles,
  operandUses,
  origins,
  parameterModes,
  primitives,
  pristineAspects,
  protocolKeys,
  protocols,
  rangeRules,
  scopes,
  targetPlatforms,
  typedResultForms,
} from "./vocabulary.ts";
export type {
  BuiltinKind,
  CallbackResultUse,
  CallbackTimes,
  CalleeKind,
  CallMode,
  Capability,
  ContentsSlot,
  Conversion,
  Freshness,
  Heap,
  IntegrityLevel,
  IterationKind,
  Mutability,
  OperandRole,
  OperandUse,
  Origin,
  ParameterMode,
  Primitive,
  PristineAspect,
  Protocol,
  RangeRule,
  Scope,
  TargetPlatform,
  TypedResultForm,
} from "./vocabulary.ts";

export type DumpedOperand = "this" | { argument: number } | { argumentsFrom: number };

export type DumpedTypePart =
  | {
      part: "Instance";
      class: string;
      pristine: PristineAspect[];
      isOfClassItself: boolean;
      contents: { slot: string; type: DumpedType }[];
    }
  | { part: "InstanceOfReceiverClass" }
  | { part: "TypedArrayOfReceiverElementType" }
  | { part: "Layout"; layout: string }
  | { part: "Builtin"; builtin: string }
  | { part: "Operand"; operand: DumpedOperand }
  | { part: "Slot"; operand: DumpedOperand; slot: string }
  | { part: "IteratedValues"; operand: DumpedOperand; isSettled: boolean }
  | { part: "CallbackResult"; operand: DumpedOperand }
  | { part: "Prototype"; operand: DumpedOperand };

export interface DumpedType {
  isAnything: boolean;
  hasAnyObject: boolean;
  hasAnyFunction: boolean;
  hasPlainData: boolean;
  primitives: Primitive[];
  integers: { minimum: number; maximum: number } | null;
  stringLiterals: string[];
  freshness: Freshness;
  parts: DumpedTypePart[];
}

export type DumpedPlace =
  | { place: "None" | "Result" | "NativeMemory" }
  | { place: "Operand" | "OwnValues" | "Prototype"; operand: DumpedOperand }
  | { place: "IteratedValues"; operand: DumpedOperand; isSettled: boolean }
  | { place: "Slot"; operand: DumpedOperand; slot: string }
  | { place: "ResultSlot"; slot: string }
  | { place: "ResultField"; index: number; holdsOnlyWhatIsStored: boolean }
  | { place: "NewValue"; type: DumpedType }
  | { place: "Member"; operand: DumpedOperand; path: (string | null)[]; firstStep: number }
  | { place: "NativeCell"; cell: string };

export type DumpedKey =
  | { key: "None" | "Any" | "Indexes" }
  | { key: "Operand" | "ElementsOf"; operand: DumpedOperand }
  | { key: "Names"; names: string[] };

export interface DumpedTransfer {
  from: DumpedPlace;
  to: DumpedPlace;
}

export interface DumpedHandlerCall {
  callee: DumpedPlace;
  times: CallbackTimes;
  thisValue: DumpedPlace;
  arguments: DumpedPlace[];
  resultUse: CallbackResultUse;
}

export interface DumpedCallback {
  callee: DumpedOperand;
  times: CallbackTimes;
  constructs: boolean;
  newTarget: DumpedPlace;
  thisValue: DumpedPlace;
  arguments: DumpedPlace[];
  spreadArguments: DumpedPlace;
  resultUse: CallbackResultUse;
  resultTo: DumpedPlace;
}

export interface DumpedPropertyAction {
  action: PropertyActionKind;
  object: DumpedOperand;
  key: DumpedKey;
  value: DumpedPlace;
  integrityLevel: IntegrityLevel | null;
}

export interface DumpedParameter {
  operand: DumpedOperand;
  mode: ParameterMode;
  accepted: DumpedType;
  conversion: Conversion;
  converted: DumpedType;
  refused: DumpedType;
  admitted: DumpedType | null;
  uses: OperandUse[];
  roles: OperandRole[];
  protocols: Protocol[];
  namedMembers: string[];
  calledMembers: string[];
  convertedMembers: string[];
}

export interface DumpedResult {
  type: DumpedType;
  typesByPlatform?: { platform: TargetPlatform; type: DumpedType }[];
  rangeRule: RangeRule;
  rangeOperand: DumpedOperand | null;
  substringOf: DumpedOperand | null;
  typedResultForm: TypedResultForm;
  typedResultSource: DumpedOperand | null;
  iteratedOperand: DumpedOperand | null;
  iterationKind: IterationKind | null;
  prototypeSource: DumpedOperand | null;
  properties: { name: string; type: DumpedType }[];
}

export interface DumpedImplementation {
  how: ImplementationKind;
  otherwise: Extract<ImplementationKind, "Generic" | "HostCall" | "Compiled"> | null;
  callee: CalleeKind;
  inlineBuiltin: string | null;
  maximumArgumentCount: number | null;
  function: number | null;
}

export interface DumpedOverload {
  token: string;
  path: string;
  mode: CallMode;
  isProvenByConstruction: boolean;
  isUndeclared: boolean;
  textHash: string;
  receiver: DumpedParameter | null;
  parameters: DumpedParameter[];
  result: DumpedResult;
  capability: Capability;
  throws: boolean;
  onlyPropagatesErrors: boolean;
  runsOnlyOperandCode: boolean;
  readsStateBeforeConversions: boolean;
  isSpecialCase: boolean;
  resultIsDeclaredOnly?: true;
  reads: Heap[];
  writes: Heap[];
  transfers: DumpedTransfer[];
  callbacks: DumpedCallback[];
  propertyActions: DumpedPropertyAction[];
  handlerCalls: DumpedHandlerCall[];
  implementation: DumpedImplementation;
  model: number | null;
}

export interface DumpedEntry {
  id: number;
  token: string;
  path: string;
  kind: BuiltinKind;
  origin: Origin;
  scope: Scope;
  mutability: Mutability;
  platforms: TargetPlatform[];
  flags: BuiltinFlag[];
  holder: string | null;
  name: string;
  isSymbolName: boolean;
  prototypeLink: PrototypeLink;
  inheritsFrom: string | null;
  instanceClass: string | null;
  sameObjectAs: string | null;
  overloads: DumpedOverload[];
}

export interface DumpedSlot {
  token: string;
  name: string;
  owner: string;
  heap: Heap;
  contentsSlot: ContentsSlot | null;
  holds: DumpedType | null;
}

export interface DumpedClass {
  token: string;
  origin: Origin;
  parent: string | null;
  constructor: string | null;
  prototype: string | null;
  instanceTest: InstanceTest;
  isPrimitiveWrapper: boolean;
  isNeverPristine: boolean;
  pristineTest: PristineTest;
  hasClosureInstances: boolean;
  definesCharactersOnNewInstances: boolean;
  namesDefinedOnNewInstances: string[] | null;
  slots: DumpedSlot[];
  stateHeap: Heap | null;
}

export interface DumpedLayout {
  token: string;
  isTuple: boolean;
  fields: { name: string | null; isOptional: boolean; type: DumpedType }[];
}

export interface TableDump {
  entries: DumpedEntry[];
  classes: DumpedClass[];
  layouts: DumpedLayout[];
}

export function canonicalTextOf(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalTextOf).join(",")}]`;
  if (typeof value !== "object" || value === null) return JSON.stringify(value);
  const members = Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${members.map(([key, member]) => `${JSON.stringify(key)}:${canonicalTextOf(member)}`).join(",")}}`;
}

export function hashOfEntry(overload: DumpedOverload): string {
  const { textHash: _, model: _model, implementation, ...declared } = overload;
  const { function: _function, ...code } = implementation;
  return createHash("sha256")
    .update(canonicalTextOf({ ...declared, implementation: code }))
    .digest("hex")
    .slice(0, 16);
}

export const needsDifferentialTest = (overload: DumpedOverload): boolean =>
  !overload.isProvenByConstruction && !overload.isUndeclared;

export function findStaleEntries(table: TableDump, listedHashes: ReadonlySet<string>): string[] {
  return table.entries
    .flatMap(entry => entry.overloads)
    .filter(overload => needsDifferentialTest(overload) && !listedHashes.has(overload.textHash))
    .map(overload => overload.token);
}

export function parseVerifiedList(text: string): Set<string> {
  const hashes = new Set<string>();
  for (const line of text.split("\n")) {
    if (line === "" || line.startsWith("#")) continue;
    hashes.add(line.split(" ", 1)[0]);
  }
  return hashes;
}

const unverifiedPrefix = "# unverified ";

export interface UnverifiedOverload {
  token: string;
  reason: string;
}

export function parseUnverifiedList(text: string): Map<string, string> {
  const reasons = new Map<string, string>();
  for (const line of text.split("\n")) {
    if (!line.startsWith(unverifiedPrefix)) continue;
    const [token, ...reason] = line.slice(unverifiedPrefix.length).split(": ");
    reasons.set(token, reason.join(": "));
  }
  return reasons;
}

export function formatVerifiedList(
  origin: Origin,
  overloads: readonly DumpedOverload[],
  unverified: readonly UnverifiedOverload[],
): string {
  const lines = overloads
    .map(overload => `${overload.textHash} ${overload.token}`)
    .sort((left, right) => {
      const leftToken = left.slice(left.indexOf(" "));
      const rightToken = right.slice(right.indexOf(" "));
      return leftToken < rightToken ? -1 : leftToken > rightToken ? 1 : 0;
    });
  return (
    `# Hashes of the hand-written ${origin === "Engine" ? "engine" : "host"} overloads that test/aot/builtins/differential.test.ts has checked.\n` +
    "# Written by: AOT_BUILTINS_UPDATE=1 bun test test/aot/builtins/differential.test.ts\n" +
    unverified
      .map(({ token, reason }) => `${unverifiedPrefix}${token}: ${reason}\n`)
      .sort()
      .join("") +
    lines.map(line => `${line}\n`).join("")
  );
}

export interface VerifiedListPaths {
  engine: string;
  host: string;
}

export const verifiedListPaths = (bunRoot: string, javaScriptCoreDirectory: string): VerifiedListPaths => ({
  engine: `${javaScriptCoreDirectory}/aot/builtins/verified-overloads.txt`,
  host: `${bunRoot}/src/codegen/builtins/data/verified-host-overloads.txt`,
});
