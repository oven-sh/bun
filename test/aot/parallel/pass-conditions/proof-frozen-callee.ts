// Alone: whether a callee is copied into the loop goes by all that the executable holds
const turns: number = JSON.parse("4");
class P {
  x = 1;
}
function hold(p: P, depth: number): void {
  if (depth > 0) {
    hold(p, depth - 1);
    return;
  }
  Object.freeze(p);
}
function run(): string {
  let out = "";
  for (let j = 0; j < turns; j++) {
    const p = new P();
    hold(p, 2);
    try {
      p.x = 3;
    } catch {
      out += "!";
    }
    out += "," + p.x;
  }
  return out;
}
console.log(run());
