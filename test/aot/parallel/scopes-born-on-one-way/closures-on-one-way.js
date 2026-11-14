// A scope that only the closure of one way holds is born there, with what its variables hold by then; the stores of the other ways are gone.
class List {
  size;
  origin;
  tail = [];
  grown = [];
  constructor(size, origin) {
    this.size = size;
    this.origin = origin;
  }
  withMutations(change) {
    change(this);
    return this;
  }
}
function wrap(list, index) {
  if (typeof index !== "number") index = index >>> 0;
  return index < 0 ? list.size + index : index;
}
// immutable's updateList()
function update(list, index, value) {
  index = wrap(list, index);
  if (index !== index) return list;
  if (index >= list.size || index < 0)
    return list.withMutations(function (held) {
      index < 0 ? held.grown.push("below", index, value) : held.grown.push("above", index + 1, value);
    });
  index += list.origin;
  list.tail[index] = value;
  return list;
}
function late(list, key, seen) {
  let count = 0;
  if (key === undefined) return null;
  count += key.length;
  if (count > 3) {
    count *= 2;
    const ask = () => [key, count, seen];
    count++;
    seen = "later";
    return ask;
  }
  count -= 1;
  key = key + count;
  seen = key;
  return () => seen;
}
function inLoop(values, limit) {
  const asks = [];
  let total = 0;
  for (const value of values) {
    let step = value;
    if (step > limit) {
      step++;
      asks.push(() => (step += 1));
      continue;
    }
    step *= 2;
    total += step;
  }
  return [total, asks.map(ask => ask() + ask())];
}
function throwing(value, deep) {
  let state = "begun";
  try {
    if (value === 3) throw { get: () => state };
    state = "past" + value;
    if (deep) throwing(value - 1, deep - 1);
  } catch (error) {
    state += "|caught";
    return error.get() + state;
  } finally {
    state = "ended";
  }
  return state;
}
function twice(value) {
  let held = value;
  if (value % 3 === 0) return () => held++;
  held += 1;
  if (value % 3 === 1) return () => held--;
  held += 10;
  return held;
}
function* steps(value) {
  let held = value;
  if (value > 1) yield () => held;
  held += 5;
  yield held;
}
let list = new List(20, 2);
const answers = [];
for (let turn = 0; turn < 60; turn++) {
  list = update(list, turn - 5, turn);
  list = update(list, String(turn), turn);
  update(list, NaN, 0);
  const ask = late(list, "k".repeat(turn % 6), turn);
  if (turn > 56) answers.push(String(ask?.()), String(late(list)));
  const found = twice(turn);
  if (turn > 54) answers.push(typeof found === "function" ? [found(), found(), found()].join() : found);
  if (turn > 57) answers.push(...[...steps(turn % 3)].map(step => (typeof step === "function" ? step() : step)));
}
console.log(list.grown.join(), list.tail.join());
console.log(answers.join(" "));
console.log(JSON.stringify(inLoop([1, 5, 2, 9, 3, 12], 4)), JSON.stringify(inLoop([1, 2], 4)));
console.log([0, 1, 2, 3, 4, 5].map(value => throwing(value, 2)).join());
