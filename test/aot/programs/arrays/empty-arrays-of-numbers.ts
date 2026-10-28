// `[]` of number[] is one call with nothing behind it, whether or not the compiler sees how much room it will need, and also once an accessor for an index on a prototype of arrays has made every array slow.
// CALLS+ none NewEmptyArray\.DoubleDefaultCapacity
// CALLS- none CallOperation
// SIZE< none 24
function none(): number[] { return []; }
function one(value: number): number[] { const made: number[] = []; made.push(value); return made; }
function three(value: number): number[] { const made: number[] = []; made.push(value); made.push(value + 0.5); made.push(value * 2); return made; }
function many(count: number): number[] { const made: number[] = []; for (let i = 0; i < count; i++) made.push(i / 2); return made; }
const makers: (() => number[])[] = [none];
function show(): void {
  const empty = makers[0]();
  console.log(empty.length, JSON.stringify(empty), Array.isArray(empty), JSON.stringify(one(1.5)), JSON.stringify(three(2)), JSON.stringify(many(9)));
  empty.push(0.25);
  empty[3] = 7;
  console.log(empty.length, JSON.stringify(empty), 1 in empty, empty[1]);
}
show();
let total = 0;
for (let round = 0; round < 50000; round++) {
  const empty = none();
  empty.push(round);
  total += empty.length + one(round)[0] + three(round).length + many(round & 7).length;
}
console.log(total);
class Odd extends Array<number> {}
Object.defineProperty(Odd.prototype, 1, { get() { return -1; }, set(_value: number) {}, configurable: true });
const odd = new Odd();
odd.push(1, 2, 3);
console.log(odd.length, odd[0], odd[1], odd[2]);
show();
total = 0;
for (let round = 0; round < 2000; round++) {
  const empty = none();
  empty.push(round);
  total += empty.length + one(round)[0] + three(round).length + many(round & 7).length;
}
console.log(total);
