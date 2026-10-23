// What is called: every overload of the table without a declaration or with a general one, every native binding, and every function of the objects that
// native bindings answer, for which the entry of the binding speaks, and the functions under private names of the global object.
import * as internals from "bun:internal-for-testing";
import { types } from "node:util";
import { everyCandidate, operandOrigin, Unavailable, undefinedCandidate, type Candidate } from "../differential/instances";
import { Log } from "../differential/log";
import type { Invocation, Realm } from "../differential/members";
import { reasonNeverCalled } from "../differential/operands";
import { claimsEveryUse, isObject, type CallMode, type DumpedEntry, type DumpedOverload, type OperandUse } from "../differential/table-description";

export type Target = {
  name: string;
  path: string;
  mode: CallMode;
  isInTable: boolean;
  // What the entry of a native binding declares for the function, or for every function of the object that the binding answers.
  declaredUses: OperandUse[];
  invocation: Invocation;
  // The values the function is made for, if any can be made.
  receivers: Candidate[];
  hasOwnReceiver: boolean;
  // The `length` of the function, and how many arguments it is called with: more than that, to see what it does with the rest.
  length: number;
  argumentCount: number;
};
export type Unreachable = { name: string; path: string; mode: CallMode; reason: string; isSkipped: boolean };

const neverCalledNatives: ReadonlyMap<RegExp, string> = new Map([
  // The differential test calls these with the operands that their entries name. Here they would get everything.
  [/^process\.(binding|_linkedBinding|chdir|_rawDebug|stdout|stderr)\b/, "it changes the state of the process or takes over a standard stream"],
  [/^(alert|confirm|prompt)$/, "it waits for input"],
  [/^Atomics\.(waitAsync|pause)$/, "it blocks the thread"],
  [/^(fetch|postMessage)$/, "it starts a thread or opens a connection"],
  [/^%ModuleRequire%/, "it loads whatever its operand names"],
  [/crash_handler_jsc|^%CrashHandlerJsc|restartProcess|jsFunctionReportUncaughtException|setSyntheticAllocationLimitForTesting/i, "it ends the process or makes it fail"],
  [/BunDebugger\.cpp|console\.takeHeapSnapshot|jsFunction_(start|stop|collect)\w*(Profiler|Coverage)/, "it opens the inspector, waits for it or profiles the process"],
  [/spawnThreadsForTesting|createNodeWorker|jsFunctionPostMessage|^Bun\.WebView|^Bun\.Terminal$/, "it starts a thread, a process or a terminal"],
  [/ffi\.bind\.ts:cc$|\.FfiBindTsCc$|^%FFI%|napi_body/i, "it compiles or loads machine code"],
  [/^Bun\.FFI\.(CString|closeCallback|toArrayBuffer|toBuffer)$/, "it takes a number for an address, and reads or frees what is there"],
  [/upgrade_?command|install_?binding|trim_testing|patch_testing\.?bind\.?ts:?apply|npmManifestTestHelpers|readTarball|loadNpmrc/i, "it works on files that its operands name outside the folder of the test"],
  [/setSocketFault|clearSocketFaults|jsSetAsyncHooksEnabled|psiTrigger|injectStdioReadError|setMax\w+ForTesting|emitMemoryPressure|seedCacheForTesting/i, "it changes how the rest of the process behaves"],
  [/^%EventEmitter%\.prototype\.(removeAllListeners|off|removeListener|emit|setMaxListeners)$|^dispatchEvent$/, "with its own receiver it takes away or runs the handlers of the process"],
  [/^Bun\.Image\.(fromClipboard|hasClipboardImage|clipboardChangeCount)$/, "it reads the clipboard"],
  [/^Bun\.plugin\b|setConfigPlugins|setPages|checkFramework/, "it changes how modules are loaded"],
  [/doConnect|clusterRawBind|sendHelperPrimary|emitHandleIPCMessage/, "it opens a connection or writes to the channel of a parent process"],
  [/^%(Quic\w+|PostgresSQL\w+|MySQL\w+|PostgresBinding|MysqlBinding)%|node_quic_binding|postgres\.bind\.ts|mysql\.bind\.ts/, "it needs a server that the test does not have"],
  [
    /isLiveCellAtRawAddress|createNoOpForTesting|parseRoutePattern|jsFunction_arrayBufferViewHasBuffer|setServerCustomOptions|^%AsyncFromSyncIterator%|^%LinkTimeConstant:|^%NodeCryptoBinding%\.Cipher$|^private global makeErrorWithCode ERR_INVALID_ARG_VALUE$/,
    "only the code of Bun and of the engine calls it, and it takes the kinds of its operands on trust",
  ],
  [
    /createNativeFrameForTesting|orderedRemoveProbe|noProxyMatches|createStatsForIno|describeCheckerQueries|createMemfdForTesting|jsFunction_readFreedStringUnderASAN/i,
    "a helper of Bun's own tests that takes the kinds of its operands on trust or reads freed memory on purpose",
  ],
  [
    /shellLex|shellParse|proxy_testing\.?bind\.?ts:?proxyFor|(operatingSystem|architecture)IsMatch|compareCodeResolution|describeCodeGraph/i,
    "a helper of Bun's own tests that does not come back for some operands",
  ],
]);

