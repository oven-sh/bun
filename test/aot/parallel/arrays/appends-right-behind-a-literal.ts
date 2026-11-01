// `const list = []; list.push(a); list.push(b);` in hot loops: what the appends return, what runs between them, who sees the list between them, and every kind of storage.
const kept: unknown[] = [];
function keep<T>(list: T): T {
  kept[kept.length & 7] = list;
  return list;
}
function two(i: number): number[] {
  const list: number[] = [];
  list.push(i & 255);
  list.push(1);
  return list;
}
function lengths(i: number): number {
  const list: number[] = [7];
  const first = list.push(i & 3);
  const second = list.push(i & 1, i & 2, 5);
  keep(list);
  return first * 100 + second * 10 + list.push(9) + list.length;
}
function fractionsBehindIntegers(i: number): number[] {
  const list: number[] = [];
  list.push(i & 7);
  list.push(i + 0.5);
  list.push(NaN);
  return list;
}
function anyValues(i: number, text: string): unknown[] {
  const list: unknown[] = [];
  list.push(text);
  list.push(i & 1 ? null : undefined, { id: i & 3 });
  list.push([i & 1]);
  return list;
}
let calls = 0;
function next(i: number): number {
  if ((++calls & 1023) === 0) throw new RangeError("call " + (i & 7));
  return (i + calls) & 63;
}
function callsBetween(i: number): number[] | string {
  let list: number[] | undefined;
  try {
    list = [];
    list.push(next(i));
    list.push(next(i), calls & 3);
    return list;
  } catch (error) {
    return (error as Error).message + " " + (list ? list.length : "none");
  }
}
function seenBetween(i: number): number {
  const list: number[] = [];
  list.push(i & 15);
  const seen = keep(list).length;
  list.push(2);
  return seen * 10 + list.length;
}
function holdsItself(): number {
  const list: unknown[] = [];
  list.push(list);
  list.push(1);
  return (list[0] as unknown[]).length;
}
function returnsTheLength(i: number): number {
  const list: number[] = [i & 1];
  return list.push(i & 2);
}
function seventeen(i: number): number[] {
  const list: number[] = [];
  list.push(i & 1, i & 2, i & 3, i & 4, i & 5, i & 6, i & 7, i & 8, 9);
  list.push(i & 1, i & 2, i & 3, i & 4, i & 5, i & 6, i & 7, i & 8);
  return list;
}
function grownLater(i: number): number[] {
  const list: number[] = [];
  list.push(i & 3);
  list.push(i & 5);
  for (let k = 0; k < (i & 7); k++) list.push(k);
  return list;
}
function nothingAppended(): number {
  const list: number[] = [];
  return list.push() + list.push();
}
function sum(list: readonly unknown[]): number {
  let total = list.length * 1000;
  for (const value of list) total += typeof value === "number" ? (value === value ? value : 500) : typeof value === "string" ? value.length : value == null ? 3 : 7;
  return total;
}
let total = 0;
const messages = new Set<string>();
for (let i = 0; i < 40000; i++) {
  const between = callsBetween(i);
  if (typeof between === "string") messages.add(between);
  total =
    (total +
      sum(keep(two(i))) +
      lengths(i) +
      sum(fractionsBehindIntegers(i)) +
      sum(keep(anyValues(i, "abc"))) +
      (typeof between === "string" ? 1 : sum(between)) +
      seenBetween(i) +
      holdsItself() +
      returnsTheLength(i) +
      sum(seventeen(i)) +
      sum(keep(grownLater(i))) +
      nothingAppended()) %
    1000003;
}
console.log(total, [...messages].sort().join("; "));
console.log(JSON.stringify([two(300), lengths(7), fractionsBehindIntegers(5), anyValues(5, "x"), anyValues(4, "y"), seenBetween(9), holdsItself(), returnsTheLength(3), seventeen(255), grownLater(13)]));
const grown = two(5);
grown.push(2.5, 3);
grown[9] = 1;
console.log(JSON.stringify(grown), grown.length, kept.length);
