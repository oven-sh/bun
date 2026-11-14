// STATISTIC: ArrayCallbacksRunByStubs >= 6
// map() and reduce() with callbacks that add, subtract or multiply two fields of an element of which nothing is known.

const one = Number("1");
let seen = 0;
const parsed = list => JSON.parse(JSON.stringify(list));
// Nothing is known of what comes back.
const hidden = value => JSON.parse("0", () => value);

// The functions are too large to be copied into the loop.
function sums(list, turn) {
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
  return list.map(x => x.age + x.id);
}
function differences(list, turn) {
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
  const made = list.map(x => x.age - x.id);
  return made;
}
function products(list, turn) {
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
  return list.map(x => x.age * x.id);
}
function total(list, start, turn) {
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
  const products = list.reduce((s, x) => s + x.age * x.id, start);
  const sums = list.reduce((s, x) => s + (x.age + x.id), start);
  const differences = list.reduce((s, x) => s + (x.age - x.id), start);
  return [products, sums, differences];
}

const text = value => Object.is(value, -0) ? "-0" : typeof value === "string" ? JSON.stringify(value) : Array.isArray(value) ? "[" + value.map(text) + "]" : String(value);
class Person { constructor(age, id) { this.name = "p" + age; this.age = age; this.id = id; } }
const records = (ages, ids) => ages.map((age, i) => ({ id: ids[i], name: "n" + i, age }));
const lists = [
  ["integers", parsed(records([4, 8, -3, 0, 70000], [1, 2, 3, -4, 70000]))],
  ["fractions", parsed(records([4.5, 8, -3], [1, 2, 0.25]))],
  ["late fraction", parsed(records([4, 8, 0.5], [1, 2, 3]))],
  ["zeros", records([0, -0, 0, 5], [-5, 3, 0, -0])],
  ["past integers", records([2147483647, 1, -2147483648], [1, 2147483647, 2])],
  ["wide", parsed(records([4, 8, 9], [1, 2, 3])).map(x => Object.assign({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 }, x))],
  ["instances", [new Person(3, 4), new Person(5, 6)]],
  ["two shapes", [new Person(3, 4), { id: 7, age: 8 }, { age: 1, id: 2 }, new Person(9, 1)]],
  ["strings", records(["a", "b"], [1, 2])],
  ["a string behind", records([1, 2, "c"], [1, 2, 3])],
  ["no field", [{ id: 1, age: 2 }, { id: 3 }]],
  ["a getter", [{ id: 1, age: 2 }, { id: 3, get age() { seen++; return 5; } }]],
  ["inherited", [{ id: 1, age: 2 }, Object.create({ id: 3, age: 5 })]],
  ["not a number", records([NaN, 1], [1, NaN])],
  ["no objects", [{ id: 1, age: 2 }, 5, "text"]],
  ["a hole", [{ id: 1, age: 2 }, , { id: 3, age: 4 }]],
  ["a proxy", [{ id: 1, age: 2 }, new Proxy({ id: 3, age: 4 }, { get(o, key) { seen++; return o[key]; } })]],
  ["empty", []],
];
for (const [name, shown] of lists) {
  const list = hidden(shown);
  for (let turn = 0; turn < 3; turn++) {
    let made;
    try { made = text(sums(list, turn)); } catch (e) { made = e.constructor.name; }
    if (turn === 2) console.log(name, "sums", made);
    try { made = text(differences(list, turn)); } catch (e) { made = e.constructor.name; }
    if (turn === 2) console.log(name, "differences", made);
    try { made = text(products(list, turn)); } catch (e) { made = e.constructor.name; }
    if (turn === 2) console.log(name, "products", made);
    for (const start of [0, 0.5, -0, "s", 9007199254740990, one]) {
      let result;
      try { result = text(total(list, start, turn)); } catch (e) { result = e.constructor.name; }
      if (turn === 2) console.log(name, start, result);
    }
  }
}
console.log(seen);
