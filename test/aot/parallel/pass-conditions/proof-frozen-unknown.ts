// Alone: whether a callee is copied into the loop goes by all that the executable holds
const turns: number = JSON.parse("4");
class P {
  x = 1;
}
const all: P[] = [new P(), new P(), new P(), new P()];
let at = 0;
const pokes: (() => void)[] = JSON.parse("1")
  ? [
      (): void => {
        Object.freeze(all[at]);
      },
    ]
  : [];
function run(): string {
  let out = "";
  for (let j = 0; j < turns; j++) {
    const p = all[j];
    at = j;
    p.x = 2;
    pokes[0]();
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
