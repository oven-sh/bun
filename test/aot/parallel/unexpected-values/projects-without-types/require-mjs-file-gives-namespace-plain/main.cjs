const { attempt } = require("./show.cjs");
const uses = require("./uses.cjs");
const point = require("./point.mjs");

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

for (const name in uses) attempt(name + "(namespace)", () => uses[name](point));
point.move(5);
for (const name of ["sum", "spread", "written", "unpacked"]) attempt(name + "(namespace after move)", () => uses[name](point));
for (const name in uses) attempt(name + "(plain again)", () => uses[name]({ x: 1, y: 2 }));
attempt("typeof move", () => typeof point.move);
attempt("the same object each time", () => require("./point.mjs") === point);
