// Alone: whether a callee is copied into the loop goes by all that the executable holds
const turns: number = JSON.parse("6");
let held = 1;
let calls = 0;
const evil: any = {
  valueOf(): number {
    if (++calls === 2) held = 50;
    return 0;
  },
};
function run(): number {
  let j = 0;
  let sink = 0;
  do {
    sink = Math.abs(evil);
    held = held + 1;
    j++;
  } while (j < turns);
  return held + sink;
}
console.log(run());
