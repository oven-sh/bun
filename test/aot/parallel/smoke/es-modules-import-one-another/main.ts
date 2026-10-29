// Default, named, renamed, namespace and type imports, a re-export and a dynamic import of one module.
import greet, { PI, area as circleArea, type Point } from "./es-exports.ts";
import * as everything from "./es-exports.ts";
export { PI } from "./es-exports.ts";
const origin: Point = { x: 0, y: 0 };
console.log(greet("world"), PI, circleArea(2), everything.counter, origin.x);
everything.increment();
console.log(everything.counter, Object.keys(everything).length);
const lazy = await import("./es-exports.ts");
console.log(lazy.default === greet);
