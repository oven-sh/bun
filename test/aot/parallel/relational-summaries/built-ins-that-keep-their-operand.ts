// A helper hands its parameter to a built-in and to nothing else. These built-ins keep the reference: in an array, a map, a set, a bound function, a promise, a weak reference, a registry, a property, an iterator, an error.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Thing {
  n: number;
  tag: string;
}
const show = (things: Iterable<Thing | undefined>) => Array.from(things, t => (t ? t.tag : "nothing")).join();
const rounds = 150;
const rare = (t: Thing) => t.n % 70 === 69;

const pushed: Thing[] = [];
const viaPush = (t: Thing) => void (rare(t) && pushed.push(t));
const unshifted: Thing[] = [];
const viaUnshift = (t: Thing) => void (rare(t) && unshifted.unshift(t));
const spliced: Thing[] = [];
const viaSplice = (t: Thing) => void (rare(t) && spliced.splice(0, 0, t));
const filled: (Thing | undefined)[] = [undefined, undefined];
const viaFill = (t: Thing) => void (rare(t) && filled.fill(t, 1));
let concatenated: Thing[] = [];
const viaConcat = (t: Thing) => void (rare(t) && (concatenated = concatenated.concat(t)));
let ofList: Thing[] = [];
const viaArrayOf = (t: Thing) => void (rare(t) && (ofList = Array.of(t, t)));
let fromList: Thing[] = [];
const viaArrayFrom = (t: Thing) => void (rare(t) && (fromList = Array.from({ length: 2 }, () => t)));
let withList: Thing[] = [{ n: 0, tag: "old" }];
const viaWith = (t: Thing) => void (rare(t) && (withList = withList.with(0, t)));
const map = new Map<number, Thing>();
const viaMapSet = (t: Thing) => void (rare(t) && map.set(t.n, t));
const keyed = new Map<Thing, number>();
const viaMapKey = (t: Thing) => void (rare(t) && keyed.set(t, t.n));
const set = new Set<Thing>();
const viaSetAdd = (t: Thing) => void (rare(t) && set.add(t));
const anchors: object[] = [];
const weakMap = new WeakMap<object, Thing>();
const viaWeakMapValue = (t: Thing) => {
  if (!rare(t)) return;
  const anchor = {};
  anchors.push(anchor);
  weakMap.set(anchor, t);
};
const bound: (() => string)[] = [];
function tagOfThis(this: Thing): string {
  return this.tag;
}
function tagOf(t: Thing): string {
  return t.tag;
}
const viaBindThis = (t: Thing) => void (rare(t) && bound.push(tagOfThis.bind(t)));
const viaBindArgument = (t: Thing) => void (rare(t) && bound.push(tagOf.bind(null, t)));
const promises: Promise<Thing>[] = [];
const viaPromiseResolve = (t: Thing) => void (rare(t) && promises.push(Promise.resolve(t)));
const viaThen = (t: Thing) => void (rare(t) && promises.push(Promise.resolve(0).then(() => t)));
const viaWithResolvers = (t: Thing) => {
  if (!rare(t)) return;
  const { promise, resolve } = Promise.withResolvers<Thing>();
  promises.push(promise);
  resolve(t);
};
const target: Record<string, Thing> = {};
const viaDefineProperty = (t: Thing) => void (rare(t) && Object.defineProperty(target, "defined" + t.n, { value: t, enumerable: true }));
const viaAssign = (t: Thing) => void (rare(t) && Object.assign(target, { ["assigned" + t.n]: t }));
const viaReflectSet = (t: Thing) => void (rare(t) && Reflect.set(target, "reflected" + t.n, t));
let fromEntries: Record<string, Thing> = {};
const viaFromEntries = (t: Thing) => void (rare(t) && (fromEntries = Object.fromEntries([["entry", t]])));
let created: { inherited?: Thing } = {};
const viaCreate = (t: Thing) => void (rare(t) && (created = Object.create({ inherited: t })));
const heirs: object[] = [];
const viaSetPrototypeOf = (t: Thing) => void (rare(t) && heirs.push(Object.setPrototypeOf({}, t)));
const iterators: Iterator<Thing>[] = [];
const viaIterator = (t: Thing) => void (rare(t) && iterators.push([t][Symbol.iterator]()));
const errors: Error[] = [];
const viaCause = (t: Thing) => void (rare(t) && errors.push(new Error("e", { cause: t })));
const aggregated: AggregateError[] = [];
const viaAggregate = (t: Thing) => void (rare(t) && aggregated.push(new AggregateError([t], "many")));
const proxies: Thing[] = [];
const viaProxy = (t: Thing) => void (rare(t) && proxies.push(new Proxy(t, {})));
const frozen: Readonly<Thing>[] = [];
const viaFreeze = (t: Thing) => void (rare(t) && frozen.push(Object.freeze(t)));
const boxed: Thing[] = [];
const viaObject = (t: Thing) => void (rare(t) && boxed.push(Object(t)));
const timed: Thing[] = [];
const viaTimerArgument = (t: Thing) => void (rare(t) && setTimeout((x: Thing) => timed.push(x), 0, t));
const ticked: Thing[] = [];
const viaNextTick = (t: Thing) => void (rare(t) && process.nextTick((x: Thing) => ticked.push(x), t));
const grouped: Partial<Record<string, Thing[]>>[] = [];
const viaGroupBy = (t: Thing) => void (rare(t) && grouped.push(Object.groupBy([t], x => x.tag)));
const flattened: Thing[][] = [];
const viaFlat = (t: Thing) => void (rare(t) && flattened.push([[t], [[t]]].flat(2) as Thing[]));
const entries: [string, Thing][][] = [];
const viaEntries = (t: Thing) => void (rare(t) && entries.push(Object.entries({ held: t })));
const spreadInto: { held?: Thing }[] = [];
const viaSpread = (t: Thing) => void (rare(t) && spreadInto.push({ ...{ held: t } }));

