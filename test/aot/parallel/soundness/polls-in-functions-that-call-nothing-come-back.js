// Every poll takes its slow path here and comes back with nothing to do, and the loop goes on with every value where it was. A function that
// calls nothing may have no frame: what it returns to is then in a register or on top of the stack. Each loop ends by a test that no count
// of turns can be made of, so it polls on every turn, and two functions call each other in tail position, which polls without a frame.
// Env: BUN_JSC_forceTrapAwareStackChecks=1
const one = process.argv.length > 100 ? 3 : 1;
const turns = process.argv.length > 100 ? 7 : 3000;

function sumUpTo(limit, step) {
  let sum = 0;
  for (let i = 0; i !== limit; i = (i + step) | 0) sum = (sum + i) | 0;
  return sum;
}

function halvings(value) {
  let count = 0;
  while (value > 1) {
    value = value / 2;
    count++;
  }
  return count;
}

function collatz(value) {
  let steps = 0;
  while (value !== 1) {
    value = value % 2 === 0 ? value / 2 : 3 * value + 1;
    steps++;
  }
  return steps;
}

function twoLoops(limit, step) {
  let low = 0;
  let high = 0;
  for (let i = 0; i !== limit; i = (i + step) | 0) low = (low ^ i) | 0;
  for (let i = limit; i !== 0; i = (i - step) | 0) high = (high + (i & 5)) | 0;
  return low * 31 + high;
}

function sumInTry(limit, step) {
  let sum = 0;
  try {
    for (let i = 0; i !== limit; i = (i + step) | 0) sum = (sum + (i ^ 3)) | 0;
  } catch (error) {
    sum = -1;
  }
  return sum;
}

function down(count, total) {
  "use strict";
  if (count === 0) return total;
  return up(count - 1, total + count);
}

function up(count, total) {
  "use strict";
  if (count === 0) return total;
  return down(count - 1, total - 1);
}

class Counter {
  step = one;
  walk = limit => {
    let sum = 0;
    for (let i = 0; i !== limit; i = (i + this.step) | 0) sum = (sum + 2 * i) | 0;
    return sum;
  };
  sum(limit) {
    let sum = 0;
    for (let i = 0; i !== limit; i = (i + this.step) | 0) sum = (sum + 3 * i) | 0;
    return sum;
  }
  static sum(limit, step) {
    let sum = 0;
    for (let i = 0; i !== limit; i = (i + step) | 0) sum = (sum + 5 * i) | 0;
    return sum;
  }
}

// The callers keep values of their own across the calls.
function callsThemAll(limit, step) {
  const counter = new Counter();
  let text = "";
  for (let round = 1; round !== 4; round = (round + step) | 0) {
    const before = round * 1.5;
    const a = sumUpTo(limit * round, step);
    const b = halvings(limit * round + 0.5);
    const c = collatz(limit + round);
    const d = twoLoops(limit + round, step);
    const e = sumInTry(limit - round, step);
    const f = down(limit + round, round);
    const g = counter.walk(limit) + counter.sum(limit + 1) + Counter.sum(limit + 2, step);
    text += [round, before, a, b, c, d, e, f, g].join() + ";";
  }
  return text;
}

let atTopLevel = 0;
for (let i = 0; i !== turns; i = (i + one) | 0) atTopLevel = (atTopLevel + 7 * i) | 0;

console.log(sumUpTo(turns, one), halvings(turns + 0.25), collatz(turns + 27), twoLoops(turns, one), sumInTry(turns, one));
console.log(down(turns, 0), up(turns + 1, 5));
console.log(new Counter().walk(turns), new Counter().sum(turns), Counter.sum(turns, one));
console.log(callsThemAll(turns, one));
console.log(atTopLevel);
