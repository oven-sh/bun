// STATISTIC: ArrayCallbacksRunByStubs >= 4
// map() to lengths of strings and arrays of which nothing is known, and searches of doubles for an equal number.

const one = Number("1");
let seen = 0;
class Derived extends Array {}
const parsed = list => JSON.parse(JSON.stringify(list));

// The functions are too large to be copied into the loop.
function lengths(list, turn) {
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
  return list.map(x => x.length);
}
function lengthsOfNames(list, turn) {
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
  return list.map(x => x.name.length);
}
function lengthsOfTags(list, turn) {
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
  return list.map(x => x.tags.length);
}
function placeOf(list, turn, value) {
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
  return list.findIndex(x => x === value);
}
function found(list, turn, value) {
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
  return list.find(x => x === value);
}

const text = x => (Object.is(x, -0) ? "-0" : String(x));
const show = answer => (Array.isArray(answer) ? answer.constructor.name + "[" + Array.from(answer, text).join(" ") + "]" : text(answer));
const values = parsed([]);
for (const list of [parsed(["a", "", "abc"]), [], ["n" + one, "ab" + "c".repeat(one * 30), "\u0660"], [[1, 2], [], new Derived(1, 2, 3), new Array(5), [,]], ["a", 5], ["a", null], ["a", { get length() { return ++seen; } }], [new String("ab"), x => x, new Uint8Array(3)], ["a", , "b"]]) values.push(list);
const named = parsed([]);
for (const list of [parsed(Array.from({ length: 12 }, (_, i) => ({ id: i, name: "n" + i, tags: Array(i % 4).fill(i) }))), [], [{ name: "n", tags: [1] }, { id: 1, tags: [], name: "nm" }], [{ name: "x", tags: "xy" }, { get name() { return "n" + ++seen; }, tags: [] }], [{ name: "abc" }, { tags: [] }], [Object.create({ name: "n1", tags: [1] })]]) named.push(list);
const doubles = parsed([]);
for (const list of [[0.5, 1.5, -0, 2], [1.5, , 0.5], parsed([0.1, 0.2, 2]), [], [0, 0.5], [NaN, 0.5], [0.5, Infinity]]) doubles.push(list);
const wanted = [0.5, -0, NaN, 2, "0.5", Infinity];
function ask() {
  const answers = [];
  for (let round = 0; round < 6; round++) {
    for (let place = 0; place < values.length; place++) {
      const list = values[place];
      if (round === 3 && place === 0) list.push("abz" + one);
      try {
        answers.push(show(lengths(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
    }
    for (let place = 0; place < named.length; place++) {
      const list = named[place];
      try {
        answers.push(show(lengthsOfNames(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(lengthsOfTags(list, round)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
    }
    for (let place = 0; place < doubles.length; place++) {
      const list = doubles[place];
      try {
        answers.push(show(placeOf(list, round, wanted[round])));
      } catch (error) {
        answers.push(error.constructor.name);
      }
      try {
        answers.push(show(found(list, round, wanted[round])));
      } catch (error) {
        answers.push(error.constructor.name);
      }
    }
    console.log(answers.splice(0).join(" "));
  }
}
ask();
console.log(seen);
