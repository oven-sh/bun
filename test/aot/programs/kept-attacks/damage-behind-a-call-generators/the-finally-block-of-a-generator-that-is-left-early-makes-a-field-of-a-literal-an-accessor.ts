// A typed caller reads an object, makes a call and reads it again. The finally block of a generator, which runs because a loop in the callee is left early, makes a field of the object, which an object literal has made, an accessor.
// `strike` multiplies a variable that is declared a number. In the rounds of the damage the variable holds an object, so the multiplication leaves its typed path and runs valueOf, which does the damage.
type Pair = { left: number; right: number; note?: string };

let victim: Pair | null = null;
let spark: number = 0;
const hot: any = {
  valueOf(): number {
    spark = 0;
    const target = victim;
    if (target === null) return 0;
    victim = null;
    Object.defineProperty(target, "left", { get: () => -7, enumerable: true, configurable: true });
    return 1;
  },
};
function strike(): boolean {
  return spark * 1 === 1;
}

function* steps(): Generator<number> {
  try {
    yield 1;
    yield 2;
  } finally {
    strike();
  }
}
function callee(round: number): number {
  for (const step of steps()) return step + (round & 3);
  return -1;
}

function holder(p: Pair, round: number): string {
  const before = p.left + p.right + ":" + p.note;
  const got = callee(round);
  const after = p.left + "," + p.right + "," + JSON.stringify(p);
  return before + " " + got + " " + after;
}

function outer(round: number): string {
  const p: Pair = { left: round, right: round + 1 };
  const before = p.left + p.right + ":" + p.note;
  if (round === 150 || round === 151 || round === 299) {
    victim = p;
    spark = hot;
  }
  const inner = holder(p, round);
  const after = p.left + "," + p.right + "," + JSON.stringify(p);
  return before + " [" + inner + "] " + after;
}

let digest = 0;
for (let round = 0; round < 300; round++) {
  const line = outer(round);
  for (let index = 0; index < line.length; index++) digest = (digest * 31 + line.charCodeAt(index)) | 0;
  if (round < 2 || (round >= 149 && round <= 152) || round === 299) console.log(round + ": " + line);
}
console.log("digest " + digest);
