// A typed caller reads an object, makes a call and reads it again. The reviver of JSON.parse, which the callee calls, defines a getter on the prototype object under the name of an optional field that the object does not have.
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
  Object.defineProperty(Card.prototype, "note", { get: () => "from above", configurable: true });
  return true;
}

function callee(round: number): number {
  return JSON.parse("[1,2]", (key, value) => (key === "1" && strike() ? 10 : value))[1] + (round & 3);
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
  delete (Card.prototype as any).note;
}
console.log("digest " + digest);
