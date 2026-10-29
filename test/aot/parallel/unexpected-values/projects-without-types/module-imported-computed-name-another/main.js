import * as consume from "./consume.js";
import { attempt } from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

async function load(name) {
  return (await import("./kinds/" + name + ".js")).default;
}

let sum = 0;
const honest = await load("list");
for (let i = 0; i < 2000; i++) {
  const list = honest();
  sum += consume.size(list) + consume.first(list) + consume.total(list) + consume.indexed(list) + consume.sorted(list)[0] + consume.each(list).length + consume.unpacked(list)[1];
}
console.log("sum", sum);

for (const name of "list like text set map typed generator number heir nothing list".split(" ")) {
  const make = await load(name);
  for (const use in consume) attempt(use + "(" + name + ")", () => consume[use](make()));
}
try {
  await load("absent");
  console.log("a module that is not there was loaded");
} catch (error) {
  console.log("a module that is not there", error.constructor.name);
}
