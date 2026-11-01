// A loop that goes on while the counter plus a constant stands in some relation to an integer: every relation, the sum on either side, steps that are and are not the constant,
// bounds around zero, and counters that start where a sum is no longer exact, at -0, at NaN, at an infinity and at a fraction.
const lines: string[] = [];
const floats = new Float64Array(9);
for (let i = 0; i < floats.length; i++) floats[i] = i + 0.5;
const list: number[] = [3, 1, 4, 1, 5, 9, 2, 6];
const text = "a,b,,c,";

function neighbors(view: Float64Array): number {
  let sum = 0;
  for (let k = 0; k + 1 < view.length; k++) sum += view[k] * view[k + 1];
  return sum;
}
function everyThird(view: Float64Array): number {
  let sum = 0;
  for (let k = 0; k + 2 < view.length; k += 3) sum += view[k] + view[k + 1] + view[k + 2];
  return sum;
}
function boundOnTheLeft(values: number[]): number {
  let sum = 0;
  for (let k = 0; values.length > k + 1; k++) sum += values[k + 1] - values[k];
  return sum;
}
function atMost(values: number[]): number {
  let sum = 0;
  for (let k = 0; k + 2 <= values.length; k += 2) sum += values[k] * values[k + 1];
  return sum;
}
function downwards(values: number[]): number {
  let sum = 0;
  for (let k = values.length; k - 1 >= 0; k--) sum = sum * 3 + values[k - 1];
  return sum;
}
function downwardsAboveZero(values: number[]): number {
  let sum = 0;
  for (let k = values.length - 1; k - 1 > -1; k--) sum = sum * 3 + values[k] - values[k - 1];
  return sum;
}
function pairsOfCharacters(string: string): number {
  let count = 0;
  for (let k = 0; k + 1 < string.length; k++) if (string.charCodeAt(k) === 44 && string.charCodeAt(k + 1) === 44) count++;
  return count;
}
function leavesWhereTheTestHolds(values: number[]): number {
  let k = 0;
  for (;;) {
    if (k + 3 > values.length) break;
    k += 2;
  }
  return k;
}
// How many turns, at most twenty, and where the counter stands behind them.
function turns(start: number, addend: 1 | -1, bound: number): string {
  const limit = bound | 0;
  let count = 0;
  let k = start;
  if (addend === 1) for (; k + 1 < limit && count < 20; k++) count++;
  else for (; k - 1 > limit && count < 20; k--) count++;
  return count + " " + k;
}

lines.push("neighbors " + neighbors(floats) + " " + neighbors(new Float64Array(0)) + " " + neighbors(new Float64Array(1)) + " " + neighbors(floats.subarray(7)));
lines.push("every third " + everyThird(floats) + " " + everyThird(floats.subarray(1)) + " " + everyThird(floats.subarray(7)));
lines.push("bound on the left " + boundOnTheLeft(list) + " " + boundOnTheLeft([]) + " " + boundOnTheLeft([7]));
lines.push("at most " + atMost(list) + " " + atMost([2, 3, 5]) + " " + atMost([2]));
lines.push("downwards " + downwards(list) + " " + downwards([]) + " " + downwardsAboveZero(list) + " " + downwardsAboveZero([1]) + " " + downwardsAboveZero([]));
lines.push("characters " + pairsOfCharacters(text) + " " + pairsOfCharacters("") + " " + pairsOfCharacters(",") + " " + pairsOfCharacters(",,,"));
lines.push("leaves " + leavesWhereTheTestHolds(list) + " " + leavesWhereTheTestHolds([]) + " " + leavesWhereTheTestHolds([1, 2, 3]));
for (const start of [0, -0, -3, 2147483640, -2147483648, 4294967295, 2 ** 53 - 2, 2 ** 53, -(2 ** 53), -(2 ** 53) - 2, 1e300, -1e300, Infinity, -Infinity, NaN, 0.5, -1.5]) {
  for (const bound of [0, 1, 5, -5, 2147483647, -2147483648]) lines.push(start + " " + bound + ": " + turns(start, 1, bound) + " | " + turns(start, -1, bound));
}
console.log(lines.join("\n"));
