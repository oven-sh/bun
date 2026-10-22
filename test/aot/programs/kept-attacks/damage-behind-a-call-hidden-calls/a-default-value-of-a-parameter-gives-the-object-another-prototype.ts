// A typed caller reads an object, makes a call and reads it again. The default value of a parameter, which is evaluated because the callee's callee gets no argument, gives the object another prototype, which has the name of an optional field that the object does not have.
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
  Object.setPrototypeOf(target, { note: "inherited" });
  return true;
}

function inner(round: number, struck: boolean = strike()): number {
  return struck ? -1 : round & 3;
}
function callee(round: number): number {
  return inner(round) + 1;
}

function holder(p: Card, round: number): string {
  const before = p.id + ":" + p.note;
  const got = callee(round);
  const after = p.note + "," + p.id + "," + (p instanceof Card);
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Card = new Card(round);
  const before = p.id + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  const after = p.note + "," + p.id + "," + (p instanceof Card);
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
