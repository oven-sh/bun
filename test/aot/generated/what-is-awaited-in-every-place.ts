// bun what-is-awaited-in-every-place.ts <folder> writes <folder>/<place>-<seen | hidden>.ts
//
// Every kind of thing that can be awaited, in every place where the language waits for a value. Beside each case runs a chain of jobs that counts
// turns of the job queue, so a line says after how many turns the case went on, with what, and which of its own steps ran in between.
// Each case runs once more alone, with no other job in the queue.
// A program holds one place and all the things. In `seen` the expression stands in the place; in `hidden` it comes through a function that the compiler does not look through.
// Only syntax that can be erased, so that Node runs the programs too.
import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

interface Awaited {
  name: string;
  /** The expression, as it stands in the place. `note` is in scope. */
  text: string;
  /** Declarations at the top of the program. */
  before?: string;
  /** TypeScript rejects `await` of it, so the typed program reaches it through `unknown`. */
  isNoValidOperand?: true;
}

const awaitedThings: Awaited[] = [
  { name: "undefined", text: `undefined` },
  { name: "null", text: `null` },
  { name: "integer", text: `7` },
  { name: "double", text: `0.5` },
  { name: "text", text: `"text"` },
  { name: "bigint", text: `10n` },
  { name: "symbol", text: `Symbol.for("s")` },
  { name: "object", text: `{ a: 1 }` },
  { name: "array", text: `[1, 2]` },
  { name: "function", text: `() => 1` },
  {
    name: "instance",
    text: `new Plain(3)`,
    before: `class Plain {\n  n: number;\n  constructor(n: number) {\n    this.n = n;\n  }\n}`,
  },
  { name: "object-whose-then-is-a-number", text: `{ then: 5 }` },
  { name: "object-whose-then-is-undefined", text: `{ then: undefined }` },

  { name: "resolved", text: `Promise.resolve(1)` },
  { name: "resolved-with-an-object", text: `Promise.resolve({ a: 1 })` },
  { name: "rejected", text: `Promise.reject(new Error("rejected"))` },
  { name: "rejected-with-undefined", text: `Promise.reject(undefined)` },
  { name: "resolved-in-the-executor", text: `new Promise<number>(resolve => resolve(1))` },
  { name: "rejected-in-the-executor", text: `new Promise<number>((_, reject) => reject(new Error("executor")))` },
  { name: "executor-throws", text: `new Promise<number>(() => {\n    throw new Error("executor threw");\n  })` },
  {
    name: "executor-resolves-and-throws",
    text: `new Promise<number>(resolve => {\n    resolve(1);\n    throw new Error("too late");\n  })`,
  },
  { name: "resolved-a-job-later", text: `new Promise<number>(resolve => queueMicrotask(() => resolve(1)))` },
  {
    name: "rejected-a-job-later",
    text: `new Promise<number>((_, reject) => queueMicrotask(() => reject(new Error("later"))))`,
  },
  { name: "resolved-three-jobs-later", text: `Promise.resolve().then(() => {}).then(() => {}).then(() => 1)` },
  { name: "resolved-with-a-promise", text: `new Promise<number>(resolve => resolve(Promise.resolve(1)))` },
  {
    name: "resolved-with-a-rejected-promise",
    text: `new Promise<number>(resolve => resolve(Promise.reject(new Error("inner"))))`,
  },
  { name: "resolve-of-a-promise", text: `Promise.resolve(Promise.resolve(1))` },
  { name: "settled-long-ago", text: `settledLongAgo`, before: `const settledLongAgo = Promise.resolve("old");` },
  {
    name: "rejected-long-ago",
    text: `rejectedLongAgo`,
    before: `const rejectedLongAgo = Promise.reject(new Error("old"));\nrejectedLongAgo.catch(() => {});`,
  },
  { name: "then-of-a-promise", text: `Promise.resolve(1).then(value => value + 1)` },
  { name: "then-that-throws", text: `Promise.resolve(1).then(() => {\n    throw new Error("in then");\n  })` },
  { name: "catch-that-recovers", text: `Promise.reject(new Error("x")).catch(() => "recovered")` },
  { name: "finally-of-a-promise", text: `Promise.resolve(1).finally(() => note("finally ran"))` },
  { name: "finally-that-throws", text: `Promise.resolve(1).finally(() => {\n    throw new Error("in finally");\n  })` },
  { name: "all", text: `Promise.all([1, Promise.resolve(2)])` },
  { name: "all-of-nothing", text: `Promise.all([])` },
  { name: "all-with-a-rejection", text: `Promise.all([Promise.resolve(1), Promise.reject(new Error("one of all"))])` },
  { name: "all-settled", text: `Promise.allSettled([Promise.resolve(1), Promise.reject(2)])` },
  { name: "race", text: `Promise.race([new Promise<number>(() => {}), Promise.resolve(2)])` },
  { name: "any-of-rejections", text: `Promise.any([Promise.reject(1), Promise.reject(2)])` },
  {
    name: "with-resolvers",
    text: `resolvedFromOutside()`,
    before: `function resolvedFromOutside() {\n  const { promise, resolve } = Promise.withResolvers<number>();\n  resolve(4);\n  return promise;\n}`,
  },

  {
    name: "thenable",
    text: `{\n    then(resolve: (value: number) => void) {\n      note("then called");\n      resolve(1);\n    },\n  }`,
  },
  {
    name: "thenable-that-rejects",
    text: `{\n    then(_: (value: number) => void, reject: (reason: unknown) => void) {\n      reject(new Error("thenable"));\n    },\n  }`,
  },
  {
    name: "thenable-that-throws",
    text: `{\n    then(_: (value: number) => void) {\n      throw new Error("then threw");\n    },\n  }`,
  },
  {
    name: "thenable-that-resolves-and-throws",
    text: `{\n    then(resolve: (value: number) => void) {\n      resolve(1);\n      throw new Error("ignored");\n    },\n  }`,
  },
  {
    name: "thenable-that-settles-three-times",
    text: `{\n    then(resolve: (value: number) => void, reject: (reason: unknown) => void) {\n      resolve(1);\n      reject(new Error("second"));\n      resolve(3);\n    },\n  }`,
  },
  {
    name: "thenable-that-resolves-later",
    text: `{\n    then(resolve: (value: number) => void) {\n      queueMicrotask(() => resolve(1));\n    },\n  }`,
  },
  {
    name: "thenable-of-a-thenable",
    text: `{\n    then(resolve: (value: PromiseLike<number>) => void) {\n      note("outer then");\n      resolve({\n        then(inner: any) {\n          note("inner then");\n          inner(2);\n          return undefined as any;\n        },\n      });\n    },\n  }`,
    isNoValidOperand: true,
  },
  {
    name: "thenable-of-a-promise",
    text: `{\n    then(resolve: (value: Promise<number>) => void) {\n      resolve(Promise.resolve(3));\n    },\n  }`,
    isNoValidOperand: true,
  },
  {
    name: "thenable-of-itself",
    text: `selfish`,
    before: `const selfish = {\n  calls: 0,\n  then(resolve: (value: unknown) => void) {\n    resolve(++this.calls < 3 ? this : "enough");\n  },\n};`,
    isNoValidOperand: true,
  },
  {
    name: "then-is-a-getter",
    text: `{\n    get then() {\n      note("then read");\n      return (resolve: (value: number) => void) => resolve(1);\n    },\n  }`,
  },
  {
    name: "then-is-a-getter-that-throws",
    text: `{\n    get then(): undefined {\n      throw new Error("getter");\n    },\n  }`,
  },
  {
    name: "then-is-a-getter-that-answers-once",
    text: `onceThenable()`,
    before: `function onceThenable() {\n  let reads = 0;\n  return {\n    get then() {\n      return reads++ ? undefined : (resolve: (value: string) => void) => resolve("first read");\n    },\n  };\n}`,
    isNoValidOperand: true,
  },
  {
    name: "then-on-the-class",
    text: `new Later(5)`,
    before: `class Later {\n  n: number;\n  constructor(n: number) {\n    this.n = n;\n  }\n  then(resolve: (value: number) => void) {\n    note("Later.then");\n    resolve(this.n);\n  }\n}`,
  },
  {
    name: "then-on-the-parent-class",
    text: `new MuchLater(6)`,
    before: `class LaterBase {\n  then(resolve: (value: string) => void) {\n    resolve("from the parent");\n  }\n}\nclass MuchLater extends LaterBase {\n  n: number;\n  constructor(n: number) {\n    super();\n    this.n = n;\n  }\n}`,
  },
  {
    name: "then-on-a-function",
    text: `Object.assign(() => 1, {\n    then(resolve: (value: string) => void) {\n      resolve("function with then");\n    },\n  })`,
  },
  {
    name: "then-stored-afterwards",
    text: `thenStoredAfterwards()`,
    before: `function thenStoredAfterwards() {\n  const made: { n: number; then?: (resolve: (value: string) => void) => void } = { n: 1 };\n  made.then = resolve => resolve("stored afterwards");\n  return made;\n}`,
    isNoValidOperand: true,
  },
  {
    name: "then-deleted-again",
    text: `thenDeletedAgain()`,
    before: `function thenDeletedAgain() {\n  const made: { n: number; then?: (resolve: (value: string) => void) => void } = { n: 1, then: resolve => resolve("no") };\n  delete made.then;\n  return made;\n}`,
    isNoValidOperand: true,
  },
  {
    name: "then-that-takes-nothing",
    text: `{\n    then() {\n      note("then without parameters");\n      queueMicrotask(giveUp);\n    },\n  }`,
    isNoValidOperand: true,
  },
  {
    name: "proxy-of-an-object",
    text: `new Proxy({ a: 1 }, {\n    get(target, key, receiver) {\n      note("get " + String(key));\n      return Reflect.get(target, key, receiver);\n    },\n  })`,
  },
  { name: "proxy-of-a-promise", text: `new Proxy(Promise.resolve(1), {})` },
  {
    name: "proxy-whose-get-throws",
    text: `new Proxy({}, {\n    get() {\n      throw new Error("trap");\n    },\n  })`,
  },
  {
    name: "revoked-proxy",
    text: `revoked()`,
    before: `function revoked() {\n  const { proxy, revoke } = Proxy.revocable({}, {});\n  revoke();\n  return proxy;\n}`,
  },

  { name: "subclass", text: `Mine.resolve(1)`, before: `class Mine<T> extends Promise<T> {}` },
  {
    name: "subclass-with-its-own-then",
    text: `Loud.resolve(1)`,
    before: `class Loud<T> extends Promise<T> {\n  then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: any) => B | PromiseLike<B>) | null): Promise<A | B> {\n    note("Loud.then");\n    return super.then(onFulfilled, onRejected);\n  }\n}`,
  },
  {
    name: "subclass-with-another-species",
    text: `Odd.resolve(1)`,
    before: `class Odd<T> extends Promise<T> {\n  static get [Symbol.species]() {\n    note("species read");\n    return Promise;\n  }\n}`,
  },
  {
    name: "promise-with-its-own-then",
    text: `Object.assign(Promise.resolve(1), {\n    then(resolve: (value: string) => void) {\n      note("own then");\n      resolve("own");\n    },\n  })`,
    isNoValidOperand: true,
  },
  { name: "promise-with-its-own-constructor", text: `Object.assign(Promise.resolve(1), { constructor: Object })` },
  {
    name: "promise-whose-constructor-is-a-getter",
    text: `Object.defineProperty(Promise.resolve(1), "constructor", {\n    get() {\n      note("constructor read");\n      return Promise;\n    },\n  })`,
  },
  {
    name: "promise-whose-constructor-throws",
    text: `Object.defineProperty(Promise.resolve(1), "constructor", {\n    get() {\n      throw new Error("constructor getter");\n    },\n  })`,
  },
  { name: "promise-without-a-prototype", text: `Object.setPrototypeOf(Promise.resolve(1), null)` },
  {
    name: "promise-under-another-prototype",
    text: `Object.setPrototypeOf(Promise.resolve(1), {\n    then(resolve: (value: string) => void) {\n      resolve("other prototype");\n    },\n  })`,
  },
  { name: "promise-with-another-property", text: `Object.assign(Promise.resolve(1), { extra: 1 })` },
  { name: "frozen-promise", text: `Object.freeze(Promise.resolve(1))` },

  {
    name: "async-function",
    text: `answers()`,
    before: `async function answers() {\n  note("answers runs");\n  return 1;\n}`,
  },
  {
    name: "async-function-that-throws",
    text: `throwsAtOnce()`,
    before: `async function throwsAtOnce(): Promise<number> {\n  throw new Error("at once");\n}`,
  },
  {
    name: "async-function-that-waits",
    text: `waits()`,
    before: `async function waits() {\n  await null;\n  note("waits went on");\n  return 2;\n}`,
  },
  {
    name: "async-function-that-waits-twice",
    text: `waitsTwice()`,
    before: `async function waitsTwice() {\n  await null;\n  await null;\n  return 3;\n}`,
  },
  {
    name: "async-function-that-waits-and-throws",
    text: `waitsAndThrows()`,
    before: `async function waitsAndThrows(): Promise<number> {\n  await null;\n  throw new Error("after waiting");\n}`,
  },
  {
    name: "async-function-that-returns-a-promise",
    text: `returnsPromise()`,
    before: `async function returnsPromise() {\n  return Promise.resolve(4);\n}`,
  },
  {
    name: "async-function-that-returns-a-rejection",
    text: `returnsRejection()`,
    before: `async function returnsRejection(): Promise<number> {\n  return Promise.reject(new Error("returned"));\n}`,
  },
  {
    name: "async-function-that-returns-a-thenable",
    text: `returnsThenable()`,
    before: `async function returnsThenable(): Promise<number> {\n  return {\n    then(resolve: (value: number) => void) {\n      note("returned then");\n      resolve(5);\n    },\n  } as PromiseLike<number>;\n}`,
  },
  {
    name: "async-function-that-returns-an-awaited-promise",
    text: `returnsAwaited()`,
    before: `async function returnsAwaited() {\n  return await Promise.resolve(6);\n}`,
  },
  {
    name: "async-function-that-returns-another",
    text: `handsOn()`,
    before: `async function last() {\n  await null;\n  return 7;\n}\nasync function handsOn() {\n  return last();\n}`,
  },
  {
    name: "async-function-that-awaits-another",
    text: `awaitsAnother()`,
    before: `async function innermost() {\n  await null;\n  return 8;\n}\nasync function awaitsAnother() {\n  return (await innermost()) + 1;\n}`,
  },
  {
    name: "async-function-whose-finally-answers",
    text: `finallyAnswers()`,
    before: `async function finallyAnswers() {\n  try {\n    throw new Error("lost");\n  } finally {\n    return "finally";\n  }\n}`,
  },
  {
    name: "async-function-whose-parameter-throws",
    text: `badDefault()`,
    before: `async function badDefault(value: number = fails()) {\n  return value;\n}\nfunction fails(): number {\n  throw new Error("default");\n}`,
  },
  { name: "async-arrow", text: `(async () => 9)()` },
  {
    name: "async-method",
    text: `holder.method()`,
    before: `const holder = {\n  n: 10,\n  async method() {\n    await null;\n    return this.n;\n  },\n};`,
  },
  {
    name: "async-static-method",
    text: `Statics.make()`,
    before: `class Statics {\n  static async make() {\n    return new Statics();\n  }\n}`,
  },
  {
    name: "async-function-by-call",
    text: `answersByCall.call(null)`,
    before: `async function answersByCall() {\n  return 11;\n}`,
  },
  {
    name: "bound-async-function",
    text: `boundAnswers()`,
    before: `const boundAnswers = async function (this: { n: number }) {\n  return this.n;\n}.bind({ n: 12 });`,
  },
  {
    name: "function-that-returns-a-promise",
    text: `plainMaker()`,
    before: `function plainMaker() {\n  return Promise.resolve(13);\n}`,
  },
  {
    name: "function-that-throws",
    text: `plainThrower()`,
    before: `function plainThrower(): Promise<number> {\n  throw new Error("no promise at all");\n}`,
  },
  { name: "step-of-an-async-generator", text: `counts().next()`, before: `async function* counts() {\n  yield 1;\n}` },
  {
    name: "step-of-an-async-generator-that-throws",
    text: `breaks().next()`,
    before: `async function* breaks(): AsyncGenerator<number> {\n  throw new Error("generator");\n}`,
  },
  {
    name: "return-of-an-async-generator",
    text: `counts2().return(5)`,
    before: `async function* counts2(): AsyncGenerator<number, number | void> {\n  yield 1;\n}`,
  },
  {
    name: "throw-of-an-async-generator",
    text: `counts3().throw(new Error("thrown in"))`,
    before: `async function* counts3() {\n  yield 1;\n}`,
  },
  { name: "text-of-a-response", text: `new Response("body").text()` },
  {
    name: "promise-of-another-realm",
    text: `otherRealm()`,
    before: `import { runInNewContext } from "node:vm";\nfunction otherRealm(): Promise<number> {\n  return runInNewContext("Promise.resolve(14)");\n}`,
  },
];

