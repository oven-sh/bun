// `list.count` in a loop, `list` one instance of a class below a built-in class for all the turns: the field is read by name, once, ahead of the loop. Whatever changes what the read finds is still seen in the turn in which it happens.
class List extends Array {
  count = 1;
  step = 2;
  total() {
    return this.count + this.step;
  }
}
class Table extends Map {
  count = 3;
  total() {
    return this.count;
  }
}
class Bag extends Set {
  count = 4;
  total() {
    return this.count;
  }
}
class Failure extends Error {
  count = 5;
  total() {
    return this.count;
  }
}
class Pledge extends Promise {
  count = 6;
  total() {
    return this.count;
  }
}
class Moment extends Date {
  count = 7;
  total() {
    return this.count;
  }
}
class Bytes extends Uint8Array {
  count = 8;
  total() {
    return this.count;
  }
}
function quiet(object, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += object.total();
  return sum;
}
function storesInTheLoop(object, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.total();
    if (i % 7 === 3) object.count = i;
  }
  return sum;
}
function changedByACall(object, turns, change) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    sum += object.count;
    if (i === 40) change(object);
  }
  return sum;
}
function readsDirectly(object, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += object.count;
  return sum;
}
const makers = [() => new List(), () => new Table(), () => new Bag(), () => new Failure("lost"), () => new Pledge(() => {}), () => new Moment(0), () => new Bytes(2)];
for (const make of makers) {
  console.log(make().constructor.name, quiet(make(), 100), storesInTheLoop(make(), 100), readsDirectly(make(), 100));
  console.log(changedByACall(make(), 100, object => { object.count = 100; }));
  console.log(changedByACall(make(), 100, object => { delete object.count; }));
  let reads = 0;
  console.log(changedByACall(make(), 100, object => { Object.defineProperty(object, "count", { get() { return ++reads; }, configurable: true }); }), reads);
  console.log(changedByACall(make(), 100, object => { delete object.count; Object.setPrototypeOf(object, { count: 9 }); }));
  const withGetter = make();
  let asked = 0;
  Object.defineProperty(withGetter, "count", { get() { return ++asked; } });
  console.log(readsDirectly(withGetter, 100), asked, quiet(withGetter, 10), asked);
  const without = make();
  delete without.count;
  console.log(readsDirectly(without, 3), quiet(make() instanceof Bytes ? make() : Object.freeze(make()), 50));
  const inherits = make();
  delete inherits.count;
  Object.getPrototypeOf(inherits).count = 11;
  console.log(readsDirectly(inherits, 100));
  delete Object.getPrototypeOf(inherits).count;
  const trapped = make();
  delete trapped.count;
  let traps = 0;
  Object.setPrototypeOf(trapped, new Proxy({}, { get(target, key) { traps++; return key === "count" ? 2 : undefined; } }));
  console.log(readsDirectly(trapped, 100), traps);
}
const plainMap = new Map();
plainMap.count = 12;
const plainArray = [1, 2, 3];
plainArray.count = 13;
console.log(readsDirectly(plainMap, 100), readsDirectly(plainArray, 100), readsDirectly({ count: 14 }, 100), readsDirectly(Object.assign(() => {}, { count: 15 }), 100));
function lengths(object, turns) {
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += object.length + object[0];
  return sum;
}
const listed = new List();
listed.push(5, 6);
console.log(lengths(listed, 100), lengths(new Bytes(3), 100));
