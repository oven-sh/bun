// One place in a program that sees two kinds of list or collection. A function is hot with one kind (an array of integers, a Map, a typed array over a buffer that can be resized, what entries() answers) and
// then gets another. A value of several kinds is split into a tag and a cell, or is used behind a switch on its kind, and whatever the compiler reads of one kind (a length, a size, a storage, a position) may be
// read only behind that switch. The generators that give every use one birth have no such place.
//
// A site is a use, the kind it is hot with, the kind that comes then, and the road by which the value gets to the use. Every site has functions and classes of its own. A program holds the sites of one
// road and one pair of kinds, a hundred or two, so that nothing but those two births decides what the compiler believes at its uses. One site a program would be more than three million programs.
import known from "./known-to-differ.json";
import onceWrong from "./once-wrong.json";

type Program = { name: string; file: string; text: string };

// The letter says which uses make sense for a kind: L an array, K like an array, T a typed array, V a DataView, B a buffer, M a Map, S a Set, W weak, I an iterator, H a collection of the host, Y what only for await can walk, X none of them.
export const kinds: Record<string, [string, string]> = {
  integers: ["L", "[5, 6, 7]"],
  fractions: ["L", "[1.5, 2.5, 3.5]"],
  texts: ["L", '["a", "b"]'],
  records: ["L", "[{ a: 1 }, { a: 2 }]"],
  mixed: ["L", '[1, "a", 2.5, null, undefined, { a: 1 }]'],
  pairs: ["L", '[["a", 1], ["b", 2]]'],
  lists: ["L", "[[1, 2], [3], []]"],
  emptyList: ["L", "[]"],
  oneInteger: ["L", "[2]"],
  holes: ["L", "[1, , 3]"],
  holesOfFractions: ["L", "[1.5, , 3.5]"],
  holesOfTexts: ["L", '["a", , "c"]'],
  onlyHoles: ["L", "new Array(3)"],
  lastHole: ["L", "[1, 2, ,]"],
  notANumber: ["L", "[NaN, 1.5, -0]"],
  bigIntegers: ["L", "[1n, 2n]"],
  largeIntegers: ["L", "[2147483647, -2147483648, 4294967296]"],
  sparse: ["L", "sparse()"],
  cut: ["L", "withLength([1, 2, 3, 4], 2)"],
  cutToNothing: ["L", "withLength([1, 2, 3], 0)"],
  stretched: ["L", "withLength([1, 2], 5)"],
  stretchedFractions: ["L", "withLength([1.5], 3)"],
  frozen: ["L", "Object.freeze([1, 2, 3])"],
  sealed: ["L", "Object.seal([1, 2, 3])"],
  notExtensible: ["L", "Object.preventExtensions([1, 2, 3])"],
  fixedLength: ["L", 'Object.defineProperty([1, 2, 3], "length", { writable: false })'],
  getterAtOne: ["L", "Object.defineProperty([1, 2, 3], 1, { get() { return 9; }, enumerable: true, configurable: true })"],
  readOnlyAtOne: ["L", "Object.defineProperty([1, 2, 3], 1, { value: 8, writable: false })"],
  named: ["L", "Object.assign([1, 2], { a: 5, size: 7 })"],
  child: ["L", "new List(1, 2, 3)"],
  childOfOne: ["L", "List.of(4)"],
  ownWalk: ["L", "Object.assign([1, 2, 3], { [Symbol.iterator]: function* () { yield 9; yield 8; } })"],
  noParent: ["L", "Object.setPrototypeOf([1, 2, 3], null)"],
  inherits: ["L", 'Object.setPrototypeOf([1, , 3], Object.setPrototypeOf({ 1: "from above" }, Array.prototype))'],
  notSpread: ["L", "Object.assign([1, 2], { [Symbol.isConcatSpreadable]: false })"],
  filled: ["L", "new Array(3).fill(0)"],
  filledWithFractions: ["L", "new Array(2).fill(0.5)"],
  fromLength: ["L", "Array.from({ length: 3 }, (each, index) => index)"],
  ofTwo: ["L", "Array.of(1, 2)"],
  split: ["L", '"a,b,c".split(",")'],
  mapped: ["L", "[1, 2, 3].map(each => each * 1.5)"],
  filtered: ["L", "[1, 2, 3].filter(each => each > 1)"],
  sliced: ["L", "[1, 2, 3].slice(1)"],
  joined: ["L", "[1].concat([2.5], [\"c\"])"],
  sorted: ["L", "[3, 1, 2].sort()"],
  namesOfRecord: ["L", "Object.keys({ a: 1, b: 2 })"],
  entriesOfRecord: ["L", "Object.entries({ a: 1, b: 2 })"],
  parsed: ["L", 'JSON.parse("[1, 2, 3]")'],
  cloned: ["L", "structuredClone([1, 2.5])"],
  match: ["L", '"abc".match(/b(c)/)'],
  pushed: ["L", "pushed(1, 2, 3)"],
  pushedOfTwoKinds: ["L", 'pushed(1, 2.5, "c")'],
  shifted: ["L", "shifted([0, 1, 2, 3])"],
  rest: ["L", "((...rest) => rest)(1, 2, 3)"],
  spreadOfSet: ["L", "[...new Set([1, 2])]"],
  long: ["L", "Array.from({ length: 100 }, (each, index) => index)"],

  like: ["K", '{ length: 2, 0: "x", 1: "y" }'],
  likeWithHole: ["K", '{ length: 3, 0: "x", 2: "z" }'],
  likeWithTextLength: ["K", '{ length: "2", 0: 1, 1: 2 }'],
  likeWithNegativeLength: ["K", "{ length: -1, 0: 1 }"],
  likeWithGetter: ["K", "{ get length() { return 2; }, 0: 1, 1: 2 }"],
  given: ["K", "(function () { return arguments; })(1, 2, 3)"],
  givenNothing: ["K", "(function () { return arguments; })()"],
  givenStrict: ["K", '(function () { "use strict"; return arguments; })(1, 2, 3)'],
  givenAndNamed: ["K", "(function (a, b) { a = 9; return arguments; })(1, 2, 3)"],
  givenAndCut: ["K", "(function () { arguments.length = 1; return arguments; })(1, 2, 3)"],
  givenAndDeleted: ["K", "(function (a) { delete arguments[0]; return arguments; })(1, 2)"],

  bytes: ["T", "new Uint8Array([1, 2, 3])"],
  signedBytes: ["T", "new Int8Array([-1, 2, 3])"],
  clamped: ["T", "new Uint8ClampedArray([1, 300, 3])"],
  shorts: ["T", "new Int16Array([1, -2, 3])"],
  unsignedShorts: ["T", "new Uint16Array([1, 2, 65535])"],
  words: ["T", "new Int32Array([1, -2, 3])"],
  unsignedWords: ["T", "new Uint32Array([1, 2, 4294967295])"],
  halves: ["T", "new Float16Array([1.5, 2.5])"],
  floats: ["T", "new Float32Array([1.5, 2.5, 0.1])"],
  doubles: ["T", "new Float64Array([1.5, 2.5])"],
  doublesWithNaN: ["T", "new Float64Array([NaN, -0, 1])"],
  bigWords: ["T", "new BigInt64Array([1n, -2n])"],
  unsignedBigWords: ["T", "new BigUint64Array([1n, 2n])"],
  noBytes: ["T", "new Uint8Array(0)"],
  buffer: ["T", 'Buffer.from("abc")'],
  window: ["T", "new Uint8Array([1, 2, 3, 4, 5]).subarray(1, 4)"],
  offset: ["T", "new Int16Array(new Uint8Array([1, 0, 2, 0, 3, 0, 4, 0]).buffer, 2, 2)"],
  manyBytes: ["T", "new Uint8Array(2000).fill(7)"],
  childOfBytes: ["T", "new Bytes([1, 2, 3])"],
  tracking: ["T", "new Uint8Array(resizable(4, 8))"],
  trackingFromTwo: ["T", "new Uint8Array(resizable(4, 8), 2)"],
  fixedOverResizable: ["T", "new Uint8Array(resizable(4, 8), 1, 2)"],
  trackingDoubles: ["T", "new Float64Array(resizable(16, 32))"],
  trackingGrown: ["T", "resized(new Uint8Array(resizable(4, 8)), 8)"],
  trackingShrunk: ["T", "resized(new Uint8Array(resizable(4, 8)), 1)"],
  trackingShrunkToNothing: ["T", "resized(new Uint8Array(resizable(4, 8)), 0)"],
  outOfBounds: ["T", "resized(new Uint8Array(resizable(4, 8), 1, 2), 2)"],
  trackingOutOfBounds: ["T", "resized(new Uint8Array(resizable(4, 8), 2), 1)"],
  detached: ["T", "detached(new Uint8Array([1, 2, 3]))"],
  detachedDoubles: ["T", "detached(new Float64Array([1.5, 2.5]))"],
  shared: ["T", "filledBytes(new Uint8Array(new SharedArrayBuffer(4)))"],
  sharedWords: ["T", "new Int32Array(new SharedArrayBuffer(8))"],
  growing: ["T", "filledBytes(new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 8 })))"],
  grown: ["T", "grown(new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 8 })), 8)"],
  fixedOverGrowing: ["T", "new Uint8Array(new SharedArrayBuffer(4, { maxByteLength: 8 }), 1, 2)"],

  view: ["V", "new DataView(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)"],
  viewOfPart: ["V", "new DataView(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer, 2, 4)"],
  viewOfNothing: ["V", "new DataView(new ArrayBuffer(0))"],
  trackingView: ["V", "new DataView(resizable(8, 16))"],
  trackingViewShrunk: ["V", "resized(new DataView(resizable(8, 16)), 2)"],
  viewOutOfBounds: ["V", "resized(new DataView(resizable(8, 16), 2, 4), 3)"],
  detachedView: ["V", "detached(new DataView(new ArrayBuffer(8)))"],
  sharedView: ["V", "new DataView(new SharedArrayBuffer(8))"],
  growingView: ["V", "new DataView(new SharedArrayBuffer(8, { maxByteLength: 16 }))"],

  memory: ["B", "new Uint8Array([1, 2, 3, 4]).buffer"],
  resizableMemory: ["B", "resizable(4, 8)"],
  sharedMemory: ["B", "new SharedArrayBuffer(4)"],
  growingMemory: ["B", "new SharedArrayBuffer(4, { maxByteLength: 8 })"],
  detachedMemory: ["B", "detached(new Uint8Array(4)).buffer"],

  map: ["M", 'new Map([["a", 1], ["b", 2], ["c", 3]])'],
  emptyMap: ["M", "new Map()"],
  mapOfIntegers: ["M", "new Map([[1, 1.5], [2, 2.5]])"],
  mapOfRecords: ["M", "new Map([[key, { a: 1 }], [other, { a: 2 }]])"],
  mapWithGaps: ["M", 'withoutKey(new Map([["a", 1], ["b", 2], ["c", 3]]), "b")'],
  clearedMap: ["M", 'cleared(new Map([["a", 1]]))'],
  largeMap: ["M", "new Map(Array.from({ length: 40 }, (each, index) => [index, index]))"],
  childOfMap: ["M", 'new Table([["a", 1]])'],
  grouped: ["M", "Map.groupBy([1, 2, 3], each => (each % 2 ? \"a\" : \"b\"))"],
  mapOfOddKeys: ["M", 'new Map([[NaN, 1], [-0, 2], [undefined, 3], [null, 4], ["a", 5]])'],

  set: ["S", "new Set([1, 2, 3, 4])"],
  emptySet: ["S", "new Set()"],
  setOfTexts: ["S", 'new Set(["a", "b"])'],
  setOfPairs: ["S", 'new Set([["a", 1], ["b", 2]])'],
  setWithGaps: ["S", "withoutKey(new Set([1, 2, 3]), 2)"],
  clearedSet: ["S", "cleared(new Set([1]))"],
  largeSet: ["S", "new Set(Array.from({ length: 40 }, (each, index) => index))"],
  childOfSet: ["S", "new Bag([1, 2])"],
  union: ["S", "new Set([1, 2]).union(new Set([2, 3]))"],

  weakMap: ["W", "new WeakMap([[key, 1]])"],
  emptyWeakMap: ["W", "new WeakMap()"],
  weakSet: ["W", "new WeakSet([key])"],
  emptyWeakSet: ["W", "new WeakSet()"],

  valuesOfList: ["I", "[5, 6, 7].values()"],
  keysOfList: ["I", "[5, 6, 7].keys()"],
  entriesOfList: ["I", '["a", "b"].entries()'],
  valuesOfHoles: ["I", "[1, , 3].values()"],
  valuesOfFractions: ["I", "[1.5, 2.5].values()"],
  valuesOfBytes: ["I", "new Uint8Array([1, 2, 3]).values()"],
  entriesOfBytes: ["I", "new Uint8Array([1, 2]).entries()"],
  valuesOfDetached: ["I", "valuesThenDetached()"],
  entriesOfMap: ["I", 'new Map([["a", 1], ["b", 2]]).entries()'],
  keysOfMap: ["I", 'new Map([["a", 1], ["b", 2]]).keys()'],
  valuesOfMap: ["I", 'new Map([["a", 1], ["b", 2]]).values()'],
  valuesOfSet: ["I", "new Set([1, 2, 3]).values()"],
  entriesOfSet: ["I", 'new Set(["a", "b"]).entries()'],
  startedValuesOfList: ["I", "started([5, 6, 7].values())"],
  startedEntriesOfMap: ["I", 'started(new Map([["a", 1], ["b", 2]]).entries())'],
  finishedValuesOfSet: ["I", "started(new Set([1]).values(), 2)"],
  letters: ["I", '"ab\\u{1F600}"[Symbol.iterator]()'],
  matches: ["I", '"a1b2".matchAll(/[a-z](\\d)/g)'],
  entriesOfParams: ["I", 'new URLSearchParams("a=1&b=2").entries()'],
  keysOfHeaders: ["I", 'new Headers({ a: "1", b: "2" }).keys()'],
  entriesOfForm: ["I", "form().entries()"],
  generator: ["I", "(function* () { yield 1; yield 2; yield 3; })()"],
  generatorOfPairs: ["I", '(function* () { yield ["a", 1]; yield ["b", 2]; })()'],
  generatorOfNothing: ["I", "(function* () {})()"],
  generatorThatThrows: ["I", '(function* () { yield 1; throw new RangeError("from the generator"); })()'],
  generatorThatCleansUp: ["I", "(function* () { try { yield 1; yield 2; yield 3; } finally { closed++; } })()"],
  generatorOfGenerator: ["I", "(function* () { yield 0; yield* [1, 2]; yield* new Set([3]); })()"],
  startedGenerator: ["I", "started((function* () { yield 1; yield 2; yield 3; })())"],
  helperMapped: ["I", "[1, 2, 3].values().map(each => each * 2)"],
  helperTaken: ["I", "new Set([1, 2, 3]).values().take(2)"],
  helperFiltered: ["I", "[1, 2, 3].values().filter(each => each !== 2)"],
  wrapped: ["I", "Iterator.from({ next() { return { done: true, value: 1 }; } })"],
  byHand: ["I", "counter(3)"],
  byHandWithReturn: ["I", "counter(3, true)"],
  walkable: ["I", "{ *[Symbol.iterator]() { yield 1; yield 2; } }"],
  walkableOfPairs: ["I", '{ [Symbol.iterator]() { return new Map([["a", 1]]).entries(); } }'],

  params: ["H", 'new URLSearchParams("a=1&b=2&a=3")'],
  noParams: ["H", "new URLSearchParams()"],
  headers: ["H", 'new Headers({ a: "1", b: "2" })'],
  noHeaders: ["H", "new Headers()"],
  headersWithCookies: ["H", 'new Headers([["set-cookie", "x=1"], ["set-cookie", "y=2"], ["a", "1"]])'],
  formData: ["H", "form()"],
  noFormData: ["H", "new FormData()"],

  asyncGenerator: ["Y", "(async function* () { yield 1; yield 2; yield 3; })()"],
  asyncGeneratorOfPairs: ["Y", '(async function* () { yield ["a", 1]; yield ["b", 2]; })()'],
  asyncGeneratorOfNothing: ["Y", "(async function* () {})()"],
  asyncGeneratorThatThrows: ["Y", '(async function* () { yield 1; throw new RangeError("from the generator"); })()'],
  asyncGeneratorThatCleansUp: ["Y", "(async function* () { try { yield 1; yield 2; yield 3; } finally { closed++; } })()"],
  asyncGeneratorOfList: ["Y", "(async function* () { yield* [1, 2]; yield* new Set([3]); })()"],
  asyncByHand: ["Y", "asyncCounter(3)"],
  asyncByHandWithReturn: ["Y", "asyncCounter(3, true)"],
  stream: ["Y", "new ReadableStream({ start(controller) { controller.enqueue(1); controller.enqueue(2); controller.close(); } })"],
  emptyStream: ["Y", "new ReadableStream({ start(controller) { controller.close(); } })"],
  promises: ["L", "[Promise.resolve(1), 2, Promise.resolve(3)]"],
  setOfPromises: ["S", "new Set([Promise.resolve(1), 2])"],
  thenables: ["L", "[{ then(resolve) { resolve(1); } }, 2]"],

  text: ["X", '"abcd"'],
  emptyText: ["X", '""'],
  rope: ["X", '"ab".repeat(3) + String(7)'],
  integer: ["X", "7"],
  nothing: ["X", "null"],
  missing: ["X", "undefined"],
  record: ["X", '{ a: 1, b: "x", length: 2, size: 3 }'],
  bare: ["X", "Object.create(null)"],
  arrow: ["X", "() => 1"],
  proxyOfList: ["X", "new Proxy([1, 2], {})"],
  proxyOfMap: ["X", 'new Proxy(new Map([["a", 1]]), {})'],
  proxyOfBytes: ["X", "new Proxy(new Uint8Array([1, 2]), {})"],
  wrappedText: ["X", 'new String("ab")'],
};

