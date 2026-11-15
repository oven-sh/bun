import * as outer from "./outer.mjs";
import * as top from "./top.mjs";
import * as last from "./last.mjs";
const read = (space, name) => String(space[name]);
const asked = process.argv[2] ?? "round";
console.log("outer", read(outer, asked), Object.keys(outer).join());
console.log("top", read(top, asked), Object.keys(top).join());
console.log("last", read(last, asked), Object.keys(last).join());
try {
  await import("./named.mjs");
} catch (error) {
  console.log("named", error.name, error.message.replace(/ in module .*/, ""));
}
