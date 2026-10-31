// `list.m()` in a loop, `list` an instance of a class below Array, Map, Set or Error. What the built-in class makes for `super()` is proven an instance of that class and no more.
// It is still expected to have the layout of its own class: that is tested once ahead of the loop, and behind the test the method needs no lookup.
// IR+ ^function f\d+ name="overList" .* parameters=\[\{type=L\d+ flags=\[IsExpected\]\}
// IR= 1 overList TypeTest v\d+ testedType=L\d+
// IR= 1 overTable TypeTest v\d+ testedType=L\d+
// IR= 1 overBag TypeTest v\d+ testedType=L\d+
// IR= 1 overFailure TypeTest v\d+ testedType=L\d+
class List extends Array {
  #p = 5;
  count = 1;
  m() {
    return this.#p + this.count;
  }
}
class Table extends Map {
  #p = 6;
  count = 2;
  m() {
    return this.#p + this.count;
  }
}
class Bag extends Set {
  #p = 7;
  count = 3;
  m() {
    return this.#p + this.count;
  }
}
class Failure extends Error {
  #p = 8;
  count = 4;
  m() {
    return this.#p + this.count;
  }
}
export function overList(list, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += list.m();
  return sum;
}
export function overTable(table, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += table.m();
  return sum;
}
export function overBag(bag, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += bag.m();
  return sum;
}
export function overFailure(failure, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += failure.m();
  return sum;
}
for (const each of [overList]) console.log(each(new List(), 1000));
for (const each of [overTable]) console.log(each(new Table(), 1000));
for (const each of [overBag]) console.log(each(new Bag(), 1000));
for (const each of [overFailure]) console.log(each(new Failure("failed"), 1000));
const list = new List();
list.push(1, 2);
const table = new Table();
table.set(1, 2);
const bag = new Bag();
bag.add(3);
console.log(list.length, list.m(), Array.isArray(list), list instanceof List, table.get(1), table.m(), bag.has(3), bag.m(), new Failure("why").message);