// What is done with the value, and the kinds it makes sense to be hot with.
export const uses: Record<string, [string, string]> = {
  fillByForOf: ["LKTMSIH", "const r = []; for (const each of v) r.push(each); return r;"],
  fillByIndexOfForOf: ["LKTMSIH", "const r = []; let i = 0; for (const each of v) r[i++] = each; return r;"],
  countByForOf: ["LKTMSIH", "let n = 0; for (const each of v) n++; return n;"],
  sumByForOf: ["LTSI", "let s = 0; for (const each of v) s += each; return s;"],
  leaveForOf: ["LKTMSIH", "let kept; for (const each of v) { kept = each; break; } return [kept, closed, v];"],
  leaveForOfAtSecond: ["LKTMSIH", "let n = 0; for (const each of v) if (++n === 2) return [each, closed, v]; return n;"],
  throwInForOf: ["LKTMSIH", 'try { for (const each of v) throw new SyntaxError("mine"); } catch (e) { return [e.name, closed, v]; } return "none";'],
  pairsByForOf: ["LMIH", "const r = []; for (const [k, w] of v) r.push(k, w); return r;"],
  keepOne: ["LKTMSIH", "let kept = null; for (const each of v) if (each !== 5) kept = { each }; return kept.each;"],
  keepLast: ["LKTMSIH", "let kept; for (const each of v) kept = [each]; return kept[0];"],
  twoWalks: ["LKTMSIH", "const r = []; for (const each of v) r.push(each); for (const each of v) r.push(each); return r;"],
  walkInWalk: ["LKTMSIH", "let n = 0; for (const each of v) { for (const inner of v) n++; if (n > 1000) break; } return n;"],
  spread: ["LKTMSIH", "return [...v];"],
  spreadTwice: ["LKTMSIH", "return [...v, ...v];"],
  spreadBetween: ["LKTMSIH", "return [0, ...v, 9];"],
  spreadIntoCall: ["LKTSI", "return Math.max(...v);"],
  spreadIntoOwnCall: ["LKTMSIH", "return count(...v);"],
  spreadIntoRest: ["LKTMSIH", "return gather(0, ...v);"],
  spreadIntoNew: ["LKTMSIH", "return new List(...v);"],
  spreadIntoPush: ["LKTMSIH", "const r = [0]; r.push(...v); return r;"],
  spreadIntoRecord: ["LKTMSIHVBW", "return { ...v };"],
  applied: ["LKT", "return count.apply(null, v);"],
  reflected: ["LKT", "return Reflect.apply(gather, null, v);"],
  arrayFrom: ["LKTMSIH", "return Array.from(v);"],
  arrayFromMapped: ["LKTMSIH", "return Array.from(v, each => [each]);"],
  arrayFromWithIndex: ["LKTMSIH", "return Array.from(v, (each, index) => index);"],
  firstTwo: ["LKTMSIH", "const [a, b] = v; return [a, b, closed];"],
  firstAndRest: ["LKTMSIH", "const [a, ...rest] = v; return [a, rest];"],
  second: ["LKTMSIH", "const [, b] = v; return b;"],
  firstOrDefault: ["LKTMSIH", 'const [a = "none", b = "none", c = "none", d = "none"] = v; return [a, b, c, d];'],
  nested: ["LMIH", "const [[a, b]] = v; return [a, b];"],
  noneOfIt: ["LKTMSIH", "const [] = v; return [closed, v];"],
  swapped: ["LKTMSIH", "let a, b; [b, a] = v; return [a, b];"],
  intoMembers: ["LKTMSIH", "const r = {}; [r.a, r.b] = v; return r;"],
  handedOn: ["LKTMSIH", "return [...(function* () { yield* v; })()];"],
  newMap: ["LMIH", "return new Map(v);"],
  newSet: ["LKTMSIH", "return new Set(v);"],
  newWeakSet: ["LSI", "return new WeakSet(v);"],
  fromEntries: ["LMIH", "return Object.fromEntries(v);"],
  newBytes: ["LKTSIB", "return new Uint8Array(v);"],
  newDoubles: ["LKTSI", "return new Float64Array(v);"],
  doublesFrom: ["LKTSI", "return Float64Array.from(v);"],
  bytesSet: ["LKT", "const r = new Uint8Array(8); r.set(v, 1); return r;"],
  bufferFrom: ["LKTB", "return Buffer.from(v);"],
  newParams: ["LMIH", "return new URLSearchParams(v);"],
  newHeaders: ["LMIH", "return new Headers(v);"],
  groupBy: ["LKTSI", 'return Map.groupBy(v, each => typeof each);'],
  recordGroupBy: ["LKTSI", "return Object.groupBy(v, each => typeof each);"],
  iteratorFrom: ["LKTMSIH", "return Iterator.from(v).take(5).toArray();"],
  helperOfWalk: ["LTMSIH", "return v[Symbol.iterator]().map(each => [each]).take(2).toArray();"],
  unionWith: ["SM", "return new Set([1, 9]).union(v);"],
  isSubset: ["SM", "return new Set([1]).isSubsetOf(v);"],

  // A plus: the use takes two values, v and w, each of either kind.
  spreadOfBoth: ["+LKTMSIH", "return [...v, ...w];"],
  concatOfBoth: ["+L", "return v.concat(w);"],
  pushAllOfOther: ["+L", "v.push(...w); return v;"],
  zipByIndex: ["+LKT", "const r = []; for (let i = 0; i < v.length && i < w.length; i++) r.push(v[i], w[i]); return r;"],
  zipToLongest: ["+LKT", "const r = []; for (let i = 0; i < v.length || i < w.length; i++) r.push(v[i], w[i]); return r;"],
  zipByWalk: ["+LKTMSIH", "const other = w[Symbol.iterator](), r = []; for (const each of v) r.push(each, other.next().value); return r;"],
  copyFromOther: ["+LKT", "for (let i = 0; i < w.length; i++) v[i] = w[i]; return v;"],
  setFromOther: ["+TM", "v.set(w, 1); return v;"],
  walkOfBoth: ["+LKTMSIH", "let n = 0; for (const each of v) for (const inner of w) n++; return n;"],
  sumOfBoth: ["+LKT", "let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; for (let i = 0; i < w.length; i++) s += w[i]; return s;"],
  lengthsOfBoth: ["+LKTMSH", "return [v.length ?? v.size, w.length ?? w.size, v.length === w.length];"],
  longerOfBoth: ["+LKT", "const longer = v.length > w.length ? v : w; return [longer[0], longer.length];"],
  firstThatHasAny: ["+LKTMSH", "const chosen = (v.length ?? v.size) ? v : w; const r = []; for (const each of chosen) r.push(each); return r;"],
  swapOfBoth: ["+LKTMSIHVBW", "[v, w] = [w, v]; return [v, w];"],
  swappedThenWalked: ["+LKTMSIH", "[v, w] = [w, v]; const r = []; for (const each of v) r.push(each); return r;"],
  firstsOfBoth: ["+LKTMSIH", "const [[a], [b]] = [v, w]; return [a, b];"],
  mapOfBoth: ["+LKTMSIH", "const r = new Map(), other = w[Symbol.iterator](); for (const each of v) r.set(each, other.next().value); return r;"],
  sameValue: ["+LKTMSIHVBW", "return [v === w, v == w, Object.is(v, w)];"],
  keptBoth: ["+LKTMSIHVBW", "const r = { one: v, other: w }; return [r.one === v, r.other === w];"],
  otherInFirst: ["+LMS", "(v.push ?? v.add ?? v.set).call(v, w, w); return v;"],
  includesOther: ["+LMS", "return [v.includes?.(w), v.has?.(w)];"],
  everyInOther: ["+LTS", "let n = 0; for (const each of v) if (w.includes?.(each) ?? w.has?.(each)) n++; return n;"],
  // A star: the use stands in an async function only.
  fillByForAwait: ["*LKTMSIHY", "const r = []; for await (const each of v) r.push(each); return r;"],
  countByForAwait: ["*LKTMSIHY", "let n = 0; for await (const each of v) n++; return n;"],
  leaveForAwait: ["*LKTMSIHY", "let kept; for await (const each of v) { kept = each; break; } return [kept, closed];"],
  throwInForAwait: ["*LKTMSIHY", 'try { for await (const each of v) throw new SyntaxError("mine"); } catch (e) { return [e.name, closed]; } return "none";'],
  pairsByForAwait: ["*LMIHY", "const r = []; for await (const [k, w] of v) r.push(k, w); return r;"],
  keepLastByForAwait: ["*LKTMSIHY", "let kept; for await (const each of v) kept = [each]; return kept[0];"],
  twoWalksByForAwait: ["*LKTMSIHY", "const r = []; for await (const each of v) r.push(each); for await (const each of v) r.push(each); return r;"],
  arrayFromAsync: ["*LKTMSIHY", "return await Array.fromAsync(v);"],
  arrayFromAsyncMapped: ["*LKTMSIHY", "return await Array.fromAsync(v, each => [each]);"],
  awaitEach: ["*LKTMSIH", "const r = []; for (const each of v) r.push(await each); return r;"],
  awaitInIndexLoop: ["*LKT", "let s = 0; for (let i = 0; i < v.length; i++) s += await v[i]; return s;"],
  awaitBetweenReads: ["*LKTMSH", "const before = v.length ?? v.size; await null; return [before, v.length ?? v.size];"],
  awaitBetweenStores: ["*LKT", "v[0] = 8; await null; v[1] = 9; return v;"],
  awaitInSpread: ["*LKTMSIH", "return [await 0, ...v, await 9];"],
  promiseAll: ["*LKTMSIH", "return await Promise.all(v);"],
  promiseAllSettled: ["*LKTMSIH", "return (await Promise.allSettled(v)).map(each => each.status);"],
  promiseRace: ["*LKTMSIH", "return await Promise.race([Promise.race(v), late()]);"],
  promiseAny: ["*LKTMSIH", "return await Promise.any(v);"],
  handedOnAsync: ["*LKTMSIHY", "const r = []; for await (const each of (async function* () { yield* v; })()) r.push(each); return r;"],
  nextOfAsync: ["*Y", "return await v.next?.();"],
  returnOfAsync: ["*Y", "return [await v.return?.(4), await v.next?.(), closed];"],
  readerOfStream: ["*Y", "const reader = v.getReader(); return [await reader.read(), await reader.read(), await reader.read()];"],
  typeOfAsync: ["*Y", "return [typeof v, typeof v[Symbol.asyncIterator], typeof v[Symbol.iterator], Object.prototype.toString.call(v)];"],

  walkOfEntries: ["LTMSH", "const r = []; for (const each of v.entries()) r.push(each); return r;"],
  walkOfKeys: ["LTMSH", "const r = []; for (const each of v.keys()) r.push(each); return r;"],
  walkOfValues: ["LTMSH", "const r = []; for (const each of v.values()) r.push(each); return r;"],
  spreadOfEntries: ["LTMSH", "return [...v.entries()];"],
  spreadOfKeys: ["LTMSH", "return [...v.keys()];"],
  pairsOfEntries: ["LTMSH", "let s = \"\"; for (const [k, w] of v.entries()) s += k + \"=\" + w + \";\"; return s;"],
  walkByHand: ["LTMSIH", "const it = v[Symbol.iterator](), r = []; for (let step = it.next(); !step.done; step = it.next()) r.push(step.value); return r;"],
  next: ["I", "return v.next();"],
  nextTwice: ["I", "v.next(); return v.next().value;"],
  nextToTheEnd: ["I", "let n = 0; while (!v.next().done && n < 50) n++; return [n, v.next()];"],
  returned: ["I", "return [v.return?.(4), v.next(), closed];"],
  thrown: ["I", 'return [v.throw?.(new RangeError("in")), closed];'],
  ownWalkIsItself: ["I", "return v[Symbol.iterator]() === v;"],
  toArray: ["I", "return v.toArray();"],
  helperMap: ["I", "return v.map(each => [each]).toArray();"],
  helperDrop: ["I", "return v.drop(1).toArray();"],
  helperReduce: ["I", "return v.reduce((sum, each) => sum + each, \"\");"],
  helperSome: ["I", "return [v.some(each => each === 2), closed, v];"],
  helperFind: ["I", "return v.find(each => each !== 1);"],
  helperFlatMap: ["I", "return v.flatMap(each => [each, each]).toArray();"],
  helperForEach: ["I", "const r = []; v.forEach(each => r.push(each)); return r;"],

  length: ["LKT", "return v.length;"],
  size: ["MSH", "return v.size;"],
  lengthOrSize: ["LKTMSH", "return v.length ?? v.size;"],
  byteLength: ["TVB", "return [v.byteLength, v.byteOffset];"],
  memoryOf: ["TV", "return v.buffer;"],
  at0: ["LKT", "return v[0];"],
  at1: ["LKT", "return v[1];"],
  at2: ["LKT", "return v[2];"],
  atLast: ["LKT", "return v[v.length - 1];"],
  atLength: ["LKT", "return v[v.length];"],
  atMinusOne: ["LKT", "return v[-1];"],
  atTen: ["LKT", "return v[10];"],
  atFraction: ["LKT", "return v[0.5];"],
  atText: ["LKT", 'return v["1"];'],
  atLarge: ["LKT", "return v[4294967295];"],
  atMethod: ["LT", "return v.at(-1);"],
  atGiven: ["LKT", "const r = []; for (const i of [0, 1, 2, 3, -1]) r.push(v[i]); return r;"],
  sum: ["LKT", "let s = 0; for (let i = 0; i < v.length; i++) s += v[i]; return s;"],
  sumDownward: ["LKT", "let s = 0; for (let i = v.length - 1; i >= 0; i--) s += v[i]; return s;"],
  sumWithKeptLength: ["LKT", "let s = 0; for (let i = 0, n = v.length; i < n; i++) s += v[i]; return s;"],
  sumPastTheEnd: ["LKT", "let s = \"\"; for (let i = 0; i <= v.length + 1; i++) s += v[i] + \",\"; return s;"],
  copyByIndex: ["LKT", "const r = []; for (let i = 0; i < v.length; i++) r.push(v[i]); return r;"],
  copyIntoPlanned: ["LKT", "const r = new Array(v.length); for (let i = 0; i < v.length; i++) r[i] = v[i]; return r;"],
  copyIntoBytes: ["LKT", "const r = new Uint8Array(v.length); for (let i = 0; i < v.length; i++) r[i] = v[i]; return r;"],
  store0: ["LKT", "v[0] = 9; return v;"],
  storeFraction: ["LKT", "v[0] = 2.5; return v;"],
  storeText: ["LKT", 'v[1] = "t"; return v;'],
  storeRecord: ["LKT", "v[0] = { a: 1 }; return v;"],
  storeNothing: ["LKT", "v[0] = undefined; return v;"],
  storeBig: ["LKT", "v[0] = 5n; return v;"],
  storeAtLength: ["LKT", "v[v.length] = 9; return v;"],
  storePastLength: ["LKT", "v[v.length + 2] = 9; return v;"],
  storeAtMinusOne: ["LKT", "v[-1] = 9; return [v[-1], v];"],
  storeFar: ["LKT", "v[50000] = 9; return [v.length, v[50000]];"],
  storeAll: ["LKT", "for (let i = 0; i < v.length; i++) v[i] = i; return v;"],
  addToAll: ["LKT", "for (let i = 0; i < v.length; i++) v[i] += 1; return v;"],
  incrementAt0: ["LKT", "v[0]++; return v;"],
  storeNamed: ["LKTMSVBWIH", "v.a = 9; return [v.a, v];"],
  setLengthTo1: ["LK", "v.length = 1; return v;"],
  setLengthTo0: ["LK", "v.length = 0; return v;"],
  setLengthTo5: ["LK", "v.length = 5; return v;"],
  setLengthThenRead: ["LK", "v.length = 1; return [v[0], v[1], v.length];"],
  delete0: ["LKT", "const r = delete v[0]; return [r, v];"],
  deleteLast: ["LKT", "delete v[v.length - 1]; return [v.length, v];"],
  has0: ["LKT", "return [0 in v, 1 in v, 5 in v];"],
  hasOwn1: ["LKT", "return [Object.hasOwn(v, 1), Object.hasOwn(v, \"length\")];"],
  push: ["L", "const r = v.push(1); return [r, v];"],
  pushFraction: ["L", "v.push(1.5); return v;"],
  pushText: ["L", 'v.push("t"); return v;'],
  pushTwo: ["L", "v.push(1, 2); return v;"],
  pushMany: ["L", "for (let i = 0; i < 20; i++) v.push(i); return v;"],
  pop: ["L", "const r = v.pop(); return [r, v];"],
  popAll: ["L", "const r = []; while (v.length) r.push(v.pop()); return [r, v];"],
  shift: ["L", "const r = v.shift(); return [r, v];"],
  unshift: ["L", "const r = v.unshift(0); return [r, v];"],
  splice: ["L", "const r = v.splice(1, 1); return [r, v];"],
  spliceIn: ["L", 'const r = v.splice(1, 0, "in", 2.5); return [r, v];'],
  fill: ["LT", "return v.fill(4);"],
  fillPart: ["LT", "return v.fill(4, 1, 2);"],
  reverse: ["LT", "return v.reverse();"],
  sort: ["LT", "return v.sort();"],
  sortBy: ["LT", "return v.sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));"],
  copyWithin: ["LT", "return v.copyWithin(0, 1);"],
  indexOf: ["LT", "return [v.indexOf(6), v.indexOf(2), v.indexOf(undefined), v.indexOf(NaN)];"],
  lastIndexOf: ["LT", "return [v.lastIndexOf(2), v.lastIndexOf(2.5)];"],
  includes: ["LT", "return [v.includes(2), v.includes(undefined), v.includes(NaN)];"],
  find: ["LT", "return v.find(each => each !== 1);"],
  findLast: ["LT", "return v.findLast(each => each !== 1);"],
  findIndex: ["LT", "return v.findIndex(each => each === undefined);"],
  some: ["LT", "return v.some(each => each === 2);"],
  every: ["LT", "return v.every(each => each !== 2);"],
  reduce: ["LT", "return v.reduce((sum, each) => sum + each, \"\");"],
  reduceWithoutStart: ["LT", "return v.reduce((sum, each) => sum + each);"],
  reduceRight: ["LT", "return v.reduceRight((sum, each) => sum + each, \"\");"],
  forEach: ["LTMSH", "const r = []; v.forEach((each, k) => r.push(k, each)); return r;"],
  forEachThatGrows: ["LMS", "let n = 0; v.forEach(each => { if (n++ < 3) (v.push ?? v.add ?? v.set).call(v, 100 + n, n); }); return [n, v];"],
  forOfThatGrows: ["LMS", "let n = 0; for (const each of v) if (n++ < 3) (v.push ?? v.add ?? v.set).call(v, 100 + n, n); return [n, v];"],
  forOfThatShrinks: ["LMS", "let n = 0; for (const each of v) { n++; if (v.pop) v.pop(); else v.delete(v.keys().next().value); } return [n, v];"],
  forOfThatClears: ["LMS", "let n = 0; for (const each of v) { n++; if (v.clear) v.clear(); else v.length = 0; } return [n, v];"],
  map: ["LT", "return v.map(each => each);"],
  mapToFractions: ["LT", "return v.map(each => each / 2);"],
  mapToRecords: ["LT", "return v.map(each => ({ each }));"],
  mapWithIndex: ["LT", "return v.map((each, index) => index);"],
  filter: ["LT", "return v.filter(each => each !== 2);"],
  flat: ["L", "return v.flat();"],
  flatMap: ["L", "return v.flatMap(each => [each, each]);"],
  slice: ["LTB", "return v.slice(1);"],
  sliceAll: ["LTB", "return v.slice();"],
  sliceFromEnd: ["LTB", "return v.slice(-2, -1);"],
  subarray: ["T", "return v.subarray(1);"],
  subarrayOfSubarray: ["T", "return v.subarray(1).subarray(1);"],
  setFromList: ["T", "v.set([7], 1); return v;"],
  setFromItself: ["T", "v.set(v.subarray(1)); return v;"],
  concat: ["LKTMSX", "return [0].concat(v);"],
  concatOnto: ["L", "return v.concat([9], 8);"],
  concatWithItself: ["L", "return v.concat(v);"],
  join: ["LT", 'return v.join("-");'],
  toText: ["LKTMSVBWIH", "return String(v);"],
  toLocaleText: ["LT", "return v.toLocaleString(\"en-US\");"],
  template: ["LKTMSH", "return `${v}`;"],
  plusText: ["LKTMSH", 'return v + "";'],
  withOne: ["LT", "return v.with(0, 4);"],
  toSorted: ["LT", "return v.toSorted();"],
  toReversed: ["LT", "return v.toReversed();"],
  toSpliced: ["L", "return v.toSpliced(0, 1, 7, 8);"],
  borrowedMap: ["LKT", "return Array.prototype.map.call(v, each => each);"],
  borrowedSlice: ["LKT", "return Array.prototype.slice.call(v, 1);"],
  borrowedJoin: ["LKT", 'return Array.prototype.join.call(v, "+");'],
  borrowedIndexOf: ["LKT", "return Array.prototype.indexOf.call(v, 2);"],
  borrowedIncludes: ["LKT", "return Array.prototype.includes.call(v, undefined);"],
  borrowedPush: ["LK", "const r = Array.prototype.push.call(v, 4); return [r, v];"],
  borrowedPop: ["LK", "const r = Array.prototype.pop.call(v); return [r, v];"],
  borrowedForEach: ["LKT", "const r = []; Array.prototype.forEach.call(v, (each, index) => r.push(index, each)); return r;"],
  borrowedReverse: ["LK", "return Array.prototype.reverse.call(v);"],
  borrowedFill: ["LKT", "return Array.prototype.fill.call(v, 3);"],
  borrowedValues: ["LKT", "return [...Array.prototype.values.call(v)];"],
  borrowedTypedLength: ["T", "return lengthOfTyped.call(v);"],
  borrowedTypedJoin: ["T", "return Uint8Array.prototype.join.call(v, \"+\");"],
  borrowedSize: ["MS", "return sizeOfMap.call(v);"],
  borrowedHas: ["MS", 'return Map.prototype.has.call(v, "a");'],
  borrowedSetHas: ["MS", "return Set.prototype.has.call(v, 1);"],

  has: ["MSWH", 'return [v.has("a"), v.has(1), v.has(key), v.has(NaN)];'],
  get: ["MWH", 'return [v.get("a"), v.get(1), v.get(key), v.get("none")];'],
  getAll: ["H", 'return v.getAll("a");'],
  set: ["MWH", 'const r = v.set("a", "9"); return [r === v, v];'],
  setByRecord: ["MW", "v.set(other, 9); return [v.get(other), v];"],
  setMany: ["M", "for (let i = 0; i < 20; i++) v.set(i, i); return v;"],
  add: ["SW", "const r = v.add(other); return [r === v, v.has(other), v];"],
  addMany: ["S", "for (let i = 0; i < 20; i++) v.add(i); return v;"],
  append: ["H", 'v.append("a", "4"); return v;'],
  remove: ["MSWH", 'return [v.delete("a"), v.delete(1), v.delete(key), v];'],
  clear: ["MS", "v.clear(); return [v.size, v];"],
  getOrInsert: ["MW", "return [v.getOrInsert?.(key, 5), v];"],
  sortHost: ["H", "v.sort?.(); return v;"],
  getSetCookie: ["H", "return v.getSetCookie?.();"],
  toJSON: ["H", "return v.toJSON?.();"],
  countOfHost: ["H", "return v.count;"],
  intersection: ["S", "return v.intersection(new Set([1, 2, \"a\"]));"],
  difference: ["S", "return v.difference(new Set([1]));"],
  firstKey: ["MSH", "return v.keys().next().value;"],
  firstEntry: ["LTMSH", "return v.entries().next().value;"],

  getByte: ["V", "return [v.getInt8(0), v.getUint8(1)];"],
  getShort: ["V", "return [v.getInt16(0), v.getUint16(0, true)];"],
  getWord: ["V", "return [v.getInt32(0), v.getUint32(0, true)];"],
  getFloat: ["V", "return [v.getFloat32(0), v.getFloat64(0, true)];"],
  getBig: ["V", "return [v.getBigInt64(0), v.getBigUint64(0, true)];"],
  getLastByte: ["V", "return v.getUint8(v.byteLength - 1);"],
  getPastTheEnd: ["V", "return v.getUint8(v.byteLength);"],
  getWordAtTheEnd: ["V", "return v.getInt32(v.byteLength - 2);"],
  getAtMinusOne: ["V", "return v.getInt8(-1);"],
  setByte: ["V", "v.setInt8(0, -5); return v;"],
  setWord: ["V", "v.setUint32(0, 0x01020304, true); return v;"],
  setDouble: ["V", "v.setFloat64(0, 1.5); return v;"],
  setPastTheEnd: ["V", "v.setInt16(v.byteLength - 1, 1); return v;"],
  sumOfView: ["V", "let s = 0; for (let i = 0; i < v.byteLength; i++) s += v.getUint8(i); return s;"],
  resize: ["B", "v.resize(2); return v;"],
  grow: ["B", "v.grow(8); return v;"],
  transfer: ["B", "const r = v.transfer(); return [r, v];"],
  transferToFixed: ["B", "const r = v.transferToFixedLength(2); return [r, v];"],
  factsOfMemory: ["B", "return [v.byteLength, v.maxByteLength, v.resizable, v.growable, v.detached];"],
  viewOnto: ["B", "return new DataView(v, 1);"],
  wordsOnto: ["B", "return new Int16Array(v, 2);"],
  resizeUnder: ["TV", "v.buffer.resize(2); return [v.byteLength, v];"],
  resizeInWalk: ["T", "const r = []; for (const each of v) { r.push(each); if (r.length === 1) v.buffer.resize(2); } return r;"],
  resizeInLoop: ["T", "let s = 0; for (let i = 0, n = v.length; i < n; i++) { s += v[i] ?? 100; if (i === 0) v.buffer.resize(1); } return s;"],
  detachInLoop: ["T", "let s = 0; for (let i = 0, n = v.length; i < n; i++) { s += v[i] ?? 100; if (i === 0) v.buffer.transfer(); } return s;"],
  detachInCallback: ["T", "return v.map((each, index) => { if (index === 0) v.buffer.transfer(); return each; });"],
  atomicsLoad: ["T", "return Atomics.load(v, 0);"],
  atomicsAdd: ["T", "return [Atomics.add(v, 0, 1), v];"],

  countByForIn: ["LKTMSVBWIH", "let n = 0; for (const k in v) n++; return n;"],
  namesByForIn: ["LKTMSH", "const r = []; for (const k in v) r.push(k); return r;"],
  keys: ["LKTMSVBWIH", "return Object.keys(v);"],
  values: ["LKTMSH", "return Object.values(v);"],
  entries: ["LKTMSH", "return Object.entries(v);"],
  ownNames: ["LKTMSVBWIH", "return Object.getOwnPropertyNames(v);"],
  ownKeys: ["LKTMSH", "return Reflect.ownKeys(v).length;"],
  describe0: ["LKT", "return Object.getOwnPropertyDescriptor(v, 0);"],
  describeLength: ["LKT", 'return Object.getOwnPropertyDescriptor(v, "length");'],
  json: ["LKTMSVBWIH", "return JSON.stringify(v);"],
  clone: ["LKTMSVB", "return structuredClone(v);"],
  assign: ["LKTMSH", "return Object.assign({}, v);"],
  members: ["LKTMSVBWIH", "const { a, length, size, byteLength } = v; return [a, length, size, byteLength];"],
  membersAndRest: ["LKTMSH", "const { 0: first, ...rest } = v; return [first, rest];"],
  freeze: ["LKMS", "Object.freeze(v); return [Object.isFrozen(v), v];"],
  freezeThenStore: ["LK", "Object.freeze(v); v[0] = 9; return v;"],
  isFrozen: ["LKTMS", "return [Object.isFrozen(v), Object.isSealed(v), Object.isExtensible(v)];"],
  isArray: ["LKTMSVBWIH", "return Array.isArray(v);"],
  isView: ["LKTMSVBWIH", "return ArrayBuffer.isView(v);"],
  typeOf: ["LKTMSVBWIH", "return typeof v;"],
  tag: ["LKTMSVBWIH", "return Object.prototype.toString.call(v);"],
  instanceOfs: ["LKTMSVBWIH", "return [v instanceof Array, v instanceof Map, v instanceof Set, v instanceof Uint8Array, v instanceof DataView, v instanceof Iterator, v instanceof Object];"],
  constructorName: ["LKTMSVBWIH", "return v.constructor?.name;"],
  parent: ["LKTMSVBWIH", "return Object.getPrototypeOf(v) === Array.prototype;"],
  canBeWalked: ["LKTMSVBWIH", "return typeof v[Symbol.iterator];"],
  truth: ["LKTMSVBWIH", "return v ? 1 : 0;"],
  isNothing: ["LKTMSVBWIH", "return v == null;"],
  sameAsItself: ["LKTMSVBWIH", "return [v === v, v == v, Object.is(v, v)];"],
  looselyEqual: ["LKTMSH", 'return [v == "1,2", v == 2, v == ""];'],
  toNumber: ["LKTMSH", "return +v;"],
  optionalLength: ["LKTMSVBWIH", "return v?.length;"],
  optionalCall: ["LKTMSVBWIH", 'return v?.get?.("a");'],
  switchOnKind: ["LKTMSVBWIH", 'if (Array.isArray(v)) return v.length; if (v instanceof Map) return v.size; if (v instanceof Set) return -v.size; if (ArrayBuffer.isView(v)) return v.byteLength; if (typeof v === "string") return v.length; return -1;'],
  switchThenWalk: ["LKTMSVBWIH", "const r = []; if (Array.isArray(v)) for (let i = 0; i < v.length; i++) r.push(v[i]); else if (v instanceof Map) for (const [k, w] of v) r.push(k, w); else if (v instanceof Set) for (const each of v) r.push(each); else if (ArrayBuffer.isView(v)) r.push(v.byteLength); return r;"],
  lengthThenWalk: ["LKTMSIH", "const r = new Array(v.length ?? v.size ?? 0); let i = 0; for (const each of v) r[i++] = each; return r;"],
  keptInRecord: ["LKTMSVBWIH", "const r = { kept: v }; return r.kept === v;"],
  keptInList: ["LKTMSVBWIH", "const r = [v, v]; return r[1];"],
  keptInMap: ["LKTMSVBWIH", "const r = new Map([[v, 1]]); return r.get(v);"],
  keptInWeakMap: ["LKTMSVBWIH", "const r = new WeakMap([[v, 1]]); return r.get(v);"],
  keptInClosure: ["LKTMSVBWIH", "const r = () => v; return r();"],
};

