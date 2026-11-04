// A list is stored to near its start and read right behind the store, in a loop. The store may lengthen the list, take the place of storage that is shared with a literal,
// turn integers into doubles or doubles into anything, land on a list that takes no more elements, or meet a setter.
function ring(list, turns, make) {
  let sum = 0;
  for (let i = 0; i < turns; i++) {
    list[i & 7] = make(i);
    const old = list[(i + 3) & 7];
    sum += old === undefined ? 1000 : typeof old === "number" ? old : old.length;
  }
  return sum;
}
console.log("grows from nothing", ring([], 20, i => [i, i]), ring([], 3, i => i + 0.5));
console.log("full from the start", ring([[1], [2], [3], [4], [5], [6], [7], [8]], 20, i => [i, i, i]));

function literal() {
  return [1, 2, 3];
}
function intoALiteral(i, value) {
  const list = literal();
  list[i & 3] = value;
  return list[(i + 1) & 3] + "|" + list.length + "|" + list.join();
}
for (let i = 0; i < 6; i++) console.log("shared with a literal", intoALiteral(i, i * 10), literal().join());

function converts(list, values) {
  const seen = [];
  for (let i = 0; i < values.length; i++) {
    list[i & 3] = values[i];
    seen.push(list[(i + 1) & 3], list[i & 3]);
  }
  return JSON.stringify(seen) + " " + JSON.stringify(list);
}
console.log("integers, then a double", converts([1, 2, 3, 4], [5, 6.5, 7, 8]));
console.log("doubles, then a text", converts([1.5, 2.5, 3.5, 4.5], [5.5, "six", 7.5, null]));
console.log("doubles, then not a number", converts([1.5, 2.5, 3.5, 4.5], [NaN, 6.5, undefined, 8.5]));
console.log("integers, then an object", converts([1, 2, 3, 4], [{ a: 1 }, 6, [7], 8]));

function farOut(list, position, value) {
  list[1] = value;
  const first = list[0];
  list[position] = value;
  return [first, list[0], list[1], list[position], list.length].join();
}
for (const position of [2, 999, 1000, 1001, 100000, 4294967294, 4294967295])
  console.log("far out", position, farOut([1, 2], position, 9), farOut(["a", "b"], position, "z"));

function closed(list, how) {
  "use strict";
  how(list);
  const seen = [];
  for (let i = 0; i < 4; i++) {
    try {
      list[i & 3] = i + 10;
      seen.push(list[(i + 1) & 3]);
    } catch (error) {
      seen.push(error.constructor.name);
    }
  }
  return seen.join() + " " + list.join() + " " + list.length;
}
console.log("frozen", closed([1, 2], Object.freeze));
console.log("sealed", closed([1, 2], Object.seal));
console.log("takes no more", closed([1, 2], Object.preventExtensions));
console.log("length is fixed", closed([1, 2], list => Object.defineProperty(list, "length", { writable: false })));
console.log("an element is fixed", closed([1, 2], list => Object.defineProperty(list, 1, { value: 5, writable: false })));

function shrinksBetween(list) {
  const seen = [];
  for (let i = 0; i < 6; i++) {
    list[i & 3] = i;
    if (i === 2) list.length = 1;
    seen.push(list[(i + 3) & 3], list.length);
  }
  return seen.join();
}
console.log("shrinks between", shrinksBetween([9, 9, 9, 9]));

function lengthensWhileWalked(list) {
  const seen = [];
  for (const value of list) {
    if (seen.length < 4) list[(seen.length + 2) & 7] = value + 1;
    seen.push(value);
  }
  return seen.join() + " " + list.length;
}
console.log("lengthens while it is walked", lengthensWhileWalked([1, 2]), lengthensWhileWalked([0.5]), lengthensWhileWalked(["a", "b"]));

function lengthensWhileTakenApart(list) {
  const [a = (list[3] = 9), b = (list[2] = 8), c, d, e] = list;
  return [a, b, c, d, e, list.length].join();
}
console.log("lengthens while it is taken apart", lengthensWhileTakenApart([]), lengthensWhileTakenApart([1]), lengthensWhileTakenApart([undefined, 2]));

function lengthBehindAStore(list, i) {
  const before = list.length;
  list[i & 7] = i;
  return before + ">" + list.length;
}
console.log("the length behind a store", lengthBehindAStore([], 5), lengthBehindAStore([1, 2, 3], 1), lengthBehindAStore([1, 2, 3], 3));

class Rows extends Array {}
console.log("a class below Array", ring(new Rows(), 12, i => [i]), ring(Rows.from([[1], [2]]), 12, i => i));

const holes = [, , 3];
console.log("holes", ring(holes, 5, i => i), holes.join());

const log = [];
class Watched extends Array {}
console.log("before the setter", ring(new Watched(), 8, i => i));
Object.defineProperty(Watched.prototype, 5, {
  set(value) {
    log.push("set " + value);
  },
  get() {
    return "from the prototype";
  },
  configurable: true,
});
console.log("a setter on the prototype", ring(new Watched(), 8, i => i), ring(Watched.from([1.5, 2.5]), 8, i => i + 0.5), log.join());
console.log("a plain list beside it", ring([], 8, i => i), ring([1.5, 2.5], 8, i => i + 0.5));
delete Watched.prototype[5];
console.log("behind it", ring(new Watched(), 8, i => i), ring([], 8, i => i));
