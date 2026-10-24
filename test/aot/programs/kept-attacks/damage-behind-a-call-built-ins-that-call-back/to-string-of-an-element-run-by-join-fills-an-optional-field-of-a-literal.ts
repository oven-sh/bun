// A typed caller reads an object, makes a call and reads it again. The toString method of an element, which Array.prototype.join in the callee runs, fills an optional field of the object, which an object literal has made without it, in typed code.
type Pair = { left: number; right: number; note?: string };

let victim: Pair | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  target.note = "filled";
  return true;
}

const parts = [
  "a",
  {
    toString(): string {
      return strike() ? "struck" : "b";
    },
  },
];
function callee(round: number): number {
  return parts.join().length + (round & 3);
}

function holder(p: Pair, round: number): string {
  const before = p.left + p.right + ":" + p.note;
  const got = callee(round);
  const after = p.note + "," + p.left + "," + Object.keys(p).join("");
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Pair = { left: round, right: round + 1 };
  const before = p.left + p.right + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  const after = p.note + "," + p.left + "," + Object.keys(p).join("");
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
