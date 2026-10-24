// In strict code `arguments` is a copy and a rest parameter is a fresh array, and both hold references to what was passed: whoever keeps or returns the list keeps every argument.
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
const other: Thing = { n: -1, tag: "the other" };
const keptLists: ArrayLike<Thing>[] = [];
const keptThings: Thing[] = [];
function keepsArguments(a: Thing, b: Thing): number {
  if (a.n % 100 === 99) keepsList(arguments);
  return a.n + b.n;
}
function keepsList(list: ArrayLike<Thing>): void {
  keptLists.push(list);
}
function storesThroughArguments(a: Thing): Thing {
  arguments[0] = other;
  return a;
}
function storesIntoParameter(a: Thing): Thing {
  a = other;
  return arguments[0];
}
function readsRest(...all: Thing[]): number {
  let sum = 0;
  for (const thing of all) sum += thing.n;
  return sum;
}
function keepsRest(...all: Thing[]): number {
  if (all[0].n % 100 === 98) keptLists.push(all);
  return all.length;
}
function returnsRest(first: Thing, ...others: Thing[]): Thing[] {
  return others;
}
function keepsOneOfRest(...all: Thing[]): void {
  if (all[1].n % 100 === 97) keptThings.push(all[1]);
}
function spreadsRestOn(...all: Thing[]): number {
  return keepsRest(...all) + readsRest(...all);
}
function restOfRest(...all: Thing[]): Thing[] {
  const [, ...tail] = all;
  return tail;
}
function writesRest(...all: Thing[]): Thing {
  all[0] = other;
  return all[0];
}
function sortsRest(...all: Thing[]): Thing {
  return all.sort((p, q) => q.n - p.n)[0];
}
function lastOf(...all: Thing[]): Thing | undefined {
  return all.pop();
}
const rare = (t: Thing) => t.n % 100 === 96;
function keepsByForOf(...all: Thing[]): void {
  for (const t of all) if (rare(t)) keptThings.push(t);
}
function keepsByPattern(...all: Thing[]): void {
  const [, second] = all;
  if (rare(second)) keptThings.push(second);
}
function keepsByForEach(...all: Thing[]): void {
  all.forEach(t => void (rare(t) && keptThings.push(t)));
}
function keepsBySpreadingIntoPush(...all: Thing[]): void {
  if (rare(all[0])) keptThings.push(...all);
}
function keepsACopy(...all: Thing[]): void {
  if (rare(all[0])) keptLists.push([...all], all.slice(), Array.from(all), all.map(t => t), all.concat());
}
function keepsByIterator(...all: Thing[]): void {
  const first = all[Symbol.iterator]().next().value;
  if (first && rare(first)) keptThings.push(first);
}
function keepsByIndexInALoop(...all: Thing[]): void {
  for (let i = 0; i < all.length; i++) if (rare(all[i])) keptThings.push(all[i]);
}
function keepsOutOfArguments(a: Thing, b: Thing): void {
  for (const t of arguments) if (rare(t)) keptThings.push(t);
}
let sum = 0;
const lines: string[] = [];
for (let i = 0; i < 300; i++) {
  const mine: Thing = { n: i, tag: "mine" + i };
  sum += keepsArguments({ n: i, tag: "first" + i }, { n: 1, tag: "second" + i });
  sum += readsRest({ n: i, tag: "" }, { n: 1, tag: "" }, { n: 2, tag: "" }) + readsRest();
  sum += keepsRest({ n: i, tag: "rest" + i }, { n: 0, tag: "and" + i });
  sum += spreadsRestOn({ n: i, tag: "spread" + i });
  keepsOneOfRest({ n: 0, tag: "not kept" }, { n: i, tag: "one of rest " + i });
  keepsByForOf({ n: 0, tag: "no" }, { n: i, tag: "for-of " + i });
  keepsByPattern({ n: 0, tag: "no" }, { n: i, tag: "pattern " + i });
  keepsByForEach({ n: 0, tag: "no" }, { n: i, tag: "forEach " + i });
  keepsBySpreadingIntoPush({ n: i, tag: "spread into push " + i }, { n: 0, tag: "and its neighbor " + i });
  keepsACopy({ n: i, tag: "copied " + i });
  keepsByIterator({ n: i, tag: "iterator " + i });
  keepsByIndexInALoop({ n: 0, tag: "no" }, { n: i, tag: "by index " + i });
  keepsOutOfArguments({ n: 0, tag: "no" }, { n: i, tag: "out of arguments " + i });
  const rest = returnsRest(mine, mine, { n: 5, tag: "five" + i });
  const again = returnsRest(mine, mine);
  const line = [
    storesThroughArguments(mine) === mine,
    storesIntoParameter(mine) === mine,
    rest[0] === mine,
    rest.length,
    rest !== again,
    restOfRest(other, mine)[0] === mine,
    writesRest(mine) === other,
    sortsRest(other, mine, other) === mine,
    lastOf(other, mine) === mine,
    lastOf(),
  ].join();
  if (i >= 298) lines.push(line + " " + rest[1].tag);
}
console.log(sum, churn(60));
console.log(lines.join("\n"));
console.log(keptLists.map(list => list.length + ":" + Array.from(list, t => t.tag).join("+")).join(" | "));
console.log(keptThings.map(t => t.tag).join());
