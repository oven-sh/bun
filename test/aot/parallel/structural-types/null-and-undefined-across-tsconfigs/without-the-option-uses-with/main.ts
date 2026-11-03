import {
  Box,
  Point,
  addOne,
  apply,
  bits,
  describe,
  first,
  isNull,
  lengthOrZero,
  maybe,
  not,
  numbers,
  orDefault,
  origin,
  registry,
  shout,
  size,
  sum,
  sumByIndex,
  totalOfRegistry,
} from "./inner/lib.ts";

function show(label: string, value: unknown) {
  console.log(label, typeof value, String(value));
}
function attempt(label: string, run: () => unknown) {
  try {
    show(label, run());
  } catch (error) {
    show(label, error instanceof TypeError ? "TypeError" : "another error");
  }
}
const nothing: number = undefined;
const none: number = null;
const noText: string = undefined;
const noPoint: Point = null;
show("addOne undefined", addOne(nothing));
show("addOne null", addOne(none));
show("addOne literal", addOne(undefined));
show("bits undefined", bits(nothing));
show("bits null", bits(null));
attempt("size undefined", () => size(noText));
show("shout undefined", shout(noText));
show("shout null", shout(null));
show("not undefined", not(undefined));
attempt("describe null", () => describe(noPoint));
const point = new Point(undefined, null);
show("point x", point.x);
show("point y", point.y);
show("point sum", point.sum());
show("describe", describe(point));
point.label = undefined;
show("describe without label", describe(point));
origin.x = null;
origin.y = undefined;
show("origin", describe(origin));
show("sum", sum([1, undefined, 2]));
show("sum null", sum([1.5, null, 2]));
show("sumByIndex", sumByIndex([1, undefined, 2]));
show("sumByIndex null", sumByIndex([null, 1.5]));
numbers.push(undefined);
numbers[0] = null;
show("numbers", JSON.stringify(numbers));
show("numbers sum", sum(numbers));
show("numbers by index", sumByIndex(numbers));
show("first", first([undefined, 1]));
show("first empty", addOne(first([])));
show("box", new Box<number>(undefined).map(addOne).value);
show("box null", new Box<number>(null).map(n => n + 1).value);
show("orDefault", orDefault(undefined));
show("orDefault null", orDefault(null));
show("isNull", isNull(null));
show("isNull undefined", isNull(undefined));
show("lengthOrZero", lengthOrZero());
attempt("lengthOrZero null", () => lengthOrZero(null));
registry.set("a", 1);
registry.set("b", undefined);
registry.set("c", null);
show("registry", totalOfRegistry());
const some: number = maybe(false);
show("maybe", some);
show("maybe + 1", some + 1);
show("maybe true + 1", maybe(true) + 1);
show(
  "apply",
  apply(n => undefined, 1),
);
show(
  "apply null",
  apply(n => null, 1),
);
show(
  "apply of nothing",
  apply(n => n * 2, undefined),
);
