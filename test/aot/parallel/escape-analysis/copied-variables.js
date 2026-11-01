let kept;
function make(turn) {
  let count = turn;
  if (turn === 7) {
    kept = () => count;
    count += 1;
  } else {
    count += 1;
  }
  count += 1;
  return count;
}
let sum = 0;
for (let turn = 0; turn < 40; turn++) sum += make(turn);
console.log(sum, kept());
