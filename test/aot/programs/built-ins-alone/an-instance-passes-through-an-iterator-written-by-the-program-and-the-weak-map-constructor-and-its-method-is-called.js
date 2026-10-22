class Item {
  constructor(size) {
    this.size = size;
  }
  double() {
    return this.size * 2;
  }
}
function once(value) {
  return {
    [Symbol.iterator]() {
      let done = false;
      return {
        next() {
          if (done) return { done: true, value: undefined };
          done = true;
          return { done: false, value };
        },
      };
    },
  };
}
console.log(new WeakMap(once([once, new Item(1.5)])).get(once).double());
