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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v0 key="y"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Add v2, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = Add v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Pixel"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number flags=[IsExpected]}, {type=number flags=[IsExpected]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v7 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v6, v7 key="x"
// CHECK-NEXT: v9 = Convert v5 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v9, v10 key="y"
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: v13 = TypeTest v12 testedType=object
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: Jump -> next b4(v14)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
