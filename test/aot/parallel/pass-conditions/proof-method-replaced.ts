// Alone: whether a callee is copied into the loop goes by all that the executable holds
const turns: number = JSON.parse("4");
class P {
  m(): number {
    return 1;
  }
}
const one = new P();
const pokes: (() => void)[] = JSON.parse("1")
  ? [
      (): void => {
        (P.prototype as any).m = (): number => 9;
      },
    ]
  : [];
function inner(p: P): string {
  let out = "";
  for (let j = 0; j < turns; j++) {
    const x = p.m();
    pokes[0]();
    out += "," + x + ":" + p.m();
  }
  return out;
}
console.log(inner(one));
