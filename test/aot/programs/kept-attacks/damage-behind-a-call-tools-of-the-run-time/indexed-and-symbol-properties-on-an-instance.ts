// An instance of a class gets a property whose name is an index, one whose name is a symbol, and one whose name is a number too large for an index. The caller walks the keys of the object in front of the call and behind it.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const mark = Symbol("mark");
let mode = 0;
function below(p: Point): number {
  if (mode === 1) (p as any)[0] = "zero";
  else if (mode === 2) (p as any)[mark] = "marked";
  else if (mode === 3) (p as any)[4294967295] = "large";
  else if (mode === 4) (p as any)["-1"] = "negative";
  return 1;
}

function holder(p: Point): string {
  let before = "";
  for (const key in p) before += key;
  const got = below(p);
  let after = "";
  for (const key in p) after += key + ".";
  return before + " " + got + " " + after + " " + (p.x + p.y) + " " + Reflect.ownKeys(p).length + " " + String((p as any)[0]) + " " + String((p as any)[mark]);
}

for (let round = 0; round < 500; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Point(round, 1));
  if (mode || round === 0) console.log(round + ": " + line);
}
