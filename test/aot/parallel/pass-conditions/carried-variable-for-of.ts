// Alone: whether a callee is copied into the loop goes by all that the executable holds
const order: number[] = JSON.parse("[0,1,2,3]");
let held = 1;
function poke(j: number, depth: number): void {
  if (depth > 0) {
    poke(j, depth - 1);
    return;
  }
  if (j === 1) held = 50;
}
function run(): string {
  let text = "";
  for (const j of order) {
    held = held + 1;
    poke(j, 2);
    text += "," + held;
  }
  return text;
}
console.log(run());
