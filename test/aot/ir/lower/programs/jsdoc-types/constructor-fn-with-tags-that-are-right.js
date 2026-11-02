// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: Named sumOf describe
// CHECK-LABEL: function {{*}}name="Named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v1 key="name"
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Data data=[[d_4]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="tags"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sumOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="named"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
