// What filter() and map() make of a list of numbers that is handed in is read again as a list of numbers: whole numbers, fractions, NaN, -0, Infinity and holes.
const whole = JSON.parse("[1,2,3,4,5,6,7,8]") as number[];
const fractions = JSON.parse("[0.5,1.5,2.5,3.5,4.5,5.5,6.5,7.5]") as number[];
const unusual: number[] = [1, NaN, 3, 0 / 0, 5, -0, Infinity, 8.25];
const withHoles: number[] = [1, 2, 3, 4, 5];
delete withHoles[1];
delete withHoles[3];

function weigh(value: number | undefined): number {
  if (value === undefined) return 17;
  if (value !== value) return 11;
  if (Object.is(value, -0)) return 7;
  return value === Infinity ? 13 : value;
}
function largeDoubled(list: number[]): number[] {
  return list.filter(value => !(value <= 2)).map(value => value * 2);
}
function rootsSummed(list: number[]): number {
  let sum = 0;
  for (const root of list.map(value => Math.sqrt(value - 3))) sum += weigh(root);
  return sum;
}
function keptSummed(list: number[]): number {
  const kept = list.filter(value => value !== 3);
  let sum = 0;
  for (let index = 0; index < kept.length; index++) sum += weigh(kept[index]);
  return sum;
}
function halvedThenFound(list: number[]): number | undefined {
  return list
    .map(value => value / 2)
    .filter(value => value > 1)
    .find(value => value > 2);
}
function negatedThenDivided(list: number[]): number {
  const negated = list.map(value => -value);
  for (let index = 0; index < negated.length; index++) negated[index] = negated[index] / 0;
  let sum = 0;
  for (const value of negated) sum += value === -Infinity ? 1 : weigh(value);
  return sum;
}

const lists = [whole, fractions, unusual, withHoles];
const sums = [0, 0, 0, 0];
for (let round = 0; round < 300; round++) {
  for (let which = 0; which < lists.length; which++) {
    const list = lists[which];
    sums[which] += largeDoubled(list).length + rootsSummed(list) + keptSummed(list);
    sums[which] += weigh(halvedThenFound(list)) + negatedThenDivided(list);
  }
}
console.log(sums.map(sum => sum.toFixed(3)).join(" "));
for (const list of lists) {
  const doubled = largeDoubled(list);
  const texts = doubled.map(value => (Object.is(value, -0) ? "-0" : String(value)));
  console.log(JSON.stringify(doubled), texts.join(), Object.keys(doubled).join());
}
const doubled = largeDoubled(unusual);
console.log(doubled.includes(NaN), doubled.indexOf(NaN), 0 in doubled, 2 in doubled, doubled.length);
const halved = withHoles.map(value => value * 0.5);
console.log(Object.keys(halved).join(), halved.length);