export function reasonTargetIsSkipped(path: string): string | undefined {
  for (const [pattern, reason] of neverCalledNatives) if (pattern.test(path)) return reason;
  return reasonNeverCalled(path);
}

const sampleClasses = new WeakMap<Candidate, string[]>();

function classesOfCandidate(realm: Realm, candidate: Candidate): string[] {
  if (candidate.instanceOf !== undefined) return realm.table.ancestryOf(candidate.instanceOf);
  if (candidate.kind !== "Pristine" || candidate.prepare) return [];
  let classes = sampleClasses.get(candidate);
  if (classes) return classes;
  try {
    classes = realm.classesOf(candidate.create(new Log(), 0, { receiver: undefined }));
  } catch (error) {
    if (!(error instanceof Unavailable)) throw error;
    classes = [];
  }
  sampleClasses.set(candidate, classes);
  return classes;
}

const constructorArguments: (() => unknown[])[] = [() => [], () => [{}], () => ["a"], () => [1], () => [new Uint8Array(8)], () => ["a", {}]];

function constructedCandidate(name: string, classConstructor: Function): Candidate {
  return {
    name: `constructed:${name}`,
    kind: "Pristine",
    create(log, operand) {
      for (const createArguments of constructorArguments) {
        try {
          const value = Reflect.construct(classConstructor, createArguments());
          log.identify(value, operandOrigin(operand));
          return value;
        } catch {}
      }
      throw new Unavailable(`new ${name}() threw`);
    },
  };
}

function isAvailable(candidate: Candidate): boolean {
  if (candidate.prepare) return true;
  try {
    candidate.create(new Log(), 0, { receiver: undefined });
    candidate.release?.();
    return true;
  } catch {
    return false;
  }
}

function instancesOf(realm: Realm, classToken: string): Candidate[] {
  const made = everyCandidate.filter(candidate => classesOfCandidate(realm, candidate).includes(classToken));
  if (made.length > 0) return made.slice(0, 2);
  const classConstructor = realm.valueOf(realm.table.classes.get(classToken)?.constructor ?? null);
  if (typeof classConstructor !== "function" || reasonTargetIsSkipped(realm.table.entries.get(realm.table.classes.get(classToken)!.constructor!)!.path)) return [];
  const constructed = constructedCandidate(classToken, classConstructor);
  return isAvailable(constructed) ? [constructed] : [];
}

function fixedCandidate(name: string, value: unknown): Candidate {
  return { name, kind: "Pristine", create: () => value };
}

function receiversOf(realm: Realm, entry: DumpedEntry, mode: CallMode): { receivers: Candidate[]; hasOwnReceiver: boolean } {
  if (mode === "Construct" || entry.holder === null || entry.holder === "GlobalThis") return { receivers: [undefinedCandidate], hasOwnReceiver: true };
  const holder = realm.table.entries.get(entry.holder);
  if (holder?.kind !== "Prototype") return { receivers: [fixedCandidate("holder", realm.valueOf(entry.holder))], hasOwnReceiver: true };
  const classToken = realm.table.dump.classes.find(({ prototype }) => prototype === entry.holder)?.token;
  const receivers = classToken === undefined ? [] : instancesOf(realm, classToken);
  return { receivers, hasOwnReceiver: receivers.length > 0 };
}