const head = `class List extends Array {}
class Bytes extends Uint8Array {}
class Table extends Map {}
class Bag extends Set {}
const key = { key: 1 }, other = { other: 1 };
let closed = 0;
const lengthOfTyped = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "length").get;
const sizeOfMap = Object.getOwnPropertyDescriptor(Map.prototype, "size").get;
function count() { return arguments.length; }
function gather(first, ...rest) { return rest; }
function sparse() { const a = [1, 2, 3]; a[20000] = 4; return a; }
function withLength(a, length) { a.length = length; return a; }
function pushed(...all) { const a = []; for (let i = 0; i < all.length; i++) a.push(all[i]); return a; }
function shifted(a) { a.shift(); return a; }
function filledBytes(a) { for (let i = 0; i < a.length; i++) a[i] = i + 1; return a; }
function resizable(length, most) { const b = new ArrayBuffer(length, { maxByteLength: most }); filledBytes(new Uint8Array(b)); return b; }
function resized(a, length) { a.buffer.resize(length); return a; }
function grown(a, length) { filledBytes(a); a.buffer.grow(length); return a; }
function detached(a) { a.buffer.transfer(); return a; }
function valuesThenDetached() { const a = new Uint8Array([1, 2, 3]), it = a.values(); it.next(); a.buffer.transfer(); return it; }
function withoutKey(c, k) { c.delete(k); return c; }
function cleared(c) { c.clear(); return c; }
function started(it, steps = 1) { for (let i = 0; i < steps; i++) it.next(); return it; }
function form() { const f = new FormData(); f.append("a", "1"); f.append("b", "2"); f.append("a", "3"); return f; }
function counter(most, hasReturn) { let n = 0; const it = { next() { return n < most ? { done: false, value: ++n } : { done: true, value: undefined }; }, [Symbol.iterator]() { return this; } }; if (hasReturn) it.return = function () { closed++; n = most; return {}; }; return it; }
function late() { return new Promise(resolve => setTimeout(resolve, 1, "late")); }
function asyncCounter(most, hasReturn) { let n = 0; const it = { next() { return Promise.resolve(n < most ? { done: false, value: ++n } : { done: true, value: undefined }); }, [Symbol.asyncIterator]() { return this; } }; if (hasReturn) it.return = function () { closed++; n = most; return Promise.resolve({}); }; return it; }
function showList(r, depth) { const n = r.length; let s = ""; for (let i = 0; i < n; i++) { if (n > 48 && i === 8) { s += ",.." + n + ".."; i = n - 8; } s += (i ? "," : "") + (i in r ? show(r[i], depth + 1) : "hole"); } return s; }
function show(r, depth = 0) {
  if (r === undefined) return "undefined";
  if (r === null) return "null";
  switch (typeof r) {
    case "number": return Object.is(r, -0) ? "-0" : String(r);
    case "string": return r.length > 400 ? JSON.stringify(r.slice(0, 100)) + ".." + r.length : JSON.stringify(r);
    case "bigint": return r + "n";
    case "boolean": return String(r);
    case "symbol": return String(r);
    case "function": return "function " + r.name;
  }
  if (depth > 4) return "deep";
  try {
    const tag = Object.prototype.toString.call(r).slice(8, -1);
    let named = "";
    for (const k of Reflect.ownKeys(r)) if (typeof k === "symbol" || (k !== "length" && k !== "callee" && String(k >>> 0) !== k)) { const d = Reflect.getOwnPropertyDescriptor(r, k); named += " " + String(k) + ":" + ("value" in d ? show(d.value, depth + 1) : "accessor"); }
    if (Array.isArray(r)) return (Object.getPrototypeOf(r) === Array.prototype ? "" : "child") + "[" + showList(r, depth) + "]" + named;
    if (r instanceof Map) return tag + "{" + showList(Array.from(Map.prototype.entries.call(r)), depth) + "}" + named;
    if (r instanceof Set) return tag + "{" + showList(Array.from(Set.prototype.values.call(r)), depth) + "}" + named;
    if (r instanceof DataView) { let s; try { s = r.byteLength + "@" + r.byteOffset + " " + show(r.buffer, depth + 1); } catch (e) { s = e.name; } return tag + "(" + s + ")" + named; }
    if (ArrayBuffer.isView(r)) return r.constructor.name + "(" + r.length + "@" + r.byteOffset + ")[" + showList(r, depth) + "]" + named;
    if (r instanceof ArrayBuffer || r instanceof SharedArrayBuffer) return tag + "(" + r.byteLength + "/" + r.maxByteLength + ")[" + showList(new Uint8Array(r), depth) + "]" + named;
    if (r instanceof WeakMap || r instanceof WeakSet) return tag + "(" + r.has(key) + "," + r.has(other) + ")" + named;
    if (r instanceof URLSearchParams || r instanceof Headers || r instanceof FormData) return tag + "{" + showList(Array.from(r), depth) + "}" + named;
    if (r instanceof Error) return r.name + ": " + r.message;
    if (r instanceof Promise || typeof r[Symbol.asyncIterator] === "function") return tag + named;
    if (typeof r.next === "function") { const rest = []; for (let i = 0; i < 12; i++) { const step = r.next(); if (step.done) break; rest.push(step.value); } return tag + " with " + showList(rest, depth) + " left"; }
    let indexed = "";
    for (const k of Reflect.ownKeys(r)) if (typeof k === "string" && (k === "length" || String(k >>> 0) === k)) { const d = Reflect.getOwnPropertyDescriptor(r, k); indexed += " " + k + ":" + ("value" in d ? show(d.value, depth + 1) : "accessor"); }
    return tag + "{" + indexed + named + " }";
  } catch (e) { return "cannot be shown: " + e.name; }
}
`;

