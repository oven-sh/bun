// One bit says that nothing on the prototype object of a class has changed. Here it is broken before the first hot call: the program gives the class a default under a name that hot code reads.
// From then on each read of another absent name rests on the bit of its own name, which is asked in cold code. Much later a callee leaves its typed path and puts that name on the prototype object too.
class Card {
  id: number;
  declare spare?: number;
  declare owner?: string;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

function readSpare(p: Card): number {
  const spare = p.spare;
  return spare === undefined ? -1 : spare;
}

let strikes = false;
const bomb = {
  valueOf(): number {
    if (strikes) (Card.prototype as any).owner = "owner from above";
    return 2;
  },
};

let factor: number = 2;
function callee(round: number): number {
  return factor * (round & 3);
}

function holder(p: Card, round: number): string {
  const before = p.owner + "," + p.note;
  const got = callee(round);
  return before + " " + got + " " + p.owner + "," + p.note + "," + readSpare(p);
}

let digest = 0;
for (let round = 0; round < 400; round++) {
  if (round === 3) (Card.prototype as any).spare = 7;
  const p = new Card(round);
  if (round % 5 === 0) p.note = "n" + round;
  if (round % 11 === 0) p.spare = round;
  strikes = round === 250;
  if (strikes) factor = bomb as any;
  const line = holder(p, round);
  factor = 2;
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 5 || (round >= 249 && round <= 252) || round === 399) console.log(round + ": " + line);
  if (round === 300) delete (Card.prototype as any).owner;
}
console.log("digest " + digest);
