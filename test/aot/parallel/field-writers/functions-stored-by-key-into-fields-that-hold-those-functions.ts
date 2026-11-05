// Three records, each filled by key with one function alone, so each field is typed by that function: one that captures nothing, one that captures a variable, one that has got a property of its own.
// The stub behind a store by key tells the first two by the number in the closure and leaves the third to the run time. All three read back what was stored.
// COUNT: operations <= 3057
type Listener = () => number;
interface First { [name: string]: Listener | undefined; a: Listener | undefined; b: Listener | undefined }
interface Second { [name: string]: Listener | undefined; c: Listener | undefined; d: Listener | undefined }
interface Third { [name: string]: Listener | undefined; e: Listener | undefined; f: Listener | undefined }
function plain() {
  return 1;
}
function withProperty() {
  return 2;
}
(withProperty as Listener & { mark?: number }).mark = 7;
function capturing(n: number): Listener {
  return () => n;
}
const keys = ["a", "b", "c", "d", "e", "f"];
function first(turn: number): number {
  const record: First = { a: undefined, b: undefined };
  record[keys[turn & 1]!] = plain;
  return (record.a ? record.a() : 10) + (record.b ? record.b() : 20);
}
function second(turn: number): number {
  const record: Second = { c: undefined, d: undefined };
  record[keys[2 + (turn & 1)]!] = capturing(turn);
  return (record.c ? record.c() : 10) + (record.d ? record.d() : 20);
}
function third(turn: number): number {
  const record: Third = { e: undefined, f: undefined };
  record[keys[4 + (turn & 1)]!] = withProperty;
  return (record.e ? record.e() : 10) + (record.f ? record.f() : 20) + (record.e ?? record.f as any).mark;
}
let totals = [0, 0, 0];
for (let turn = 0; turn < 3000; turn++) {
  totals[0]! += first(turn);
  totals[1]! += second(turn);
  totals[2]! += third(turn);
}
console.log(totals.join());