const typedHead = (
  [
    ["function count() {", "function count(...all: any[]): number {"],
    ["function gather(first, ...rest) {", "function gather(first: any, ...rest: any[]): any[] {"],
    ["function withLength(a, length) {", "function withLength<T>(a: T[], length: number): T[] {"],
    ["function pushed(...all) { const a = [];", "function pushed<T>(...all: T[]): T[] { const a: T[] = [];"],
    ["function shifted(a) {", "function shifted<T>(a: T[]): T[] {"],
    ["function filledBytes(a) {", "function filledBytes<T extends Uint8Array>(a: T): T {"],
    ["function resizable(length, most) {", "function resizable(length: number, most: number): ArrayBuffer {"],
    ["function resized(a, length) { a.buffer.resize(length);", "function resized<T extends ArrayBufferView>(a: T, length: number): T { (a.buffer as ArrayBuffer).resize(length);"],
    ["function grown(a, length) { filledBytes(a); a.buffer.grow(length);", "function grown<T extends Uint8Array>(a: T, length: number): T { filledBytes(a); (a.buffer as SharedArrayBuffer).grow(length);"],
    ["function detached(a) { a.buffer.transfer();", "function detached<T extends ArrayBufferView>(a: T): T { (a.buffer as ArrayBuffer).transfer();"],
    ["function withoutKey(c, k) {", "function withoutKey<T extends { delete(k: any): boolean }>(c: T, k: any): T {"],
    ["function cleared(c) {", "function cleared<T extends { clear(): void }>(c: T): T {"],
    ["function started(it, steps = 1) {", "function started<T extends { next(): any }>(it: T, steps = 1): T {"],
    ["function counter(most, hasReturn) { let n = 0; const it = {", "function counter(most: number, hasReturn?: boolean) { let n = 0; const it: { next(): { done: boolean; value: number | undefined }; [Symbol.iterator](): any; return?(): {} } = {"],
    ["function asyncCounter(most, hasReturn) { let n = 0; const it = {", "function asyncCounter(most: number, hasReturn?: boolean) { let n = 0; const it: { next(): Promise<{ done: boolean; value: number | undefined }>; [Symbol.asyncIterator](): any; return?(): Promise<{}> } = {"],
    ["function showList(r, depth) {", "function showList(r: any, depth: number): string {"],
    ["function show(r, depth = 0) {", "function show(r: any, depth = 0): string {"],
    ['"length").get;', '"length")!.get!;'],
    ['"size").get;', '"size")!.get!;'],
  ] as const
).reduce((text, [untyped, typed]) => text.replace(untyped, typed), head).replaceAll(/^(?!$)/gm, "// @ts-ignore\n");

