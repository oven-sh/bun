// Methods of arrays, strings, typed arrays, iterators, promises and Intl are called in a context of node:vm. structuredClone, queueMicrotask and setTimeout are handed in.
import vm from "node:vm";
async function show(label, run) {
  try {
    console.log(label, JSON.stringify(await run()));
  } catch (error) {
    console.log(label, "threw", error?.constructor?.name, error?.code);
  }
}
const context = vm.createContext({ structuredClone, console, queueMicrotask, setTimeout });
for (const text of [
  "[3, 1, 2].toSorted().join()", "[1, [2, [3]]].flat(2).join()", "[1, 2, 3].map(x => x * 2).filter(x => x > 2).reduce((a, b) => a + b)", "Array.from({ length: 3 }, (_, i) => i).join()",
  "Array.from(new Set([1, 1, 2])).join()", "[1, 2, 3].findLast(x => x < 3)", "[...new Map([[1, 2]]).entries()].join()", "Object.entries({ a: 1 }).join()", "Object.fromEntries([['a', 1]]).a", "Object.groupBy([1, 2, 3], x => x % 2 ? 'odd' : 'even').odd.join()",
  "'abc'.replaceAll('b', 'x')", "'a-b'.split('-').join()", "'abc'.at(-1)", "'a'.padStart(3, 'x')", "[...'ab'.matchAll(/./g)].length", "'x'.localeCompare('y')", "/(?<n>a)/.exec('a').groups.n",
  "new Intl.NumberFormat('en-US').format(1234.5)", "new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(0)", "new Intl.PluralRules('en').select(1)", "(1234.5).toLocaleString('de-DE')", "new Intl.Segmenter('en').segment('ab')[Symbol.iterator]().next().value.segment",
  "new Uint8Array([3, 1, 2]).sort().join()", "new Uint8Array([1, 2]).toHex()", "Uint8Array.from([1, 2]).map(x => x + 1).join()", "new Float64Array(2).fill(1.5).join()",
  "Reflect.ownKeys({ a: 1, [Symbol.iterator]: 2 }).length", "JSON.stringify(structuredClone({ a: [1, new Date(0)] }))", "structuredClone(new Map([[1, 2]])) instanceof Map", "function* g() { yield* [1, 2]; } [...g()].join()",
  "Iterator.from([1, 2, 3]).map(x => x * 2).take(2).toArray().join()", "new Set([1, 2]).union(new Set([3])).size", "new WeakRef({}).deref() !== undefined", "typeof new FinalizationRegistry(() => {}).register", "Math.sumPrecise([0.1, 0.2])", "new Date(0).toISOString()",
  "typeof Temporal", "typeof WebAssembly", "new Proxy({}, { get: (_, key) => key }).x", "class A { #x = 1; static y = 2; get x() { return this.#x; } } new A().x + A.y", "new Error('m', { cause: 1 }).cause", "new AggregateError([1], 'm').errors.length", "Symbol.for('x').description", "BigInt(2) ** 64n + ''",
  "new DisposableStack().disposed", "RegExp.escape('a.b')", "String.raw`a${1}`", "encodeURIComponent('a b')", "escape('a b')", "parseInt('12px')", "globalThis === this",
]) await show(text, () => vm.runInContext(text, context));
for (const text of [
  "Promise.all([1, Promise.resolve(2)]).then(x => x.join())", "Promise.allSettled([Promise.reject(1)]).then(x => x[0].status)", "Promise.any([Promise.reject(1), 2])", "Promise.race([1, 2])", "Promise.withResolvers().promise instanceof Promise", "Promise.try(() => 1)",
  "(async () => { let sum = 0; for await (const x of (async function* () { yield 1; yield 2; })()) sum += x; return sum; })()", "Array.fromAsync([1, Promise.resolve(2)]).then(x => x.join())", "new Promise(resolve => queueMicrotask(() => resolve('job')))", "new Promise(resolve => setTimeout(() => resolve('timer'), 1))",
]) await show(text, () => vm.runInContext(text, context));
