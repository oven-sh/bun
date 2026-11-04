// RUN: lower
// OPTIONS: builtin-modules

console.log("strict: " + (/** @this {unknown} */ function () {
  return this === undefined;
})());

/** @typedef {{ x: number, y: number }} Point */

/**
 * @param {Point} p
 * @returns {number}
 */
function sum(p) {
  return p.x + p.y;
}

/**
 * @param {number} n
 * @returns {number}
 */
function plusOne(n) {
  return n + 1;
}
exports.plusOne = plusOne;

/** @type {number} */
exports.limit = 10;

class Pixel {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
exports.Pixel = Pixel;

const path = require("node:path");

/** @type {string} */
const separator = path.posix.sep;

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum({ x: i, y: 1 }) + plusOne(i) + exports.limit + sum(new exports.Pixel(i, 1)) + separator.length;
console.log("2000 rounds: " + warm);
console.log(Object.keys(exports).join(), typeof module.exports.plusOne, module.exports === exports, sum(new Pixel(1, 2)));

// GENERATED: sum plusOne Pixel
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Pixel"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: number):
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]]}
// CHECK-NEXT: PropSet v5, v1 key="x"
// CHECK-NEXT: PropSet v5, v2 key="y"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b1(| 0), notTaken b2(v5)
// CHECK-NEXT: b1(v10):
// CHECK-NEXT: Jump -> next b2(v10)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
