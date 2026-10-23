// "Parameter i is stored into a field of parameter j": from then on j keeps i alive, i is reachable from whoever holds j, and both may be the same object. The holder may outlive the call, be returned, be kept by an earlier call, or be a container: array, map, set, closure, another object's field several reads deep.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
interface Item {
  tag: string;
  next?: Item | null;
}
interface Holder {
  tag: string;
  item: Item | null;
  items: Item[];
  deep: { deeper: { item: Item | null } };
}
const holder = (tag: string): Holder => ({ tag, item: null, items: [], deep: { deeper: { item: null } } });
function put(h: Holder, i: Item): void {
  h.item = i;
}
function append(h: Holder, i: Item): void {
  h.items.push(i);
}
function putDeep(h: Holder, i: Item): void {
  h.deep.deeper.item = i;
}
function putByKey(h: Holder, key: "item", i: Item): void {
  h[key] = i;
}
function putAt(list: Item[], at: number, i: Item): void {
  list[at] = i;
}
function putInMap(map: Map<string, Item>, i: Item): void {
  map.set(i.tag, i);
}
function chain(a: Item, b: Item): Item {
  a.next = b;
  return a;
}
function putThrough(h: Holder, i: Item): void {
  put(h, i);
}
function putOnOnePath(h: Holder, i: Item, really: boolean): void {
  if (really) h.item = i;
}
function putBoth(h: Holder, a: Item, b: Item, first: boolean): void {
  h.item = first ? a : b;
}
function exchange(a: Holder, b: Holder): void {
  const old = a.item;
  a.item = b.item;
  b.item = old;
}
// The holder is long-lived, the item is made for the call.
const longLived = holder("long-lived");
const longList: Item[] = [];
const longMap = new Map<string, Item>();
const history: string[] = [];
for (let i = 0; i < 300; i++) {
  put(longLived, { tag: "put" + i });
  append(longLived, { tag: "appended" + i });
  putDeep(longLived, { tag: "deep" + i });
  putAt(longList, i % 3, { tag: "at" + i });
  putInMap(longMap, { tag: "map" + (i % 2) + "/" + (i >= 298 ? i : 0) });
  if (i % 100 === 99) {
    churn(30);
    history.push(longLived.item!.tag + " " + longLived.items[i].tag + " " + longLived.deep.deeper.item!.tag);
  }
}
console.log(churn(60), history.join(" | "));
console.log(longLived.items.length, longLived.items[150].tag, longList.map(i => i.tag).join(), [...longMap.keys()].join());

// Both are made by the caller; the holder is returned or kept, the item only went through the helper.
const keptHolders: Holder[] = [];
function makeFilled(i: number): Holder {
  const h = holder("made" + i);
  put(h, { tag: "item of made" + i });
  putThrough(h, { tag: "second item of made" + i });
  append(h, { tag: "listed in made" + i });
  putDeep(h, { tag: "deep in made" + i });
  return h;
}
for (let i = 0; i < 300; i++) {
  const h = makeFilled(i);
  if (i % 100 === 50) keptHolders.push(h);
}
console.log(churn(60), keptHolders.map(h => [h.item!.tag, h.items[0].tag, h.deep.deeper.item!.tag].join("+")).join(" | "));

// The holder was kept by an earlier call; this call only stores into it.
const registry: Holder[] = [];
function register(h: Holder): void {
  registry.push(h);
}
function laterFilled(i: number): void {
  const h = holder("registered" + i);
  if (i % 100 === 25) register(h);
  putByKey(h, "item", { tag: "stored after registering " + i });
}
for (let i = 0; i < 300; i++) laterFilled(i);
console.log(churn(60), registry.map(h => h.item!.tag).join(" | "));

// Aliases.
let line = "";
for (let i = 0; i < 200; i++) {
  const a: Item = { tag: "a" + i };
  const b: Item = { tag: "b" + i };
  const self = chain(a, a);
  const h = holder("h" + i);
  const g = holder("g" + i);
  putOnOnePath(h, a, i % 2 === 0);
  putBoth(g, a, b, i % 3 === 0);
  const before = (h.item ? h.item.tag : "null") + "/" + g.item!.tag;
  exchange(h, g);
  exchange(h, h);
  line = [self === a, a.next === a, a.next!.next!.next === a, chain(a, b).next === b, before, (h.item ? h.item.tag : "null") + "/" + (g.item ? g.item.tag : "null")].join();
}
console.log(line);

// A long chain built by a helper, one link a call: every link must live as long as the head.
let head: Item = { tag: "head" };
let tail = head;
for (let i = 0; i < 2000; i++) {
  const link: Item = { tag: "link" + i };
  chain(tail, link);
  tail = link;
}
churn(60);
let links = 0;
let lastTag = "";
for (let at: Item | null | undefined = head; at; at = at.next) {
  links++;
  lastTag = at.tag;
}
console.log(links, lastTag);

// The store goes into a closure's variable, and the closure is the parameter.
function feed(sink: (i: Item) => void, i: Item): void {
  sink(i);
}
function makeSink(): { sink: (i: Item) => void; last: () => Item | null } {
  let last: Item | null = null;
  return { sink: i => void (last = i), last: () => last };
}
const sinks = [makeSink(), makeSink()];
for (let i = 0; i < 300; i++) feed(sinks[i & 1].sink, { tag: "fed" + i });
console.log(churn(60), sinks.map(s => s.last()!.tag).join());
