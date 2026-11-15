import tool from "./tool.cjs";
function work(most) {
  let total = 0;
  for (let turn = 0; turn < most; turn++) total = total * 3 + ((turn * 7 + 3) % tool.held);
  return total;
}
console.log("SAID " + work(Number("0")) + " " + work(Number("3")));
