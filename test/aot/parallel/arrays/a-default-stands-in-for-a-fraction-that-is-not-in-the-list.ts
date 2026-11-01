// `list[i] ?? 100` and its other spellings over lists of fractions: an element that is there, a hole, an index past the
// end, NaN, the infinities and -0.
function withNullish(list: number[], turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += list[i & 7] ?? 100;
  return sum;
}
function withComparison(list: number[], turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const element = list[i & 7];
    sum += element === undefined ? 100 : element;
  }
  return sum;
}
function withPattern(list: number[], turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const [first = 100, , third = 1000] = list;
    sum += first + third + i;
  }
  return sum;
}
function twoOfACopy(list: number[], turns: number): number {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    const copy = list.slice();
    sum = (sum + (copy[i & 3] ?? 0) + (copy[2] ?? 0)) | 0;
  }
  return sum;
}
const show = (value: number | string) => (Object.is(value, -0) ? "-0" : String(value));

const whole: number[] = JSON.parse("[1.5,2.5,3.5,4.5,5.5,6.5,7.5,8.5]");
const short: number[] = JSON.parse("[0.5,0.25]");
const holed: number[] = [1.5, 2.5, 3.5, 4.5, 5.5];
delete holed[1];
delete holed[2];
holed.length = 7;
const odd: number[] = [0.5, NaN, Infinity, -Infinity, -0, 1e308, 5e-324, -1.5];
const empty: number[] = [];

for (const [name, list] of Object.entries({ whole, short, holed, odd, empty })) {
  console.log(name, show(withNullish(list, 16)), show(withComparison(list, 16)));
  console.log(name, show(withPattern(list, 4)), twoOfACopy(list, 9));
  const each: string[] = [];
  for (let i = 0; i < 9; i++) each.push(show(list[i] ?? "none"));
  console.log(each.join(" "));
}
for (const list of [[-0], [NaN, 1.5], [Infinity, 0.5], [-Infinity, 0.5]]) console.log(show(withNullish(list, 2)));
