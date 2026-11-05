// `this` is not Array, so no row of the table describes the call: it enters the function of Bun's library with its own operands, and the class, the iterator of the program and the mapper all run.
class List {
  constructor() {
    console.log("made");
    this.length = 0;
  }
}
const items = {
  *[Symbol.iterator]() {
    yield 1;
    yield 2;
  },
};
const list = Array.from.call(List, items, x => x * 2);
console.log(list instanceof List, list.length, list[0], list[1]);
class Sub extends Array {}
console.log(Sub.from([1, 2]) instanceof Sub, Sub.from("ab").length);
