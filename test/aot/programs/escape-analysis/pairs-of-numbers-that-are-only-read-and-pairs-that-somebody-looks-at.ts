// Functions answer with a pair or a small tuple of numbers, and callers take it apart at once: by a pattern, by an assignment pattern, by an index.
// Beside them stand the callers that can tell whether there was an array: an element that is no number, NaN, a hole, a getter under an index,
// a class below Array, a pair that is kept on one way, a pair that is written to, an iterator of its own.
const lines: string[] = [];
function say(...values: unknown[]) {
  lines.push(values.map(value => (Array.isArray(value) ? "[" + value.map(String).join(",") + "]" : Object.is(value, -0) ? "-0" : String(value))).join(" "));
}

function bounds(list: number[]): [number, number] {
  let low = 1000;
  for (let i = 0; i < list.length; i++) if (list[i] < low) low = list[i];
  let high = -1000;
  for (let i = 0; i < list.length; i++) if (list[i] > high) high = list[i];
  return [low, high];
}
function lastOf(list: number[]): [number, number] {
  let last = list[0];
  let count = 0;
  for (let i = 0; i < list.length; i++) {
    last = list[i];
    count++;
  }
  for (let i = 0; i < list.length; i++) if (list[i] === 77) count += 100;
  return [last, count];
}
function divide(a: number, b: number): [number, number] {
  return [Math.floor(a / b), a % b];
}
function halves(a: number): [number, number, number] {
  return [a * 0.5, a * 0.25, a * 0.125];
}
function named(a: number, name: string): [number, string] {
  return [a + 1, name];
}

function byPattern(list: number[]) {
  const [low, high] = bounds(list);
  return high - low;
}
function byAssignment(list: number[]) {
  let low = 0;
  let high = 0;
  [low, high] = bounds(list);
  return high - low;
}
function byIndex(list: number[]) {
  return bounds(list)[1];
}
function byTwoIndexes(list: number[]) {
  const both = bounds(list);
  return both[1] - both[0];
}
function beyondTheEnd(list: number[]) {
  const both: number[] = bounds(list);
  const [a, b, c] = both;
  return String(a) + b + c + both[2] + both.length;
}
function withDefaults(list: number[]) {
  const [last = -5, count = -6] = lastOf(list);
  return last + ":" + count;
}

const whole = [3, 1, 2];
const holey: number[] = [3, 1, 2];
delete (holey as any)[1];
const withOther: number[] = [3, "x" as any, 2];
const withNaN = [3, NaN, 2];
const withMinusZero = [-0];
const empty: number[] = [];
for (let turn = 0; turn < 3; turn++) {
  for (const list of [whole, holey, withOther, withNaN, withMinusZero, empty]) {
    say("pattern", byPattern(list), "assignment", byAssignment(list), "index", byIndex(list), "indexes", byTwoIndexes(list));
    say("beyond", beyondTheEnd(list), "defaults", withDefaults(list), "last", lastOf(list));
  }
}

let sum = 0;
for (let i = 1; i < 2000; i++) {
  const [quotient, rest] = divide(i, 7);
  const [half, quarter, eighth] = halves(i);
  const [next, name] = named(i, "ab");
  sum += quotient - rest + half - quarter + eighth + next - name.length;
}
say("sum", sum, divide(1, 0), divide(0, 0), divide(-1, 2), halves(NaN), halves(-0));

function local(i: number) {
  const pair = [i * 0.5, i + 1];
  return pair[0] - pair[1];
}
function localWithNaN(i: number) {
  const pair = [i / i, i + 1];
  return String(pair[0]) + pair[1] + pair.length + (pair[0] === pair[0]);
}
say("local", local(3), local(-0), localWithNaN(0), localWithNaN(2));

