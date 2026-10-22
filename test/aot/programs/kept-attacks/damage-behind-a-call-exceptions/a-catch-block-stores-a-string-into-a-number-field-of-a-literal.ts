// A typed caller reads an object, makes a call and reads it again. The catch block of the callee stores a string into a number field of the object, which an object literal has made.
type Pair = { left: number; right: number; note?: string };

let victim: Pair | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  (target as any).right = "text";
  return true;
}

function fails(round: number): number {
  if (round % 50 < 2 || round === 299) throw new Error("now and then");
  return round & 3;
}
function callee(round: number): number {
  try {
    return fails(round) + 1;
  } catch {
    strike();
    return -1;
  }
}

function holder(p: Pair, round: number): string {
  const before = p.left + p.right + ":" + p.note;
  const got = callee(round);
  const after = p.left + "," + (p.right + 1) + "," + typeof p.right;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Pair = { left: round, right: round + 1 };
  const before = p.left + p.right + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  const after = p.left + "," + (p.right + 1) + "," + typeof p.right;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
