// A store on a function object honors a setter or a read-only property anywhere on its prototype chain, also one that appears after earlier stores.
"use strict";
const log = [];
const Top = { top: true };
const Kind = Object.setPrototypeOf({ tag: "kind" }, Top);
function run(label) {
  function Made() {}
  Object.setPrototypeOf(Made, Kind);
  try { Made.alpha = 1; Made.beta = 2; Object.assign(Made, { gamma: 3, alpha: 4 }); log.push(label + " " + JSON.stringify({ ...Made }) + " " + Object.keys(Made)); }
  catch (error) { log.push(label + " " + error.name + " " + Object.keys(Made)); }
}
for (let round = 0; round < 4; round++) run("plain" + round);
Object.defineProperty(Kind, "alpha", { set(value) { log.push("setter alpha " + value + " on " + typeof this); }, configurable: true });
for (let round = 0; round < 3; round++) run("setter" + round);
delete Kind.alpha;
for (let round = 0; round < 3; round++) run("deleted" + round);
Object.defineProperty(Top, "beta", { value: 7, writable: false, configurable: true });
for (let round = 0; round < 3; round++) run("readonly" + round);
delete Top.beta;
Object.defineProperty(Top, "gamma", { get() { return "got"; }, configurable: true });
for (let round = 0; round < 3; round++) run("getter only" + round);
delete Top.gamma;
Kind.alpha = "data above";
for (let round = 0; round < 3; round++) run("data above" + round);
Object.freeze(Kind);
for (let round = 0; round < 3; round++) run("frozen above" + round);
console.log(log.join("\n"));
