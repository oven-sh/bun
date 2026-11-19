var pick;
let total = "";
let turn = 0;
pick = turn => "first" + turn;
if (Number("1")) pick = turn => "second" + turn;
do {
  total += pick(turn);
  turn++;
} while (turn < Number("3"));
console.log("SAID end " + total);
function peek() {
  return pick;
}
console.log("SAID peek " + typeof peek());
