type Callee = (...values: unknown[]) => unknown;
type Form = (callee: Callee, list: unknown) => unknown;
type Caller = (form: Form, callee: Callee, list: unknown) => unknown;

function throwCompiled(value: unknown): unknown {
  throw new TypeError("compiled " + String(value));
}
function applyAgain(value: unknown): unknown {
  return throwCompiled.apply(undefined, { length: 1, 0: value } as any);
}
const throwInterpreted = new Function("value", "throw new TypeError('interpreted ' + String(value));") as Callee;
function returnValue(value: unknown): unknown {
  return value;
}

const kept: unknown[] = [];
function keep<T>(value: T): T {
  kept.push(value);
  return kept.pop() as T;
}
function* callsAtSecondStep(callee: Callee, list: unknown): Generator<unknown, void, unknown> {
  yield 1;
  yield callee((list as any)[0]);
}
function* delegates(inner: Iterable<unknown>): Generator<unknown, void, unknown> {
  yield* inner;
}
function callsInNext(callee: Callee, list: unknown): Iterable<unknown> {
  return {
    [Symbol.iterator]() {
      let count = 0;
      return { next: () => (count++ ? { value: callee((list as any)[0]), done: false } : { value: 1, done: false }) };
    },
  };
}
function callsWhileOpening(callee: Callee, list: unknown): Iterable<unknown> {
  return {
    [Symbol.iterator]() {
      const value = callee((list as any)[0]);
      return { next: () => ({ value, done: true }) };
    },
  };
}
function last(values: Iterable<unknown>): unknown {
  let seen: unknown;
  for (const value of values) seen = value;
  return seen;
}
function secondStep(generator: Generator<unknown, void, unknown>): unknown {
  generator.next();
  return generator.next().value;
}
function secondStepByName(iterator: Iterator<unknown, void, unknown>): unknown {
  iterator.next();
  return iterator.next().value;
}

const callees: Array<[string, Callee]> = [
  ["interpreted callee", throwInterpreted],
  ["compiled callee", throwCompiled],
  ["compiled callee applying again", applyAgain],
];

const forms: Array<[string, Form]> = [
  ["apply", (callee, list) => callee.apply(undefined, list as any)],
  ["spread of a set", (callee, list) => callee(...new Set([(list as any)[0]]))],
  ["bound apply", (callee, list) => Function.prototype.bind.call(callee, undefined).apply(undefined, list as any)],
  ["proxy apply", (callee, list) => new Proxy(returnValue, { apply: (_target, _receiver, values) => callee(values[0]) }).apply(undefined, list as any)],
  ["plain call", (callee, list) => callee((list as any)[0])],
  ["step of a declared generator", (callee, list) => secondStep(keep(callsAtSecondStep(callee, list)))],
  ["step of a generator by name", (callee, list) => secondStepByName(keep(callsAtSecondStep(callee, list)))],
  ["loop over a generator", (callee, list) => last(keep(callsAtSecondStep(callee, list)))],
  ["delegation to a generator", (callee, list) => last(keep(delegates(keep(callsAtSecondStep(callee, list)))))],
  ["spread of a generator", (callee, list) => [...keep(callsAtSecondStep(callee, list))]],
  ["loop over an iterator a user wrote", (callee, list) => last(keep(callsInNext(callee, list)))],
  ["opening of an iterable a user wrote", (callee, list) => last(keep(callsWhileOpening(callee, list)))],
  ["spread of an iterable a user wrote", (callee, list) => [...keep(callsInNext(callee, list))]],
];

const lists: Array<[string, () => unknown]> = [
  ["array-like", () => ({ length: 1, 0: "a" })],
  ["throwing length", () => ({ get length(): number { throw new RangeError("length"); }, 0: "a" })],
];

const callers: Array<[string, Caller]> = [
  ["interpreted caller", new Function("form", "callee", "list", "return form(callee, list);") as Caller],
  ["reviver", (form, callee, list) => JSON.parse("1", () => form(callee, list))],
  ["compiled caller", (form, callee, list) => [form(callee, list)]],
];

export const exceptionRows: Record<string, () => number> = {};
export const asyncExceptionRows: Record<string, () => Promise<number>> = {};
for (const [formName, form] of forms) {
  for (const [calleeName, callee] of callees) {
    for (const [listName, list] of lists) {
      for (const [callerName, caller] of callers) {
        exceptionRows[callerName + ", " + formName + ", " + calleeName + ", " + listName] = () => {
          try {
            caller(form, callee, list());
            return 0;
          } catch {
            return 1;
          }
        };
      }
      asyncExceptionRows["promise reaction, " + formName + ", " + calleeName + ", " + listName] = async () => {
        try {
          await Promise.resolve(list()).then(value => form(callee, value));
          return 0;
        } catch {
          return 1;
        }
      };
    }
  }
}