interface Place {
  name: string;
  /** Declarations of one case. `E` stands for the awaited expression, `N` for the number of the case. They define `caseN(): Promise<unknown>`. */
  text: string;
}

const places: Place[] = [
  { name: "statement", text: `async function caseN() {\n  const value = await E;\n  return value;\n}` },
  {
    name: "try",
    text: `async function caseN() {\n  try {\n    return ["try", await E];\n  } catch (error) {\n    note("caught at " + turns());\n    throw error;\n  } finally {\n    note("finally at " + turns());\n  }\n}`,
  },
  {
    name: "finally",
    text: `async function caseN() {\n  try {\n    note("body");\n  } finally {\n    note("got " + show(await E));\n  }\n  return "behind";\n}`,
  },
  {
    name: "catch",
    text: `async function caseN() {\n  try {\n    throw new Error("first");\n  } catch {\n    return await E;\n  }\n}`,
  },
  {
    name: "return-await",
    text: `async function innerN() {\n  return await E;\n}\nasync function caseN() {\n  return await innerN();\n}`,
  },
  {
    name: "return",
    text: `async function innerN() {\n  return E;\n}\nasync function caseN() {\n  return await innerN();\n}`,
  },
  {
    name: "return-in-try",
    text: `async function innerN() {\n  try {\n    return E;\n  } finally {\n    note("left at " + turns());\n  }\n}\nasync function caseN() {\n  return await innerN();\n}`,
  },
  { name: "arrow", text: `const innerN = async () => await E;\nasync function caseN() {\n  return await innerN();\n}` },
  { name: "arrow-body", text: `const innerN = async () => E;\nasync function caseN() {\n  return await innerN();\n}` },
  {
    name: "method",
    text: `class HolderN {\n  tag = "N";\n  async run() {\n    const value = await E;\n    return [this.tag, value];\n  }\n}\nasync function caseN() {\n  return await new HolderN().run();\n}`,
  },
  {
    name: "private-static-method",
    text: `class HolderN {\n  static async #run() {\n    return await E;\n  }\n  static go() {\n    return HolderN.#run();\n  }\n}\nasync function caseN() {\n  return await HolderN.go();\n}`,
  },
  {
    name: "super-method",
    text: `class BaseN {\n  async run(): Promise<unknown> {\n    return await E;\n  }\n}\nclass DerivedN extends BaseN {\n  async run(): Promise<unknown> {\n    return ["derived", await super.run()];\n  }\n}\nasync function caseN() {\n  return await new DerivedN().run();\n}`,
  },
  {
    name: "three-deep",
    text: `async function thirdN() {\n  return E;\n}\nasync function secondN() {\n  return await thirdN();\n}\nasync function firstN() {\n  const value = await secondN();\n  note("first at " + turns());\n  return value;\n}\nasync function caseN() {\n  return await firstN();\n}`,
  },
  {
    name: "twice",
    text: `async function caseN() {\n  const first = await E;\n  note("between at " + turns());\n  const second = await E;\n  return [first, second];\n}`,
  },
  {
    name: "loop",
    text: `async function caseN() {\n  const got: unknown[] = [];\n  for (let turn = 0; turn < 3; turn++) {\n    got.push(await E);\n    note("turn " + turn + " at " + turns());\n  }\n  return got;\n}`,
  },
  {
    name: "arguments",
    text: `function pairN(a: unknown, b: unknown) {\n  return [a, b];\n}\nasync function caseN() {\n  return pairN(await E, await E);\n}`,
  },
  {
    name: "operand",
    text: `async function caseN() {\n  let live = turns() + 100;\n  const text = "<" + live + show(await E) + live++ + ">";\n  return text + live;\n}`,
  },
  {
    name: "default-of-a-pattern",
    text: `async function caseN() {\n  const { value = await E }: { value?: unknown } = {};\n  return value;\n}`,
  },
  { name: "condition", text: `async function caseN() {\n  if (await E) return "truthy";\n  return "falsy";\n}` },
  {
    name: "either-arm",
    text: `async function caseN() {\n  const value = turns() >= 0 ? await E : await null;\n  return value;\n}`,
  },
  {
    name: "behind-another-await",
    text: `async function caseN() {\n  await null;\n  note("went on at " + turns());\n  return await E;\n}`,
  },
  {
    name: "not-awaited-at-once",
    text: `async function caseN() {\n  const pending = E;\n  note("made");\n  await null;\n  return await pending;\n}`,
  },
  {
    name: "yield",
    text: `async function* streamN() {\n  const sent: unknown = yield E;\n  note("sent " + show(sent));\n}\nasync function caseN() {\n  const stream = streamN();\n  const step = await stream.next();\n  note("step at " + turns());\n  return [step, await stream.next("back")];\n}`,
  },
  {
    name: "yield-in-try",
    text: `async function* streamN() {\n  try {\n    yield E;\n  } catch (error) {\n    note("inside caught " + show(error));\n    yield "recovered";\n  } finally {\n    note("cleanup at " + turns());\n  }\n}\nasync function caseN() {\n  const stream = streamN();\n  return [await stream.next(), await stream.next()];\n}`,
  },
  {
    name: "return-of-an-async-generator",
    text: `async function* streamN() {\n  return E;\n}\nasync function caseN() {\n  return await streamN().next();\n}`,
  },
  {
    name: "await-in-an-async-generator",
    text: `async function* streamN() {\n  yield ["awaited", await E];\n}\nasync function caseN() {\n  return await streamN().next();\n}`,
  },
  {
    name: "yield-star-of-a-list",
    text: `async function* streamN() {\n  yield* [E];\n}\nasync function caseN() {\n  return await streamN().next();\n}`,
  },
  {
    name: "yield-star-of-an-async-generator",
    text: `async function* sourceN() {\n  yield E;\n}\nasync function* streamN() {\n  return yield* sourceN();\n}\nasync function caseN() {\n  const stream = streamN();\n  return [await stream.next(), await stream.next()];\n}`,
  },
  {
    name: "for-await-of-a-list",
    text: `async function caseN() {\n  const got: unknown[] = [];\n  for await (const value of [E, E]) {\n    got.push(value);\n    note("value at " + turns());\n  }\n  return got;\n}`,
  },
  {
    name: "for-await-of-an-async-generator",
    text: `async function* streamN() {\n  yield E;\n  yield E;\n}\nasync function caseN() {\n  const got: unknown[] = [];\n  for await (const value of streamN()) {\n    got.push(value);\n    note("value at " + turns());\n  }\n  return got;\n}`,
  },
  {
    name: "for-await-of-a-generator",
    text: `function* sourceN() {\n  try {\n    yield E;\n    yield E;\n  } finally {\n    note("source closed at " + turns());\n  }\n}\nasync function caseN() {\n  const got: unknown[] = [];\n  for await (const value of sourceN()) got.push(value);\n  return got;\n}`,
  },
  {
    name: "for-await-of-a-hand-written-iterator",
    text: `async function caseN() {\n  let steps = 0;\n  const source = {\n    [Symbol.asyncIterator]() {\n      return {\n        next(): any {\n          return steps++ ? { done: true, value: undefined } : { done: false, value: E };\n        },\n        return(): any {\n          note("return called");\n          return {};\n        },\n      };\n    },\n  };\n  const got: unknown[] = [];\n  for await (const value of source) got.push(show(value));\n  return got;\n}`,
  },
  {
    name: "step-of-a-hand-written-iterator",
    text: `async function caseN() {\n  let steps = 0;\n  const source = {\n    [Symbol.asyncIterator]() {\n      return {\n        next(): any {\n          return steps++ ? { done: true, value: undefined } : E;\n        },\n      };\n    },\n  };\n  const got: unknown[] = [];\n  for await (const value of source) got.push(show(value));\n  return got;\n}`,
  },
  {
    name: "close-of-a-hand-written-iterator",
    text: `async function caseN() {\n  const source = {\n    [Symbol.asyncIterator]() {\n      return {\n        next(): any {\n          return { done: false, value: 1 };\n        },\n        return(): any {\n          note("return called at " + turns());\n          return E;\n        },\n      };\n    },\n  };\n  for await (const value of source) {\n    note("got " + value);\n    break;\n  }\n  return "behind the loop at " + turns();\n}`,
  },
  {
    name: "close-of-a-hand-written-iterator-by-a-throw",
    text: `async function caseN() {\n  const source = {\n    [Symbol.asyncIterator]() {\n      return {\n        next(): any {\n          return { done: false, value: 1 };\n        },\n        return(): any {\n          note("return called at " + turns());\n          return E;\n        },\n      };\n    },\n  };\n  try {\n    for await (const value of source) throw new Error("body " + value);\n  } finally {\n    note("left at " + turns());\n  }\n}`,
  },
  {
    name: "yield-star-of-a-hand-written-iterator",
    text: `async function* streamN() {\n  let steps = 0;\n  const source = {\n    [Symbol.asyncIterator]() {\n      return {\n        next(): any {\n          return steps++ ? { done: true, value: "end" } : E;\n        },\n      };\n    },\n  };\n  return yield* source;\n}\nasync function caseN() {\n  const stream = streamN();\n  return [await stream.next(), await stream.next()];\n}`,
  },
  {
    name: "return-into-an-async-generator",
    text: `async function* streamN() {\n  try {\n    yield 1;\n  } finally {\n    note("cleanup at " + turns());\n  }\n}\nasync function caseN() {\n  const stream = streamN();\n  await stream.next();\n  note("stepped at " + turns());\n  return [await stream.return(E as any), await stream.next()];\n}`,
  },
  {
    name: "return-into-an-async-generator-that-has-not-begun",
    text: `async function* streamN() {\n  note("never");\n  yield 1;\n}\nasync function caseN() {\n  const stream = streamN();\n  return [await stream.return(E as any), await stream.next()];\n}`,
  },
  {
    name: "throw-into-an-async-generator",
    text: `async function* streamN() {\n  try {\n    yield 1;\n  } catch (error) {\n    note("inside caught " + show(error) + " at " + turns());\n    yield "recovered";\n  }\n}\nasync function caseN() {\n  const stream = streamN();\n  await stream.next();\n  return await stream.throw(E);\n}`,
  },
  {
    name: "requests-that-wait-in-line",
    text: `async function* streamN() {\n  const sent: unknown = yield E;\n  note("sent " + show(sent) + " at " + turns());\n  yield E;\n  return E;\n}\nasync function caseN() {\n  const stream = streamN();\n  return await Promise.allSettled([stream.next(), stream.next("second"), stream.next(), stream.return("late" as any), stream.next()]);\n}`,
  },
  {
    name: "await-using",
    text: `async function caseN() {\n  {\n    await using held = {\n      [Symbol.asyncDispose](): any {\n        note("disposed at " + turns());\n        return E;\n      },\n    };\n    note("holds " + typeof held);\n  }\n  return "behind the block at " + turns();\n}`,
  },
  { name: "resolve", text: `async function caseN() {\n  return await Promise.resolve(E);\n}` },
  { name: "resolve-function", text: `async function caseN() {\n  return await new Promise(resolve => resolve(E));\n}` },
  {
    name: "answer-of-then",
    text: `async function caseN() {\n  return await Promise.resolve().then((): unknown => E);\n}`,
  },
  {
    name: "answer-of-catch",
    text: `async function caseN() {\n  return await Promise.reject(0).catch((): unknown => E);\n}`,
  },
  {
    name: "answer-of-finally",
    text: `async function caseN() {\n  return await Promise.resolve("kept").finally(() => E);\n}`,
  },
  { name: "member-of-all", text: `async function caseN() {\n  return await Promise.all([E, 0, E]);\n}` },
  { name: "member-of-all-settled", text: `async function caseN() {\n  return await Promise.allSettled([E, E]);\n}` },
  {
    name: "member-of-race",
    text: `async function caseN() {\n  return await Promise.race([E, Promise.resolve().then(() => {}).then(() => "the other")]);\n}`,
  },
  {
    name: "member-of-any",
    text: `async function caseN() {\n  return await Promise.any([E, Promise.resolve().then(() => {}).then(() => "the other")]);\n}`,
  },
  {
    name: "callback-of-map",
    text: `async function caseN() {\n  return await Promise.all([1, 2].map(async each => [each, await E]));\n}`,
  },
  {
    name: "beside-a-twin",
    text: `async function twinN(tag: string) {\n  const value = await E;\n  note(tag + " at " + turns());\n  return value;\n}\nasync function caseN() {\n  const a = twinN("a");\n  const b = twinN("b");\n  return [await b, await a];\n}`,
  },
  {
    name: "nobody-waits",
    text: `async function looseN() {\n  const value = await E;\n  note("loose got " + show(value) + " at " + turns());\n}\nasync function caseN() {\n  looseN().catch(error => note("loose failed " + show(error) + " at " + turns()));\n  for (let turn = 0; turn < 8; turn++) await null;\n  return "waited eight turns";\n}`,
  },
  {
    name: "under-a-store",
    text: `async function caseN() {\n  return await store.run("N", async () => {\n    const value = await E;\n    note("store " + store.getStore());\n    return value;\n  });\n}`,
  },
];

