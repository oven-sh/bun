import * as other from "./other.js";
function make(n) {
  const list = [];
  for (let i = 0; i < n; i++) list.push(i + 1);
  Object.setPrototypeOf(list, other);
  return list;
}
const said = [];
for (let turn = 0; turn < 3; turn++) {
  try {
    const [first, second] = make(3);
    said.push(first + second);
  } catch (e) {
    said.push(e.name);
  }
}
console.log(said.join(), make(1).one, make(1).two());