for (let i = 0; i < rounds; i++) {
  viaPush({ n: i, tag: "push" + i });
  viaUnshift({ n: i, tag: "unshift" + i });
  viaSplice({ n: i, tag: "splice" + i });
  viaFill({ n: i, tag: "fill" + i });
  viaConcat({ n: i, tag: "concat" + i });
  viaArrayOf({ n: i, tag: "of" + i });
  viaArrayFrom({ n: i, tag: "from" + i });
  viaWith({ n: i, tag: "with" + i });
  viaMapSet({ n: i, tag: "map" + i });
  viaMapKey({ n: i, tag: "key" + i });
  viaSetAdd({ n: i, tag: "set" + i });
  viaWeakMapValue({ n: i, tag: "weak value" + i });
  viaBindThis({ n: i, tag: "bound this" + i });
  viaBindArgument({ n: i, tag: "bound argument" + i });
  viaPromiseResolve({ n: i, tag: "resolve" + i });
  viaThen({ n: i, tag: "then" + i });
  viaWithResolvers({ n: i, tag: "resolvers" + i });
  viaDefineProperty({ n: i, tag: "defined" + i });
  viaAssign({ n: i, tag: "assigned" + i });
  viaReflectSet({ n: i, tag: "reflected" + i });
  viaFromEntries({ n: i, tag: "entries" + i });
  viaCreate({ n: i, tag: "create" + i });
  viaSetPrototypeOf({ n: i, tag: "prototype" + i });
  viaIterator({ n: i, tag: "iterator" + i });
  viaCause({ n: i, tag: "cause" + i });
  viaAggregate({ n: i, tag: "aggregate" + i });
  viaProxy({ n: i, tag: "proxy" + i });
  viaFreeze({ n: i, tag: "frozen" + i });
  viaObject({ n: i, tag: "object" + i });
  viaTimerArgument({ n: i, tag: "timer" + i });
  viaNextTick({ n: i, tag: "tick" + i });
  viaGroupBy({ n: i, tag: "group" + i });
  viaFlat({ n: i, tag: "flat" + i });
  viaEntries({ n: i, tag: "entry" + i });
  viaSpread({ n: i, tag: "spread" + i });
}
console.log(churn(80));
console.log(show(pushed), show(unshifted), show(spliced), show(filled), show(concatenated), show(ofList), show(fromList), show(withList));
console.log(show(map.values()), show(keyed.keys()), show(set), show(anchors.map(a => weakMap.get(a))));
console.log(bound.map(f => f()).join());
console.log(Object.keys(target).join(), show(Object.values(target)), fromEntries.entry.tag, created.inherited!.tag, heirs.map(h => (h as Thing).tag).join());
console.log(show(iterators.map(it => it.next().value)), show(errors.map(e => e.cause as Thing)), show(aggregated.map(e => e.errors[0])));
console.log(show(proxies), show(frozen), Object.isFrozen(frozen[0]), show(boxed));
console.log(grouped.map(g => Object.keys(g).join()).join(), show(flattened.flat()), show(entries.map(e => e[0][1])), show(spreadInto.map(s => s.held)));
console.log(show(await Promise.all(promises)));
await new Promise(resolve => setTimeout(resolve, 5));
console.log(churn(20), show(timed), show(ticked));
