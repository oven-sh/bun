// A total starts at zero and every call that the build sees adds a small integer. Calls that it does not see add more than that: large integers, fractions, minus zero, NaN and the infinities.
class Total {
  sum = 0;
  steps = 0;
  balance = 0;
  add(step: number) {
    this.sum += step;
    this.balance -= step;
    this.steps++;
  }
}
class Copy {
  sum = 0;
  constructor(total: Total) {
    this.sum = total.sum;
  }
}
function show(value: number) {
  return Object.is(value, -0) ? "-0" : String(value);
}
const kept: (Total | Copy)[] = [];
function follow(name: string, start: number, steps: number[]) {
  const total = new Total();
  kept.push(total);
  for (let turn = 0; turn < 100; turn++) total.add(turn & 3);
  Reflect.set(total, "sum", start);
  Reflect.set(total, "balance", -start);
  const seen: string[] = [];
  for (const step of steps) {
    total.add.call(total, step);
    const copy = new Copy(total);
    kept.push(copy);
    seen.push(show(total.sum) + "|" + show(total.balance) + "|" + show(copy.sum) + "|" + (total.sum | 0) + "|" + (total.sum % 7));
  }
  console.log(name, seen.join(" "), total.steps, JSON.stringify(total), Object.keys(total).join());
}
const given: number[] = JSON.parse("[1, -1, 2, -2, 1, 1, 1, -3, -3]");
for (const exponent of [31, 32, 52, 53, 62, 63, 64]) {
  follow("up to 2 ** " + exponent, 2 ** exponent - 2, given);
  follow("down to -(2 ** " + exponent + ")", -(2 ** exponent) + 2, given.map(step => -step));
}
follow("large steps", 0, [2 ** 31, 2 ** 31, 2 ** 40, 2 ** 51, 2 ** 51, 2 ** 51, 2 ** 52, -(2 ** 53), -(2 ** 53), 1, 1]);
follow("fractions", 0, [0.5, 0.5, 0.25, -1.25, 1e-300, 3]);
follow("minus zero", -0, [-0, -0, 0, -0, 1, -1, -0]);
follow("no numbers", 5, [NaN, 1, 2]);
follow("the infinities", 5, [Infinity, 1, -Infinity, 1]);
follow("back again", 2 ** 52 + 4, [-8, 8, -(2 ** 52), 1, 2 ** 31, -(2 ** 31)]);
console.log(kept.length);
