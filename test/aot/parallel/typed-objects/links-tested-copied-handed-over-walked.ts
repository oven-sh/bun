// Links between objects of one class: null, undefined or both stand for "no object". Each is read through, compared, copied, handed to a call and walked in a loop whose variable starts from a parameter.
// A loop that asks for one of the two must not take the other for it.
class Node {
  value: number;
  next: Node | null;
  other: Node | null;
  constructor(value: number, next: Node | null) { this.value = value; this.next = next; this.other = null; }
}
class Step {
  value: number;
  next: Step | undefined;
  constructor(value: number, next: Step | undefined) { this.value = value; this.next = next; }
}
class Either {
  value: number;
  next: Either | null | undefined;
  constructor(value: number, next: Either | null | undefined) { this.value = value; this.next = next; }
}
class Late {
  value: number;
  next?: Late;
  constructor(value: number) { this.value = value; }
}
function readThrough(o: Node): number { const x = o.next; return x === null ? 0 : x.value; }
function twoSteps(o: Node): number { return o.next!.next!.value; }
function isLast(o: Node): boolean { return o.next === null; }
function sameLink(a: Node, b: Node): boolean { return a.next === b.next; }
function copyWide(a: Node, b: Node): void { a.other = b.next; }
function copyNarrow(a: Node, b: Node): void { a.next = b.next; }
function take(n: Node | null): number { return n === null ? -1 : n.value + 1; }
function handOver(o: Node): number { return take(o.next) + take(o.other); }
function walk(o: Node | null): number { let sum = 0; while (o !== null) { sum += o.value; o = o.next; } return sum; }
function walkTruthy(o: Node | null): number { let sum = 0; while (o) { sum += o.value; o = o.next; } return sum; }
function walkSteps(o: Step | undefined): number { let sum = 0; while (o !== undefined) { sum += o.value; o = o.next; } return sum; }
function walkUntilNull(o: Either | null | undefined): number { let sum = 0; while (o !== null) { sum += o!.value; o = o!.next; } return sum; }
function walkUntilUndefined(o: Either | null | undefined): number { let sum = 0; while (o !== undefined) { sum += o!.value; o = o!.next; } return sum; }
function walkWhileAny(o: Either | null | undefined): number { let sum = 0; while (o != null) { sum += o.value; o = o.next; } return sum; }
function walkLate(o: Late | undefined): number { let sum = 0; while (o !== undefined) { sum += o.value; o = o.next; } return sum; }
function lastOf(o: Node): Node { let last = o; for (let x: Node | null = o; x !== null; x = x.next) last = x; return last; }
function attempt(label: string, f: () => number): void {
  try { console.log(label, f()); } catch (e) { console.log(label, (e as Error).constructor.name); }
}

let list: Node | null = null;
let steps: Step | undefined = undefined;
let late: Late | undefined = undefined;
for (let i = 1; i <= 100; i++) {
  list = new Node(i, list);
  steps = new Step(i, steps);
  const l: Late = new Late(i);
  if (late !== undefined) l.next = late;
  late = l;
}
const head = list!;
let total = 0;
for (let i = 0; i < 300; i++) {
  total += readThrough(head) + twoSteps(head) + (isLast(head) ? 1 : 0) + (sameLink(head, head.next!) ? 1 : 0) + handOver(head) + walk(head) + walkTruthy(head) + walkSteps(steps) + walkLate(late);
  copyWide(head, head.next!);
}
console.log("total", total, "last", lastOf(head).value, "empty", walk(null), walkTruthy(null), walkSteps(undefined), walkLate(undefined));
copyNarrow(head, head.next!);
console.log("one left out", walk(head), isLast(lastOf(head)), take(lastOf(head).next));

const endsInNull = new Either(1, new Either(2, new Either(3, null)));
const endsInUndefined = new Either(10, new Either(20, new Either(30, undefined)));
for (let i = 0; i < 3; i++) {
  attempt("until null, ends in null", () => walkUntilNull(endsInNull));
  attempt("until null, ends in undefined", () => walkUntilNull(endsInUndefined));
  attempt("until undefined, ends in undefined", () => walkUntilUndefined(endsInUndefined));
  attempt("until undefined, ends in null", () => walkUntilUndefined(endsInNull));
  attempt("while any", () => walkWhileAny(endsInNull) + walkWhileAny(endsInUndefined) + walkWhileAny(null) + walkWhileAny(undefined));
}
