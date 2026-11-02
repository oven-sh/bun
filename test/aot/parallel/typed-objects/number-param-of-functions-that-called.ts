// A `number` parameter of a function that is only called, never handed on. Where every call passes an int32 by its type, a counter that runs up to the parameter
// is an int32 and fills an int32 field. A sum of two int32s only looks like one: here it leaves int32 at run time, in both directions, and has to arrive whole.
interface Link {
  value: number;
  next: Link | null;
}
function makeList(n: number): Link | null {
  let head: Link | null = null;
  for (let i = 0; i < n; i++) head = { value: i, next: head };
  return head;
}
function sumList(head: Link | null): number {
  let total = 0;
  for (let p = head; p !== null; p = p.next) total += p.value;
  return total;
}
console.log(sumList(makeList(1000)), sumList(makeList(0)), sumList(makeList(3)));

const one = process.argv.length > 100 ? 5 : 1;
const most = 2147483647;
const least = -2147483648;

interface Kept {
  kept: number;
}
function keep(value: number): Kept {
  return { kept: value };
}
const keptValues = [keep(7), keep(most + one), keep(least - one), keep(most), keep(least)];
console.log(keptValues.map(entry => entry.kept).join(" "));

function makeListFrom(start: number, n: number): Link | null {
  let head: Link | null = null;
  for (let i = 0; i < n; i++) head = { value: start + i, next: head };
  return head;
}
console.log(sumList(makeListFrom(most - 2, 6)), sumList(makeListFrom(5, 4)));

function countTo(limit: number): number {
  let last = -1;
  for (let i = 0; i < limit; i++) last = i;
  return last;
}
console.log(countTo(10), countTo(0), countTo(-3));

function countToMaybeFraction(limit: number): number {
  let steps = 0;
  for (let i = 0; i < limit; i++) steps++;
  return steps;
}
console.log(countToMaybeFraction(4), countToMaybeFraction(4.5), countToMaybeFraction(NaN));

function outer(n: number): number {
  return sumList(makeListThroughOuter(n));
}
function makeListThroughOuter(n: number): Link | null {
  let head: Link | null = null;
  for (let i = 0; i < n; i++) head = { value: i * 2, next: head };
  return head;
}
console.log(outer(100), outer(1));

function leftOut(n?: number): string {
  return typeof n + " " + n;
}
function sometimesLeftOut(n: number): string {
  return typeof n + " " + n;
}
console.log(leftOut(), leftOut(3), sometimesLeftOut(3), (sometimesLeftOut as () => string)());
