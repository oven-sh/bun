import * as box from "./box.mjs";
function show(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object") return Object.keys(value).map(key => show(value[key])).join();
  return String(value);
}
const uses = [b => b.width, b => Object.assign({}, b)];
for (const use of uses) console.log(show(use(box)));
