// A typed caller reads an object, makes a call and reads it again. A function with one parameter, which the callee with twelve parameters calls in tail position, stores an object with a valueOf method into a number field of the object.
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
    (target as any).x = { valueOf: () => 1000 };
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

function narrow(n: number): number {
  strike();
  return n & 7;
}
function callee(a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number): number {
  return narrow(a + b + c + d + e + f + g + h + i + j + k + l);
}

function holder(p: Point, round: number): string {
  const before = p.x + p.y;
  const got = callee(round, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11);
  const after = (p.x + 1) + "," + typeof p.x + "," + p.y;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Point = new Point(round, round + 1);
  const before = p.x + p.y;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    spark = hot;
  }
  const inner = holder(p, round);
  const after = (p.x + 1) + "," + typeof p.x + "," + p.y;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
