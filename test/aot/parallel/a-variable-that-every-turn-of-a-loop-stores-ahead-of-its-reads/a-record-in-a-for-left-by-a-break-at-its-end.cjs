var held;
let total = "";
let turn = 0;
for (;;) {
  held = { n: turn };
  total += held.n + ";";
  turn++;
  if (!(turn < Number("3"))) break;
}
console.log("SAID end " + total);
function peek() {
  return held;
}
console.log("SAID peek " + typeof peek());
