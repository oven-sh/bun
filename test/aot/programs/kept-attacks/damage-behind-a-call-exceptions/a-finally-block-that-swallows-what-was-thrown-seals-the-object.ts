// A typed caller reads an object, makes a call and reads it again. A function that then throws. A return statement in a finally block of the callee swallows what was thrown. That function seals the object, which has an optional field that is not there yet.
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
  Object.seal(target);
  return true;
}

function risky(): void {
  if (strike()) throw new Error("behind the damage");
}
function callee(round: number): number {
  try {
    risky();
  } finally {
    return round & 3;
  }
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
  if (round === 150 || round === 151 || round === 299) victim = p;
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
