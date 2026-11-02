// What stands under each name of node:module, taken out without naming it: by Object.entries, Object.values and for-in.
import host from "node:module";

let seen;
for (const each of [host]) seen = each;
const holder = seen;

console.log(
  Object.entries(holder)
    .map(([key, value]) => key + ":" + typeof value)
    .join(),
);
console.log(
  Object.entries(holder)
    .map(([key, value]) => key + ":" + Array.isArray(value))
    .join(),
);
console.log(
  Object.values(holder)
    .map(value => typeof value)
    .join(),
);
const found = [];
for (const key in holder) found.push(key + ":" + typeof holder[key]);
console.log(found.join());
