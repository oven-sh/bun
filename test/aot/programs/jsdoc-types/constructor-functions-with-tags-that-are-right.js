/**
 * @constructor
 * @param {number} x
 * @param {number} y
 */
function Point(x, y) {
  /** @type {number} */
  this.x = x;
  /** @type {number} */
  this.y = y;
}

/** @returns {number} */
Point.prototype.sum = function () {
  return this.x + this.y;
};

/**
 * @param {Point} other
 * @returns {Point}
 */
Point.prototype.plus = function (other) {
  return new Point(this.x + other.x, this.y + other.y);
};

/** @type {number} */
Point.made = 0;

/**
 * @param {number} n
 * @returns {Point}
 */
Point.diagonal = function (n) {
  Point.made++;
  return new Point(n, n);
};

/**
 * @class
 * @param {string} name
 */
function Named(name) {
  this.name = name;
  /** @type {string[]} */
  this.tags = [];
}

Named.prototype = {
  /** @returns {string} */
  describe() {
    return "named";
  },
};

/** @param {number} start */
function Counter(start) {
  this.n = start;
}
Counter.prototype.next = function () {
  return ++this.n;
};

/**
 * @param {Point} p
 * @returns {number}
 */
function sumOf(p) {
  return p.x + p.y;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += new Point(i, 1).sum() + sumOf(Point.diagonal(i)) + new Point(i, 1).plus(new Point(1, 1)).x + new Counter(i).next();
console.log("2000 rounds: " + warm);

const p = new Point(1, 2);
console.log(p.sum(), sumOf(p), p instanceof Point, Object.keys(p).join(), JSON.stringify(p.plus(p)), Point.made, p.constructor === Point);
const named = new Named("n");
named.tags.push("t");
console.log(named.name, named.tags.join(), named.describe(), named instanceof Named, named.constructor === Object);
const counter = new Counter(5);
console.log(counter.next(), counter.next(), counter.n, Object.keys(counter).join());

export {};
