let kept;
function make(turn) {
  let count = turn;
  function bump() {
    count += 1;
    if (turn === 7 && count === 9) kept = () => count;
  }
  bump();
  bump();
  return count;
}
let sum = 0;
for (let turn = 0; turn < 40; turn++) sum += make(turn);
console.log(sum, kept());
