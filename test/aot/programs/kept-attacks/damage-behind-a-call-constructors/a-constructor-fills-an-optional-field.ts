// A typed caller reads an object, makes a call and reads it again. The constructor of another class, which the caller calls with `new`, fills an optional field of the object, in typed code.
class Card {
  id: number;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}

let victim: Card | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  target.note = "filled";
  return true;
}

class Probe {
  seen: number;
  constructor(round: number) {
    strike();
    this.seen = round & 3;
  }
}

function holder(p: Card, round: number): string {
  const before = p.id + ":" + p.note;
  const got = new Probe(round).seen;
  const after = p.note + "," + p.id + "," + ("note" in p) + "," + Object.keys(p).join("");
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Card = new Card(round);
  const before = p.id + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) victim = p;
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
