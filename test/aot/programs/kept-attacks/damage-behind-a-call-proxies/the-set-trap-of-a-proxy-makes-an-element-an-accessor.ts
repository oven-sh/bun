// A typed caller reads an array, makes a call and reads it again. The set trap of a proxy, which a store to a property in the callee runs, makes an element of the array an accessor.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.

let victim: number[] | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    Object.defineProperty(target, 1, { get: () => -5, configurable: true });
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

const watched = new Proxy(
  { level: 1 },
  {
    set(target, key, value, receiver) {
      strike();
      return Reflect.set(target, key, value, receiver);
    },
  },
);
function callee(round: number): number {
  watched.level = round;
  return round & 3;
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
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    spark = hot;
  }
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
