// Alone: whether a callee is copied into the loop goes by all that the executable holds
const turns: number = JSON.parse("6");
class Box {
  v = 1.5;
}
const box = new Box();
function poke(j: number, depth: number): void {
  if (depth > 0) {
    poke(j, depth - 1);
    return;
  }
  if (j === 1) box.v = 50.25;
}
function run(b: Box): number {
  let j = 0;
  do {
    b.v = b.v + 0.5;
    poke(j, 2);
    j++;
  } while (j < turns);
  return b.v;
}
console.log(run(box));
