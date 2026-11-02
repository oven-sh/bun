// A loop adds the same integer in every turn, and the sum is read behind the loop. What it adds is read once in front of the loop.
class Payload {
  constructor(count) {
    this.count = count;
  }
}
class Item {
  constructor() {
    this.value = 0;
    this.count = 1;
  }
}

function adds(item, payload, start, turns) {
  let sum = start;
  for (let i = 0; i < turns; i++) {
    item.value = i & 7;
    sum += payload.count;
  }
  return sum;
}

function takesAway(item, payload, start, turns) {
  let sum = start;
  for (let i = 0; i < turns; i++) {
    item.value = i & 7;
    sum -= payload.count;
  }
  return sum;
}

function addsAnIntegerFromAParameter(start, step, turns) {
  const integer = step | 0;
  const count = turns | 0;
  let sum = start;
  for (let i = 0; i < count; i++) sum += integer;
  return sum;
}

function twoSums(first, second, turns) {
  const a = first | 0;
  const b = second | 0;
  let up = 0.5;
  let down = 0;
  for (let i = 0; i < turns; i++) {
    up += a;
    down -= b;
  }
  return [up, down];
}

function sumIsLookedAtInTheLoop(step, turns) {
  const integer = step | 0;
  let sum = 0;
  let seen = 0;
  for (let i = 0; i < turns; i++) {
    sum += integer;
    if (sum > 40) seen++;
  }
  return [sum, seen];
}

function storeChangesWhatIsAdded(item, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    item.count = i;
    sum += item.count;
  }
  return sum;
}

function storesAnyValue(cell, payload, start, turns) {
  let sum = start;
  for (let i = 0; i < turns; i++) {
    cell.value = i & 1 ? "odd" : i;
    sum += payload.count;
  }
  return sum;
}

function lastOfFirstLoopIsAddedInSecond(list, turns) {
  let last = 0;
  let fractions = 0.5;
  let i = 0;
  do {
    last = list[i] | 0;
    fractions += last;
    i++;
  } while (i < list.length);
  let sum = 0;
  for (let j = 0; j < turns; j++) sum += last;
  return [sum, fractions];
}

function lastOfFirstLoopIsTakenAwayInSecond(list, turns) {
  let last = 0;
  let total = 0;
  let i = 0;
  do {
    last = list[i] & 1023;
    total += last;
    i++;
  } while (i < list.length);
  let sum = 0;
  for (let j = 0; j < turns; j++) sum -= last;
  return [sum, total];
}

function show(value) {
  return Object.is(value, -0) ? "-0" : String(value);
}

const item = new Item();
const greatest = 2147483647;
const answers = [];
// Whole numbers, in few turns and in more turns than run without a poll.
for (const turns of [0, 1, 7, 8, 9, 16, 1000, 3000000]) {
  answers.push(show(adds(item, new Payload(3), 0, turns)));
  answers.push(show(takesAway(item, new Payload(3), 0, turns)));
  answers.push(show(addsAnIntegerFromAParameter(0, -5, turns)));
}
// The value of the store is what the last turn left.
answers.push(item.value);
// The sum goes past 2^53, where adding doubles rounds.
answers.push(show(adds(item, new Payload(greatest), 0, 4400000)));
answers.push(show(takesAway(item, new Payload(greatest), 0, 4400000)));
answers.push(show(adds(item, new Payload(3), 2 ** 53 - 20, 100)));
answers.push(show(adds(item, new Payload(1), 2 ** 53, 100)));
answers.push(show(adds(item, new Payload(greatest), 2 ** 51 - 1, 2000000)));
answers.push(show(addsAnIntegerFromAParameter(2 ** 52 + 1, greatest, 3000000)));
// Starts that are no whole number below 2^51.
answers.push(show(adds(item, new Payload(3), 0.25, 100)));
answers.push(show(adds(item, new Payload(3), NaN, 100)));
answers.push(show(adds(item, new Payload(3), Infinity, 100)));
answers.push(show(adds(item, new Payload(3), 2 ** 60, 100)));
answers.push(show(addsAnIntegerFromAParameter(1e308, greatest, 100)));
// -0 stays -0 where only 0 is taken away, and is 0 where 0 is added.
answers.push(show(adds(item, new Payload(0), -0, 100)));
answers.push(show(takesAway(item, new Payload(0), -0, 100)));
answers.push(show(takesAway(item, new Payload(0), 0, 100)));
answers.push(show(takesAway(item, new Payload(5), 500, 100)));
answers.push(show(addsAnIntegerFromAParameter(-0, 0, 100)));
answers.push(show(addsAnIntegerFromAParameter(-0, 0, 0)));
// What is added is no integer, or no number.
answers.push(show(adds(item, new Payload(0.5), 0, 100)));
answers.push(show(adds(item, new Payload(undefined), 0, 100)));
answers.push(show(adds(item, new Payload(2 ** 40), 0, 100)));
answers.push(show(adds(item, new Payload("1"), 0, 3)));
answers.push(show(takesAway(item, new Payload("1"), 0, 3)));
// A store of a value of any type, into an object made by name.
const names = ["value"];
const cell = Object.create(null);
for (const name of names) cell[name] = 0;
for (const turns of [0, 7, 8, 9, 1000, 3000000]) answers.push(show(storesAnyValue(cell, new Payload(3), 0, turns)), cell.value);
answers.push(show(storesAnyValue(cell, new Payload(greatest), 0, 4400000)), cell.value);
answers.push(show(storesAnyValue(cell, new Payload(0.5), 0, 9)), cell.value);
answers.push(show(storesAnyValue(new Item(), new Payload(2), 1, 9)));
// More than one sum, a sum that is looked at, and a store to what is read.
answers.push(twoSums(3, 4, 1000).map(show).join());
answers.push(twoSums(greatest, greatest, 5000000).map(show).join());
answers.push(sumIsLookedAtInTheLoop(3, 100).map(show).join());
answers.push(show(storeChangesWhatIsAdded(item, 100)));
// What is added comes out of a loop in front that is written out as well.
const integers = new Int32Array(1000);
const numbers = [];
for (let i = 0; i < integers.length; i++) {
  integers[i] = i * 7;
  numbers.push(i * 3);
}
for (const turns of [0, 1, 7, 8, 9, 100, 5000]) {
  for (const list of [integers, numbers]) {
    answers.push(lastOfFirstLoopIsAddedInSecond(list, turns).map(show).join());
    answers.push(lastOfFirstLoopIsTakenAwayInSecond(list, turns).map(show).join());
  }
}
console.log(answers.join("\n"));