// How the value gets from its birth to its use. `@` is the number of the site, A and B are the two births, USE the body of the use. What stands between « and » is there in the TypeScript form only.
const given = `let last@ = ""; for (let n = 0; n < 20; n++) last@ = attempt@(A);
console.log("NAME, hot:", last@);
for (let n = 0; n < 3; n++) console.log("NAME, then:", attempt@(B));
console.log("NAME, again:", attempt@(A));
`;
const chosen = `let last@ = ""; for (let n = 0; n < 20; n++) last@ = attempt@(0);
console.log("NAME, hot:", last@);
for (let n = 0; n < 3; n++) console.log("NAME, then:", attempt@(1));
console.log("NAME, again:", attempt@(0));
`;
const attempt = (call: string, argument = "Both@") => `function attempt@(v«: ${argument}») { try { return show(${call}); } catch (e) { return "threw " + e.name; } }\n`;
const [givenAsync, chosenAsync] = [given, chosen].map(text => text.replaceAll("attempt@(", "await attempt@("));
const attemptAsync = (call: string, argument = "Both@") => `async function attempt@(v«: ${argument}») { try { return show(await ${call}); } catch (e) { return "threw " + e.name; } }\n`;
const givenTwo = `let last@ = ""; for (let n = 0; n < 20; n++) last@ = attempt@(A, A);
console.log("NAME, hot:", last@);
console.log("NAME, then:", attempt@(A, B));
console.log("NAME, then:", attempt@(B, A));
console.log("NAME, then:", attempt@(B, B));
console.log("NAME, again:", attempt@(A, A));
`;
const chosenTwo = `let last@ = ""; for (let n = 0; n < 20; n++) last@ = attempt@(0);
console.log("NAME, hot:", last@);
for (let n = 1; n < 4; n++) console.log("NAME, then:", attempt@(n));
console.log("NAME, again:", attempt@(0));
`;
const attemptTwo = (call: string) => `function attempt@(v«: Both@», w«: Both@») { try { return show(${call}); } catch (e) { return "threw " + e.name; } }\n`;
export const roads: Record<string, { text: string; onlyWalks?: boolean; needs?: string; isAsync?: boolean; isOfTwo?: boolean }> = {
  // The value is an argument of the function that uses it.
  handed: { text: "function use@(v«: Both@») { USE }\n" + attempt("use@(v)") + given },
  // The value is a member of an object that the caller of the use is given.
  member: { text: "class Holder@ { «held: Both@; »constructor(held«: Both@») { this.held = held; } }\nfunction use@(v«: Both@») { USE }\nfunction ask@(holder«: Holder@») { return use@(holder.held); }\n" + attempt("ask@(new Holder@(v))") + given },
  // The function that uses it reads it from what it is given.
  ownMember: { text: "class Holder@ { «held: Both@; »constructor(held«: Both@») { this.held = held; } }\nfunction use@(holder«: Holder@») { const v = holder.held; USE }\n" + attempt("use@(new Holder@(v))") + given },
  // The value is born on one of two paths of the function that holds it in a variable.
  held: { text: "function use@(v«: Both@») { USE }\nfunction ask@(which«: number») { let v«: Both@»; if (which === 0) v = A; else v = B; return use@(v); }\n" + attempt("ask@(v)", "number") + chosen },
  // The same, and the use is written in that function.
  heldAndUsed: { text: "function ask@(which«: number») { const v = which === 0 ? A : B; USE }\n" + attempt("ask@(v)", "number") + chosen },
  // One kind is born in the function that uses it, the other is given to it.
  bornOrGiven: { text: "function ask@(which«: number», given«: Both@») { const v = which === 0 ? A : given; USE }\n" + attempt("ask@(v, B)", "number") + chosen },
  givenOrBorn: { text: "function ask@(which«: number», given«: Both@») { const v = which === 0 ? given : B; USE }\n" + attempt("ask@(v, A)", "number") + chosen },
  // A variable holds nothing, then one kind, then the other, around a loop.
  heldAroundLoop: { text: "function use@(v«: Both@») { USE }\nfunction ask@(turns«: number») { let v«: Both@ | null» = null; const r«: string[]» = []; for (let i = 0; i < turns; i++) { if (v !== null) r.push(show(use@(v))); v = i % 3 === 0 ? A : i % 3 === 1 ? B : null; } return r; }\n" + attempt("ask@(v + 4)", "number") + chosen },
  // The value is what a function answers.
  answered: { text: "function make@(which«: number»)«: Both@» { return which === 0 ? A : B; }\nfunction use@(v«: Both@») { USE }\nfunction ask@(which«: number») { return use@(make@(which)); }\n" + attempt("ask@(v)", "number") + chosen },
  // The value is an element of a list that the caller of the use is given.
  element: { text: "function use@(v«: Both@») { USE }\nfunction ask@(list«: Both@[]») { return use@(list[0]); }\n" + attempt("ask@([v])") + given },
  // The value is in a variable of an enclosing function.
  enclosed: { text: "function keeper@() { let enclosedValue«: Both@»; return { keep(v«: Both@») { enclosedValue = v; }, ask() { const v = enclosedValue; USE } }; }\nconst theKeeper@ = keeper@();\n" + attempt("(theKeeper@.keep(v), theKeeper@.ask())") + given },
  // The value is what a Map of the caller holds.
  valueOfMap: { text: "function use@(v«: Both@») { USE }\nfunction ask@(table«: Map<string, Both@>») { return use@(table.get(\"k\")); }\n" + attempt('ask@(new Map([["k", v]]))') + given },
  // Both kinds are elements of one list, and one loop uses each.
  eachOfList: { text: "function use@(v«: Both@») { USE }\nfunction ask@(which«: number») { const r«: string[]» = []; for (const v of which === 0 ? [A, A] : [A, B, A]) r.push(show(use@(v))); return r; }\n" + attempt("ask@(v)", "number") + chosen },
  // One kind is what a parameter is when nothing is given.
  defaulted: { text: "function use@(v«: Both@» = A) { USE }\nfunction ask@(which«: number») { return which === 0 ? use@() : use@(B); }\n" + attempt("ask@(v)", "number") + chosen },
  // One kind stands in for nothing.
  orElse: { text: "function use@(given«?: Both@») { const v«: Both@» = given ?? A; USE }\nfunction ask@(which«: number») { return use@(which === 0 ? undefined : B); }\n" + attempt("ask@(v)", "number") + chosen },
  // A field starts as one kind and is stored into.
  field: { text: "class Holder@ { held«: Both@» = A; replace(v«: Both@») { this.held = v; return this; } }\nfunction use@(v«: Both@») { USE }\nfunction ask@(holder«: Holder@») { return use@(holder.held); }\n" + attempt("ask@(v === 0 ? new Holder@() : new Holder@().replace(B))", "number") + chosen },
  // A variable of the module holds one kind and then the other.
  variableOfModule: { text: "let current@«: Both@ | null» = null;\nfunction use@() { const v = current@; USE }\n" + attempt("(current@ = v, use@())") + given },
  // The value waits in a generator that has stopped.
  acrossYield: { text: "function* use@(v«: Both@») { yield 0; USE }\nfunction ask@(v«: Both@») { const steps = use@(v); steps.next(); return steps.next().value; }\n" + attempt("ask@(v)") + given },
  // The value waits in an async function that has stopped.
  acrossAwait: { isAsync: true, text: "async function use@(v«: Both@») { await null; USE }\n" + attemptAsync("use@(v)") + givenAsync },
  memberAcrossAwait: { isAsync: true, text: "class Holder@ { «held: Both@; »constructor(held«: Both@») { this.held = held; } }\nasync function use@(v«: Both@») { USE }\nasync function ask@(holder«: Holder@») { await null; return use@(holder.held); }\n" + attemptAsync("ask@(new Holder@(v))") + givenAsync },
  heldAcrossAwait: { isAsync: true, text: "async function ask@(which«: number») { const v = which === 0 ? A : B; await null; USE }\n" + attemptAsync("ask@(v)", "number") + chosenAsync },
  // Two values at one use, each of either kind.
  twoHanded: { isOfTwo: true, text: "function use@(v«: Both@», w«: Both@») { USE }\n" + attemptTwo("use@(v, w)") + givenTwo },
  twoMembers: { isOfTwo: true, text: "class Holder@ { «one: Both@; other: Both@; »constructor(one«: Both@», other«: Both@») { this.one = one; this.other = other; } }\nfunction use@(v«: Both@», w«: Both@») { USE }\nfunction ask@(holder«: Holder@») { return use@(holder.one, holder.other); }\n" + attemptTwo("ask@(new Holder@(v, w))") + givenTwo },
  twoHeld: { isOfTwo: true, text: "function ask@(which«: number») { let v«: Both@» = which & 1 ? B : A, w«: Both@» = which & 2 ? B : A; USE }\n" + attempt("ask@(v)", "number") + chosenTwo },
  // The value is what a callback of a built-in is given.
  callback: { text: "function ask@(list«: Both@[]») { return list.map(v => { USE })[0]; }\n" + attempt("ask@([v])") + given },
  // What is walked is what a method of a member answers.
  entriesOfMember: { onlyWalks: true, needs: "LTMSH", text: "class Holder@ { «held: Both@; »constructor(held«: Both@») { this.held = held; } }\nfunction use@(v«: Both@») { USE }\nfunction ask@(holder«: Holder@») { return use@(holder.held.entries()); }\n" + attempt("ask@(new Holder@(v))") + given },
  keysOfMember: { onlyWalks: true, needs: "LTMSH", text: "class Holder@ { «held: Both@; »constructor(held«: Both@») { this.held = held; } }\nfunction use@(v«: Both@») { USE }\nfunction ask@(holder«: Holder@») { return use@(holder.held.keys()); }\n" + attempt("ask@(new Holder@(v))") + given },
  valuesOfMember: { onlyWalks: true, needs: "LTMSH", text: "class Holder@ { «held: Both@; »constructor(held«: Both@») { this.held = held; } }\nfunction use@(v«: Both@») { USE }\nfunction ask@(holder«: Holder@») { return use@(holder.held.values()); }\n" + attempt("ask@(new Holder@(v))") + given },
  walkOfMember: { onlyWalks: true, needs: "LTMSHI", text: "class Holder@ { «held: Both@; »constructor(held«: Both@») { this.held = held; } }\nfunction use@(v«: Both@») { USE }\nfunction ask@(holder«: Holder@») { return use@(holder.held[Symbol.iterator]()); }\n" + attempt("ask@(new Holder@(v))") + given },
};

