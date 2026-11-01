// Alone: whether a callee is copied into the loop goes by all that the executable holds
const turns: number = JSON.parse("4");
class P {
  x?: number = 1;
  y = 2;
}
const one = new P();
const pokes: (() => void)[] = JSON.parse("1")
  ? [
      (): void => {
        delete one.x;
      },
    ]
  : [];
function inner(p: P): string {
  let out = "";
  for (let j = 0; j < turns; j++) {
    const x = p.x;
    pokes[0]();
    out += "," + x + ":" + p.x;
    p.x = 1;
  }
  return out;
}
console.log(inner(one));
