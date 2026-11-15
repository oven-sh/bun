export {};
interface Row { a?: number; b?: number; c?: number; d?: number }
class Held { a?: number; b = 2; c?: number; constructor(first: boolean) { if (first) this.a = 1; } }
function onlyB(v: number): Row { return { b: v }; }
function onlyC(v: number): Row { return { c: v }; }
function twoMakers(v: number, first: boolean): Row { return first ? { a: v, b: v } : { a: v, d: v }; }
function byCopy(from: Row, v: number): Row { return { ...from, d: v }; }
function whole(v: number): Row { return { a: v, b: v + 1, c: v + 2, d: v + 3 }; }
const constant: Row = { c: 7 };
function tell(row: Row): string {
  return (row.a === undefined ? "-" : String(row.a + 1)) + (row.b === undefined ? "-" : String(row.b + 1)) + (row.c === undefined ? "-" : String(row.c + 1)) + (row.d === undefined ? "-" : String(row.d + 1));
}
function tellHeld(held: Held): string { return (held.a === undefined ? "-" : String(held.a + 1)) + String(held.b + 1) + (held.c === undefined ? "-" : String(held.c + 1)); }
console.log(tell(onlyB(1)), tell(onlyC(2)), tell(twoMakers(3, true)), tell(twoMakers(4, false)), tell(byCopy(onlyB(5), 6)), tell(byCopy(whole(7), 8)), tell(whole(9)), tell(constant));
console.log(tellHeld(new Held(true)), tellHeld(new Held(false)), "a" in onlyB(1), "b" in onlyB(1), Object.keys(byCopy(onlyC(1), 2)).join());
