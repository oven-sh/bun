/** @type {number} */
let count = 0;

/** @type {string} */
const name = "counter";

/** @type {number[]} */
const sizes = [1, 2, 3];

/** @type {{ x: number, y: number }} */
const origin = { x: 1, y: 2 };

/** @type {Map<string, number>} */
const byName = new Map();

/** @type {(n: number) => number} */
const double = n => n * 2;

/**
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function add(a, b) {
  return a + b;
}

/**
 * @param {{ x: number, y: number }} p
 * @returns {number}
 */
function sum(p) {
  return p.x + p.y;
}

/**
 * @param {number[]} list
 * @returns {number}
 */
function total(list) {
  let result = 0;
  for (const n of list) result += n;
  return result;
}

/**
 * @param {string} text
 * @return {number}
 */
const size = text => text.length;

class Counter {
  /** @type {number} */
  n = 0;

  /** @type {string[]} */
  log = [];

  /** @param {number} start */
  constructor(start) {
    this.n = start;
    /** @type {number} */
    this.step = 1;
  }

  /**
   * @param {number} by
   * @returns {number}
   */
  add(by) {
    this.n += by * this.step;
    return this.n;
  }

  /** @returns {number} */
  get twice() {
    return this.n * 2;
  }

  /** @param {number} value */
  set twice(value) {
    this.n = value / 2;
  }

  /**
   * @param {number} n
   * @returns {Counter}
   */
  static from(n) {
    return new Counter(n);
  }
}

for (let i = 0; i < 2000; i++) {
  count = add(count, i % 3);
  count += sum(origin) + total(sizes) + double(i % 2) + size(name);
  byName.set("k" + (i % 4), count);
}
console.log("count: " + count);
console.log("map: " + [...byName].join(" "));

const counter = Counter.from(1);
for (let i = 0; i < 2000; i++) counter.add(i % 2);
counter.twice = counter.twice + 2;
console.log("counter: " + counter.n + " " + counter.twice + " " + counter.step + " " + JSON.stringify(counter));
console.log("kinds: " + [typeof count, typeof name, typeof double, typeof counter.n, Array.isArray(sizes)].join(" "));

export {};
