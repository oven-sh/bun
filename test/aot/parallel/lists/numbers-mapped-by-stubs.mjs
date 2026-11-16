// STATISTIC: ArrayCallbacksRunByStubs >= 5
// map() of arrays of which nothing is known, with a callback that adds a number to an element or a field, or multiplies by it.

const parsed = list => JSON.parse(JSON.stringify(list));
let seen = 0;
class Derived extends Array {}

// The functions are too large to be copied into the loop.
function addOne(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => x + 1);
}
function addBound(list, turn, bound) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => bound + x);
}
function double(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => x * 2);
}
function halve(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => x * 0.5);
}
function negate(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => x * -1);
}
function subtract(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => x - 3);
}
function agesDoubled(list, turn) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => x.age * 2);
}
function agesAdded(list, turn, bound) {
  if (turn < -1) {
    console.log("never 0", turn * 2, turn - 0, turn % 3);
    console.log("never 1", turn * 3, turn - 1, turn % 4);
    console.log("never 2", turn * 4, turn - 2, turn % 5);
    console.log("never 3", turn * 5, turn - 3, turn % 6);
    console.log("never 4", turn * 6, turn - 4, turn % 7);
    console.log("never 5", turn * 7, turn - 5, turn % 8);
    console.log("never 6", turn * 8, turn - 6, turn % 9);
    console.log("never 7", turn * 9, turn - 7, turn % 10);
    console.log("never 8", turn * 10, turn - 8, turn % 11);
    console.log("never 9", turn * 11, turn - 9, turn % 12);
    console.log("never 10", turn * 12, turn - 10, turn % 13);
    console.log("never 11", turn * 13, turn - 11, turn % 14);
  }
  return list.map(x => x.age + bound);
}

function show(list) {
  if (!Array.isArray(list)) return String(list);
  return list.constructor.name + "[" + Array.from({ length: list.length }, (_, i) => (!(i in list) ? "hole" : Object.is(list[i], -0) ? "-0" : typeof list[i] === "string" ? JSON.stringify(list[i]) : String(list[i]))).join(" ") + "]";
}

const numbers = parsed([]);
for (const list of [[1, 2, 3], [], [0, -1, 2147483647], [0.5, 1.25, -2], [1, 2.5, 3], ["a", 1], [1, "b", 3], [1, undefined, null], [-2147483648, 5], [1073741824, 1], [0, -0, 0], [1, NaN, Infinity], [5n, 6n], [1, , 3], [1, { valueOf() { seen++; return 4; } }, 2], parsed([7, 8, 9]), parsed([0.1, 0.2])]) numbers.push(list);
const people = parsed([]);
for (const list of [parsed([{ age: 1 }, { age: 2 }]), parsed([{ age: 1.5 }, { name: "n", age: 2 }]), [], parsed([{ age: "x" }, { age: 1 }]), parsed([{ age: 1 }, null]), [{ age: 1 }, { get age() { return ++seen; } }], [{ age: -0 }, { age: 2147483647 }], [Object.create({ age: 3 }), { age: 4 }]]) people.push(list);
const changes = [() => {}, list => list.push(2.5), list => Object.setPrototypeOf(list, Derived.prototype), list => Object.freeze(list), list => (list.map = () => "own"), list => (list.length = 1)];
function askAll() {
  const answers = [];
  for (let round = 0; round < 6; round++) {
    for (let place = 0; place < numbers.length; place++) {
      const list = numbers[place];
      if (round === 3) changes[place % changes.length](list);
      try {
        answers.push(show(addOne(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(addBound(list, round, round - 2)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(double(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(halve(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(negate(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(subtract(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      console.log(answers.splice(0).join(" "));
    }
    for (let place = 0; place < people.length; place++) {
      const list = people[place];
      try {
        answers.push(show(agesDoubled(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(agesAdded(list, round, round === 4 ? "s" : round / 2)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      console.log(answers.splice(0).join(" "));
    }
  }
}
askAll();
console.log(seen);