const head = `import { AsyncLocalStorage } from "node:async_hooks";
declare function setImmediate(callback: (value?: unknown) => void): unknown;
declare const process: { argv: string[]; nextTick(callback: () => void): void; on(event: "unhandledRejection", listener: (reason: unknown) => void): void };
const store = new AsyncLocalStorage<string>();
let count = 0;
let counting = false;
let notes: string[] = [];
let giveUp = () => {};
function step() {
  if (!counting) return;
  count++;
  Promise.resolve().then(step);
}
function turns() {
  return count;
}
function note(text: string) {
  notes.push(text);
}
function hide<T>(value: T): T {
  return [value, undefined as T][Number(process.argv.length > 100)];
}
function show(value: unknown, depth = 0): string {
  if (typeof value === "function") return "function";
  if (typeof value === "symbol" || typeof value === "bigint") return typeof value + " " + String(value);
  if (typeof value !== "object" || value === null) return JSON.stringify(value) ?? "undefined";
  if (depth > 3) return "..";
  try {
    if (value instanceof AggregateError) return "AggregateError(" + value.errors.map(each => show(each, depth + 1)).join() + ")";
    if (value instanceof Error) return value.name + "(" + value.message + ")";
    if (Array.isArray(value)) return "[" + value.map(each => show(each, depth + 1)).join() + "]";
    if (Object.prototype.toString.call(value) === "[object Promise]") return "a promise";
    return "{" + Reflect.ownKeys(value).map(key => String(key) + ":" + (typeof Object.getOwnPropertyDescriptor(value, key)!.get === "function" ? "getter" : show((value as any)[key], depth + 1))).join() + "}";
  } catch (error) {
    return "unprintable " + (error as Error).message;
  }
}
async function run(name: string, body: () => Promise<unknown>, isBesideOtherJobs: boolean) {
  await new Promise(resolve => setImmediate(resolve));
  notes = [];
  count = 0;
  counting = isBesideOtherJobs;
  let line: string;
  const gaveUp = new Promise<string>(resolve => (giveUp = () => resolve("nobody answered")));
  if (isBesideOtherJobs) Promise.resolve().then(step);
  else process.nextTick(() => note("a tick"));
  try {
    const value = await Promise.race([body(), gaveUp]);
    line = count + " turns, " + show(value);
  } catch (error) {
    line = count + " turns, threw " + show(error);
  }
  counting = false;
  console.log(name + " | " + line + (notes.length ? " | " + notes.join("; ") : ""));
}
process.on("unhandledRejection", reason => console.log("nobody caught " + show(reason)));
`;

