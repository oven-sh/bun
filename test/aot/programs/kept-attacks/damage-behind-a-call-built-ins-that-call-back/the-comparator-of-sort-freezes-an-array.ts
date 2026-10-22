// A typed caller reads an array, makes a call and reads it again. The comparator of Array.prototype.sort, which the callee calls, freezes the array.

let victim: number[] | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  Object.freeze(target);
  return true;
}

function callee(round: number): number {
  const sorted = [3, 1, 2].sort((left, right) => {
    strike();
    return left - right;
  });
  return sorted[0] + (round & 3);
}

function holder(p: number[], round: number): string {
  const before = p[0] + p[3] + p.length;
  const got = callee(round);
  let stored = "stored";
  try {
    p[0] = 9;
    p.push(1);
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p[0] + "," + p.length;
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: number[] = [round, round + 1, round + 2, round + 3];
  const before = p[0] + p[3] + p.length;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  let stored = "stored";
  try {
    p[0] = 9;
    p.push(1);
  } catch (error) {
    stored = (error as Error).name;
  }
  const after = stored + "," + p[0] + "," + p.length;
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