// The kinds that differ for the compiler or for a fast path of the run time. A sweep by hand may choose among all of them.
const usualFirst = ["integers", "fractions", "records", "holes", "given", "bytes", "doubles", "tracking", "view", "map", "set", "weakMap", "valuesOfList", "entriesOfMap", "generator", "params", "asyncGenerator", "stream"];
const usualSecond = [
  "integers", "fractions", "texts", "mixed", "emptyList", "holes", "holesOfFractions", "onlyHoles", "sparse", "stretched", "frozen", "getterAtOne", "child", "ownWalk", "inherits", "noParent", "pushed",
  "like", "given", "givenStrict", "bytes", "words", "doubles", "bigWords", "buffer", "tracking", "trackingShrunk", "outOfBounds", "detached", "shared", "growing",
  "view", "trackingView", "viewOutOfBounds", "detachedView", "memory", "resizableMemory", "sharedMemory", "map", "emptyMap", "mapWithGaps", "childOfMap", "set", "emptySet", "weakMap", "weakSet",
  "valuesOfList", "entriesOfList", "valuesOfBytes", "entriesOfMap", "valuesOfSet", "letters", "generator", "generatorThatCleansUp", "helperMapped", "byHandWithReturn", "walkable",
  "params", "headers", "formData", "entriesOfParams", "text", "nothing", "missing", "record", "proxyOfList", "integer",
  "asyncGenerator", "asyncGeneratorThatCleansUp", "asyncByHandWithReturn", "stream", "promises",
];

