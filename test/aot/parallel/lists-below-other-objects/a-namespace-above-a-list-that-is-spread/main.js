import * as other from "./other.js";
function make(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(i + 1);
  Object.setPrototypeOf(list, other);
  return list;
}
function count(...all) { return all.length; }
const said = [];
for (let turn = 0; turn < 3; turn++) {
  try { said.push(count(...make(3))); } catch (e) { said.push(e.name); }
  try { said.push([...make(2)].length); } catch (e) { said.push(e.name); }
  try { for (const x of make(2)) said.push(x); } catch (e) { said.push(e.name); }
}
console.log(said.join());