const kept: number[][] = [];
function keptOnOneWay(i: number) {
  const pair = divide(i, 3);
  const first = pair[0];
  if (i % 5 === 0) {
    kept.push(pair);
    pair[1] = 0.5;
  }
  return first + pair[1];
}
function keptThenRead(i: number) {
  const pair = [i * 0.5, i / (i - 2)];
  if (i === 2 || i === 4) kept.push(pair);
  return pair[0] + pair[1];
}
for (let i = 0; i < 12; i++) say("kept", keptOnOneWay(i), keptThenRead(i));
say(kept.length, ...kept, kept[0] === kept[1], kept[0] === kept[0]);

function written(i: number) {
  const pair = divide(i, 3);
  pair[0] = i === 4 ? (undefined as any) : i === 5 ? ("s" as any) : pair[1] * 1.5;
  pair[1]++;
  return String(pair[0]) + "," + pair[1];
}
function grown(i: number) {
  const pair: number[] = divide(i, 3);
  pair[3] = i;
  pair.length = i % 2 ? 1 : 4;
  return pair.length + ":" + String(pair[0]) + String(pair[2]) + String(pair[3]) + (2 in pair);
}
for (let i = 3; i < 8; i++) say("written", written(i), grown(i));

function withGetter(i: number) {
  const pair = divide(i, 3);
  let reads = 0;
  Object.defineProperty(pair, "0", { get() { reads++; return 40 + i; }, configurable: true });
  const [a, b] = pair;
  return a + b + pair[0] + ":" + reads;
}
function frozen(i: number) {
  const pair = Object.freeze(divide(i, 3)) as [number, number];
  let message = "stored";
  try {
    pair[0] = 9;
  } catch (error) {
    message = (error as Error).constructor.name;
  }
  return message + pair[0] + Object.isFrozen(pair);
}
say("getter", withGetter(4), withGetter(5), "frozen", frozen(7));

class Pair extends Array<number> {
  get spread() {
    return this[1] - this[0];
  }
}
function ofClass(a: number, b: number): Pair {
  const pair = new Pair();
  pair.push(a, b);
  return pair;
}
function readsClass(i: number) {
  const pair = ofClass(i, i * 2.5);
  const [a, b] = pair;
  return a + b + pair.spread + (pair instanceof Pair ? 0.25 : 0) + pair.length;
}
say("class", readsClass(2), readsClass(3), Array.isArray(ofClass(1, 2)), ofClass(1, 2).constructor === Pair);

function ownIterator(i: number) {
  const pair = divide(i, 3);
  if (i > 6)
    (pair as any)[Symbol.iterator] = function* () {
      yield 70;
      yield 80;
    };
  const [a, b] = pair;
  return a + "," + b + "," + pair[0];
}
say("iterator", ownIterator(5), ownIterator(7));

function* pairs(n: number): Generator<[number, number]> {
  for (let i = 0; i < n; i++) yield [i, i * i];
}
function listOfPairs(n: number): [number, number][] {
  const list: [number, number][] = [];
  for (let i = 0; i < n; i++) list.push([i, i * 0.5]);
  return list;
}
let total = 0;
for (const [key, value] of pairs(50)) total += value - key;
for (const [key, value] of listOfPairs(50)) total += value - key;
for (const [key, value] of new Map([[1, 2.5], [2, NaN]])) total += key + (value === value ? value : 1000);
for (const [key, value] of Object.entries({ a: 1, b: 2.5 })) total += key.length + value;
say("loops", total);

function same(i: number) {
  const a = divide(i, 3);
  const b = divide(i, 3);
  const c = i % 2 ? a : b;
  return String(a === b) + (c === a) + (c === b) + typeof a + Array.isArray(c) + JSON.stringify(c) + String(a) + Object.keys(b);
}
say("same", same(4), same(5));

function oneOfTwo(i: number, list: number[]) {
  const pair = i % 3 === 0 ? bounds(list) : i % 3 === 1 ? divide(i, 2) : lastOf(list);
  return pair[0] + pair[1];
}
for (let i = 0; i < 6; i++) say("one of", oneOfTwo(i, whole), oneOfTwo(i, holey), oneOfTwo(i, withOther));

console.log(lines.join("\n"));