type Choice = { sitesOfAProgram?: number; sumsOfASite?: number; first?: string[]; second?: string[]; roads?: string[]; uses?: string[]; oneIn?: number; which?: number; alone?: string[] };

function usesThatFit(r: string, a: string, b: string, among: string[]) {
  const road = roads[r];
  if (a === b || (road.needs && (!road.needs.includes(kinds[a][0]) || !(road.needs + "X").includes(kinds[b][0])))) return [];
  // Behind entries() and the like the value is an iterator whatever the collection is.
  const letter = road.onlyWalks ? "I" : kinds[a][0];
  return among.filter(u => uses[u][0].includes(letter) && (road.isAsync || !uses[u][0].startsWith("*")) && !!road.isOfTwo === uses[u][0].startsWith("+"));
}

// How hot a function is held to be is its place among the program's own code: the hottest fifth is hot. A site that shares its program with others is among the hottest, as it is when it is alone, only beside
// enough code that runs once. Without it a fault that shows at every one of 24 sites alone shows at none of them.
function textOf(r: string, a: string, b: string, sites: string[], sumsOfASite: number, isTyped?: boolean) {
  let text = isTyped ? typedHead : head;
  const sums = "  x = (x * 3 + 1) | 0;\n".repeat(sumsOfASite);
  if (sums) for (let n = 1; n <= sites.length; n++) text += `function runsOnce${n}(x${isTyped ? ": number" : ""}) {\n${sums}  return x;\n}\nrunsOnce${n}(process.argv.length);\n`;
  sites.forEach((u, index) => {
    // What is declared is that the value is of one of its two kinds. Most uses make sense for one of them only: TypeScript's complaint about that is silenced, line by line.
    const road = isTyped ? ("const first@ = A;\nconst second@ = B;\ntype Both@ = typeof first@ | typeof second@;\n" + roads[r].text).replaceAll(/[«»]/g, "") : roads[r].text.replaceAll(/«[^»]*»/g, "");
    const site = road.replaceAll("NAME", u).replaceAll(/\bA\b/g, () => kinds[a][1]).replaceAll(/\bB\b/g, () => kinds[b][1]).replaceAll("@", () => String(index + 1)).replaceAll("USE", () => uses[u][1]);
    text += isTyped ? site.replaceAll(/^(?!$)/gm, "// @ts-ignore\n") : site;
  });
  return text + (isTyped ? "export {};\n" : "");
}

