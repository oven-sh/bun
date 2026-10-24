// Nothing is put on the prototype object of the class: it gets another parent, which has two of the names that the caller reads off objects with empty slots.
// The callee does it in a generic arm, three calls below the caller that holds the proof, and the two functions in between end in tail calls.
class Card {
  id: number;
  declare title?: string;
  declare owner?: string;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

let strikes = false;
const parent = { owner: "owner from far above", note: "note from far above" };
const bomb = {
  valueOf(): number {
    if (strikes) Object.setPrototypeOf(Card.prototype, parent);
    return 2;
  },
};

let factor: number = 2;
function deepest(round: number): number {
  return factor * (round & 3);
}
function deeper(round: number): number {
  return deepest(round + 1);
}
function callee(round: number): number {
  return deeper(round + 1);
}

function holder(p: Card, round: number): string {
  const before = p.title + "," + p.owner + "," + p.note;
  const got = callee(round);
  return before + " " + got + " " + p.title + "," + p.owner + "," + p.note + "," + ("owner" in p);
}

let digest = 0;
for (let round = 0; round < 400; round++) {
  const p = new Card(round);
  if (round % 5 === 0) p.owner = "o" + round;
  strikes = round === 201;
  if (strikes) factor = bomb as any;
  const line = holder(p, round);
  factor = 2;
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 199 && round <= 203) || round === 301 || round === 399) console.log(round + ": " + line);
  if (round === 300) Object.setPrototypeOf(Card.prototype, Object.prototype);
}
console.log("digest " + digest);
