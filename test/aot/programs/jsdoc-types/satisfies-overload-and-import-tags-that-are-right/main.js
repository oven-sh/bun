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
