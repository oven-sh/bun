function follow(list, index) {
  list[index] = index;
  index = list[index + 1];
  list[index] = index;
  index = list[index + 1];
  list[index] = index;
  return list[index + 1];
}

function chain(length) {
  const list = [];
  for (let i = 0; i < length; i++) list.push((i * 5 + 1) & 7);
  return list;
}

for (let start = 0; start < 8; start++) {
  const list = chain(16);
  console.log("follow", start, follow(list, start), list.join());
}

function storeAtTheEnd(list, value) {
  list[list.length] = value;
  const first = list.length;
  list[list.length] = value + 1;
  const second = list.length;
  list[list.length] = value + 2;
  return first * 10000 + second * 100 + list.length;
}

for (let length = 0; length < 12; length++) {
  const list = chain(length);
  console.log("storeAtTheEnd", length, storeAtTheEnd(list, 40), list.join());
}

function pushFour(list, value) {
  list.push(value);
  list.push(value);
  const between = list.length;
  list.push(value + 1);
  list.push(value + 2);
  return between * 100 + list.length;
}

for (let length = 0; length < 12; length++) {
  const list = chain(length);
  console.log("pushFour", length, pushFour(list, 7), list.join());
}

function grown(turns) {
  const list = [];
  let sum = 0;
  for (let i = 0; i < turns; i++) sum += pushFour(list, i);
  for (let i = 0; i < list.length; i += 97) sum += list[i];
  return sum + list.length;
}
console.log("grown", grown(5000));

function pushOtherKinds(list, a, b, c) {
  list.push(a);
  const first = list[list.length - 1];
  list.push(b);
  const second = list[list.length - 1];
  list.push(c);
  return [first, second, list[list.length - 1], list.length].join();
}
console.log("kinds", pushOtherKinds([1, 2], 3, 4.5, 6));
console.log("kinds", pushOtherKinds([1, 2], 3.5, 4, "five"));
console.log("kinds", pushOtherKinds([1.5], NaN, 2, 3));
console.log("kinds", pushOtherKinds([], {}.missing, 2, 3));
console.log("kinds", pushOtherKinds(["a"], 1, 2, 3));

function storeFarAway(list, index) {
  list[0] = 1;
  const before = list.length;
  list[index] = 2;
  const after = list.length;
  list[1] = 3;
  return [before, after, list.length, list[0], list[1], list[index], list[index - 1]].join();
}
console.log("far", storeFarAway([9, 9, 9], 2));
console.log("far", storeFarAway([9, 9, 9], 3));
console.log("far", storeFarAway([9, 9, 9], 40));
console.log("far", storeFarAway([9, 9, 9], 200000));

function twoLists(a, b, value) {
  a.push(value);
  b.push(value + 1);
  a.push(value + 2);
  b.push(value + 3);
  return a.length * 100 + b.length;
}
{
  const a = chain(3), b = chain(4);
  console.log("two", twoLists(a, b, 1), a.join(), b.join());
  console.log("same", twoLists(a, a, 5), a.join());
}

class Ring {
  items = [];
  count = 0;
  add(value) {
    this.items.push(value);
    this.count = this.items.length;
    this.items.push(value * 2);
    return this.count + this.items.length;
  }
  replace() {
    this.items.push(1);
    this.items = [this.items.length];
    this.items.push(2);
    return this.items.join();
  }
}
{
  const ring = new Ring();
  let sum = 0;
  for (let i = 0; i < 40; i++) sum += ring.add(i);
  console.log("ring", sum, ring.count, ring.items.length, ring.replace(), ring.replace());
}

function shortened(list) {
  list.push(1);
  list.length = 1;
  list.push(2);
  const middle = list.length;
  list.length = 0;
  list.push(3);
  return middle * 10 + list.length + ":" + list.join();
}
console.log("shortened", shortened([5, 6, 7]), shortened([]));

function frozenBetween(list, freeze) {
  list.push(1);
  if (freeze) Object.freeze(list);
  try {
    list.push(2);
  } catch (error) {
    return error.constructor.name + list.length;
  }
  return "pushed" + list.length;
}
console.log("frozen", frozenBetween([], false), frozenBetween([], true), frozenBetween([0], true));
