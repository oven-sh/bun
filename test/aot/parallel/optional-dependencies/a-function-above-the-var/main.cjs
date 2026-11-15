// The function is called above the statement of the `var` and behind it.
function nameOfTools() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return [work, tools?.name, tools?.describe(), tools?.uses];
}
const arrow = () => tools?.name ?? "not yet";
console.log(nameOfTools(), arrow());
var tools = require("./tools.mjs");
console.log(nameOfTools(), arrow());
