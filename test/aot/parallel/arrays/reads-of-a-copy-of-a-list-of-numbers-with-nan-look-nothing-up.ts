// A list of numbers with NaN among them holds values of any kind: storage for doubles has no room for NaN. A copy has the storage of the list that it is made from,
// so a read of the copy that expects doubles, as the types of the elements would have it, fails its test at every turn and looks the element up.
// Expecting doubles it was 4,005: two lookups a turn for each of the five methods.
// COUNT: arrivals <= 40
// Alone: what the compiler knows of a list goes by all that the executable holds, and with it what is counted here
const numbers: number[] = [1.5, 2.5, NaN, 4.5, 5.5, 6.5, 7.5, 8.5];
const more: number[] = [0.25, NaN];

function twoOf(list: number[], i: number): number {
  return (list[i & 3] ?? 0) + (list[1] ?? 0);
}
function replaced(i: number): number {
  return twoOf(numbers.with(2, 9), i);
}
function part(i: number): number {
  return twoOf(numbers.slice(3), i);
}
function reversed(i: number): number {
  return twoOf(numbers.toReversed(), i);
}
function cut(i: number): number {
  return twoOf(numbers.toSpliced(2, 1), i);
}
function joined(i: number): number {
  return twoOf(numbers.concat(more), i & 1);
}

let sum = 0;
for (let i = 0; i < 400; i++) sum += replaced(i) + part(i) + reversed(i) + cut(i) + joined(i);
console.log(sum);
// A copy that still holds NaN reads it, and one that was widened reads what was put in.
console.log(numbers.slice(2)[0], numbers.toReversed()[5], numbers.concat(more)[9], numbers.with(0, NaN)[0], [1, 2, 3].concat(0.5)[3], [1, 2, 3].with(1, 0.5)[1]);
