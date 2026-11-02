// The program calls built-in functions of the language on arrays of integers and with closures of its own, and text that is evaluated at run time calls the same functions on everything else: strings, holes, array-likes, heirs of Array, a receiver for the callback, callbacks that throw. The functions that the executable holds were compiled for any caller, so both get what plain Bun gives.
// Text that is decoded at run time is unknown to the compiler.
const decoded = text => Buffer.from(text).toString();
async function attempt(text) {
  try { console.log(text + ": " + await (0, eval)(decoded(text))); } catch (error) { console.log(text + ": " + error.name + ": " + error.message); }
}
async function main() {
  const numbers = [3, 1, 2];
  console.log(numbers.map(x => x + 1).filter(x => x > 2).reduce((sum, x) => sum + x, 0));
  console.log(numbers.toSorted((a, b) => a - b).join() + Array.from(numbers, x => x * 2).join() + numbers.flatMap(x => [x]).length + numbers.find(x => x > 1) + numbers.some(x => x > 2) + numbers.every(x => x > 0));
  console.log(Object.entries({ a: 1 }).length + Object.fromEntries([["b", 2]]).b + "a-b".replace(/-/g, () => "+") + [..."a1".matchAll(/\d/g)].length);
  console.log((await Promise.all([1, 2])).join() + new Map([[1, 2]]).get(1) + new Set([1]).has(1) + [...(function* () { yield 1; })()].length);

  await attempt("['b', 'a'].map(letter => letter + letter).filter(Boolean).reduce((text, letter) => text + letter)");
  await attempt("[, 1, , 2].map(x => x * 2).length + Object.keys([, 1, , 2].map(x => x * 2)).join() + [, 1].filter(() => true).length + [, 1].reduce((sum, x) => sum + x)");
  await attempt("Array.prototype.map.call({ length: 2, 0: 'x', 1: 'y' }, function (value, index) { return this.prefix + value + index; }, { prefix: '>' }).join()");
  await attempt("(() => { class List extends Array {} const list = List.from([1, 2]).map(x => x + 0.5); return list.constructor.name + list.join() + (list.filter(() => true) instanceof List) + (list.flatMap(x => [x]) instanceof List); })()");
  await attempt("[1, 2, 3].map(x => { if (x === 2) throw new RangeError('two'); return x; })");
  await attempt("[].reduce((sum, x) => sum + x)");
  await attempt("[1, 2].map('not a function')");
  await attempt("Array.prototype.map.call(null, x => x)");
  await attempt("['10', '9', 1, undefined, , 'b'].toSorted().join('|') + [2.5, -0, NaN, 1].toSorted((a, b) => a - b).join('|') + [{ n: 2 }, { n: 1 }].toSorted((a, b) => a.n - b.n).map(item => item.n).join()");
  await attempt("Array.from('ab', letter => letter + '!').join() + Array.from({ length: 2 }).join('|') + Array.from(new Map([[1, 2]])).join() + Array.from.call(Object, [1]).length + Array.from((function* () { yield 'g'; })()).join()");
  await attempt("[[1], 'a', [[2]]].flatMap(x => x).length + ['a', 1n, null].find(x => typeof x === 'bigint') + [NaN].some(Number.isNaN) + [].every(() => false)");
  await attempt("Object.entries('ab').join('|') + Object.entries([7]).join() + Object.entries(new Proxy({ p: 1 }, {})).join() + Object.fromEntries(new Map([['m', 1]])).m + Object.entries({ get g() { return 5; } }).join()");
  await attempt("'a-b'.replace(/(?<dash>-)/g, (...parts) => typeof parts.at(-1)) + 'aaa'.replace(/a/gy, (match, index) => index) + 'x'.replace({ [Symbol.replace]: () => 'custom' }, '') + [...'a1b2'.matchAll(/(?<digit>\\d)/g)].map(match => match.groups.digit).join()");
  await attempt("Promise.all(new Set([Promise.resolve('s'), { then(resolve) { resolve('t'); } }])).then(values => values.join())");
  await attempt("Promise.all([Promise.reject(new TypeError('rejected'))])");
  await attempt("Promise.all(5)");
  await attempt("(() => { class Other extends Promise {} return Other.all([1]) instanceof Other; })()");
  await attempt("new Map([[NaN, 'nan'], [-0, 'zero'], ['k', { deep: 1 }]]).get(NaN) + new Map([[-0, 'zero']]).get(0) + new Set('aab').size + new Set([{}, {}]).size + [...new Map(Object.entries({ a: 1 }))].join()");
  await attempt("(generator => [generator.next().value, generator.throw(new Error('thrown in')).value, generator.next().done].join())((function* () { try { yield 1; } catch (error) { yield error.message; } })())");
  console.log(numbers.map(x => x + 1).join() + numbers.toSorted().join() + (await Promise.all(numbers)).join());
}
main();
