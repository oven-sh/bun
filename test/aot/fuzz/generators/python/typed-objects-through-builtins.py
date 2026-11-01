#!/usr/bin/env python3
"""typed-objects-through-built-ins-and-back.py <n>: an object of the program goes through a built-in and comes back.
The n-th of 820 programs: (kind of typed object) x (road). The object is made in typed code, goes down the road (Object.values, Array.from, a Map, Promise.all, a generator ..), and what comes out, which TypeScript still types, is
read, stored to, deleted from, added to, called, spread and compared with the original. No cast, no any. `names` lists the programs; a name does in place of the number.
As plain Bun, line by line."""
import sys, json
KINDS = {
 'record': ('interface T { id: number; name: string; note?: string }', '{ id: 1, name: "one" }', []),
 'recordWithNote': ('interface T { id: number; name: string; note?: string }', '{ id: 1, name: "one", note: "n" }', []),
 'instance': ('class T { id: number = 1; name: string = "one"; note?: string; }', 'new T()', ['r instanceof T']),
 'instanceWithMethod': ('class T { id: number = 1; name: string = "one"; note?: string; label(): string { return this.name + this.id; } }', 'new T()', ['r.label()', 'r instanceof T']),
 'heir': ('class Base { id: number = 1; note?: string; }\nclass T extends Base { name: string = "one"; }', 'new T()', ['r instanceof Base']),
 'nested': ('interface Inner { n: number }\ninterface T { id: number; name: string; note?: string; inner: Inner }', '{ id: 1, name: "one", inner: { n: 5 } }', ['r.inner.n', '(r.inner.n = 6, x.inner.n)', 'r.inner === x.inner']),
 'withArray': ('interface T { id: number; name: string; note?: string; list: number[] }', '{ id: 1, name: "one", list: [1, 2] }', ['r.list.join()', '(r.list.push(3), x.list.length)', 'r.list === x.list']),
 'union': ('interface A { kind: "a"; id: number; name: string; note?: string }\ninterface B { kind: "b"; id: number; name: string; note?: string; more: number }\ntype T = A | B;', '{ kind: "b", id: 1, name: "one", more: 2 }', ['r.kind === "b" ? r.more : -1']),
 'getter': ('class T { id: number = 1; name: string = "one"; note?: string; get both(): string { return this.name + this.id; } }', 'new T()', ['r.both']),
 'frozenLater': ('interface T { id: number; name: string; note?: string }', '{ id: 1, name: "one" }', ['Object.isFrozen(Object.freeze(r))', 'Object.isFrozen(x)']),
}
ROADS = {
 'itself': 'x', 'objectValues': 'Object.values({ k: x })[0]', 'objectValuesOfRecord': 'Object.values(table)[0]', 'objectEntries': 'Object.entries(table)[0][1]', 'forOfObjectValues': '(() => { for (const each of Object.values(table)) return each; return x; })()',
 'arrayFrom': 'Array.from(list)[0]', 'arrayFromMapped': 'Array.from(list, each => each)[0]', 'arrayFromSet': 'Array.from(new Set(list))[0]', 'arrayOf': 'Array.of(x)[0]', 'spread': '[...list][0]', 'slice': 'list.slice()[0]', 'filter': 'list.filter(() => true)[0]',
 'find': 'list.find(() => true)!', 'findLast': 'list.findLast(() => true)!', 'at': 'list.at(0)!', 'concat': 'list.concat([])[0]', 'flat': '[list].flat()[0]', 'flatMap': 'list.flatMap(each => [each])[0]', 'map': 'list.map(each => each)[0]',
 'reverse': 'list.slice().reverse()[0]', 'sort': 'list.slice().sort((a, b) => a.id - b.id)[0]', 'toSorted': 'list.toSorted((a, b) => a.id - b.id)[0]', 'toReversed': 'list.toReversed()[0]', 'with': 'list.with(0, x)[0]', 'toSpliced': 'list.toSpliced(1, 0)[0]',
 'reduce': 'list.reduce((_, each) => each)', 'reduceWithStart': 'list.reduce<T | undefined>((_, each) => each, undefined)!', 'pop': 'list.slice().pop()!', 'shift': 'list.slice().shift()!', 'splice': 'list.slice().splice(0, 1)[0]',
 'entries': '[...list.entries()][0][1]', 'values': 'list.values().next().value!', 'mapGet': 'new Map([["k", x]]).get("k")!', 'mapValues': '[...new Map([["k", x]]).values()][0]', 'mapEntries': '[...new Map([["k", x]])][0][1]', 'mapForEach': '(() => { let found = x; new Map([["k", x]]).forEach(each => { found = each; }); return found; })()',
 'setSpread': '[...new Set([x])][0]', 'setValues': 'new Set([x]).values().next().value!', 'setForEach': '(() => { let found = x; new Set([x]).forEach(each => { found = each; }); return found; })()',
 'promiseResolve': 'await Promise.resolve(x)', 'promiseAll': '(await Promise.all([x]))[0]', 'promiseAllOfPromises': '(await Promise.all([Promise.resolve(x)]))[0]', 'promiseRace': 'await Promise.race([x])', 'promiseAny': 'await Promise.any([Promise.resolve(x)])',
 'allSettled': '(result => result.status === "fulfilled" ? result.value : x)((await Promise.allSettled([Promise.resolve(x)]))[0])', 'then': 'await Promise.resolve(1).then(() => x)', 'asyncFunction': 'await (async () => x)()',
 'objectAssign': 'Object.assign(x, {})', 'fromEntries': 'Object.fromEntries([["k", x]]).k', 'groupBy': 'Object.groupBy(list, () => "g").g![0]', 'mapGroupBy': 'Map.groupBy(list, () => "g").get("g")![0]', 'weakRef': 'new WeakRef(x).deref()!', 'weakMap': '(key => new WeakMap([[key, x]]).get(key)!)({})',
 'reflectGet': '(Reflect.get({ k: x }, "k") as T)', 'computedKey': 'table[["k"].join("")]', 'destructured': '(({ k }) => k)({ k: x })', 'arrayDestructured': '(([first]) => first)(list)', 'rest': '((...all: T[]) => all[0])(x)', 'restOfArray': '(([, ...others]) => others[0])([x, x])',
 'generator': '(function* () { yield x; })().next().value!', 'generatorSpread': '[...(function* () { yield x; })()][0]', 'asyncGenerator': '(await (async function* () { yield x; })().next()).value!', 'iteratorHelpers': 'list.values().map(each => each).toArray()[0]', 'iteratorFilter': 'list.values().filter(() => true).toArray()[0]',
 'applied': '((each: T) => each).apply(undefined, [x])', 'called': '((each: T) => each).call(undefined, x)', 'bound': '((each: T) => each).bind(undefined, x)()', 'reflectApply': '(Reflect.apply((each: T) => each, undefined, [x]) as T)', 'conditional': '(list.length ? x : list[0])', 'nullish': '(list.at(5) ?? x)',
 'closure': '(() => () => x)()()', 'field': 'new (class { constructor(public held: T) {} })(x).held', 'staticField': '(class { static held: T = x; }).held', 'tuple': '((pair: [T, number]) => pair[0])([x, 1])', 'symbolKey': '({ [Symbol.iterator]: x })[Symbol.iterator]', 'structuredLike': 'list.copyWithin(0, 0)[0]', 'fill': 'new Array<T>(1).fill(x)[0]', 'arrayFromLength': 'Array.from({ length: 1 }, () => x)[0]', 'joinedLists': '[...list, ...list][1]', 'includesThenIndex': 'list[list.indexOf(x)]', 'everySome': '(list.every(each => each === x) && list.some(each => each === x) ? list[0] : list[0])', 'keysThenRead': 'table[Object.keys(table)[0]]',
}
programs = [(k, r) for k in KINDS for r in ROADS]
if sys.argv[1] == 'count': print(len(programs)); sys.exit()
if sys.argv[1] == 'names': print('\n'.join('.'.join(p) for p in programs)); sys.exit()
kk, rk = programs[int(sys.argv[1])] if sys.argv[1].isdigit() else tuple(sys.argv[1].split('.'))
declarations, make, extra = KINDS[kk]
uses = ['r === x', 'r.id', 'r.name', 'String(r.note)', 'read(r)', '(r.id = 2, x.id)', '(x.name = "two", r.name)', '(r.note = "added", x.note)', '(delete r.note, "note" in x)', 'Object.keys(r).join()', 'JSON.stringify(r)', 'JSON.stringify({ ...r })', '(({ id, name }) => name + id)(r)', '[r].map(read).join()', 'r === x'] + extra + ['JSON.stringify(x)']
body = '\n'.join(f'row({json.dumps(u)}, () => ({u}));' for u in uses)
print(f"""// {kk}.{rk}
export {{}};
declare const console: any;
{declarations}
function row(name: string, run: () => unknown) {{ try {{ console.log(name + ": " + String(run())); }} catch (error) {{ console.log(name + ": THROWS " + String(error).split(" (bun")[0]); }} }}
function read(o: T): string {{ return o.name + o.id; }}
const x: T = {make};
const list: T[] = [x];
const table: Record<string, T> = {{ k: x }};
const r: T = {ROADS[rk]};
{body}""")
