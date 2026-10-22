// An array literal of up to four numbers is made by one call. A NaN among them makes the same array as anywhere else, and what is pushed, read and listed afterwards is what plain arrays give.
// CALLS+ one ArrayLiteralWithDouble\.n1
// CALLS+ two ArrayLiteralWithDouble\.n2
// CALLS+ three ArrayLiteralWithDouble\.n3
// CALLS+ four ArrayLiteralWithDouble\.n4
// CALLS- three NewArrayWithLength
// SIZE< three 60
function one(a: number): number[] { return [a]; }
function two(a: number, b: number): number[] { return [a, b]; }
function three(a: number, b: number, c: number): number[] { return [a, b, c]; }
function four(a: number, b: number, c: number, d: number): number[] { return [a, b, c, d]; }
function five(a: number, b: number, c: number, d: number, e: number): number[] { return [a, b, c, d, e]; }
const makers: ((a: number, b: number, c: number, d: number, e: number) => number[])[] = [one, two, three, four, five];
const values = [0, -0, 1, -1, 0.5, 1e300, -1e-300, NaN, Infinity, -Infinity, 2147483647, -2147483648, 4294967296, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE];
function at(index: number): number {
  const value = values[index % values.length];
  return value === undefined ? 0 : value;
}
function show(list: number[]) {
  return list.map(value => (Object.is(value, -0) ? "-0" : String(value))).join() + " " + list.length + " " + list.includes(NaN) + " " + list.indexOf(NaN) + " " + JSON.stringify(list);
}
for (const make of makers) {
  for (let i = 0; i < values.length; i++) {
    const list = make(at(i), at(i + 1), at(i + 5), at(i + 7), at(i + 11));
    const before = show(list);
    list.push(at(i + 3));
    list[0] = list[list.length - 1];
    console.log(before, "|", show(list), Object.keys(list).join(""));
  }
}
const zero = 0;
const made = three(zero / zero, Math.sqrt(-1), Infinity - Infinity);
console.log(show(made), made.every(value => value !== value));
let sum = 0;
let kept: number[][] = [];
for (let round = 0; round < 100000; round++) {
  const list = round & 1 ? three(round, round / 2, -round) : four(round, 0.25, round * 3, round & 2 ? NaN : 1);
  if (!(round % 9973)) kept.push(list, one(round), two(round, -round));
  const last = list[list.length - 1];
  sum += list[0] + list[1] + list[2] + (last === last ? last : 7);
}
console.log(sum, kept.map(show).join(";"));
