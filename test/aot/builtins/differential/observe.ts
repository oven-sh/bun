import { types } from "node:util";
import { Unavailable } from "./instances";
import { Log } from "./log";
import type { Invocation, Realm } from "./members";
import type { Completion, OperandSet, Run } from "./runs";
import { retakeSnapshot, takeSnapshot } from "./snapshots";
import { isObject, unreachable } from "./table-description";

const maxIteratorSteps = 8;
const regExpStateKeys = "input lastMatch lastParen leftContext rightContext $1 $2 $3 $4 $5 $6 $7 $8 $9".split(" ");
const promiseThen = Promise.prototype.then;
const noop = () => {};

export function perform({ mode, callee, key, callsWhatIsRead }: Invocation, receiver: any, args: unknown[]): unknown {
  const read = () => (callee ? Reflect.apply(callee, receiver, []) : receiver[key]);
  switch (mode) {
    case "Construct":
      return Reflect.construct(callsWhatIsRead ? read() : callee!, args);
    case "Call":
      return Reflect.apply(callsWhatIsRead ? read() : callee!, receiver, args);
    case "Get":
      return read();
    case "Set":
      if (callee) Reflect.apply(callee, receiver, args);
      else receiver[key] = args[0];
      return undefined;
    default:
      return unreachable(mode);
  }
}

function complete(invocation: Invocation, receiver: unknown, args: unknown[]): Completion {
  try {
    return { kind: "Returned", value: perform(invocation, receiver, args) };
  } catch (error) {
    return { kind: "Threw", error };
  }
}

function readRegExpState(): string {
  return regExpStateKeys.map(key => String(Reflect.get(RegExp, key))).join("\0");
}

function withoutRecording<T>(log: Log, action: () => T): T {
  const wasRecording = log.isRecording;
  log.isRecording = false;
  try {
    return action();
  } finally {
    log.isRecording = wasRecording;
  }
}

function handleRejection(log: Log, value: unknown): void {
  if (types.isPromise(value)) withoutRecording(log, () => Reflect.apply(promiseThen, value, [noop, noop]));
}

function nextMethodOf(log: Log, value: unknown): Function | undefined {
  if (!isObject(value) || log.originOf(value) !== undefined || types.isProxy(value)) return undefined;
  if (typeof value === "function" || types.isPromise(value)) return undefined;
  const next: unknown = withoutRecording(log, () => {
    try {
      return Reflect.get(value, "next");
    } catch {
      return undefined;
    }
  });
  return typeof next === "function" && log.originOf(next) === undefined ? next : undefined;
}

async function stepIterator(log: Log, iterator: unknown): Promise<unknown[]> {
  const next = nextMethodOf(log, iterator);
  const yielded: unknown[] = [];
  if (!next) return yielded;
  try {
    for (let step = 0; step < maxIteratorSteps; step++) {
      let result: any = Reflect.apply(next, iterator, []);
      if (types.isPromise(result)) result = await result;
      if (!isObject(result) || log.originOf(result) !== undefined) break;
      const { done, value } = result as IteratorResult<unknown>;
      if (done) break;
      yielded.push(value);
    }
  } catch {}
  return yielded;
}

// Only code of an operand shows that something runs later, and only a job or a task can run it.
async function waitForTasks(set: OperandSet, delay: number): Promise<void> {
  const hasCode = [set.receiver, ...set.arguments].some(candidate => candidate.kind === "Instrumented");
  if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
  else if (hasCode) await new Promise(resolve => setImmediate(resolve));
  else for (let turn = 0; turn < 4; turn++) await undefined;
}

function release(value: unknown): void {
  if (!isObject(value) || types.isProxy(value)) return;
  try {
    const name = Reflect.getPrototypeOf(value)?.constructor?.name;
    if (name === "Timeout") clearTimeout(value as any);
    else if (name === "Immediate") clearImmediate(value as any);
  } catch {}
}

export type RunOptions = { lateDelay?: number };

function isRepeatable({ mode }: Invocation, { receiver, arguments: candidates }: OperandSet): boolean {
  if (mode === "Get") return true;
  if (mode !== "Call") return false;
  const hasPlainReceiver = receiver.name === "holder" || receiver.kind === "Primitive";
  return hasPlainReceiver && candidates.every(candidate => candidate.kind === "Primitive");
}

// A store to a member of a built-in object would stay for every later call.
function saveMember({ mode, key }: Invocation, realm: Realm, receiver: unknown): (() => void) | undefined {
  if (mode !== "Set" || !isObject(receiver) || !realm.isKnownObject(receiver)) return undefined;
  const descriptor = Reflect.getOwnPropertyDescriptor(receiver, key);
  if (descriptor && Object.hasOwn(descriptor, "value")) {
    // A store reaches what native code keeps beside the property, and a definition does not: the engine goes on calling what was last stored to Error.prepareStackTrace.
    return () => {
      Reflect.set(receiver, key, descriptor.value);
      if (!Bun.deepEquals(Reflect.getOwnPropertyDescriptor(receiver, key), descriptor, true)) Reflect.defineProperty(receiver, key, descriptor);
    };
  }
  if (!descriptor) return () => Reflect.deleteProperty(receiver, key);
  try {
    const value = Reflect.get(receiver, key);
    return () => Reflect.set(receiver, key, value);
  } catch {
    return undefined;
  }
}

export async function runSet(
  realm: Realm,
  invocation: Invocation,
  set: OperandSet,
  { lateDelay = 0 }: RunOptions = {},
): Promise<Run | undefined> {
  const log = new Log();
  const candidates = [set.receiver, ...set.arguments];
  let receiver: unknown;
  let args: unknown[];
  for (const candidate of candidates) await candidate.prepare?.();
  try {
    receiver = set.receiver.create(log, "this", { receiver: undefined });
    args = set.arguments.map((candidate, index) => candidate.create(log, index, { receiver }));
  } catch (error) {
    if (error instanceof Unavailable) return undefined;
    throw error;
  }
  const before = takeSnapshot(log, [receiver, ...args], value => realm.isKnownObject(value));
  const regExpStateBefore = readRegExpState();
  const restoreMember = saveMember(invocation, realm, receiver);

  log.isRecording = true;
  const completion = complete(invocation, receiver, args);
  const hasChangedRegExpState = readRegExpState() !== regExpStateBefore;
  log.isLate = true;
  const result = completion.kind === "Returned" ? completion.value : undefined;
  handleRejection(log, result);
  await waitForTasks(set, lateDelay);
  log.isStepping = true;
  const yielded = await stepIterator(log, result);
  log.isRecording = false;

  const after = retakeSnapshot(log, before);
  const repeated = isRepeatable(invocation, set) ? complete(invocation, receiver, args) : undefined;
  if (repeated?.kind === "Returned") {
    handleRejection(log, repeated.value);
    release(repeated.value);
  }
  release(result);
  for (const candidate of candidates) candidate.release?.();
  try {
    restoreMember?.();
  } catch {}
  return {
    set,
    log,
    receiver,
    args,
    completion,
    repeated,
    before,
    after,
    yielded,
    hasChangedRegExpState,
  };
}
