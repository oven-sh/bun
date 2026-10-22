// The methods of Iterator.prototype that consume an iterator step it, run a callback, and call its `return` when they stop early: each line goes wrong if a read of a counter moves across the call.
let steps = 0;
let closes = 0;
let calls = 0;
class Numbers extends Iterator {
  next() {
    steps++;
    return { done: steps > 3, value: steps };
  }
  return() {
    closes++;
    return {};
  }
}
function measure(run) {
  steps = 0;
  closes = 0;
  calls = 0;
  const result = run(new Numbers());
  return [result, steps, closes, calls];
}
function some() {
  steps = 0;
  closes = 0;
  const found = new Numbers().some(value => value === 2);
  return [found, steps, closes];
}
function every() {
  steps = 0;
  closes = 0;
  const all = new Numbers().every(value => value < 2);
  return [all, steps, closes];
}
function find() {
  steps = 0;
  closes = 0;
  const found = new Numbers().find(value => value === 1);
  return [found, steps, closes];
}
function forEach() {
  steps = 0;
  calls = 0;
  new Numbers().forEach(() => {
    calls++;
  });
  return [steps, calls];
}
function reduce() {
  steps = 0;
  calls = 0;
  const sum = new Numbers().reduce((total, value) => {
    calls++;
    return total + value;
  }, 0);
  return [sum, steps, calls];
}
function toArray() {
  steps = 0;
  const values = new Numbers().toArray();
  return [values.length, steps];
}
function throwingCallback() {
  steps = 0;
  closes = 0;
  try {
    new Numbers().forEach(() => {
      throw new Error("stop");
    });
  } catch {}
  return [steps, closes];
}
function flatMap() {
  steps = 0;
  calls = 0;
  const helper = new Numbers().flatMap(value => {
    calls++;
    return [value, value];
  });
  helper.next();
  const afterOne = [steps, calls];
  helper.next();
  helper.next();
  return [afterOne, steps, calls];
}
console.log(some(), every(), find());
console.log(forEach(), reduce(), toArray());
console.log(throwingCallback(), flatMap());
console.log(measure(numbers => numbers.take(2).toArray().length), measure(numbers => numbers.drop(5).next().done));
