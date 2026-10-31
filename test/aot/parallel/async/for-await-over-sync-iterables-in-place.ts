// `for await` over what is only sync iterable: arrays, sets, maps, strings, generators and iterators written by hand. Every call of next() and return() with its number of arguments, every read of
// `done` and `value` (`value` is read when done, too), every then() of an element and every turn is as in plain Bun: with an empty job queue, where nothing needs to wait, and beside other jobs;
// in a function that a job has entered, in one that has never been suspended and in an async generator; when the loop runs to its end, breaks, returns or throws; for elements that are fulfilled,
// pending and rejected promises (a rejection closes the iterator) and thenables; and when next(), return() or one of the getters throws or answers with something else than an object.
const settled = Promise.resolve();
const lines: string[] = [];
let log: string[] = [];

interface Ticker {
  count: number;
  isOn: boolean;
}
let ticker: Ticker | null = null;
function startTicker(): void {
  const own: Ticker = { count: 0, isOn: true };
  const step = (): void => {
    if (!own.isOn) return;
    own.count++;
    settled.then(step);
  };
  ticker = own;
  settled.then(step);
}
function stopTicker(): void {
  if (ticker) ticker.isOn = false;
  ticker = null;
}
function note(text: string): void {
  log.push(ticker ? text + " @" + ticker.count : text);
}
function show(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value);
}
function messageOf(error: unknown): string {
  if (error instanceof TypeError) return "a TypeError";
  return error instanceof Error ? error.message : show(error);
}
function afterTimer(): Promise<void> {
  return new Promise<void>(resolve => {
    setTimeout(resolve, 0);
  });
}
function afterTwoJobs<T>(value: T): Promise<T> {
  return new Promise<T>(resolve => {
    settled.then(() => settled.then(() => resolve(value)));
  });
}
function afterATimer<T>(value: T): Promise<T> {
  return new Promise<T>(resolve => {
    setTimeout(() => resolve(value), 0);
  });
}
function rejected(message: string): Promise<never> {
  const promise = Promise.reject(new RangeError(message));
  promise.catch(() => {});
  return promise;
}
function rejectedAfterTwoJobs(message: string): Promise<never> {
  const promise = new Promise<never>((_, reject) => {
    settled.then(() => settled.then(() => reject(new RangeError(message))));
  });
  promise.catch(() => {});
  return promise;
}
function thenable(label: string, settle: (resolve: (value: unknown) => void, reject: (reason: unknown) => void) => void): any {
  return {
    then(resolve: (value: unknown) => void, reject: (reason: unknown) => void): void {
      note("then of " + label);
      settle(resolve, reject);
    },
  };
}
class OwnPromise<T> extends Promise<T> {}

function* generated(items: unknown[]): Generator<unknown, string, unknown> {
  try {
    for (const item of items) {
      note("the generator yields");
      yield item;
    }
    return "returned";
  } finally {
    note("the generator is closed");
  }
}
// An iterator that reports how it is used. A missing `close` leaves it without a return().
function counter(items: unknown[], close?: () => unknown): any {
  return {
    [Symbol.iterator](): unknown {
      note("iterator");
      let i = 0;
      const iterator: any = {
        next(): unknown {
          note("next/" + arguments.length);
          return i < items.length ? { done: false, value: items[i++] } : { done: true, value: "the end" };
        },
      };
      if (close) {
        const closes = close;
        iterator.return = function (): unknown {
          note("return/" + arguments.length);
          return closes();
        };
      }
      return iterator;
    },
  };
}
function withGetters(items: unknown[]): any {
  return {
    [Symbol.iterator](): unknown {
      let i = 0;
      return {
        next(): unknown {
          const index = i++;
          note("next");
          return {
            get done(): boolean {
              note("done " + index);
              return index >= items.length;
            },
            get value(): unknown {
              note("value " + index);
              return index < items.length ? items[index] : "the end";
            },
          };
        },
        get return(): unknown {
          note("return is read");
          return function (): unknown {
            note("return/" + arguments.length);
            return {
              get done(): boolean {
                note("done of return");
                return true;
              },
              get value(): unknown {
                note("value of return");
                return "closed";
              },
            };
          };
        },
      };
    },
  };
}
function answers(results: (() => unknown)[]): any {
  return {
    [Symbol.iterator](): unknown {
      let i = 0;
      return {
        next(): unknown {
          note("next");
          return i < results.length ? results[i++]() : { done: true, value: undefined };
        },
        return(): unknown {
          note("return");
          return {};
        },
      };
    },
  };
}
function fails(message: string): never {
  throw new RangeError(message);
}
const closed = (): unknown => ({ done: true, value: undefined });

