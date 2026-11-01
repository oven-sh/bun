// Alone: what a loop keeps in a register goes by which bodies are copied into it, and that by all that the executable holds
// STATISTIC: StoresLeftInLoopsForOthers >= 1
const turns: number = JSON.parse("6");
class Box {
  v = 1.5;
}
class Crate {
  v = 2.5;
  w = 1;
}
function run(b: Box, other: Box | Crate): number {
  let sum = 0;
  let j = 0;
  do {
    b.v = b.v + 0.5;
    sum = sum + other.v;
    j++;
  } while (j < turns);
  return sum;
}
const one = new Box();
console.log(run(one, one), run(new Box(), new Crate()));
