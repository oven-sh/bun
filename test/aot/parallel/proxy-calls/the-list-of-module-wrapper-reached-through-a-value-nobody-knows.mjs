// node:module goes out of sight and comes back as a value nobody knows. Its `wrapper`, taken off that value under a computed key and by a walk, is the list plain Bun hands out: a store to it works.
import Module from "node:module";

const controller = new AbortController();
controller.abort(Module);
const back = controller.signal.reason;

const name = ["wrap", "per"].join("");
const list = back[name];
console.log(Array.isArray(list), list.length, typeof list[0]);
list[0] = list[0] + "";
console.log("0" in list, Object.keys(list).join());

for (const value of Object.values(back)) {
  if (!Array.isArray(value) || value.length !== 2) continue;
  console.log(typeof value[0], "1" in value);
  value[1] = value[1] + "";
}
