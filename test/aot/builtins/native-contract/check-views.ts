// A small view that is made by a length keeps its bytes in memory of the collector. They move when a buffer is first made for the view, and they go
// when that buffer is detached or cut. Each quiet overload is called with such views, as its receiver and as each argument in turn, wherever it is
// the overload that the compiler finds for the call, and the views are looked at behind the call.
import { arrayBufferViewHasBuffer } from "bun:internal-for-testing";
import { Unavailable, type Candidate } from "../differential/instances";
import { Log } from "../differential/log";
import { perform } from "../differential/observe";
import { parameterOf, takes, type Atom, type DumpedOverload, type DumpedParameter, type OperandUse, type Table } from "../differential/table-description";
import type { Target } from "./targets";

export type QuietTarget = Target & {
  overload: DumpedOverload;
  // The overloads of the entry for the same kind of call, in the order in which the compiler tries them.
  overloads: DumpedOverload[];
};

export type ViewReport = {
  name: string;
  path: string;
  mode: Target["mode"];
  callCount: number;
  returned: number;
  isCutShort: boolean;
  // What became of a view, and in which call.
  changes: string[];
};

type View = ArrayBufferView & { length: number };
type Operand = { name: string; atom: Atom; create(description: string): unknown };

const byteLength = 12;
const makers: Record<string, () => View> = {
  Uint8Array: () => new Uint8Array(byteLength),
  Float32Array: () => new Float32Array(byteLength / 4),
  Buffer: () => Buffer.alloc(byteLength),
};
const fillers: Operand[] = [
  { name: "undefined", atom: "Undefined", create: () => undefined },
  { name: "zero", atom: "Number", create: () => 0 },
  { name: "one", atom: "Number", create: () => 1 },
  { name: "a text", atom: "String", create: () => "a" },
  { name: "an encoding", atom: "String", create: () => "utf8" },
  { name: "true", atom: "Boolean", create: () => true },
  { name: "an object", atom: { class: "Object" }, create: () => ({}) },
  { name: "a list", atom: { class: "Array" }, create: () => [] },
  { name: "a function", atom: "Function", create: () => () => {} },
];
const millisecondsPerTarget = 5_000;
const maxChangesReported = 4;

// A call may give the view another prototype or names of its own.
const getterOf = (name: string) => Reflect.getOwnPropertyDescriptor(Reflect.getPrototypeOf(Uint8Array.prototype)!, name)!.get!;
const [lengthGetter, byteLengthGetter] = [getterOf("length"), getterOf("byteLength")];

export function changeOf(view: View, lengthAsMade: number): string | undefined {
  if (arrayBufferViewHasBuffer(view)) return "a buffer was made for it";
  const bytes = Reflect.apply(byteLengthGetter, view, []);
  if (bytes !== byteLength || Reflect.apply(lengthGetter, view, []) !== lengthAsMade) return `it holds ${bytes} bytes`;
  return undefined;
}

// The positions that the overload speaks of. Behind a rest parameter: two.
function positionsOf({ parameters }: DumpedOverload): number {
  return Math.max(0, ...parameters.map(({ operand }) => (operand === "this" ? 0 : "argument" in operand ? operand.argument + 1 : operand.argumentsFrom + 2)));
}

function fits(table: Table, overload: DumpedOverload, receiver: Atom | undefined, args: Atom[]): boolean {
  if (args.length > positionsOf(overload)) return false;
  if (receiver !== undefined && !takes(table, overload.receiver, receiver)) return false;
  const passed = Array.from({ length: positionsOf(overload) }, (_, position): Atom => args[position] ?? "NotPassed");
  return passed.every((atom, position) => takes(table, parameterOf(overload, position), atom));
}

const usesThatStoreByKey: readonly OperandUse[] = ["StoresByKey", "DeletesByKey", "AssignsFrom", "TakesDescriptor"];
const usesThatCallOperand: readonly OperandUse[] = ["Calls", "CallsPerElement", "CallsRepeatedly"];

function callsBeforeReturn({ callbacks }: DumpedOverload, { operand, uses }: DumpedParameter): boolean {
  if (!uses.some(use => usesThatCallOperand.includes(use))) return false;
  const listed = callbacks.filter(({ callee }) => Bun.deepEquals(callee, operand));
  return listed.length === 0 || listed.some(({ times }) => times !== "Later" && times !== "PerEvent");
}

