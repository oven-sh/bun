// A typed caller reads an object, makes a call and reads it again. The apply trap of a proxy around a function, which a call in the callee runs, adds a property that the class does not declare.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let victim: Point | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    (target as any).z = 3;
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

const watched = new Proxy((round: number) => round & 3, {
  apply(target, thisValue, list) {
    strike();
    return Reflect.apply(target, thisValue, list);
  },
});
function callee(round: number): number {
  return watched(round) + 1;
}

function holder(p: Point, round: number): string {
  let keysBefore = "";
  for (const key in p) keysBefore += key;
  const before = keysBefore + (p.x + p.y);
  const got = callee(round);
  let keys = "";
  for (const key in p) keys += key;
  const after = keys + "," + p.x + "," + JSON.stringify(p) + "," + Object.keys({ ...p }).length;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Point = new Point(round, round + 1);
  let keysBefore = "";
  for (const key in p) keysBefore += key;
  const before = keysBefore + (p.x + p.y);
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    spark = hot;
  }
  const inner = holder(p, round);
  let keys = "";
  for (const key in p) keys += key;
  const after = keys + "," + p.x + "," + JSON.stringify(p) + "," + Object.keys({ ...p }).length;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
