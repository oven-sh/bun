// A loop adds the same number in every turn. The number is handed in, so only the run tells whether it is an integer, a fraction, -0, or no number at all.
function adds(start, step, turns) {
  let sum = start;
  for (let i = 0; i < turns; i++) sum += step;
  return sum;
}

function takesAway(start, step, turns) {
  let sum = start;
  for (let i = 0; i < turns; i++) sum -= step;
  return sum;
}

function addsFromTheLeft(start, step, turns) {
  let sum = start;
  for (let i = 0; i < turns; i++) sum = step + sum;
  return sum;
}

function addsAnything(start, step, turns) {
  let sum = start;
  for (let i = 0; i < turns; i++) sum += step;
  return sum;
}

function takesAnythingAway(start, step, turns) {
  let sum = start;
  for (let i = 0; i < turns; i++) sum -= step;
  return sum;
}

class Holder {
  constructor(count, more) {
    this.count = count;
    this.more = more;
  }
}

function addsAField(holder, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += holder.count;
  return sum;
}

function addsAFieldOfAnything(holder, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += holder.count;
  return sum;
}

function addsTwoFields(first, second, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += first.count + second.more;
  return sum;
}

function twoSums(up, down, turns) {
  let rises = 0;
  let falls = 0.5;
  for (let i = 0; i < turns; i++) {
    rises += up;
    falls -= down;
  }
  return [rises, falls];
}

function countsAndAdds(step, turns) {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    count++;
    sum += step;
  }
  return [count, sum];
}

function addsAHalfEveryTurn(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += 0.5;
  return sum;
}

function addsMinusZeroEveryTurn(start, turns) {
  let sum = start;
  for (let i = 0; i < turns; i++) sum += -0;
  return sum;
}

function addsAConstantBeyondThirtyTwoBits(turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += 4294967296;
  return sum;
}

function sumIsLookedAtInTheLoop(step, turns) {
  let sum = 0;
  let seen = 0;
  for (let i = 0; i < turns; i++) {
    sum += step;
    if (sum > 40) seen++;
  }
  return [sum, seen];
}

function inAnotherLoop(steps, turns) {
  let sum = 0;
  for (let k = 0; k < steps.length; k++) {
    const step = steps[k];
    for (let i = 0; i < turns; i++) sum += step;
  }
  return sum;
}

const show = value => (Array.isArray(value) ? value.map(show).join(" ") : Object.is(value, -0) ? "-0" : String(value));

const steps = [
  0, -0, 1, -1, 3, 7, 0.5, -0.25, 1e-300, 2147483647, 2147483648, -2147483647, -2147483648, -2147483649, 4294967295, 4294967296, 9007199254740991, 9007199254740992,
  1e21, 1.7976931348623157e308, NaN, Infinity, -Infinity,
];
const starts = [
  0, -0, 1, 0.5, -3, 2251799813685247, 2251799813685248, -2251799813685248, 4503599627370496, 9007199254740990, 9007199254740992, -9007199254740992, 1e300, NaN, Infinity,
  -Infinity,
];
// How many turns a loop takes is read out of a text, so nobody knows it ahead of the run.
const lengths = JSON.parse("[0, 1, 7, 8, 9, 15, 16, 17, 100]");
const twenty = lengths[1] * 20;
const hundred = lengths[8];

for (const step of steps) {
  for (const start of starts) {
    const line = [];
    for (const turns of lengths) line.push(show(adds(start, step, turns)), show(takesAway(start, step, turns)), show(addsFromTheLeft(start, step, turns)));
    console.log(show(start), show(step), line.join(" "));
  }
}

// More turns than run between two looks at the sum, and sums that pass 2 ** 53, where an addition of numbers rounds.
for (const turns of JSON.parse("[1048575, 1048576, 1048577, 1048584, 1048585, 2097153, 4194311]")) {
  console.log(
    turns,
    show(adds(0, 3, turns)),
    show(adds(0.5, 3, turns)),
    show(adds(0, 2147483647, turns)),
    show(adds(1, 2147483647, turns)),
    show(takesAway(0, 2147483647, turns)),
    show(adds(2251799813685247, 2147483647, turns)),
    show(adds(4503599627370495, 2147483647, turns)),
    show(takesAway(-4503599627370495, 2147483647, turns)),
    show(adds(9007199254740000, 1, turns)),
    show(adds(0, 0.1, turns)),
  );
}

for (const count of steps) {
  const holder = new Holder(count, 2);
  const other = new Holder(1, count);
  console.log(
    show(count),
    show(addsAField(holder, twenty)),
    show(addsTwoFields(holder, other, twenty)),
    show(twoSums(count, 3, twenty)),
    show(twoSums(3, count, twenty)),
    show(countsAndAdds(count, twenty)),
  );
}
const nine = lengths[4];
console.log(
  show(addsAFieldOfAnything(new Holder("a", 0), nine)),
  show(addsAFieldOfAnything({ count: 2 }, nine)),
  show(addsAFieldOfAnything({ count: undefined }, nine)),
  show(addsAFieldOfAnything({}, nine)),
);
console.log(
  show(addsAnything(0, "a", nine)),
  show(addsAnything("a", 1, nine)),
  show(addsAnything(0, null, nine)),
  show(addsAnything(0, undefined, nine)),
  show(addsAnything(0, true, nine)),
  show(addsAnything(0n, 2n, nine)),
  show(addsAnything(0, 2, nine)),
);
console.log(show(addsAnything(0, { valueOf: () => 2 }, nine)), show(takesAnythingAway(0, "2", nine)), show(takesAnythingAway(0, [], nine)), show(takesAnythingAway(0, 2, nine)));
console.log(show(addsAHalfEveryTurn(hundred)), show(addsMinusZeroEveryTurn(-0, hundred)), show(addsMinusZeroEveryTurn(0, hundred)), show(addsAConstantBeyondThirtyTwoBits(hundred)));
console.log(show(sumIsLookedAtInTheLoop(3, hundred)), show(sumIsLookedAtInTheLoop(0.5, hundred)));
console.log(show(inAnotherLoop([1, 0.5, -0, 2147483647, 2147483648, 3], hundred)), show(inAnotherLoop([-0, -0], hundred)), show(inAnotherLoop([NaN, 1], hundred)));