type Source = () => any;
// The third entry is true where a timer settles an element: such a loop cannot end while another chain of jobs keeps the queue busy.
const sources: [label: string, source: Source, needsTimers?: boolean][] = [
  ["numbers", () => [1, 2, 3]],
  ["nothing", () => []],
  ["one number", () => [1]],
  ["a hole", () => [1, , 3]],
  ["other values", () => ["text", null, undefined, 1.5, true, { n: 1 }, [2]]],
  ["a set", () => new Set(["a", "b"])],
  ["a map", () => new Map([["k", 1], ["l", 2]])],
  ["keys of a map", () => new Map([[1, 1], [2, 2]]).keys()],
  ["a string", () => "a\u{1F600}b"],
  ["a typed array", () => new Uint8Array([7, 8])],
  ["values of an array", () => [5, 6].values()],
  ["entries of an array", () => ["p", "q"].entries()],
  ["a generator", () => generated([1, 2, 3])],
  ["a generator of promises", () => generated([Promise.resolve(1), afterTwoJobs(2), 3])],
  ["a generator that yields a rejected promise", () => generated([1, rejected("rejected"), 3])],
  ["an iterator", () => counter([1, 2, 3], closed)],
  ["an iterator without return", () => counter([1, 2, 3])],
  ["getters", () => withGetters([1, 2])],
  ["getters and promises", () => withGetters([Promise.resolve(1), afterTwoJobs(2)])],
  ["fulfilled promises", () => [Promise.resolve(1), Promise.resolve(2), Promise.resolve(3)]],
  ["promises fulfilled after two jobs", () => [afterTwoJobs(1), 2, afterTwoJobs(3)]],
  ["promises fulfilled by timers", () => [afterATimer(1), 2, afterATimer(3)], true],
  ["a promise of a promise", () => [Promise.resolve(Promise.resolve(1)), 2]],
  ["a rejected promise in an array", () => [1, rejected("rejected"), 3]],
  ["a rejected promise first", () => counter([rejected("rejected"), 2], closed)],
  ["a rejected promise from an iterator", () => counter([1, rejected("rejected"), 3], closed)],
  ["a rejected promise from an iterator without return", () => counter([1, rejected("rejected"), 3])],
  ["a promise rejected after two jobs", () => counter([1, rejectedAfterTwoJobs("rejected late"), 3], closed)],
  ["a rejection, and return throws", () => counter([1, rejected("rejected"), 3], () => fails("return throws"))],
  ["a rejected promise as the last value", () => answers([() => ({ done: false, value: 1 }), () => ({ done: true, value: rejected("rejected at the end") })])],
  ["thenables", () => counter([thenable("a", resolve => resolve(1)), thenable("b", resolve => void settled.then(() => resolve(2))), 3], closed)],
  ["a thenable that gives a thenable", () => [thenable("outer", resolve => resolve(thenable("inner", resolveInner => resolveInner(1)))), 2]],
  ["a thenable that rejects", () => counter([1, thenable("c", (_, reject) => reject(new RangeError("rejected by then"))), 3], closed)],
  ["a thenable that throws", () => counter([1, thenable("d", () => fails("then throws")), 3], closed)],
  ["a thenable that settles twice", () => counter([thenable("e", (resolve, reject) => (resolve(1), reject(new RangeError("too late")), resolve(2))), 3], closed)],
  [
    "a then that cannot be read",
    () =>
      counter(
        [
          1,
          {
            get then(): unknown {
              note("then is read");
              return fails("then cannot be read");
            },
          },
          3,
        ],
        closed,
      ),
  ],
  ["a then that is no function", () => [{ then: 1 }, { then: null }]],
  [
    "a promise with its own then",
    () => {
      const promise: any = Promise.resolve(1);
      promise.then = function (this: any, onFulfilled: any, onRejected: any): unknown {
        note("its own then");
        return Promise.prototype.then.call(this, onFulfilled, onRejected);
      };
      return [promise, 2];
    },
  ],
  [
    "a promise whose constructor is read",
    () => {
      const promise = Promise.resolve(1);
      Object.defineProperty(promise, "constructor", {
        get(): unknown {
          note("constructor is read");
          return Promise;
        },
      });
      return [promise, 2];
    },
  ],
  [
    "a promise with another constructor",
    () => {
      const promise = Promise.resolve(1);
      Object.defineProperty(promise, "constructor", { value: OwnPromise });
      return [promise, 2];
    },
  ],
  ["promises of a subclass", () => [OwnPromise.resolve(1), 2, OwnPromise.resolve(3)]],
  ["next throws at once", () => answers([() => fails("next throws")])],
  ["next throws later", () => answers([() => ({ done: false, value: 1 }), () => fails("next throws")])],
  ["next answers with a number", () => answers([() => ({ done: false, value: 1 }), () => 5])],
  ["next answers with undefined", () => answers([() => undefined])],
  ["next answers with a promise", () => answers([() => Promise.resolve({ done: false, value: 1 })])],
  ["next answers with an empty object", () => answers([() => ({}), () => ({}), () => ({ done: true })])],
  ["done in other words", () => answers([() => ({ done: 0, value: 1 }), () => ({ done: "", value: 2 }), () => ({ done: null, value: 3 }), () => ({ done: "no", value: 4 }), () => ({ done: false, value: 5 })])],
  [
    "done throws",
    () =>
      answers([
        () => ({ done: false, value: 1 }),
        () => ({
          get done(): boolean {
            return fails("done throws");
          },
          value: 2,
        }),
      ]),
  ],
  [
    "value throws",
    () =>
      answers([
        () => ({ done: false, value: 1 }),
        () => ({
          done: false,
          get value(): unknown {
            return fails("value throws");
          },
        }),
      ]),
  ],
  [
    "value throws when done",
    () =>
      answers([
        () => ({ done: false, value: 1 }),
        () => ({
          done: true,
          get value(): unknown {
            return fails("value throws when done");
          },
        }),
      ]),
  ],
  ["Symbol.iterator throws", () => ({ [Symbol.iterator]: () => fails("Symbol.iterator throws") })],
  ["Symbol.iterator answers with a number", () => ({ [Symbol.iterator]: () => 5 })],
  ["Symbol.iterator is no function", () => ({ [Symbol.iterator]: 5 })],
  ["next is no function", () => ({ [Symbol.iterator]: () => ({ next: 5 }) })],
  ["no next", () => ({ [Symbol.iterator]: () => ({}) })],
  ["not iterable", () => ({})],
  ["null", () => null],
  ["a number", () => 5],
  ["Symbol.asyncIterator is undefined", () => Object.assign(counter([1, 2], closed), { [Symbol.asyncIterator]: undefined })],
  ["Symbol.asyncIterator is null", () => Object.assign(counter([1, 2], closed), { [Symbol.asyncIterator]: null })],
  [
    "Symbol.asyncIterator is read",
    () =>
      Object.defineProperty(counter([1, 2], closed), Symbol.asyncIterator, {
        get(): unknown {
          note("Symbol.asyncIterator is read");
          return undefined;
        },
      }),
  ],
  ["return throws", () => counter([1, 2, 3], () => fails("return throws"))],
  ["return answers with a number", () => counter([1, 2, 3], () => 5)],
  ["return answers with a promise as its value", () => counter([1, 2, 3], () => ({ done: true, value: afterTwoJobs("closed late") }))],
  ["return answers with a rejected promise as its value", () => counter([1, 2, 3], () => ({ done: true, value: rejected("rejected by return") }))],
  ["return answers that it is not done", () => counter([1, 2, 3], () => ({ done: false, value: "not done" }))],
  ["return is null", () => ({ [Symbol.iterator]: () => Object.assign(counter([1, 2, 3])[Symbol.iterator](), { return: null }) })],
  ["return is no function", () => ({ [Symbol.iterator]: () => Object.assign(counter([1, 2, 3])[Symbol.iterator](), { return: 5 }) })],
];

