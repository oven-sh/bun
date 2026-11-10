var held, other;
let total = "";
let turn = 0;
do {
  total += (other === undefined ? "none" : other) + ";";
  other = turn + 1;
  held = turn + 1;
  total += held + ";";
  turn++;
} while (turn < Number("3"));
console.log("SAID end " + total);
function peek() {
  return held;
}
console.log("SAID peek " + typeof peek());
