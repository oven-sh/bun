// A function reads three optional fields of one class in front of a call and behind it. A read of an empty slot rests on "nobody has put the name on the prototype object".
// The tests for the three names may have become one test in front of the first read, and the call may have kept it. A number variable of the callee holds an object in some rounds,
// so the multiplication leaves the typed path and runs valueOf, which puts one of the names on the prototype object: the second, then the third, then the first.
class Card {
  id: number;
  declare title?: string;
  declare owner?: string;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

let damage = 0;
const bomb = {
  valueOf(): number {
    if (damage === 1) (Card.prototype as any).owner = "owner from above";
    else if (damage === 2) (Card.prototype as any).note = "note from above";
    else if (damage === 3) (Card.prototype as any).title = "title from above";
    return 2;
  },
};

let factor: number = 2;
function callee(round: number): number {
  return factor * (round & 3);
}

function holder(p: Card, round: number): string {
  const before = p.title + "," + p.owner + "," + p.note;
  const got = callee(round);
  return before + " " + got + " " + p.title + "," + p.owner + "," + p.note;
}

function outer(p: Card, round: number): string {
  const before = p.note + "," + p.owner;
  const inner = holder(p, round);
  return before + " [" + inner + "] " + p.owner + "," + p.note + "," + p.title;
}

let digest = 0;
for (let round = 0; round < 500; round++) {
  const p = new Card(round);
  if (round % 5 === 0) p.title = "t" + round;
  if (round % 7 === 0) p.note = "n" + round;
  damage = round === 201 ? 1 : round === 302 ? 2 : round === 401 ? 3 : 0;
  if (damage) factor = bomb as any;
  const line = outer(p, round);
  factor = 2;
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || round % 100 <= 3 || round % 100 === 99) console.log(round + ": " + line);
  if (round === 250) delete (Card.prototype as any).owner;
}
console.log("digest " + digest);
