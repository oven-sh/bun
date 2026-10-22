// `fail` never returns, so the call of it has the type never and nothing may stand behind it in its block: neither the test of the form of a landing nor its branch.
// Where PlaceLandings gives such a call the flag and the test, or the type of a flagged call becomes never later, the pass runner cuts what stands behind a never value, and the flag is left on a call in front of Unreachable
// (InvalidLanding rule 1 in the verifier, "a landing nobody branched on" in code generation) unless whoever cuts takes the flag away.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let failures = 0;
function fail(message: string, culprit: unknown): never {
  failures++;
  throw new Error(message + ": " + String(culprit));
}

function pick(list: (Point | undefined)[], index: number): Point {
  const found = list[index];
  if (found === undefined) fail("nothing at", index);
  return found;
}

function holder(list: (Point | undefined)[], index: number, p: Point): string {
  const before = p.x + p.y;
  let picked: string;
  try {
    picked = String(pick(list, index).x);
  } catch (error) {
    picked = (error as Error).message;
  }
  return before + " " + picked + " " + (p.x + p.y);
}

const list = [new Point(1, 2), undefined, new Point(3, 4)];
for (let round = 0; round < 300; round++) {
  const line = holder(list, round % 3, new Point(round, 1));
  if (round < 3 || round === 299) console.log(round + ": " + line);
}
console.log(failures);
