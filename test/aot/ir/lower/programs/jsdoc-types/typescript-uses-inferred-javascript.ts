// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 1
// STATISTIC: SourceFilesInferred = 4

// FILE: main.ts
// Typescript uses what is inferred from javascript files.
import Main = require("./assigned.cjs");
import type { Row } from "./common.cjs";
import { defined, fn, Klass, named, viaModule } from "./common.cjs";
import type { Both, Point, Reducer, User } from "./esm.js";
import { add, Box, expando, frozen, open, property, shifted, table, twice } from "./esm.js";
import { one, three, two } from "./object.cjs";

const point: Point = { x: 1, y: 2 };
const user: User = { id: 1 };
const reducer: Reducer = (total, p) => total + p.x;
const both: Both<number> = { one: 1, many: [1, 2] };
const row: Row = { id: 1 };
const box: Box<number> = new Box(1);
box.init();
const late: number | undefined = box.late;
const n: number = twice(2);
const s: string = twice("a");

console.log(point.x, user.id, reducer(1, point), both.many.length, row.id, box.get() + 1, late, n, s);
console.log(shifted.call(point, 1), add(1), add(1, 2), add(1, 2, 3, 4));
console.log(expando() + expando.version, expando.nested.deep, open.a + 1, open.b.length, frozen.low + frozen.high, table.a, property.wide, property.method(1));
console.log(named + 1, fn(1), defined.length, viaModule.length, new Klass().k + 1, new Main().m + 1, one() + 1, two.length, three[0] + 1);

// FILE: assigned.cjs
class Main {
  constructor() {
    this.m = 1;
  }
}
module.exports = Main;

// FILE: common.cjs
/** @typedef {{ id: number }} Row */

exports.named = 1;
exports.fn = function (/** @type {number} */ n) {
  return n + 1;
};
Object.defineProperty(exports, "defined", { value: "defined", enumerable: true });
module.exports.viaModule = "m";
exports.Klass = class Klass {
  constructor() {
    this.k = 1;
  }
};

// FILE: esm.js
/** @typedef {{ x: number, y: number }} Point */

/**
 * @typedef {object} User
 * @property {number} id
 * @property {string} [name]
 */

/**
 * @callback Reducer
 * @param {number} total
 * @param {Point} p
 * @returns {number}
 */

/**
 * @template T
 * @typedef {{ one: T, many: T[] }} Both
 */

/**
 * @template T
 */
export class Box {
  /** @param {T} content */
  constructor(content) {
    /** @type {T} */
    this.content = content;
  }
  /** @returns {T} */
  get() {
    return this.content;
  }
  init() {
    this.late = 1;
  }
}

/**
 * @overload
 * @param {number} v
 * @returns {number}
 */
/**
 * @overload
 * @param {string} v
 * @returns {string}
 */
/**
 * @param {number | string} v
 * @returns {number | string}
 */
export function twice(v) {
  return typeof v === "number" ? v * 2 : v + v;
}

/**
 * @this {Point}
 * @param {number} n
 * @returns {number}
 */
export function shifted(n) {
  return this.x + this.y + n;
}

/**
 * @param {number} a
 * @param {number} [b]
 * @param {...number} rest
 * @returns {number}
 */
export function add(a, b, ...rest) {
  return a + (b ?? 0) + rest.length;
}

export function expando() {
  return 1;
}
expando.version = 2;
expando.nested = { deep: "d" };

export const open = {};
open.a = 1;
open.b = "two";

export const frozen = Object.freeze({ low: 1, high: 2 });

/** @type {Readonly<Record<string, number>>} */
export const table = { a: 1 };

export const property = {
  /** @type {number | string} */
  wide: 1,
  /** @param {number} n */
  method(n) {
    return n + 1;
  },
};

// FILE: object.cjs
function one() {
  return 1;
}
const two = "two";
module.exports = { one, two, three: [3] };

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": false }, "files": [] }

// GENERATED: reducer
// CHECK-LABEL: function {{*}}name="reducer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=number site=[[w_1]]}, {type=undefined|null|[[L_2]] flags=[IsExpected]}] results=[{type=number site=[[w_3]]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: number, v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="x"
// CHECK-NEXT: v3 = Add v0, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
