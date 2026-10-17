// Every row gets the function `two` by another way and calls it. Beside it stands `never`, which the row can be seen to hold as well and never does: whoever follows values through the program and loses `two` on the way would call `never`.
const yes = Date.now() > 0;
const i1 = yes ? 1 : 0;
const keyB = yes ? "b" : "a";
const nothing = yes ? undefined : null;
const anchor = {};
const token = Symbol("token");
const one = n => n + 1;
const two = n => n * 2;
const never = n => -999;
const maybe = yes ? two : 5;
let kept = one;
function lastOf(list) { let last; for (const each of list) last = each; return last; }
function eachOf(container, which) { let found; container.forEach(function () { found = arguments[which]; }); return found; }
function spliced() { const list = [one, one]; list.splice(1, 1, two); return list; }
function sentBack(f) { const made = (function* () { const got = yield 1; yield got; })(); made.next(); return made.next(f).value; }
function reflected() { const o = { a: one }; Reflect.set(o, "a", two); return o; }
function throughSetter(f) { const o = { set a(given) { this.b = given; } }; o.a = f; return o.b; }
function storedByKey(f) { const o = { b: one }; o[keyB] = f; return o; }
function protoMade() { function Made() {} Made.prototype.a = two; return new Made(); }
function assignedIfNullish() { let f = nothing; f ??= two; return f; }
function seenByComparator() { let seen; [two, two].sort((a, b) => { seen = a; return 0; }); return seen; }
function seenByReplace() { let seen; const table = { x: two }; "x".replace(/x/, found => { seen = table[found]; return ""; }); return seen; }
function revived() { let seen; const table = { a: two }; JSON.parse('{"a":1}', function (key, value) { if (key === "a") seen = table[key]; return value; }); return seen; }
function jsoned() { let seen; JSON.stringify({ f: two, toJSON() { seen = this.f; return 1; } }); return seen; }
function converted() { let seen; +{ f: two, valueOf() { seen = this.f; return 1; } }; return seen; }
function madePrimitive() { let seen; `${{ f: two, [Symbol.toPrimitive]() { seen = this.f; return ""; } }}`; return seen; }
function setInCallback() { let f = one; [1].forEach(() => { f = two; }); return f; }
function afterDelete() { const o = Object.create({ a: two }); o.a = one; delete o.a; return o; }
function Kind0() { this.own0 = two; this.shared = two; }
Kind0.prototype.inherited = function () { return two; };
Kind0.made = () => two;
class Class0 { method() { return two; } static made() { return two; } get got() { return two; } }
function Kind1() { this.own1 = two; this.shared = two; }
Kind1.prototype.inherited = function () { return two; };
Kind1.made = () => two;
class Class1 { method() { return two; } static made() { return two; } get got() { return two; } }
function Kind2() { this.own2 = two; this.shared = two; }
Kind2.prototype.inherited = function () { return two; };
Kind2.made = () => two;
class Class2 { method() { return two; } static made() { return two; } get got() { return two; } }
function Kind3() { this.own3 = two; this.shared = two; }
Kind3.prototype.inherited = function () { return two; };
Kind3.made = () => two;
class Class3 { method() { return two; } static made() { return two; } get got() { return two; } }
function Kind4() { this.own4 = two; this.shared = two; }
Kind4.prototype.inherited = function () { return two; };
Kind4.made = () => two;
class Class4 { method() { return two; } static made() { return two; } get got() { return two; } }
function Kind5() { this.own5 = two; this.shared = two; }
Kind5.prototype.inherited = function () { return two; };
Kind5.made = () => two;
class Class5 { method() { return two; } static made() { return two; } get got() { return two; } }
function Kind6() { this.own6 = two; this.shared = two; }
Kind6.prototype.inherited = function () { return two; };
Kind6.made = () => two;
class Class6 { method() { return two; } static made() { return two; } get got() { return two; } }
function Kind7() { this.own7 = two; this.shared = two; }
Kind7.prototype.inherited = function () { return two; };
Kind7.made = () => two;
class Class7 { method() { return two; } static made() { return two; } get got() { return two; } }
function Kind8() { this.own8 = two; this.shared = two; }
Kind8.prototype.inherited = function () { return two; };
Kind8.made = () => two;
class Class8 { method() { return two; } static made() { return two; } get got() { return two; } }
function Kind9() { this.own9 = two; this.shared = two; }
Kind9.prototype.inherited = function () { return two; };
Kind9.made = () => two;
class Class9 { method() { return two; } static made() { return two; } get got() { return two; } }
const kinds = [Kind0, Kind1, Kind2, Kind3, Kind4, Kind5, Kind6, Kind7, Kind8, Kind9];
const classes = [Class0, Class1, Class2, Class3, Class4, Class5, Class6, Class7, Class8, Class9];
const literals = [{ a0: 1, shared: two }, { a1: 1, shared: two }, { a2: 1, shared: two }, { a3: 1, shared: two }, { a4: 1, shared: two }, { a5: 1, shared: two }, { a6: 1, shared: two }, { a7: 1, shared: two }, { a8: 1, shared: two }, { a9: 1, shared: two }];
const passers = [(f, x0) => f, (f, x1) => f, (f, x2) => f, (f, x3) => f, (f, x4) => f, (f, x5) => f, (f, x6) => f, (f, x7) => f, (f, x8) => f, (f, x9) => f];
const makers = [x0 => two, x1 => two, x2 => two, x3 => two, x4 => two, x5 => two, x6 => two, x7 => two, x8 => two, x9 => two];
const lists = [[0, two], [1, two], [2, two], [3, two], [4, two], [5, two], [6, two], [7, two], [8, two], [9, two]];
const globals = [Math, JSON, Reflect, Object, Array, Number, String, Boolean, Symbol, Promise];
const i3 = yes ? 3 : 0;
const i7 = yes ? 7 : 0;
async function resolverOfAThenable() { const t = { then(ok) { if (ok !== never) ok(two); } }; t.then(never); return await t; }
function iteratedThis() { const a = { f: never, [Symbol.iterator]() { const got = this.f; return [n => got(n)][Symbol.iterator](); } }; const b = { f: two, [Symbol.iterator]: a[Symbol.iterator] }; a[Symbol.iterator](); return [...b][0]; }
function convertedThis() { let out; const a = { f: never, valueOf() { out = this.f(21); return 1; } }; const b = { f: two, valueOf: a.valueOf }; a.valueOf(); +b; return n => out; }
function shownThis() { let out; const a = { f: never, toString() { out = this.f(21); return ""; } }; const b = { f: two, toString: a.toString }; a.toString(); `${b}`; return n => out; }
function jsonThis() { let out; const a = { f: never, toJSON() { out = this.f(21); return 1; } }; const b = { f: two, toJSON: a.toJSON }; a.toJSON(); JSON.stringify(b); return n => out; }
function gotThis() { const a = { f: never, get g() { return this.f; } }; const b = Object.create(a); b.f = two; a.g; return b.g; }
function steppedThis() { let out; const a = { f: never, next() { out = this.f(21); return { done: true, value: 1 }; }, [Symbol.iterator]() { return this; } }; const b = { f: two, next: a.next, [Symbol.iterator]: a[Symbol.iterator] }; a.next(); for (const each of b); return n => out; }
const rows = [];
rows.push('pop' + "=" + (yes ? [one, two].pop() : never)(21));
rows.push('shift' + "=" + (yes ? [one, two].shift() : never)(21));
rows.push('at' + "=" + (yes ? [one, two].at(1) : never)(21));
rows.push('index' + "=" + (yes ? [one, two][i1] : never)(21));
rows.push('find' + "=" + (yes ? [one, two].find(f => f === two) : never)(21));
rows.push('findLast' + "=" + (yes ? [one, two].findLast(f => f === one) : never)(21));
rows.push('slice' + "=" + (yes ? [one, two].slice(1)[0] : never)(21));
rows.push('concat' + "=" + (yes ? [one].concat([two])[1] : never)(21));
rows.push('concat value' + "=" + (yes ? [one].concat(two)[1] : never)(21));
rows.push('splice result' + "=" + (yes ? [one, two].splice(1, 1)[0] : never)(21));
rows.push('splice receiver' + "=" + (yes ? spliced()[1] : never)(21));
rows.push('toSpliced' + "=" + (yes ? [one].toSpliced(0, 1, two)[0] : never)(21));
rows.push('toSorted' + "=" + (yes ? [one, two].toSorted(() => 0)[1] : never)(21));
rows.push('toReversed' + "=" + (yes ? [one, two].toReversed()[0] : never)(21));
rows.push('reverse' + "=" + (yes ? [one, two].reverse()[0] : never)(21));
rows.push('sort' + "=" + (yes ? [one, two].sort(() => 0)[1] : never)(21));
rows.push('flat' + "=" + (yes ? [[one], [two]].flat()[1] : never)(21));
rows.push('flatMap' + "=" + (yes ? [one, two].flatMap(f => [f, f])[3] : never)(21));
rows.push('filter' + "=" + (yes ? [one, two].filter(f => f === two)[0] : never)(21));
rows.push('map' + "=" + (yes ? [one, two].map(f => f)[1] : never)(21));
rows.push('map to another' + "=" + (yes ? [1, 2].map(n => n === 2 ? two : one)[1] : never)(21));
rows.push('reduce' + "=" + (yes ? [one, two].reduce((a, b) => b) : never)(21));
rows.push('reduce with a start' + "=" + (yes ? [1].reduce((a, b) => a, two) : never)(21));
rows.push('reduceRight' + "=" + (yes ? [two, one].reduceRight((a, b) => b) : never)(21));
rows.push('entries' + "=" + (yes ? [...[one, two].entries()][1][1] : never)(21));
rows.push('values' + "=" + (yes ? [...[one, two].values()][1] : never)(21));
rows.push('Array.from' + "=" + (yes ? Array.from([one, two])[1] : never)(21));
rows.push('Array.from a set' + "=" + (yes ? Array.from(new Set([two]))[0] : never)(21));
rows.push('Array.from with a function' + "=" + (yes ? Array.from([1], () => two)[0] : never)(21));
rows.push('Array.from an array-like' + "=" + (yes ? Array.from({ length: 1, 0: two })[0] : never)(21));
rows.push('Array.of' + "=" + (yes ? Array.of(one, two)[1] : never)(21));
rows.push('fill' + "=" + (yes ? new Array(2).fill(two)[1] : never)(21));
rows.push('copyWithin' + "=" + (yes ? [two, one].copyWithin(1, 0)[1] : never)(21));
rows.push('with' + "=" + (yes ? [one, one].with(1, two)[1] : never)(21));
rows.push('destructured' + "=" + (yes ? (([a, b]) => b)([one, two]) : never)(21));
rows.push('rest of an array' + "=" + (yes ? (([a, ...b]) => b[0])([one, two]) : never)(21));
rows.push('for of' + "=" + (yes ? lastOf([one, two]) : never)(21));
rows.push('iterator by hand' + "=" + (yes ? [two][Symbol.iterator]().next().value : never)(21));
rows.push('generator' + "=" + (yes ? (function* () { yield two; })().next().value : never)(21));
rows.push('generator return' + "=" + (yes ? (function* () { return two; })().next().value : never)(21));
rows.push('yield star' + "=" + (yes ? [...(function* () { yield* [one, two]; })()][1] : never)(21));
rows.push('sent to a generator' + "=" + (yes ? sentBack(two) : never)(21));
rows.push('map get' + "=" + (yes ? new Map([[1, two]]).get(1) : never)(21));
rows.push('map set get' + "=" + (yes ? new Map().set(1, two).get(1) : never)(21));
rows.push('map pair' + "=" + (yes ? [...new Map([[1, two]])][0][1] : never)(21));
rows.push('map key' + "=" + (yes ? [...new Map([[two, 1]])][0][0] : never)(21));
rows.push('map keys' + "=" + (yes ? [...new Map([[two, 1]]).keys()][0] : never)(21));
rows.push('map values' + "=" + (yes ? [...new Map([[1, two]]).values()][0] : never)(21));
rows.push('map entries' + "=" + (yes ? [...new Map([[1, two]]).entries()][0][1] : never)(21));
rows.push('map forEach value' + "=" + (yes ? eachOf(new Map([[1, two]]), 0) : never)(21));
rows.push('map forEach key' + "=" + (yes ? eachOf(new Map([[two, 1]]), 1) : never)(21));
rows.push('for of a map' + "=" + (yes ? lastOf(new Map([[1, two]]))[1] : never)(21));
rows.push('set' + "=" + (yes ? [...new Set([two])][0] : never)(21));
rows.push('set add' + "=" + (yes ? [...new Set().add(two)][0] : never)(21));
rows.push('set forEach' + "=" + (yes ? eachOf(new Set([two]), 0) : never)(21));
rows.push('set forEach second' + "=" + (yes ? eachOf(new Set([two]), 1) : never)(21));
rows.push('set entries' + "=" + (yes ? [...new Set([two]).entries()][0][1] : never)(21));
rows.push('weak map' + "=" + (yes ? new WeakMap([[anchor, two]]).get(anchor) : never)(21));
rows.push('weak ref' + "=" + (yes ? new WeakRef(two).deref() : never)(21));
rows.push('groupBy' + "=" + (yes ? Object.groupBy([one, two], f => f === two ? 'b' : 'a').b[0] : never)(21));
rows.push('Object.values' + "=" + (yes ? Object.values({ a: two })[0] : never)(21));
rows.push('Object.entries' + "=" + (yes ? Object.entries({ a: two })[0][1] : never)(21));
rows.push('Object.fromEntries' + "=" + (yes ? Object.fromEntries([['a', two]]).a : never)(21));
rows.push('Object.assign' + "=" + (yes ? Object.assign({ a: one }, { a: two }).a : never)(21));
rows.push('Object.assign to new' + "=" + (yes ? Object.assign({}, { a: two }).a : never)(21));
rows.push('Object.create' + "=" + (yes ? Object.create({ a: two }).a : never)(21));
rows.push('Object.create with properties' + "=" + (yes ? Object.create(null, { a: { value: two } }).a : never)(21));
rows.push('descriptor' + "=" + (yes ? Object.getOwnPropertyDescriptor({ a: two }, 'a').value : never)(21));
rows.push('descriptors' + "=" + (yes ? Object.getOwnPropertyDescriptors({ a: two }).a.value : never)(21));
rows.push('defineProperty' + "=" + (yes ? Object.defineProperty({ a: one }, 'a', { value: two }).a : never)(21));
rows.push('defineProperties' + "=" + (yes ? Object.defineProperties({}, { a: { value: two } }).a : never)(21));
rows.push('getPrototypeOf' + "=" + (yes ? Object.getPrototypeOf(Object.create({ a: two })).a : never)(21));
rows.push('setPrototypeOf' + "=" + (yes ? Object.setPrototypeOf({}, { a: two }).a : never)(21));
rows.push('spread' + "=" + (yes ? ({ ...{ a: two } }).a : never)(21));
rows.push('spread over' + "=" + (yes ? ({ a: one, ...{ a: two } }).a : never)(21));
rows.push('rest of an object' + "=" + (yes ? (({ b, ...c }) => c.a)({ a: two, b: 1 }) : never)(21));
rows.push('Reflect.get' + "=" + (yes ? Reflect.get({ a: two }, 'a') : never)(21));
rows.push('Reflect.set' + "=" + (yes ? reflected().a : never)(21));
rows.push('Reflect.apply' + "=" + (yes ? Reflect.apply(() => two, null, []) : never)(21));
rows.push('Reflect.construct' + "=" + (yes ? Reflect.construct(function () { this.a = two; }, []).a : never)(21));
rows.push('Reflect.getOwnPropertyDescriptor' + "=" + (yes ? Reflect.getOwnPropertyDescriptor({ a: two }, 'a').value : never)(21));
rows.push('getter' + "=" + (yes ? ({ get a() { return two; } }).a : never)(21));
rows.push('setter' + "=" + (yes ? throughSetter(two) : never)(21));
rows.push('computed name' + "=" + (yes ? ({ ['a' + i1]: two })['a1'] : never)(21));
rows.push('computed key' + "=" + (yes ? ({ a: one, b: two })[keyB] : never)(21));
rows.push('stored by key' + "=" + (yes ? storedByKey(two).b : never)(21));
rows.push('symbol' + "=" + (yes ? ({ [token]: two })[token] : never)(21));
rows.push('static' + "=" + (yes ? (class { static a = two; }).a : never)(21));
rows.push('static block' + "=" + (yes ? (class { static a; static { this.a = two; } }).a : never)(21));
rows.push('private' + "=" + (yes ? new (class { #a = two; get() { return this.#a; } })().get() : never)(21));
rows.push('field' + "=" + (yes ? new (class { a = two; })().a : never)(21));
rows.push('accessor of a class' + "=" + (yes ? new (class { get a() { return two; } })().a : never)(21));
rows.push('method as a value' + "=" + (yes ? new (class { a(n) { return n * 2; } })().a : never)(21));
rows.push('inherited method' + "=" + (yes ? new (class extends (class { a(n) { return n * 2; } }) {})().a : never)(21));
rows.push('super' + "=" + (yes ? new (class extends (class { a() { return two; } }) { a() { return super.a(); } })().a() : never)(21));
rows.push('constructor returns' + "=" + (yes ? new (function () { return { a: two }; })().a : never)(21));
rows.push('prototype' + "=" + (yes ? protoMade().a : never)(21));
rows.push('bind' + "=" + (yes ? (function () { return this; }).bind(two)() : never)(21));
rows.push('bound argument' + "=" + (yes ? (f => f).bind(null, two)() : never)(21));
rows.push('call this' + "=" + (yes ? (function () { return this; }).call(two) : never)(21));
rows.push('call' + "=" + (yes ? (f => f).call(null, two) : never)(21));
rows.push('apply' + "=" + (yes ? (f => f).apply(null, [two]) : never)(21));
rows.push('apply second' + "=" + (yes ? ((a, f) => f).apply(null, [1, two]) : never)(21));
rows.push('closure' + "=" + (yes ? (f => () => f)(two)() : never)(21));
rows.push('default' + "=" + (yes ? ((f = two) => f)() : never)(21));
rows.push('default from another' + "=" + (yes ? ((a, f = a) => f)(two) : never)(21));
rows.push('arguments' + "=" + (yes ? (function () { return arguments[1]; })(one, two) : never)(21));
rows.push('arguments written' + "=" + (yes ? (function (f) { arguments[0] = two; return arguments[0]; })(one) : never)(21));
rows.push('rest' + "=" + (yes ? ((...fs) => fs[1])(one, two) : never)(21));
rows.push('spread call' + "=" + (yes ? ((a, f) => f)(...[one, two]) : never)(21));
rows.push('spread new' + "=" + (yes ? new (function (a, f) { this.f = f; })(...[one, two]).f : never)(21));
rows.push('tag' + "=" + (yes ? ((strings, f) => f)`${two}` : never)(21));
rows.push('optional' + "=" + (yes ? ({ a: two })?.a : never)(21));
rows.push('nullish' + "=" + (yes ? (nothing ?? two) : never)(21));
rows.push('or' + "=" + (yes ? (nothing || two) : never)(21));
rows.push('and' + "=" + (yes ? (anchor && two) : never)(21));
rows.push('assigned if nullish' + "=" + (yes ? assignedIfNullish() : never)(21));
rows.push('comma' + "=" + (yes ? (one, two) : never)(21));
rows.push('finally' + "=" + (yes ? (() => { try { return two; } finally { i1 + 1; } })() : never)(21));
rows.push('caught' + "=" + (yes ? (() => { try { throw two; } catch (f) { return f; } })() : never)(21));
rows.push('caught property' + "=" + (yes ? (() => { try { throw { a: two }; } catch ({ a }) { return a; } })() : never)(21));
rows.push('error cause' + "=" + (yes ? (() => { try { throw new Error('x', { cause: two }); } catch (e) { return e.cause; } })() : never)(21));
rows.push('await' + "=" + (yes ? await two : never)(21));
rows.push('await a promise' + "=" + (yes ? await Promise.resolve(two) : never)(21));
rows.push('await async' + "=" + (yes ? await (async () => two)() : never)(21));
rows.push('await then' + "=" + (yes ? await Promise.resolve(1).then(() => two) : never)(21));
rows.push('await a chain' + "=" + (yes ? await (async () => one)().then(async () => two) : never)(21));
rows.push('await catch' + "=" + (yes ? await Promise.reject(two).catch(f => f) : never)(21));
rows.push('await rejected' + "=" + (yes ? await (async () => { try { await Promise.reject(two); } catch (f) { return f; } })() : never)(21));
rows.push('await finally' + "=" + (yes ? await Promise.resolve(two).finally(() => one) : never)(21));
rows.push('all' + "=" + (yes ? (await Promise.all([one, Promise.resolve(two)]))[1] : never)(21));
rows.push('allSettled' + "=" + (yes ? (await Promise.allSettled([Promise.resolve(two)]))[0].value : never)(21));
rows.push('race' + "=" + (yes ? await Promise.race([Promise.resolve(two)]) : never)(21));
rows.push('any' + "=" + (yes ? await Promise.any([Promise.reject(one), Promise.resolve(two)]) : never)(21));
rows.push('new Promise' + "=" + (yes ? await new Promise(resolve => resolve(two)) : never)(21));
rows.push('withResolvers' + "=" + (yes ? await (() => { const { promise, resolve } = Promise.withResolvers(); resolve(two); return promise; })() : never)(21));
rows.push('thenable' + "=" + (yes ? await { then(resolve) { resolve(two); } } : never)(21));
rows.push('async generator' + "=" + (yes ? (await (async function* () { yield two; })().next()).value : never)(21));
rows.push('for await' + "=" + (yes ? await (async () => { let f; for await (f of [Promise.resolve(two)]); return f; })() : never)(21));
rows.push('proxy get' + "=" + (yes ? new Proxy({}, { get: () => two }).a : never)(21));
rows.push('proxy target' + "=" + (yes ? new Proxy({ a: two }, {}).a : never)(21));
rows.push('proxy apply' + "=" + (yes ? new Proxy(one, { apply: () => two })() : never)(21));
rows.push('proxied function' + "=" + (yes ? new Proxy(two, {}) : never)(21));
rows.push('array method on an array-like' + "=" + (yes ? Array.prototype.map.call({ length: 1, 0: two }, f => f)[0] : never)(21));
rows.push('comparator' + "=" + (yes ? seenByComparator() : never)(21));
rows.push('replacer' + "=" + (yes ? seenByReplace() : never)(21));
rows.push('reviver holder' + "=" + (yes ? revived() : never)(21));
rows.push('toJSON' + "=" + (yes ? jsoned() : never)(21));
rows.push('valueOf' + "=" + (yes ? converted() : never)(21));
rows.push('toPrimitive' + "=" + (yes ? madePrimitive() : never)(21));
rows.push('globalThis' + "=" + (yes ? (globalThis.keptForTheTest = two, globalThis.keptForTheTest) : never)(21));
rows.push('module variable' + "=" + (yes ? (kept = two, kept) : never)(21));
rows.push('variable set in a callback' + "=" + (yes ? setInCallback() : never)(21));
rows.push('typeof guard' + "=" + (yes ? (typeof maybe === 'function' ? maybe : one) : never)(21));
rows.push('in a frozen object' + "=" + (yes ? Object.freeze({ a: two }).a : never)(21));
rows.push('after delete' + "=" + (yes ? afterDelete().a : never)(21));
rows.push('many: own' + "=" + (yes ? new kinds[i7]().shared : never)(21));
rows.push('many: inherited' + "=" + (yes ? new kinds[i7]().inherited() : never)(21));
rows.push('many: static' + "=" + (yes ? kinds[i7].made() : never)(21));
rows.push('many: prototype' + "=" + (yes ? kinds[i7].prototype.inherited() : never)(21));
rows.push('many: method' + "=" + (yes ? new classes[i7]().method() : never)(21));
rows.push('many: static method' + "=" + (yes ? classes[i7].made() : never)(21));
rows.push('many: getter' + "=" + (yes ? new classes[i7]().got : never)(21));
rows.push('many: literal' + "=" + (yes ? literals[i7].shared : never)(21));
rows.push('many: stored' + "=" + (yes ? (literals[i3].late = two, literals[i3].late) : never)(21));
rows.push('many: stored by key' + "=" + (yes ? (literals[i3][keyB] = two, literals[i3].b) : never)(21));
rows.push('many: passed' + "=" + (yes ? passers[i7](two) : never)(21));
rows.push('many: made' + "=" + (yes ? makers[i7]() : never)(21));
rows.push('many: element' + "=" + (yes ? lists[i7][1] : never)(21));
rows.push('many: pushed' + "=" + (yes ? (lists[i3].push(two), lists[i3][2]) : never)(21));
rows.push('many: popped' + "=" + (yes ? lists[i7].slice().pop() : never)(21));
rows.push('many: global' + "=" + (yes ? globals[i3].values({ a: two })[0] : never)(21));
rows.push('many: call' + "=" + (yes ? passers[i7].call(null, two) : never)(21));
rows.push('many: apply' + "=" + (yes ? passers[i7].apply(null, [two]) : never)(21));
rows.push('many: bound' + "=" + (yes ? passers[i7].bind(null, two)() : never)(21));
rows.push('many: constructor' + "=" + (yes ? new (new kinds[i7]().constructor)().shared : never)(21));
rows.push('engine: the resolver handed to a thenable' + "=" + (yes ? await resolverOfAThenable() : never)(21));
rows.push('engine: this of an iterator method' + "=" + (yes ? iteratedThis() : never)(21));
rows.push('engine: this of valueOf' + "=" + (yes ? convertedThis() : never)(21));
rows.push('engine: this of toString' + "=" + (yes ? shownThis() : never)(21));
rows.push('engine: this of toJSON' + "=" + (yes ? jsonThis() : never)(21));
rows.push('engine: this of a getter' + "=" + (yes ? gotThis() : never)(21));
rows.push('engine: this of next' + "=" + (yes ? steppedThis() : never)(21));
rows.push('structured' + "=" + (yes ? structuredClone({ a: 1 }).a === 1 ? two : one : never)(21));
rows.push('iterator helper' + "=" + (yes ? [one, two].values().drop(1).next().value : never)(21));
rows.push('iterator map' + "=" + (yes ? [1].values().map(() => two).next().value : never)(21));
rows.push('iterator toArray' + "=" + (yes ? [two].values().toArray()[0] : never)(21));
rows.push('Iterator.from' + "=" + (yes ? Iterator.from([two]).next().value : never)(21));
console.log(rows.join("\n"));
