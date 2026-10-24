// A typed caller reads an object, makes a call and reads it again. A generator at its first step, which the callee asks for by calling next, defines a getter on the prototype object under the name of an optional field that the object does not have.
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
    Object.defineProperty(Card.prototype, "note", { get: () => "from above", configurable: true });
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

function* steps(): Generator<number> {
  strike();
  yield 1;
}
function callee(round: number): number {
  return steps().next().value + (round & 3);
}

function holder(p: Card, round: number): string {
  const before = p.id + ":" + p.note;
  const got = callee(round);
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
  delete (Card.prototype as any).note;
}
console.log("digest " + digest);
