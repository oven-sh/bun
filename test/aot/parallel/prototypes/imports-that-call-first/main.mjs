// The imported file runs first and calls functions of this one, which find undefined in `shape`.
var shape = { area() { return 7; } };
export function make() { return { __proto__: shape, side: 2 }; }
export function create() { return Object.create(shape); }
import { first, second } from "./other.mjs";
console.log(first, second, make().area(), create().area());
