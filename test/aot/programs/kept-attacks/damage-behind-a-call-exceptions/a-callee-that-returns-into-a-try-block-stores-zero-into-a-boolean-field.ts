// A typed caller reads an object, makes a call and reads it again. The call stands in a try block and nothing is thrown, so the catch block must not run. The callee stores 0 into a boolean field of the object.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.
class Lamp {
  on: boolean;
  watts: number;
  constructor(on: boolean, watts: number) {
    this.on = on;
    this.watts = watts;
  }
}

let victim: Lamp | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    (target as any).on = 0;
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

function callee(round: number): number {
  strike();
  return round & 3;
}

function holder(p: Lamp, round: number): string {
  const before = (p.on ? "lit" : "dark") + p.watts;
  let got: number;
  try {
    got = callee(round);
  } catch {
    got = -1;
  }
  const after = (p.on ? "lit" : "dark") + "," + (p.on === true) + "," + (p.on === false) + "," + typeof p.on + "," + p.watts;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Lamp = new Lamp((round & 1) === 0, round);
  const before = (p.on ? "lit" : "dark") + p.watts;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    spark = hot;
  }
  const inner = holder(p, round);
  const after = (p.on ? "lit" : "dark") + "," + (p.on === true) + "," + (p.on === false) + "," + typeof p.on + "," + p.watts;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