function takesObjectsByClassAlone({ accepted }: DumpedParameter): boolean {
  if (accepted.isAnything || accepted.hasAnyObject || accepted.hasPlainData) return false;
  return accepted.parts.every(part => part.part === "Instance" && part.contents.length === 0);
}

// With an object there the compiler takes the call for code that nobody knows: addEffectsOn() of the engine's walk/AOTWalkBuiltins.cpp, but for
// what it makes of the protocols, which only takes further calls away.
function isUnknownCodeWithObjectAs(overload: DumpedOverload, parameter: DumpedParameter | null): boolean {
  if (parameter === null) return false;
  if (parameter.uses.some(use => usesThatStoreByKey.includes(use)) || callsBeforeReturn(overload, parameter)) return true;
  return parameter.roles.includes("DescribedWhenRefused") && !takesObjectsByClassAlone(parameter);
}

const isObjectAtom = (atom: Atom | undefined) => typeof atom === "object" || atom === "Function" || atom === "OtherObject";

export async function checkViews(table: Table, target: QuietTarget): Promise<ViewReport> {
  const { name, path, mode, invocation, overload, overloads } = target;
  const report: ViewReport = { name, path, mode, callCount: 0, returned: 0, isCutShort: false, changes: [] };
  const deadline = performance.now() + millisecondsPerTarget;
  const seen = new Set<string>();
  let handed: { view: View; length: number; call: string }[] = [];

  const look = (when: string) => {
    for (const { view, length, call } of handed) {
      const change = changeOf(view, length);
      if (change === undefined || seen.has(change) || report.changes.length === maxChangesReported) continue;
      seen.add(change);
      report.changes.push(`${change} ${when} ${call}`);
    }
  };
  const viewOf = (maker: string): Operand => ({
    name: maker,
    atom: { class: maker },
    create(call) {
      const view = makers[maker]();
      handed.push({ view, length: view.length, call });
      return view;
    },
  });
  // `undefined` for the atom: a receiver that was made for the function.
  const call = (receiver: { name: string; atom: Atom | undefined; create(description: string): unknown }, args: Operand[]) => {
    const atoms = args.map(({ atom }) => atom);
    if (overloads.find(other => fits(table, other, receiver.atom, atoms)) !== overload) return;
    if (isObjectAtom(receiver.atom) && isUnknownCodeWithObjectAs(overload, overload.receiver)) return;
    if (atoms.some((atom, position) => isObjectAtom(atom) && isUnknownCodeWithObjectAs(overload, parameterOf(overload, position)))) return;
    const description = `(${args.map(({ name }) => name).join(", ")}) on ${receiver.name}`;
    let self: unknown;
    try {
      self = receiver.create(description);
    } catch (error) {
      if (error instanceof Unavailable) return;
      throw error;
    }
    report.callCount++;
    try {
      const result = perform(invocation, self, args.map(operand => operand.create(description)));
      report.returned++;
      if (result instanceof Promise) result.catch(() => {});
    } catch {}
    look("behind");
  };
  const ownReceiver = (candidate: Candidate) => ({ name: candidate.name, atom: undefined, create: () => candidate.create(new Log(), 0, { receiver: undefined }) });

  const positions = mode === "Get" ? 0 : positionsOf(overload);
  for (const maker of Object.keys(makers)) {
    // A build in which such a view has a buffer from the start says nothing with it.
    if (arrayBufferViewHasBuffer(makers[maker]())) continue;
    const view = viewOf(maker);
    const own = target.receivers.slice(0, 2).map(ownReceiver);
    for (const beside of [...fillers, view]) {
      if (overload.receiver) call(view, Array.from({ length: positions }, () => beside));
      for (const receiver of own) {
        for (let position = 0; position < positions; position++) {
          if (performance.now() > deadline) report.isCutShort = true;
          else call(receiver, Array.from({ length: positions }, (_, index) => (index === position ? view : beside)));
        }
      }
    }
    // What the call has started may end in a later turn.
    await new Promise(resolve => setImmediate(resolve));
    look("a turn behind");
    handed = [];
  }
  for (const candidate of target.receivers.slice(0, 2)) candidate.release?.(false);
  return report;
}
