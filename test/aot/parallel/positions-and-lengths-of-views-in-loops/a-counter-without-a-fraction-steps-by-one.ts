// It starts from a number that was cut to a whole one: NaN, the infinities and -0 are among them.
const show = (value: any): string =>
  Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : typeof value === "string" ? JSON.stringify(value) : String(value);
function walk(view: Int32Array, from: number): string {
  const found: string[] = [];
  let turns = 0;
  for (let at = Math.trunc(from); turns < 4; at += 1, turns++) found.push(show(view[at]) + " " + show(view[at + 1]) + " " + show(view[at - 1]));
  return found.join(" | ");
}
function sum(view: Int32Array, from: number): number {
  let total = 0, turns = 0;
  for (let at = Math.trunc(from); turns < 4; at += 1, turns++) total = (Math.imul(total, 31) + (view[at]! ^ view[at + 1]! ^ view[at - 1]!)) | 0;
  return total;
}
const view = Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
for (const from of [0, -0, -3, 0.5, -0.5, NaN, Infinity, -Infinity, 2 ** 31 - 2, 2 ** 32 - 2, 2 ** 53 - 2, -(2 ** 31) - 2, 1e300, 3.0000000001]) console.log(show(from), walk(view, from), sum(view, from));
