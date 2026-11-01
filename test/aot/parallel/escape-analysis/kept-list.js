let kept;
function keep(list, turn) {
  if (turn === 7) kept = list;
  return list.length;
}
function fill(depth) {
  const pair = [depth, "x"];
  return depth > 0 ? fill(depth - 1) + pair.length : 0;
}
function make(turn) {
  return keep([turn, "text", turn + 2], turn);
}
let sum = 0;
for (let turn = 0; turn < 20; turn++) sum += make(turn);
console.log(sum + fill(50), kept.length, kept[0], kept[1], kept[2]);