const minArgumentCount = 2;
const maxArgumentCount = 5;

function lengthOf(callee: Function | undefined): number {
  const length: unknown = callee && Reflect.getOwnPropertyDescriptor(callee, "length")?.value;
  return typeof length === "number" ? length : 0;
}

// Functions that take any number of operands, whatever their `length` says.
const variadicFunctions = /^native:Cpp:Path\.cpp:/;

function argumentCountOf(path: string, mode: CallMode, callee: Function | undefined): number {
  if (mode === "Get") return 0;
  if (mode === "Set") return 1;
  if (variadicFunctions.test(path)) return maxArgumentCount;
  return Math.min(Math.max(lengthOf(callee), minArgumentCount), maxArgumentCount);
}

const operandsOf = ({ receiver, parameters }: DumpedOverload) => [...(receiver ? [receiver] : []), ...parameters];

// Nobody wrote what it does to an operand: it has no declaration, or a generator gave an operand every use for want of one.
export const isDescribedByNobody = (overload: DumpedOverload) =>
  overload.isUndeclared || (overload.isProvenByConstruction && operandsOf(overload).some(claimsEveryUse));

// An entry for whatever the function is handed: it says which kinds of change there are and nothing else about the single operands.
// A class definition that declares a result gets such an entry too.
function isDescribedInGeneral(overload: DumpedOverload): boolean {
  const operands = operandsOf(overload);
  return (
    operands.length > 0 &&
    !operands.some(claimsEveryUse) &&
    operands.every(({ uses, protocols }) => uses.includes("Retains") && !uses.includes("Calls") && protocols.length === 0)
  );
}

function declaredUsesOf(entry: DumpedEntry, mode: CallMode): OperandUse[] {
  const declared = entry.overloads.filter(overload => overload.mode === mode && !isDescribedByNobody(overload));
  return declared.flatMap(overload => operandsOf(overload).flatMap(({ uses }) => uses));
}

function targetOfOverload(realm: Realm, entry: DumpedEntry, mode: CallMode, name: string): Target | Unreachable {
  const unreachable = (reason: string, isSkipped = false): Unreachable => ({ name, path: entry.path, mode, reason, isSkipped });
  const reason = reasonTargetIsSkipped(entry.path);
  if (reason !== undefined) return unreachable(reason, true);
  if (entry.holder !== null && realm.valueOf(entry.holder) === undefined) return unreachable("this realm does not have its holder");
  const invocation = realm.invocationOf(entry, mode);
  if (!invocation) return unreachable(isObject(realm.valueOf(entry.token)) ? "it is an object, and its members are called" : "this realm does not have it");
  return {
    name,
    path: entry.path,
    mode,
    isInTable: true,
    declaredUses: declaredUsesOf(entry, mode),
    invocation,
    ...receiversOf(realm, entry, mode),
    length: lengthOf(invocation.callee),
    argumentCount: argumentCountOf(entry.path, mode, invocation.callee),
  };
}

const maxBindingDepth = 2;

function isNative(value: Function): boolean {
  try {
    return Function.prototype.toString.call(value).includes("[native code]");
  } catch {
    return false;
  }
}

function ownFunctions(holder: object): [string, Function][] {
  return Reflect.ownKeys(holder).flatMap((key): [string, Function][] => {
    const descriptor = Reflect.getOwnPropertyDescriptor(holder, key)!;
    const name = String(key);
    return [descriptor.value, descriptor.get, descriptor.set].flatMap((value, index): [string, Function][] =>
      typeof value === "function" && name !== "constructor" ? [[index === 0 ? name : `${index === 1 ? "get" : "set"} ${name}`, value]] : [],
    );
  });
}

