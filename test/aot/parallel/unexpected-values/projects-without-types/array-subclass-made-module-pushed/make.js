class Counting extends Array {
  push(value) {
    return 42;
  }
}

class Doubling extends Array {
  push(value) {
    super.push(value);
    return super.push(value);
  }
  filter() {
    return "filtered";
  }
  get length() {
    return 2;
  }
  set length(value) {}
}

class Backwards extends Array {
  *[Symbol.iterator]() {
    for (let i = this.length - 1; i >= 0; i--) yield this[i];
  }
  sort() {
    return this;
  }
  static get [Symbol.species]() {
    return Array;
  }
}

export const makers = {
  honest: () => [3, 1, 2],
  counting: () => Counting.from([3, 1, 2]),
  doubling: () => Doubling.of(3, 1, 2),
  backwards: () => Backwards.from([3, 1, 2]),
  arrayLike: () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  borrowing: () => ({ 0: 3, 1: 1, 2: 2, length: 3, push: Array.prototype.push, sort: Array.prototype.sort, filter: Array.prototype.filter, [Symbol.iterator]: Array.prototype.values }),
  shadowed: () => Object.assign([3, 1, 2], { push: () => "own push", filter: () => "own filter" }),
  proxied: () => new Proxy([3, 1, 2], {}),
  orphan: () => Object.setPrototypeOf([3, 1, 2], null),
  frozen: () => Object.freeze([3, 1, 2]),
  typed: () => new Int8Array([3, 1, 2]),
  text: () => "312",
  holes: () => [3, , 2],
};
