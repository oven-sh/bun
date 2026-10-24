// A typed caller reads an object, makes a call and reads it again. A function that calls itself, on its way back up, fills an optional field of the object, in typed code.
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
    target.note = "filled";
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

function callee(depth: number): number {
  if (depth === 0) return 0;
  const below = callee(depth - 1);
  if (depth === 2) strike();
  return below + 1;
}

function holder(p: Card, round: number): string {
  const before = p.id + ":" + p.note;
  const got = callee((round % 5) + 2);
  const after = p.note + "," + p.id + "," + ("note" in p) + "," + Object.keys(p).join("");
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
  const after = p.note + "," + p.id + "," + ("note" in p) + "," + Object.keys(p).join("");
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
