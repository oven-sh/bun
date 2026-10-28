function show(list: unknown[]): string {
  const parts: string[] = [];
  for (let index = 0; index < list.length; index++) parts.push(index in list ? (Object.is(list[index], -0) ? "-0" : String(list[index])) : "hole");
  return `${list.length}[${parts.join(",")}]`;
}
const lines: string[] = [];
const whole = new Map<number, number>([[1, 10], [2, 20], [3, 30]]);
const fractions = new Map<number, number>([[0.5, -0], [NaN, 1e-310], [Infinity, 2147483648.5]]);
const mixed = new Map<unknown, unknown>([[1, "one"], ["two", 2], [null, undefined], [3.5, { toString: () => "obj" }]]);
function total(counts: Map<number, number>): number {
  let sum = 0;
  for (const [key, count] of counts) sum += key * count;
  return sum;
}
function kept(counts: Map<unknown, unknown>): unknown[][] {
  const pairs: unknown[][] = [];
  for (const pair of counts) pairs.push(pair);
  return pairs;
}
function firstOf(list: (number | null)[]): unknown[] {
  const groups = Map.groupBy([1], () => list[0]);
  return [...groups.keys()];
}
lines.push(total(whole) + " " + total(fractions) + " " + total(new Map()));
for (const counts of [whole, fractions, mixed]) {
  const pairs = kept(counts);
  lines.push(pairs.map(show).join(" "));
  for (const pair of pairs) {
    pair[0] = "changed";
    pair.push(0.25);
    pair.length = 4;
  }
  lines.push(pairs.map(show).join(" ") + " | " + kept(counts).map(show).join(" "));
}
for (const pair of fractions) lines.push(show(firstOf(pair)) + " " + show(firstOf([null])) + " " + typeof pair[1] + " " + JSON.stringify(pair));
for (const pair of new Set([1.5, 2]).entries()) lines.push(show(pair) + " " + show(firstOf(pair)));
for (const [index, value] of [0.5, 1.5].entries()) lines.push(index + " " + value);
let sum = 0;
for (let turn = 0; turn < 400; turn++) {
  whole.set(2, turn);
  sum += total(whole) + total(fractions.size ? new Map([[turn, 0.5]]) : whole);
}
lines.push("sum " + sum);
console.log(lines.join("\n"));
