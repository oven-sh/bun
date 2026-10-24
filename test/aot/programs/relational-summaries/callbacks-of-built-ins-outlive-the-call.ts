// A built-in that calls a callback is over when it returns; the callback need not be. An async callback and a generator callback are only begun by forEach and map; what they captured and what they were handed is used later. And what a built-in answers may be its operand, the callback's answer, or what was there before.
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
}
const seen: Item[] = [];
function asyncCallback(round: number): void {
  const captured: Item = { tag: "captured by an async callback " + round };
  const list: Item[] = [{ tag: "element of forEach " + round }];
  list.forEach(async x => {
    await 0;
    if (round % 100 === 99) seen.push(x, captured);
  });
}
const begun: Generator<Item>[] = [];
function generatorCallback(round: number): void {
  const captured: Item = { tag: "captured by a generator callback " + round };
  const list: Item[] = [{ tag: "element of map " + round }];
  const all = list.map(function* (x) {
    yield x;
    yield captured;
  });
  if (round % 100 === 99) begun.push(...all);
}
function reduceWithAnObject(round: number): Item {
  const start: Item = { tag: "the start of reduce " + round };
  const list: Item[] = round % 2 ? [] : [{ tag: "element of reduce " + round }];
  return list.reduce((sum, x) => (round % 4 ? x : sum), start);
}
function findsOneOrNone(round: number): Item | undefined {
  const list: Item[] = [{ tag: "found " + round }, { tag: "not looked at " + round }];
  return list.find(x => round % 3 !== 0 && x.tag.startsWith("found"));
}
const cache = new Map<number, Item>();
type Computing = { getOrInsertComputed(key: number, make: (key: number) => Item): Item };
function computedOnce(round: number): Item {
  const made: Item = { tag: "made in round " + round };
  const map = cache as unknown as Computing;
  if (typeof map.getOrInsertComputed !== "function") {
    if (!cache.has(round % 5)) cache.set(round % 5, made);
    return cache.get(round % 5)!;
  }
  return map.getOrInsertComputed(round % 5, () => made);
}
const keptByPush: Item[] = [];
const keptBySet = new Map<number, Item>();
const keptByAdd = new Set<Item>();
const push = Array.prototype.push;
const set = Map.prototype.set;
const add = Set.prototype.add;
function methodsTakenOffTheirHolders(round: number): void {
  if (round % 100 !== 99) return;
  push.call(keptByPush, { tag: "pushed " + round });
  set.call(keptBySet, round, { tag: "set " + round });
  Reflect.apply(add, keptByAdd, [{ tag: "added " + round }]);
}
const errors: Error[] = [];
function causes(round: number): void {
  const cause: Item = { tag: "the cause " + round };
  const inner = new Error("inner " + round);
  const error = new Error("outer", { cause });
  const many = new AggregateError([inner, cause], "many", { cause: inner });
  if (round % 100 === 99) errors.push(error, many);
}
class Special extends Array<Item> {
  static made: Special[] = [];
  static get [Symbol.species](): ArrayConstructor {
    return class extends Array<Item> {
      constructor(length: number) {
        super(length);
        if (Special.made.length < 3) Special.made.push(this as unknown as Special);
      }
    } as unknown as ArrayConstructor;
  }
}
function speciesKeepsTheResult(round: number): number {
  const list = new Special();
  list.push({ tag: "in a special list " + round });
  return list.map(x => x).length + list.filter(() => true).length;
}
function sortKeepsItsOperands(round: number): Item[] {
  const compared: Item[] = [];
  const list: Item[] = [{ tag: "b" + round }, { tag: "a" + round }, { tag: "c" + round }];
  list.sort((l, r) => {
    if (compared.length < 2) compared.push(l, r);
    return l.tag < r.tag ? -1 : 1;
  });
  return compared;
}
let last = "";
let lengths = 0;
const reduced: Item[] = [];
const found: (Item | undefined)[] = [];
const comparedLater: Item[][] = [];
for (let round = 0; round < 300; round++) {
  asyncCallback(round);
  generatorCallback(round);
  const sum = reduceWithAnObject(round);
  const one = findsOneOrNone(round);
  const once = computedOnce(round);
  methodsTakenOffTheirHolders(round);
  causes(round);
  lengths += speciesKeepsTheResult(round);
  const compared = sortKeepsItsOperands(round);
  if (round % 100 > 95) {
    reduced.push(sum);
    found.push(one);
    comparedLater.push(compared);
  }
  last = [sum.tag, one ? one.tag : "none", once.tag].join(" | ");
}
console.log(last, lengths, churn(60));
await new Promise(resolve => setTimeout(resolve, 1));
console.log(churn(60), seen.map(x => x.tag).join(" | "));
console.log(begun.map(g => [...g].map(x => x.tag).join(" + ")).join(" | "));
console.log(reduced.map(x => x.tag).join(" | "));
console.log(found.map(x => (x ? x.tag : "none")).join(" | "));
console.log([...cache.values()].map(x => x.tag).join(" | "));
console.log(keptByPush.map(x => x.tag).join(), [...keptBySet.values()].map(x => x.tag).join(), [...keptByAdd].map(x => x.tag).join());
console.log(errors.map(e => (e.cause as Item).tag ?? (e.cause as Error).message).join(" | "), (errors[1] as AggregateError).errors.map(x => x.tag ?? x.message).join());
console.log(Special.made.map(l => l.map(x => x.tag).join()).join(" | "));
console.log(comparedLater.map(c => c.map(x => x.tag).join()).join(" | "));

// A body that is an async generator runs when the response is read, and a server's handler is handed the very request.
const bodies: Response[] = [];
for (let round = 0; round < 40; round++) {
  const captured: Item = { tag: "captured by a body " + round };
  const body = async function* () {
    yield captured.tag;
    await 0;
    yield " and again " + captured.tag.length;
  };
  const response = new Response(body as unknown as BodyInit);
  if (round % 20 === 19) bodies.push(response);
}
churn(60);
for (const response of bodies) console.log(await response.text());
const requests: Request[] = [];
const server = Bun.serve({
  port: 0,
  fetch(request) {
    requests.push(request);
    return new Response("answer to " + new URL(request.url).pathname);
  },
});
const asked: Request[] = [];
for (let round = 0; round < 3; round++) {
  const request = new Request(server.url + "round/" + round);
  asked.push(request);
  console.log(await (await server.fetch(request)).text());
}
churn(60);
console.log(requests.map((r, i) => new URL(r.url).pathname + " " + (r === asked[i])).join(" | "));
await server.stop(true);
