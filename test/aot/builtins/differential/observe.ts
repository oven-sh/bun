import { types } from "node:util";
import { Unavailable, type Candidate } from "./instances";
import { Log } from "./log";
import type { Invocation, Realm } from "./members";
import type { Completion, OperandSet, Run } from "./runs";
import { retakeSnapshot, takeSnapshot } from "./snapshots";
import { isObject, unreachable } from "./table-description";

const maxIteratorSteps = 8;
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

// A match that no call makes: while it is the last one, no call has made any.
const markOfNoMatch = "no built-in has matched anything since";
const matchingTheMark = new RegExp(`^${markOfNoMatch}$`);
const execute = RegExp.prototype.exec;
const lastInput = Reflect.getOwnPropertyDescriptor(RegExp, "input")!.get!;
const lastMatch = Reflect.getOwnPropertyDescriptor(RegExp, "lastMatch")!.get!;

function markRegExpState(): void {
  matchingTheMark.lastIndex = 0;
  Reflect.apply(execute, matchingTheMark, [markOfNoMatch]);
}

function hasMarkedRegExpState(): boolean {
  return Reflect.apply(lastInput, RegExp, []) === markOfNoMatch && Reflect.apply(lastMatch, RegExp, []) === markOfNoMatch;
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

async function stepIterator(log: Log, iterator: unknown, next: Function): Promise<unknown[]> {
  const yielded: unknown[] = [];
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
async function waitForTasks(sets: readonly OperandSet[], delay: number): Promise<void> {
  const hasCode = sets.some(set => [set.receiver, ...set.arguments].some(candidate => candidate.kind === "Instrumented"));
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

// `leavesOperandsAsMade`: whether the next call may have the operands of this one that take time to make.
export type RunOptions = { lateDelay?: number; leavesOperandsAsMade?(run: Run): boolean };

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

// There is one such value at a time.
const isHeldByCandidate = ({ prepare, release }: Candidate) => prepare !== undefined || release !== undefined;
const isMadeAhead = ({ receiver, arguments: candidates }: OperandSet) => isHeldByCandidate(receiver) || candidates.some(isHeldByCandidate);

type Begun = Omit<Run, "after" | "repeated" | "yielded"> & { restoreMember: (() => void) | undefined };

function begin(realm: Realm, invocation: Invocation, set: OperandSet): Begun | undefined {
  const log = new Log();
  let receiver: unknown;
  let args: unknown[];
  try {
    receiver = set.receiver.create(log, "this", { receiver: undefined });
    args = set.arguments.map((candidate, index) => candidate.create(log, index, { receiver }));
  } catch (error) {
    if (error instanceof Unavailable) return undefined;
    throw error;
  }
  const before = takeSnapshot(log, [receiver, ...args], value => realm.isKnownObject(value));
  const restoreMember = saveMember(invocation, realm, receiver);
  markRegExpState();

  log.isRecording = true;
  const completion = complete(invocation, receiver, args);
  const hasChangedRegExpState = !hasMarkedRegExpState();
  log.isLate = true;
  if (completion.kind === "Returned") handleRejection(log, completion.value);
  return { set, log, receiver, args, completion, before, hasChangedRegExpState, restoreMember };
}

const nothingYielded: unknown[] = [];

function end(invocation: Invocation, begun: Begun, options: RunOptions): Run | Promise<Run> {
  const { log, completion } = begun;
  const result = completion.kind === "Returned" ? completion.value : undefined;
  log.isStepping = true;
  const next = nextMethodOf(log, result);
  return next ? stepIterator(log, result, next).then(yielded => finish(invocation, begun, yielded, options)) : finish(invocation, begun, nothingYielded, options);
}

function finish(invocation: Invocation, { restoreMember, ...begun }: Begun, yielded: unknown[], { leavesOperandsAsMade }: RunOptions): Run {
  const { set, log, receiver, args, completion, before } = begun;
  const result = completion.kind === "Returned" ? completion.value : undefined;
  log.isRecording = false;

  const after = retakeSnapshot(log, before);
  const repeated = isRepeatable(invocation, set) ? complete(invocation, receiver, args) : undefined;
  if (repeated?.kind === "Returned") {
    handleRejection(log, repeated.value);
    release(repeated.value);
  }
  release(result);
  try {
    restoreMember?.();
  } catch {}
  const run: Run = { ...begun, repeated, after, yielded };
  if (isMadeAhead(set)) {
    const isAsMade = leavesOperandsAsMade?.(run) ?? false;
    for (const candidate of [set.receiver, ...set.arguments]) candidate.release?.(isAsMade);
  }
  return run;
}

/** One call with each set. The calls are made one behind the other, and what they leave for later has one wait to run in. */
export async function runSets(
  realm: Realm,
  invocation: Invocation,
  sets: readonly OperandSet[],
  options: RunOptions = {},
): Promise<(Run | undefined)[]> {
  // A store to a member of a built-in object is taken back before the next one.
  if (sets.length > 1 && (invocation.mode === "Set" || sets.some(isMadeAhead))) {
    const runs: (Run | undefined)[] = [];
    for (const set of sets) runs.push(...(await runSets(realm, invocation, [set], options)));
    return runs;
  }
  for (const set of sets) for (const candidate of [set.receiver, ...set.arguments]) await candidate.prepare?.();
  const begun = sets.map(set => begin(realm, invocation, set));
  await waitForTasks(sets, options.lateDelay ?? 0);
  const runs: (Run | undefined)[] = [];
  for (const one of begun) {
    const ended = one && end(invocation, one, options);
    runs.push(ended instanceof Promise ? await ended : ended);
  }
  return runs;
}

export async function runSet(realm: Realm, invocation: Invocation, set: OperandSet, options: RunOptions = {}): Promise<Run | undefined> {
  return (await runSets(realm, invocation, [set], options))[0];
}
