// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2

// FILE: main.js
// Satisfies overload and import tags that are right.
import { add, Circle, unit } from "./shapes.js";

/** @import { Point, Named } from "./shapes.js" */
/** @import { Size } from "./types" */
/** @import * as Types from "./types" */

/** @type {Point} */
const origin = { x: 0, y: 0 };

/** @type {Named} */
const home = { name: "home", at: { x: 1, y: 2 } };

/** @type {Size} */
const size = { width: 2, height: 3 };

/** @type {Types.Unit} */
const px = "px";

/** @type {import("./shapes.js").Point} */
const far = { x: 100, y: 200 };

/** @type {import("./shapes.js").Circle} */
const circle = new Circle(far, 2);

/** @type {typeof import("./shapes.js").add} */
const plus = add;

/** @param {import("./types").Size} s */
const areaOf = s => s.width * s.height;

const palette = /** @satisfies {Record<string, [number, number, number] | string>} */ ({
  red: [255, 0, 0],
  green: "#00ff00",
});

/** @satisfies {Point} */
const checked = { x: 5, y: 6 };

/**
 * @overload
 * @param {number} value
 * @returns {number}
 */
/**
 * @overload
 * @param {string} value
 * @returns {string}
 */
/**
 * @param {number | string} value
 * @returns {number | string}
 */
function twice(value) {
  return typeof value === "number" ? value * 2 : value + value;
}

class Reader {
  /**
   * @overload
   * @param {number} index
   * @returns {number}
   */
  /**
   * @overload
   * @param {string} name
   * @returns {string}
   */
  /**
   * @param {number | string} key
   * @returns {number | string}
   */
  read(key) {
    return typeof key === "number" ? key + 1 : key.toUpperCase();
  }
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plus(origin, home.at).x + areaOf(size) + circle.area() + twice(i) + twice("a").length + new Reader().read(i) + checked.x + unit.x;
console.log("2000 rounds: " + warm);
console.log(JSON.stringify(add(far, unit)), px, palette.red[0] + 1, palette.green.toUpperCase(), checked.x + checked.y);
console.log(twice(2) + 1, twice("ab").length, new Reader().read(1) + 1, new Reader().read("ab").length, circle.center === far);

// FILE: shapes.js
/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * @typedef {object} Named
 * @property {string} name
 * @property {Point} at
 */

export class Circle {
  /**
   * @param {Point} center
   * @param {number} r
   */
  constructor(center, r) {
    this.center = center;
    this.r = r;
  }

  /** @returns {number} */
  area() {
    return this.r * this.r * 3;
  }
}

/**
 * @param {Point} a
 * @param {Point} b
 * @returns {Point}
 */
export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export const unit = /** @type {const} */ ({ x: 1, y: 1 });

// FILE: types.d.ts
export interface Size {
  width: number;
  height: number;
}

export type Unit = "px" | "em";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true, "strict": true, "checkJs": true }, "files": [] }

// GENERATED: Reader read areaOf
// CHECK-LABEL: function {{*}}name="Reader"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string flags=[IsExpected]}] results=[{type=undefined|null|number|string flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=number
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b5(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|number|string flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="toUpperCase"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10, v8 calleeKey="toUpperCase" calleeName="key.toUpperCase"
// CHECK-NEXT: ReturnCall v11 casts=[{declared={type=undefined|null|number|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="areaOf"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="width"
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v0 key="height"
// CHECK-NEXT: v4 = Convert v3 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Mul v2, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
