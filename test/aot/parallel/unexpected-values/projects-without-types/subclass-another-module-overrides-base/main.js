import * as heirs from "./heirs.js";
import { Queue } from "./queue.js";
import { attempt } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

let sum = 0;
for (let i = 0; i < 2000; i++) {
  const queue = new Queue();
  sum += queue.add(i) + queue.add(1) + queue.size() + queue.first() + queue.total() + queue.room();
}
console.log("sum", sum);
const methods = ["add", "size", "first", "total", "room"];
for (const name of Object.keys(heirs)) {
  if (name === "log") continue;
  for (const method of methods) {
    heirs.log.length = 0;
    attempt(name + "." + method, () => new heirs[name]()[method](5));
    attempt(name + " through the method of the base: " + method, () => Queue.prototype[method].call(new heirs[name](), 5));
    if (heirs.log.length) console.log(name + "." + method + " ran", heirs.log.join(", "));
  }
}
attempt("the base again", () => {
  const queue = new Queue();
  return [queue.add(1), queue.size(), queue.first(), queue.total(), queue.room()];
});
