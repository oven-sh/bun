import * as point from "./point.mjs";
import { attempt } from "./show.mjs";
import * as uses from "./uses.mjs";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

let checksum = 0;
for (let i = 0; i < 2000; i++) {
  for (const name in uses) {
    const answer = uses[name]({ x: i, y: 2 });
    checksum += typeof answer === "number" ? answer : 1;
  }
}
console.log("checksum", checksum);

attempt("seen sum(namespace)", () => uses.sum(point));
attempt("seen stored(namespace)", () => uses.stored(point));
for (const name in uses) attempt(name + "(namespace)", () => uses[name](point));
point.move(5);
for (const name of ["sum", "spread", "written", "unpacked"]) attempt(name + "(namespace after move)", () => uses[name](point));
for (const name in uses) attempt(name + "(namespace of the uses)", () => uses[name](uses));
for (const name in uses) attempt(name + "(plain again)", () => uses[name]({ x: 1, y: 2 }));
const later = await import("./point.mjs");
attempt("the same object each time", () => later === point);
