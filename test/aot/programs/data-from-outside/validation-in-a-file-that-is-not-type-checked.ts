// @ts-nocheck
// A file that begins with @ts-nocheck is compiled without its types. JSON.parse<T> and validate<T> in it validate all the same.
import { validate } from "bun:bundle";

type Point = { x: number; y: number };
type Shape = { kind: "circle"; radius: number } | { kind: "box"; corners: [Point, Point]; label?: string };
const wrong: number = "not a number";

function attempt(label, run) {
  try {
    console.log(label + ": value " + JSON.stringify(run()));
  } catch (error) {
    console.log(label + ": " + error.name + (error.issues ? " at " + error.issues.map(issue => JSON.stringify(issue.path)).join() : ""));
  }
}
const load = (text: string): Point => JSON.parse<Point>(text);
for (const text of ['{"x":1,"y":2}', '{"y":2,"x":1,"z":3}', '{"x":"s","y":2}', '{"x":1}', "[1,2]", "null", '{"x":{"x":1},"y":[2]}', '{"x":1,"y":']) {
  attempt("JSON.parse<Point> of " + text, () => JSON.parse<Point>(text));
  attempt("through a function, " + text, () => load(text).x + load(text).y);
  attempt("with a reviver, " + text, () => JSON.parse<Point>(text, (key, value) => (typeof value === "number" ? value + 1 : value)));
  attempt("Point[] of " + text, () => JSON.parse<Point[]>("[" + text + "," + text + "]"));
}
for (const value of [{ x: 1, y: 2 }, { x: "s", y: 2 }, { x: 1 }, [1, 2], null, undefined, 5, { x: 1, y: 2, more: [1] }]) attempt("validate<Point> of " + JSON.stringify(value), () => validate<Point>(value));
for (const text of ['{"kind":"circle","radius":1}', '{"kind":"circle","radius":"1"}', '{"kind":"box","corners":[{"x":0,"y":0},{"x":1,"y":1}]}', '{"kind":"box","corners":[{"x":0,"y":0}]}', '{"kind":"box","corners":[{"x":0,"y":0},{"x":1,"y":null}],"label":"l"}', '{"kind":"line"}']) {
  attempt("JSON.parse<Shape> of " + text, () => JSON.parse<Shape>(text));
  attempt("validate<Shape> of " + text, () => validate<Shape>(JSON.parse(text)));
}
console.log(typeof wrong);