// A binding is a function, a constructor, or an object or array of them.
function collectBindingMembers(
  realm: Realm,
  entry: DumpedEntry,
  path: string,
  value: unknown,
  depth: number,
  seen: Set<object>,
  targets: (Target | Unreachable)[],
): void {
  if (!isObject(value) || types.isProxy(value) || seen.has(value) || depth > maxBindingDepth) return;
  seen.add(value);
  const add = (name: string, callee: Function, receivers: Candidate[], hasOwnReceiver: boolean, mode: CallMode) => {
    const memberPath = `${path} ${name}`;
    const reason = reasonTargetIsSkipped(memberPath);
    if (reason !== undefined) {
      targets.push({ name: memberPath, path: memberPath, mode, reason, isSkipped: true });
      return;
    }
    targets.push({
      name: mode === "Construct" ? `${memberPath} (new)` : memberPath,
      path: memberPath,
      mode,
      isInTable: false,
      declaredUses: declaredUsesOf(entry, mode),
      invocation: { mode, callee, key: name, callsWhatIsRead: false },
      receivers,
      hasOwnReceiver,
      length: lengthOf(callee),
      argumentCount: argumentCountOf(memberPath, mode, callee),
    });
  };
  for (const [name, member] of ownFunctions(value)) {
    if (realm.isKnownObject(member) || !isNative(member)) continue;
    if (depth > 0 || typeof value !== "function") add(name, member, [fixedCandidate("holder", value)], true, "Call");
    collectClassMembers(realm, `${path} ${name}`, member, seen, add);
    collectBindingMembers(realm, entry, `${path} ${name}`, member, depth + 1, seen, targets);
  }
  if (typeof value === "function") collectClassMembers(realm, path, value, seen, add);
  for (const key of Reflect.ownKeys(value)) {
    const held = Reflect.getOwnPropertyDescriptor(value, key)?.value;
    if (isObject(held) && typeof held !== "function" && !realm.isKnownObject(held)) {
      collectBindingMembers(realm, entry, `${path} ${String(key)}`, held, depth + 1, seen, targets);
    }
  }
}

type AddMember = (name: string, callee: Function, receivers: Candidate[], hasOwnReceiver: boolean, mode: CallMode) => void;

function collectClassMembers(realm: Realm, path: string, classConstructor: Function, seen: Set<object>, add: AddMember): void {
  const prototype = Reflect.getOwnPropertyDescriptor(classConstructor, "prototype")?.value;
  if (!isObject(prototype) || seen.has(prototype) || realm.isKnownObject(prototype)) return;
  seen.add(prototype);
  add("", classConstructor, [undefinedCandidate], true, "Construct");
  const instance = constructedCandidate(path, classConstructor);
  const receivers = reasonTargetIsSkipped(path) === undefined && isAvailable(instance) ? [instance] : [];
  for (const [name, member] of ownFunctions(prototype)) {
    if (isNative(member) && !realm.isKnownObject(member)) add(`prototype.${name}`, member, receivers, receivers.length > 0, "Call");
  }
}

export function collectTargets(realm: Realm, filter: RegExp): (Target | Unreachable)[] {
  const targets: (Target | Unreachable)[] = [];
  const seen = new Set<object>();
  const { entries } = realm.table.dump;
  for (const entry of entries) {
    if (!filter.test(entry.path)) continue;
    for (const overload of entry.overloads) {
      // What a native binding answers takes no operand.
      const speaksForFunctionsOfBinding = entry.kind === "NativeBinding" && overload.mode !== "Get";
      if (isDescribedByNobody(overload) || isDescribedInGeneral(overload) || speaksForFunctionsOfBinding) targets.push(targetOfOverload(realm, entry, overload.mode, overload.token));
    }
    if (entry.kind !== "NativeBinding" || reasonTargetIsSkipped(entry.path) !== undefined) continue;
    collectBindingMembers(realm, entry, entry.path, realm.valueOf(entry.token), 0, seen, targets);
  }
  for (const [name, callee] of Object.entries(internals.privateGlobalFunctions ?? {})) {
    const path = `private global ${name}`;
    if (!filter.test(path)) continue;
    const reason = reasonTargetIsSkipped(path);
    if (reason !== undefined) {
      targets.push({ name: path, path, mode: "Call", reason, isSkipped: true });
      continue;
    }
    const entry = entries.find(entry => entry.path === `%PrivateGlobals%.${name.split(" ")[0]}`);
    targets.push({
      name: path,
      path,
      mode: "Call",
      isInTable: false,
      declaredUses: entry ? declaredUsesOf(entry, "Call") : [],
      invocation: { mode: "Call", callee, key: name, callsWhatIsRead: false },
      receivers: [undefinedCandidate],
      hasOwnReceiver: true,
      length: callee.length,
      argumentCount: Math.max(callee.length, 1),
    });
  }
  return targets;
}
