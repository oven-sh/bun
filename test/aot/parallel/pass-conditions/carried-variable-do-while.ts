// Alone: whether a callee is copied into the loop goes by all that the executable holds
const turns: number = JSON.parse("6");
let held = 1;
function poke(j: number, depth: number): void {
  if (depth > 0) {
    poke(j, depth - 1);
    return;
  }
  if (j === 1) held = 50;
}
function run(): number {
  let j = 0;
  do {
    held = held + 1;
    poke(j, 2);
    j++;
  } while (j < turns);
  return held;
}
console.log(run());
