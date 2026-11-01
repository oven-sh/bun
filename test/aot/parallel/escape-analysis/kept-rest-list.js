let kept;
function fill(depth) {
  const pair = [depth, "x"];
  return depth > 0 ? fill(depth - 1) + pair.length : 0;
}
function make(turn, ...rest) {
  if (turn === 7) kept = rest;
  return rest.length;
}
let sum = 0;
for (let turn = 0; turn < 20; turn++) sum += make(turn, "text", turn + 2);
console.log(sum + fill(50), kept.length, kept[0], kept[1]);
