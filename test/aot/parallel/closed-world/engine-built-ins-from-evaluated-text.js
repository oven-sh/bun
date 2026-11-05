// Text that is evaluated at run time calls built-in functions of the language that the program itself never calls. Many of them are written in JavaScript too, and they are the engine's: one that is not in the executable runs from the engine's own text, so the text gets every one of them as in plain Bun.
// Text that is decoded at run time is unknown to the compiler.
const decoded = text => Buffer.from(text).toString();
async function attempt(text) {
  try { console.log(text + ": " + await (0, eval)(decoded(text))); } catch (error) { console.log(text + ": " + error.name + ": " + error.message); }
}
async function main() {
  await attempt("Array.from({ length: 3 }, (_, index) => index * 2).join()");
  await attempt("Array.from(new Set([1, 1, 2])).concat(Array.of(3)).join()");
  await attempt("[1, 2, 3].map(x => x * 2).filter(x => x > 2).reduce((sum, x) => sum + x, 0)");
  await attempt("[3, 1, 2].sort((a, b) => a - b).join() + [3, 1, 2].toSorted().join() + ['b', 'a'].sort().join()");
  await attempt("[1, [2, [3]]].flat(Infinity).join() + [1, 2].flatMap(x => [x, x]).join()");
  await attempt("[[1, 2, 3].find(x => x > 1), [1, 2, 3].findLast(x => x < 3), [1, 2, 3].findIndex(x => x > 5), [1, 2, 3].at(-1), [1, 2, 3].includes(2), [1, 2, 3].every(x => x > 0), [1, 2, 3].some(x => x > 2)].join()");
  await attempt("[1, 2, 3].toSpliced(1, 1).join() + [1, 2].with(0, 9).join() + [1, 2].toReversed().join() + [1, 2, 3, 4].copyWithin(0, 2).join() + new Array(2).fill(7).join()");
  await attempt("[...[5, 6].entries()].join('|') + [...[5, 6].keys()].join() + [...[5, 6].values()].join()");
  await attempt("Object.entries({ a: 1, b: 2 }).map(([key, value]) => key + value).join() + Object.fromEntries([['c', 3]]).c + Object.keys({ d: 4 }) + Object.values({ e: 5 })");
  await attempt("Object.groupBy([1, 2, 3], x => x % 2 ? 'odd' : 'even').odd.join() + Map.groupBy([1, 2, 3], x => x % 2).get(0).join()");
  await attempt("JSON.stringify(JSON.parse('{\"a\":[1,{\"b\":2}]}', (key, value) => typeof value === 'number' ? value + 1 : value), (key, value) => value, 1)");
  await attempt("'a-b-c'.replace(/-(\\w)/g, (match, letter) => letter.toUpperCase()) + 'abc'.replaceAll('b', match => match + match) + 'abc'.replace('c', '$&$&')");
  await attempt("[...'a1b22'.matchAll(/\\d+/g)].map(match => match[0] + '@' + match.index).join() + 'a,b;c'.split(/[,;]/).length + 'x'.padStart(3, 'ab') + 'aXb'.search(/X/) + 'ab'.match(/(a)(b)/).length");
  await attempt("/(?<year>\\d{4})-(?<month>\\d\\d)/.exec('2026-10').groups.month + '2026-10'.replace(/(?<year>\\d{4})-(?<month>\\d\\d)/, '$<month>/$<year>')");
  await attempt("Promise.all([1, Promise.resolve(2), { then(resolve) { resolve(3); } }]).then(values => values.join())");
  await attempt("Promise.allSettled([Promise.reject(new Error('no')), 1]).then(results => results.map(result => result.status).join())");
  await attempt("Promise.race([new Promise(() => {}), Promise.resolve('first')])");
  await attempt("Promise.any([Promise.reject(1), Promise.resolve('any')])");
  await attempt("Promise.reject(new RangeError('caught')).catch(error => error.message).finally(() => {})");
  await attempt("Promise.withResolvers().promise instanceof Promise && Promise.try(() => 'tried')");
  await attempt("(map => map.get(1) + [...map.entries()].join('|') + map.size + [...map.keys()].join())(new Map([[1, 2], [3, 4]]))");
  await attempt("(set => [...set.union(new Set([3]))].join() + [...set.intersection(new Set([1]))].join() + set.isSubsetOf(new Set([1, 2, 5])) + set.has(2))(new Set([1, 1, 2]))");
  await attempt("[...(function* () { const sent = yield 1; yield* [2, 3]; return sent; })()].join()");
  await attempt("(generator => [generator.next().value, generator.next('in').value, generator.return('out').value, generator.next().done].join())((function* () { const sent = yield 1; yield sent; })())");
  await attempt("(async () => { let sum = 0; for await (const x of (async function* () { yield 1; yield Promise.resolve(2); })()) sum += x; return sum; })()");
  await attempt("Array.fromAsync([1, Promise.resolve(2)]).then(values => values.join())");
  await attempt("Iterator.from([1, 2, 3, 4]).map(x => x * 2).filter(x => x > 2).drop(1).take(2).toArray().join()");
  await attempt("(() => { class Base { #hidden = 1; static count = 2; get hidden() { return this.#hidden; } } class Heir extends Base { constructor() { super(); this.own = 3; } } const heir = new Heir(); return heir.hidden + Base.count + heir.own; })()");
  await attempt("new Uint8Array([3, 1, 2]).sort().join() + Uint8Array.from([1, 2], x => x * 2).map(x => x + 1).join() + new Float64Array([1.5, 2.5]).reduce((sum, x) => sum + x) + new Int16Array([1, 2, 3]).subarray(1).toReversed().join()");
  await attempt("Function.prototype.bind.call(function (a, b) { return this.x + a + b; }, { x: 1 }, 2)(3) + Math.max.apply(null, [1, 5]) + Reflect.apply(Math.min, null, [4, 2]) + Reflect.construct(Date, [0]).getTime()");
  await attempt("new Proxy({}, { get: (target, key) => 'got ' + key }).name + Reflect.ownKeys({ a: 1, [Symbol.iterator]: 2 }).length");
  await attempt("String.raw`a${1}\\n` + `${[1, 2]}` + 'abc'.at(-1) + 'ab'.codePointAt(1) + [...'ab'].reverse().join('') + 'a b'.split(' ').map(word => word.toUpperCase()).join('')");
  await attempt("new Function('a', 'b', 'return [a, b].map(x => x + 1).join()')(1, 2) + eval('[1, 2].indexOf(2)')");
  await attempt("(({ a, ...rest }, [first, ...others]) => a + Object.keys(rest).join() + first + others.length)({ a: 1, b: 2, c: 3 }, new Set([4, 5, 6]))");
  await attempt("new AggregateError([new Error('one')], 'many', { cause: 7 }).errors.length + new Error('x', { cause: 8 }).cause");
  await attempt("new Intl.NumberFormat('en-US').format(1234.5) + new Date(0).toISOString() + (1234.5).toLocaleString('en-US') + ['b', 'a'].sort(new Intl.Collator('en').compare).join()");
  await attempt("[1, 2, 3].map(String).map(Number).map(x => x.toString(2)).join() + [,1].map(x => x).hasOwnProperty(0) + Array.prototype.map.call('ab', letter => letter + letter).join() + Array.prototype.filter.call({ length: 2, 0: 1, 1: 2 }, x => x > 1).join()");
}
main();
