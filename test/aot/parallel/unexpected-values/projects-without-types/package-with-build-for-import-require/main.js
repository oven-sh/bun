import * as imported from "point";
import required from "./required.cjs";
import { attempt } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const sumOf = point => point.sum();
const nextX = point => point.x + 1;
let total = 0;
for (let i = 0; i < 2000; i++) total += sumOf(new imported.Point(i, 1)) + nextX(new imported.Point(i, 1));
console.log("total", total);
const builds = { imported, required };
attempt("builds", () => [imported.build, required.build, imported.Point === required.Point]);
for (const maker in builds) {
  attempt("sumOf(" + maker + ")", () => sumOf(new builds[maker].Point(1, 2)));
  attempt("nextX(" + maker + ")", () => nextX(new builds[maker].Point(1, 2)));
  for (const judge in builds) attempt(judge + ".isPoint(" + maker + ")", () => builds[judge].isPoint(new builds[maker].Point(1, 2)));
  attempt(maker + " without new", () => builds[maker].Point(1, 2));
}
attempt("a method of one build on an object of the other", () => [imported.Point.prototype.sum.call(new required.Point(1, 2)), required.Point.prototype.sum.call(new imported.Point(1, 2))]);
const later = await import("point");
attempt("imported later", () => later.Point === imported.Point);
