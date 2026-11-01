// Alone: what a loop keeps in a register goes by which bodies are copied into it, and that by all that the executable holds
const turns: number = JSON.parse("6");
let held = 1;
let calls = 0;
const evil: any = {
  valueOf(): number {
    if (++calls === 2) held = 50;
    return 0;
  },
};
class Holder {
  n = 0;
}
const holder = new Holder();
(holder as any).n = evil;
function run(): number {
  let j = 0;
  let sink = 0;
  do {
    held = held + 1;
    sink = Math.abs(holder.n);
    j++;
  } while (j < turns);
  return held + sink;
}
console.log(run());
