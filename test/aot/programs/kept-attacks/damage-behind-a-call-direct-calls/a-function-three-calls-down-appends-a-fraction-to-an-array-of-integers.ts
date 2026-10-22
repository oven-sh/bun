// A typed caller reads an array, makes a call and reads it again. A function three calls further down appends a fraction to an array that has held only small integers, which its type allows.

let victim: number[] | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  target.push(0.5);
  return true;
}

function third(round: number): number {
  strike();
  return round & 3;
}
function second(round: number): number {
  return third(round) + 1;
}
function callee(round: number): number {
  return second(round) + 1;
}

function holder(p: number[], round: number): string {
  const before = p[0] + p[3] + p.length;
  const got = callee(round);
  let sum = 0;
  for (let index = 0; index < p.length; index++) sum += p[index];
  const after = sum + "," + p.length + "," + p[1] + "," + p[3];
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: number[] = [round, round + 1, round + 2, round + 3];
  const before = p[0] + p[3] + p.length;
  if (round === 150 || round === 151 || round === 299) victim = p;
  const inner = holder(p, round);
  let sum = 0;
  for (let index = 0; index < p.length; index++) sum += p[index];
  const after = sum + "," + p.length + "," + p[1] + "," + p[3];
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