export const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: [],
  },
});

export function program(place: Place, isHidden: boolean) {
  const before = new Set<string>();
  const cases: string[] = [];
  const runs: string[] = [];
  awaitedThings.forEach((awaited, index) => {
    if (awaited.before) before.add(awaited.before);
    const expression = isHidden
      ? `hide<any>(${awaited.text})`
      : awaited.isNoValidOperand
        ? `(${awaited.text} as unknown)`
        : `(${awaited.text})`;
    cases.push(place.text.replace(/(?<=[a-z"])N\b/g, String(index)).replace(/\bE\b/g, () => expression));
    runs.push(
      `await run(${JSON.stringify(awaited.name)}, case${index}, true);`,
      `await run(${JSON.stringify(awaited.name + ", alone")}, case${index}, false);`,
    );
  });
  const imports = [...before].flatMap(text => text.split("\n").filter(line => line.startsWith("import ")));
  const declarations = [...before].map(text =>
    text
      .split("\n")
      .filter(line => !line.startsWith("import "))
      .join("\n"),
  );
  return [...imports, head, ...declarations, ...cases, ...runs].join("\n") + "\n";
}

export function testPrograms() {
  return places.flatMap(place =>
    [false, true].map(isHidden => ({
      name: `${place.name}, ${isHidden ? "hidden" : "seen"}`,
      text: program(place, isHidden),
    })),
  );
}

if (import.meta.main) {
  const folder = process.argv[2];
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "tsconfig.json"), tsconfig);
  for (const { name, text } of testPrograms()) writeFileSync(join(folder, name.replace(", ", "-") + ".ts"), text);
}
