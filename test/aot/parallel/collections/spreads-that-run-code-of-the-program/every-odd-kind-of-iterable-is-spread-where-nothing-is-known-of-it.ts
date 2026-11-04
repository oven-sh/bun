// What the run time lists in no single piece, read out of an object under the global object.
function* upTo(limit: number): Generator<number> { for (let i = 0; i < limit; i++) yield i; }
class Own { [Symbol.iterator]() { let i = 0; return { next: () => (i < 3 ? { done: false, value: i++ } : { done: true, value: undefined }) }; } }
class OwnGen { *[Symbol.iterator]() { yield "a"; yield "b"; } }
class Pairs extends Map<string, number> { *[Symbol.iterator](): any { yield ["mine", 1]; } }
class Plain extends Map<string, number> {}
class Members extends Set<number> {}
class List extends Array<number> {}
class Reversed extends Array<number> { *[Symbol.iterator](): any { for (let i = this.length; i-- > 0;) yield this[i]; } }
function args(..._: unknown[]) { return arguments; }
const changedArguments = args(1, 2); (changedArguments as any)[Symbol.iterator] = function* () { yield "changed"; };
const bytes = new Uint8Array([1, 2]); (bytes as any)[Symbol.iterator] = function* () { yield "bytes"; };
const begun = upTo(4); begun.next();
const kinds: Record<string, unknown> = {
  generator: upTo(3), begun, own: new Own(), ownGen: new OwnGen(), record: { *[Symbol.iterator]() { yield 1; } },
  proxyOfList: new Proxy([1, 2], {}), proxyOfOwn: new Proxy(new Own(), {}),
  pairs: new Pairs([["theirs", 2]]), plain: new Plain([["k", 1]]), members: new Members([1, 2]), list: List.from([1, 2]), reversed: Reversed.from([1, 2, 3]),
  changedArguments, bytes, text: new String("ab"), helper: upTo(5).filter(value => value % 2 === 1), mapped: [1, 2].values().map(value => value * 2),
  headers: new Headers({ a: "1", b: "2" }), query: new URLSearchParams("x=1&y=2"), matches: "a1b2".matchAll(/\d/g), entries: Object.entries({ a: 1 })[Symbol.iterator](),
  inherited: Object.create(new Own()), below: Object.create(upTo(2)), wrapped: Iterator.from({ next() { return { done: true, value: 0 }; } }), segments: new Intl.Segmenter("en").segment("ab"),
  number: Object(5), symbol: Object(Symbol.iterator), func: function () {}, date: new Date(0), regexp: /x/, promise: Promise.resolve(1), weak: new WeakMap(),
};
(globalThis as any).held = kinds;
const count = (...values: unknown[]) => values.length;
for (const name of Object.keys(kinds)) {
  try { console.log(name, JSON.stringify([...(globalThis as any).held[name]])); } catch (error) { console.log(name, String(error)); }
}
(globalThis as any).held = { generator: upTo(3), own: new Own(), ownGen: new OwnGen() };
console.log(count(...(globalThis as any).held.generator), count(...(globalThis as any).held.own), Math.max(...(globalThis as any).held.own), new Array(...(globalThis as any).held.ownGen).join());
