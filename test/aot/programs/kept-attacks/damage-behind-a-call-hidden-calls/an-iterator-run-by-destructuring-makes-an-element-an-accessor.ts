// A typed caller reads an array, makes a call and reads it again. An iterator, which a destructuring in the callee runs, makes an element of the array an accessor.

let victim: number[] | null = null;
function strike(): boolean {
  const target = victim;
  if (target === null) return false;
  victim = null;
  Object.defineProperty(target, 1, { get: () => -5, configurable: true });
  return true;
}

const pair: Iterable<number> = {
  [Symbol.iterator]() {
    let step = 0;
    return {
      next(): IteratorResult<number> {
        if (++step === 2) strike();
        return { done: false, value: step };
      },
    };
  },
};
function callee(round: number): number {
  const [first, second] = pair;
  return first + second + (round & 3);
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
