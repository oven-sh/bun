// The first object that keys fill is a dictionary. Once others have been filled likewise, it takes their structure, and nothing else about it changes.
const names = ["x", "y"];
function make(i, base) {
  const o = base || {};
  names.forEach((name, place) => {
    o[name] = i + place;
  });
  return o;
}
function sum(list, n) {
  let total = 0;
  for (let i = 0; i < n; i++) {
    const o = list[i % list.length];
    total = (total + o.x + o.y) | 0;
  }
  return total;
}
const describe = list => list.map(o => JSON.stringify(o) + Object.keys(o).join("") + Object.isExtensible(o)).join(" ");
const several = (change, behind, base = () => undefined) => {
  const list = [make(0, base())];
  if (!behind) change(list[0]);
  for (let i = 1; i < 5; i++) list.push(make(i, base()));
  const first = sum(list, 40);
  if (behind) change(list[0]);
  return first + " " + sum(list, 40) + " " + describe(list);
};

const changes = {
  nothing() {},
  name(o) {
    o.late = 1;
  },
  value(o) {
    o.x = 70;
  },
  deletion(o) {
    delete o.x;
    o.x = 5;
  },
  hidden(o) {
    Object.defineProperty(o, "x", { value: 9, enumerable: false, configurable: true, writable: true });
  },
  fixed(o) {
    Object.defineProperty(o, "y", { value: 9, writable: false });
  },
  getter(o) {
    Object.defineProperty(o, "x", { get: () => 77, enumerable: true, configurable: true });
  },
  frozen(o) {
    Object.freeze(o);
  },
  closed(o) {
    Object.preventExtensions(o);
  },
  parent(o) {
    Object.setPrototypeOf(o, { z: 3 });
  },
  child(o) {
    Object.create(o).own = 1;
  },
  element(o) {
    o[3] = 4;
  },
  symbol(o) {
    o[Symbol.iterator] = 5;
  },
};
let turn = 0;
for (const [label, change] of Object.entries(changes)) {
  for (const behind of [false, true]) {
    names.length = 2;
    names.push("n" + turn++);
    console.log(label, behind, several(change, behind), several(change, behind, () => ({ first: 1 })), several(change, behind, () => Object.create({ above: 1 })));
  }
}

names.length = 2;
const many = [];
for (let i = 0; i < 30; i++) names.push("many" + i);
for (let i = 0; i < 4; i++) many.push(make(i));
console.log(sum(many, 20), describe(many).length);
many[0].more = 1;
many[2].more = 2;
console.log(sum(many, 20), many.map(o => o.more).join());

const order = [];
for (const list of [["p", "q"], ["q", "p"], ["p", "q"], ["q", "p"]]) {
  const o = {};
  for (const name of list) o[name] = order.length;
  order.push(o);
}
let total = 0;
for (let i = 0; i < 40; i++) total += order[i & 3].p * 2 + order[i & 3].q;
console.log(total, order.map(o => Object.keys(o).join("")).join());
