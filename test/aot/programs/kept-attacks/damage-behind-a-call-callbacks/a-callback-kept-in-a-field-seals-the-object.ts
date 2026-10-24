// A typed caller reads an object, makes a call and reads it again. A function that lies in a field of an object, which the callee reads and calls, seals the object, which has an optional field that is not there yet.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.
class Card {
  id: number;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

let victim: Card | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    Object.seal(target);
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

class Hook {
  action: () => boolean;
  constructor(action: () => boolean) {
    this.action = action;
  }
}
const hook = new Hook(strike);
function callee(round: number): number {
  hook.action();
  return round & 3;
}

function holder(p: Card, round: number): string {
  const before = p.id + ":" + p.note;
  const got = callee(round);
  let stored = "stored";
  try {
    p.note = "late";
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p.note + "," + p.id + "," + Object.keys(p).join("");
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Card = new Card(round);
  const before = p.id + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    spark = hot;
  }
  const inner = holder(p, round);
  let stored = "stored";
  try {
    p.note = "late";
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p.note + "," + p.id + "," + Object.keys(p).join("");
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