const title = (isTyped?: boolean) => (isTyped ? "typed " : "") + "two kinds of list or collection at one use";

/** How few of the programs every run of the tests takes: a program of two hundred sites takes as long to build as ten small ones. */
export const oneIn = 160;

/**
 * One program for each road and pair of kinds. A site that once showed a fault is a program of its own besides, and a site that is known to differ today is a program of its own only, so that
 * the others of its road and pair are still judged. The text of a program is made when it is asked for: all of them together are some gigabytes.
 */
export function programs(isTyped?: boolean, choice: Choice = {}): Program[] {
  const { sitesOfAProgram = 1000, sumsOfASite = sitesOfAProgram === 1 ? 0 : 200, oneIn = 1, which = 0 } = choice;
  const differs = Object.keys(choice.alone ? {} : ((known as Record<string, Record<string, string>>)[title(isTyped)] ?? {}));
  const alone = new Set([...differs, ...(choice.alone ?? (onceWrong as Record<string, string[]>)[title(isTyped)] ?? [])]);
  const made: Program[] = [];
  // The arguments of a function that is not strict are tied to its parameters, and such a function cannot stand in a module. An await outside every function can stand nowhere else.
  const fileOf = (a: string, b: string, r: string) => (isTyped ? "program.ts" : !roads[r].isAsync && (/^given(?!Strict)/.test(a) || /^given(?!Strict)/.test(b)) ? "program.cjs" : "program.mjs");
  for (const r of choice.roads ?? Object.keys(roads)) for (const a of choice.first ?? usualFirst) for (const b of choice.second ?? usualSecond) {
    const fitting = usesThatFit(r, a, b, choice.uses ?? Object.keys(uses)).filter(u => !differs.includes(`${r}-${a}-${b}-${u}`));
    for (let from = 0, part = 1; from < fitting.length; from += sitesOfAProgram, part++) {
      const name = `${r}-${a}-${b}` + (sitesOfAProgram === 1 ? "-" + fitting[from] : fitting.length > sitesOfAProgram ? "-" + part : "");
      if (oneIn !== 1 && Number(BigInt(Bun.hash(name)) % BigInt(oneIn)) !== which) continue;
      const sites = fitting.slice(from, from + sitesOfAProgram);
      made.push({ name, file: fileOf(a, b, r), get text() { return textOf(r, a, b, sites, sumsOfASite, isTyped); } });
    }
  }
  for (const name of alone) {
    const [r, a, b, u] = name.split("-");
    // Without a use it names the program of a road and a pair, which is made above: what showed there did not show in the site alone.
    if (u === undefined) continue;
    made.push({ name, file: fileOf(a, b, r), get text() { return textOf(r, a, b, [u], 0, isTyped); } });
  }
  return made;
}
