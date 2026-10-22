// FOR "THE WRITER PAYS": the design lets the walk of a writer stop at the first return address that is swapped already, "older frames were swapped by the walk that swapped that one".
// That holds only if every swap on the stack was made by a walk. Two are not: the unwinder swaps the return address of whoever catches, and code generation swaps that of one activation
// in front of a rare tail call whose callee does not keep the promised type. Behind such a frame the older frames still have their plain return addresses.
// Here such a frame stands between the write and two holders. The nearer holder comes back at its landing either way. The farther one hears of the write only if the walk went on.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let throws = false;
let strikes = false;

function mayThrow(n: number): number {
  if (throws) throw new Error("nothing is damaged yet");
  return n;
}

// It catches first, so its return address is swapped and nobody else's, and does the damage afterwards.
function catchesThenStrikes(p: Point, n: number): number {
  let got = 0;
  try {
    got = mayThrow(n);
  } catch (error) {
    got = -1;
  }
  if (strikes) delete (p as any).x;
  return got;
}

function nearerHolder(p: Point, n: number): number {
  const before = p.y;
  const got = catchesThenStrikes(p, n);
  return before + got + p.y;
}

function fartherHolder(p: Point, n: number): string {
  const before = p.x;
  const got = nearerHolder(p, n);
  return before + " " + got + " " + p.x;
}

// The same with the swap that code generation makes for the sake of the type. The callee of the tail call does the damage with that one swapped address above it.
let victim: Point | null = null;
const strike = (): any => {
  if (strikes && victim !== null) delete (victim as any).x;
  return victim;
};

function rarelyEndsInCallByValue(p: Point | null, make: () => any): Point {
  if (p === null) return make();
  return p;
}

function nearerHolderOfType(p: Point, q: Point | null, make: () => any): number {
  const before = p.y;
  const got = rarelyEndsInCallByValue(q, make);
  return before + got.y + p.y;
}

function fartherHolderOfType(p: Point, q: Point | null, make: () => any): string {
  const before = p.x;
  const got = nearerHolderOfType(p, q, make);
  return before + " " + got + " " + p.x;
}

for (let round = 0; round < 400; round++) {
  throws = round % 100 === 97 || round % 100 === 99;
  strikes = round % 100 === 98 || round % 100 === 99;
  const p = new Point(round, 1);
  const first = fartherHolder(p, round);
  const q = new Point(round, 2);
  victim = q;
  const second = fartherHolderOfType(q, round % 100 >= 97 ? null : q, strike);
  if (round % 100 >= 96) console.log(round + ": " + first + " | " + second);
}
