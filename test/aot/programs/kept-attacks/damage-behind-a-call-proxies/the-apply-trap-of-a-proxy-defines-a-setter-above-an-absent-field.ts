// A typed caller reads an object, makes a call and reads it again. The apply trap of a proxy around a function, which a call in the callee runs, defines a setter on the prototype object under the name of an optional field that the object does not have.
class Card {
  id: number;
  declare note?: string;
  constructor(id: number) {
    this.id = id;
  }
}
let caught = "";

let victim: Card | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  Object.defineProperty(Card.prototype, "note", {
    set(value: string) {
      caught += value;
    },
    configurable: true,
  });
  return true;
}

const watched = new Proxy((round: number) => round & 3, {
  apply(target, thisValue, list) {
    strike();
    return Reflect.apply(target, thisValue, list);
  },
});
function callee(round: number): number {
  return watched(round) + 1;
}

function holder(p: Card, round: number): string {
  const before = p.id + ":" + p.note;
  const got = callee(round);
  p.note = "mine";
  const after = p.note + "," + caught + "," + Object.keys(p).join("");
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Card = new Card(round);
  const before = p.id + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  p.note = "mine";
  const after = p.note + "," + caught + "," + Object.keys(p).join("");
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
