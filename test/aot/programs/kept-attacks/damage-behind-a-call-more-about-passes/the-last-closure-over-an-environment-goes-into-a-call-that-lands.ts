// In every turn of the loop `holder` makes an environment and a closure over it, and the call of `consult` is the last use of both.
// Whichever way the call comes back, the next turn must get an environment of its own:
// the closures that `consult` has been told to keep are called at the end, and each has to find the variables of its turn.
// `consult` damages the object that the holder reads in front of the call and behind it, so some of the calls come back at the landing, and it calls itself so that it is not taken in.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let damages = false;
let keeps = false;
const kept: (() => string)[] = [];

function consult(p: Point, describe: () => string, depth: number): number {
  if (depth > 0) return consult(p, describe, depth - 1) + 1;
  if (damages) (p as any).y = "T";
  if (keeps) kept.push(describe);
  return describe().length;
}

function holder(p: Point, round: number): string {
  let line = "";
  for (let turn = 0; turn < 3; turn++) {
    const before = p.x + p.y;
    let count = round * 10 + turn;
    const name = "r" + round + "t" + turn;
    const got = consult(p, () => name + ":" + count++, 2);
    line += before + " " + got + " " + p.x + "," + p.y + " | ";
  }
  return line;
}

for (let round = 0; round < 400; round++) {
  damages = round % 100 >= 98;
  keeps = round % 100 === 97 || round % 100 === 99;
  const line = holder(new Point(round, 1), round);
  if (round % 100 >= 96) console.log(round + ": " + line);
}
console.log(kept.map(describe => describe()).join(" "));
console.log(kept.map(describe => describe()).join(" "));
