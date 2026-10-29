// The rounds of the optimizer are cut short here (see the .json). A call with a spread that is resolved behind the last round still has to be expanded.
// Flags: --aot-limit=MaxOptimizationRounds:1
import { AsyncResource } from "node:async_hooks";
import { finished } from "node:stream";
import { Readable } from "node:stream";

const add = AsyncResource.bind(function (a, b, c) {
  return a + b + c;
});
console.log(add(1, 2, 3));

function callWith(callee, ...list) {
  return callee(...list, ...list);
}
console.log(callWith((...all) => all.join(","), 1, "two"));

const source = Readable.from(["x", "y"]);
finished(source, error => console.log("finished", error === undefined || error === null));
source.resume();