type Consumer = (source: Source) => Promise<void>;
async function toTheEnd(source: Source): Promise<void> {
  await null;
  try {
    for await (const value of source()) note("sees " + show(value));
    note("ends");
  } catch (error) {
    note("caught " + messageOf(error));
  }
}
async function neverSuspendedBefore(source: Source): Promise<void> {
  try {
    for await (const value of source()) note("sees " + show(value));
    note("ends");
  } catch (error) {
    note("caught " + messageOf(error));
  }
}
async function breaks(source: Source): Promise<void> {
  await null;
  let seen = 0;
  try {
    for await (const value of source()) {
      note("sees " + show(value));
      if (++seen === 2) break;
    }
    note("ends");
  } catch (error) {
    note("caught " + messageOf(error));
  }
}
async function returnsFromTheLoop(source: Source): Promise<string> {
  for await (const value of source()) {
    note("sees " + show(value));
    return "returned from the loop";
  }
  return "returned behind the loop";
}
async function returns(source: Source): Promise<void> {
  await null;
  try {
    note(await returnsFromTheLoop(source));
  } catch (error) {
    note("caught " + messageOf(error));
  }
}
async function throws(source: Source): Promise<void> {
  await null;
  try {
    for await (const value of source()) {
      note("sees " + show(value));
      fails("thrown in the loop");
    }
    note("ends");
  } catch (error) {
    note("caught " + messageOf(error));
  }
}
async function awaitsInTheLoop(source: Source): Promise<void> {
  await null;
  try {
    for await (const value of source()) {
      note("sees " + show(value));
      await settled;
      note("goes on");
    }
    note("ends");
  } catch (error) {
    note("caught " + messageOf(error));
  }
}
async function* passesOn(source: Source): AsyncGenerator<unknown, void, unknown> {
  try {
    for await (const value of source()) {
      note("passes on " + show(value));
      yield value;
    }
    note("the async generator ends");
  } catch (error) {
    note("the async generator caught " + messageOf(error));
  }
}
async function throughAnAsyncGenerator(source: Source): Promise<void> {
  await null;
  for await (const value of passesOn(source)) note("gets " + show(value));
  note("ends");
}
async function leavesAnAsyncGenerator(source: Source): Promise<void> {
  await null;
  try {
    for await (const value of passesOn(source)) {
      note("gets " + show(value));
      break;
    }
    note("ends");
  } catch (error) {
    note("caught " + messageOf(error));
  }
}
async function twoAtOnce(source: Source): Promise<void> {
  await Promise.all([toTheEnd(source), neverSuspendedBefore(source)]);
}
const consumers: [label: string, consume: Consumer][] = [
  ["to the end", toTheEnd],
  ["never suspended before", neverSuspendedBefore],
  ["breaks", breaks],
  ["returns", returns],
  ["throws", throws],
  ["awaits in the loop", awaitsInTheLoop],
  ["through an async generator", throughAnAsyncGenerator],
  ["leaves an async generator", leavesAnAsyncGenerator],
  ["two at once", twoAtOnce],
];

for (const [consumerLabel, consume] of consumers) {
  for (const withOtherJobs of [false, true]) {
    lines.push("== " + consumerLabel + (withOtherJobs ? ", beside other jobs" : ", alone"));
    for (const [label, source, needsTimers] of sources) {
      if (withOtherJobs && needsTimers) continue;
      log = [];
      await afterTimer();
      if (withOtherJobs) startTicker();
      await consume(source);
      stopTicker();
      lines.push(label + ": " + log.join(" | "));
    }
  }
}

async function sums(list: Iterable<number | Promise<number>>): Promise<number> {
  let sum = 0;
  for await (const value of list) sum += value;
  return sum;
}
const many: number[] = [];
for (let i = 0; i < 20000; i++) many.push(i);
lines.push("== long loops");
await afterTimer();
lines.push("an array: " + (await sums(many)));
lines.push("a set: " + (await sums(new Set(many))));
lines.push("fulfilled promises: " + (await sums(many.map(n => Promise.resolve(n)))));
lines.push("two arrays at once: " + (await Promise.all([sums(many), sums(many)])).join(" "));
console.log(lines.join("\n"));

export {};
