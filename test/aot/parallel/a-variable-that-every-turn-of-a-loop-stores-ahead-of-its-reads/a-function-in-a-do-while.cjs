var pick;
let total = "";
let turn = 0;
do {
  pick = turn => "second" + turn;
  total += pick(turn);
  turn++;
} while (turn < Number("3"));
console.log("SAID end " + total);
function peek() {
  return pick;
}
console.log("SAID peek " + typeof peek());
