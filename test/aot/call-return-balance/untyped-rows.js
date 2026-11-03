"use strict";
let sink = 0;
let never = 0;
if (process.argv.length > 50) never = 1;
function add(a, b) { try { if (never > 0) throw never; } catch { return -1; } return a + b; }
function three(a, b, c) { try { if (never > 0) throw never; } catch { return -1; } return a + b + (c === undefined ? 1 : c); }
function rest(first, ...others) { try { if (never > 0) throw never; } catch { return -1; } return first + others.length; }
function usesArguments() { try { if (never > 0) throw never; } catch { return -1; } return arguments.length + (arguments[0] | 0); }
function forwards() { try { if (never > 0) throw never; } catch { return -1; } return add.apply(this, arguments); }
function forwardsSpread(...all) { try { if (never > 0) throw never; } catch { return -1; } return add(...all); }
function tail(n) { try { if (never > 0) throw never; } catch { return -1; } return add(n, 1); }
const object = {
    value: 3,
    method(x) { try { if (never > 0) throw never; } catch { return -1; } return this.value + x; },
    get got() { try { if (never > 0) throw never; } catch { return -1; } return this.value + 1; },
    set put(v) { try { if (never > 0) throw never; } catch { return -1; } this.value = v & 7; },
    toString() { try { if (never > 0) throw never; } catch { return -1; } return "7"; },
    valueOf() { try { if (never > 0) throw never; } catch { return -1; } return 7; },
    toJSON() { try { if (never > 0) throw never; } catch { return -1; } return 5; },
};
const derived = Object.create(object);
const bound0 = add.bind(null);
const bound1 = add.bind(null, 1);
const boundMethod = object.method.bind(object);
const boundCall = Function.prototype.call.bind(add);
class Base { constructor(x) { this.x = x; } get twice() { try { if (never > 0) throw never; } catch { return -1; } return this.x * 2; } static make(x) { try { if (never > 0) throw never; } catch { return -1; } return new this(x); } m() { try { if (never > 0) throw never; } catch { return -1; } return this.x; } }
class Derived extends Base { #p = 1; constructor(x) { super(x + 1); } m() { try { if (never > 0) throw never; } catch { return -1; } return super.m() + this.#q(); } #q() { try { if (never > 0) throw never; } catch { return -1; } return this.#p; } }
class ArraySubclass extends Array { }
const proxy = new Proxy({ a: 1 }, { get(target, key) { try { if (never > 0) throw never; } catch { return -1; } return key === "a" ? 2 : undefined; }, has() { try { if (never > 0) throw never; } catch { return -1; } return true; }, set() { try { if (never > 0) throw never; } catch { return -1; } return true; } });
const hasInstance = { [Symbol.hasInstance](v) { try { if (never > 0) throw never; } catch { return -1; } return v === 1; } };
function* counts(n) { for (let i = 0; i < n; i++) yield i; }
function* delegates(n) { yield* counts(n); }
function* delegatesTo(inner) { yield* inner; }
const kept = [];
function keep(value) { kept.push(value); return kept.pop(); }
function drive(generator) { let t = 0; for (let step = generator.next(); !step.done; step = generator.next()) t += step.value; return t; }
function total(values) { let t = 0; for (const v of values) t += v; return t; }
const iterable = { [Symbol.iterator]() { let i = 0; return { next() { return { done: i >= 3, value: i++ }; }, return() { return {}; } }; } };
function finallyRuns(x) { try { if (never > 0) throw never; } catch { return -1; } try { return add(x, 1); } finally { sink++; } }
const array = [3, 1, 2, 5, 4];
const key = "value", keyGot = "got", keyMethod = "method";
function deep(n) { try { if (never > 0) throw never; } catch { return -1; } return n === 0 ? 0 : 1 + deep(n - 1); }
export const rows = {
    nothing: () => 1,
    call: () => add(1, 2),
    callFewer: () => three(1, 2),
    callMore: () => add(1, 2, 3, 4),
    callRest: () => rest(1, 2, 3),
    callArguments: () => usesArguments(1, 2),
    method: () => object.method(1),
    methodInherited: () => derived.method(1),
    methodByKey: () => object[keyMethod](1),
    bound0: () => bound0(1, 2),
    bound1: () => bound1(2),
    boundMethod: () => boundMethod(1),
    boundCall: () => boundCall(null, 1, 2),
    dotCall: () => add.call(null, 1, 2),
    dotApplyArray: () => add.apply(null, [1, 2]),
    dotApplyArguments: () => forwards(1, 2),
    spreadCall: () => forwardsSpread(1, 2),
    spreadArray: () => add(...array),
    reflectApply: () => Reflect.apply(add, null, [1, 2]),
    tailCall: () => tail(1),
    construct: () => new Base(1).x,
    constructDerived: () => new Derived(1).x,
    constructSpread: () => new Base(...array).x,
    constructStatic: () => Base.make(1).x,
    constructArraySubclass: () => new ArraySubclass(3).length,
    reflectConstruct: () => Reflect.construct(Base, [1]).x,
    superMethodAndPrivate: () => new Derived(1).m(),
    getter: () => object.got,
    getterInherited: () => derived.got,
    getterByKey: () => object[keyGot],
    getterOfClass: () => new Base(2).twice,
    setter: () => { object.put = 3; return 1; },
    setterInherited: () => { derived.put = 3; return 1; },
    proxyGet: () => proxy.a,
    proxyHas: () => ("b" in proxy ? 1 : 0),
    proxySet: () => { proxy.c = 1; return 1; },
    hasInstance: () => (1 instanceof hasInstance ? 1 : 0),
    toPrimitiveValueOf: () => object + 1,
    toPrimitiveToString: () => `${object}`.length,
    toJSON: () => JSON.stringify(object).length,
    jsonReviver: () => JSON.parse("[1,2]", (k, v) => v).length,
    arrayMap: () => array.map(x => x + 1).length,
    arrayForEach: () => { let t = 0; array.forEach(x => { t += x; }); return t; },
    arrayReduce: () => array.reduce(add, 0),
    arraySort: () => array.slice().sort((a, b) => a - b)[0],
    arrayFrom: () => Array.from(iterable).length,
    stringReplace: () => "a-b".replace(/-/g, () => "+").length,
    mapForEach: () => { let t = 0; new Map([[1, 2]]).forEach(v => { t += v; }); return t; },
    generatorNext: () => { const g = counts(2); return g.next().value + g.next().value; },
    generatorForOf: () => { let t = 0; for (const v of counts(3)) t += v; return t; },
    generatorReturnEarly: () => { for (const v of counts(3)) return v; return 0; },
    generatorDelegate: () => { let t = 0; for (const v of delegates(3)) t += v; return t; },
    generatorSpread: () => [...counts(3)].length,
    generatorKeptNext: () => drive(keep(counts(3))),
    generatorKeptForOf: () => total(keep(counts(3))),
    generatorKeptDelegate: () => total(keep(delegatesTo(keep(counts(3))))),
    iterableForOf: () => { let t = 0; for (const v of iterable) t += v; return t; },
    iterableBreak: () => { for (const v of iterable) { if (v === 1) break; } return 1; },
    destructure: () => { const [a, b] = iterable; return a + b; },
    iterableSpread: () => [...iterable].length,
    iterableKeptForOf: () => total(keep(iterable)),
    finallyRuns: () => finallyRuns(1),
    deep20: () => deep(20),
    closureMade: () => { const f = x => x + sink; return f(1) & 1; },
};
async function resolved(x) { try { if (never > 0) throw never; } catch { return -1; } return x + 1; }
async function awaitsOne(x) { try { if (never > 0) throw never; } catch { return -1; } return (await resolved(x)) + 1; }
async function awaitsThree(x) { try { if (never > 0) throw never; } catch { return -1; } let t = 0; for (let i = 0; i < 3; i++) t += await resolved(x); return t; }
async function awaitsValue(x) { try { if (never > 0) throw never; } catch { return -1; } return (await x) + 1; }
async function* asyncCounts(n) { for (let i = 0; i < n; i++) yield i; }
async function forAwait(n) { try { if (never > 0) throw never; } catch { return -1; } let t = 0; for await (const v of asyncCounts(n)) t += v; return t; }
const thenable = { then(resolve) { resolve(4); } };
export const asyncRows = {
    asyncNothing: async () => 1,
    awaitOne: () => awaitsOne(1),
    awaitThree: () => awaitsThree(1),
    awaitValue: () => awaitsValue(1),
    awaitThenable: async () => (await thenable) + 1,
    promiseThen: () => Promise.resolve(1).then(v => v + 1),
    promiseAll: () => Promise.all([resolved(1), resolved(2)]).then(v => v.length),
    forAwait: () => forAwait(3),
    newPromise: () => new Promise(resolve => resolve(1)),
};
