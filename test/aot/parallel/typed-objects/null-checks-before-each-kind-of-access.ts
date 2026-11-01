// A read, store, update, comparison or test of a field of `o!` throws a TypeError that names the same property, value and position as in plain Bun when `o` is null or undefined, whatever instruction the access becomes.
// STATISTIC: NullChecksFoldedIntoAccesses >= 20
class Item {
  next: Item | null = null;
  count = 0;
  ratio = 0.5;
  isOpen = false;
  label = "none";
  constructor(count: number, next: Item | null) {
    this.count = count;
    this.ratio = count + 0.25;
    this.isOpen = count % 2 === 1;
    this.label = "item " + count;
    this.next = next;
  }
}
type Maybe = Item | null | undefined;

function readReference(o: Maybe) { return o!.next === null ? "end" : "more"; }
function readCount(o: Maybe) { return o!.count; }
function readRatio(o: Maybe) { return o!.ratio; }
function readLabel(o: Maybe) { return o!.label; }
function addCount(o: Maybe, n: number) { return (n + o!.count) | 0; }
function subtractCount(o: Maybe, n: number) { return (n - o!.count) | 0; }
function addRatio(o: Maybe, n: number) { return n + o!.ratio; }
function multiplyRatio(o: Maybe, n: number) { return n * o!.ratio; }
function subtractRatio(o: Maybe, n: number) { return n - o!.ratio; }
function compareCount(o: Maybe) { return o!.count === 7 ? "seven" : "other"; }
function compareCounts(o: Maybe, n: number) { return o!.count < n ? "less" : "not less"; }
function testFlag(o: Maybe) { return o!.isOpen ? "open" : "closed"; }
function testBit(o: Maybe) { return o!.count & 4 ? "set" : "clear"; }
function storeCount(o: Maybe, n: number) { o!.count = n | 0; return "stored"; }
function storeConstant(o: Maybe) { o!.count = 7; return "stored"; }
function storeRatio(o: Maybe, n: number) { o!.ratio = n * 0.5; return "stored"; }
function storeFlag(o: Maybe, n: number) { o!.isOpen = n > 2; return "stored"; }
function storeReference(o: Maybe, other: Item) { o!.next = other; return "stored"; }
function storeNull(o: Maybe) { o!.next = null; return "stored"; }
function incrementCount(o: Maybe) { o!.count++; return "updated"; }
function addToCount(o: Maybe, n: number) { o!.count += n | 0; return "updated"; }
function addToRatio(o: Maybe, n: number) { o!.ratio += n; return "updated"; }
function readSecond(o: Maybe) { return o!.next!.count; }
function readThird(o: Maybe) { return o!.next!.next!.ratio; }
function readTwoFields(o: Maybe) { return o!.count + o!.ratio; }
function readAfterArithmetic(o: Maybe, n: number) { const scaled = n * 3 + 1; return scaled + o!.count; }
function sumList(o: Maybe) { let sum = 0; for (let item = o!; ; item = item.next!) { sum += item.count; if (sum > 100) return sum; } }

function describe(error: unknown): string {
  const e = error as Error;
  const position = /:(\d+):(\d+)\)?\s*$/m.exec(e.stack ?? "");
  const value = /\b(null|undefined)\b/.exec(e.message);
  const evaluated = /evaluating '([^']*)'/.exec(e.message);
  const property = evaluated ? /\.(\w+)\b(?!\.)/.exec(evaluated[1]) : /(?:reading|setting) '(\w+)'/.exec(e.message);
  return e.name + ": " + (property ? property[1] : "no property") + " of " + (value ? value[1] : "no value") + " at " + (position ? position[1] + ":" + position[2] : "no position");
}

function stateOf(o: Maybe): string {
  return o ? [o.count, o.ratio, o.isOpen, o.label, o.next ? o.next.count : "end"].join(" ") : String(o);
}

function makeList(length: number): Item | null {
  let list: Item | null = null;
  for (let i = length; i > 0; i--) list = new Item(i + 4, list);
  return list;
}

const other = new Item(40, null);
const cases: [string, (o: Maybe) => unknown][] = [
  ["readReference", readReference], ["readCount", readCount], ["readRatio", readRatio], ["readLabel", readLabel],
  ["addCount", o => addCount(o, 3)], ["subtractCount", o => subtractCount(o, 3)], ["addRatio", o => addRatio(o, 3)],
  ["multiplyRatio", o => multiplyRatio(o, 3)], ["subtractRatio", o => subtractRatio(o, 3)],
  ["compareCount", compareCount], ["compareCounts", o => compareCounts(o, 6)], ["testFlag", testFlag], ["testBit", testBit],
  ["storeCount", o => storeCount(o, 3)], ["storeConstant", storeConstant], ["storeRatio", o => storeRatio(o, 3)],
  ["storeFlag", o => storeFlag(o, 3)], ["storeReference", o => storeReference(o, other)], ["storeNull", storeNull],
  ["incrementCount", incrementCount], ["addToCount", o => addToCount(o, 3)], ["addToRatio", o => addToRatio(o, 3)],
  ["readSecond", readSecond], ["readThird", readThird], ["readTwoFields", readTwoFields],
  ["readAfterArithmetic", o => readAfterArithmetic(o, 3)], ["sumList", sumList],
];

for (const [name, run] of cases) {
  for (const length of [3, 2, 1, 0, -1]) {
    const o: Maybe = length < 0 ? undefined : makeList(length);
    let outcome = "";
    for (let round = 0; round < 300; round++) {
      const fresh: Maybe = round ? (length < 0 ? undefined : makeList(length)) : o;
      try { outcome = String(run(fresh)) + " | " + stateOf(fresh); } catch (error) { outcome = describe(error) + " | " + stateOf(fresh); }
    }
    console.log(name, length, "|", outcome);
  }
}
