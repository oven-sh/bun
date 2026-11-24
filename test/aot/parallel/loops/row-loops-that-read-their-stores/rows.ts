// Each round warms all bricks of a kiln, and some brick is asked behind it. What a round stores decides whether another one follows.
const note: number[] = [0.5, 0.75, 1];
let ceiling = 4;

function firstOver(bricks: number[], flame: number[], rounds: number, most: number): number {
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] + flame[at];
    if (bricks[0] > most) return round;
  }
  return -1;
}
function lastOver(bricks: number[], flame: number[], rounds: number, most: number): number {
  let turned = 0;
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < bricks.length; at++) bricks[at] += flame[at];
    if (bricks[bricks.length - 1] - most > 0) break;
  }
  for (let at = 0; at < bricks.length; at++) turned += bricks[at];
  return turned;
}
function cracks(bricks: number[], flame: number[], rounds: number, most: number): number {
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] + flame[at];
    if (bricks[1] >= most) throw new RangeError("cracked");
  }
  return 0;
}
function cooledDown(bricks: number[], flame: number[], rounds: number, most: number): number {
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] + flame[at];
    if (bricks[0] > most) bricks[0] = 0;
  }
  return bricks[0];
}
function ofTwo(bricks: number[], flame: number[], rounds: number, most: number): number {
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] + flame[at];
    if (bricks[0] + bricks[1] > most * 2) return round;
    if (Math.abs(bricks[2]) > most) return -round - 2;
  }
  return -1;
}
function halves(bricks: number[], flame: number[], rounds: number, most: number): number {
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] * 0.5 + flame[at];
    if (!(bricks[0] / 2 < most / 4)) return round;
  }
  return -1;
}
function underAnotherName(bricks: number[], same: number[], flame: number[], rounds: number, most: number): number {
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] + flame[at];
    if (same[0] > most) return round;
  }
  return -1;
}
function ofTheFlame(bricks: number[], flame: number[], rounds: number, most: number): number {
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] + flame[at];
    if (flame[0] > most) return round;
  }
  return -1;
}
function ofARow(kilns: number[][], flame: number[], rounds: number, most: number): number {
  const front = kilns[0];
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < front.length; at++) front[at] = front[at] + flame[at];
    if (kilns[0][1] > most) return round;
  }
  return -1;
}
function inFront(bricks: number[], flame: number[], rounds: number, most: number): number {
  for (let round = 0; round < rounds; round++) {
    if (bricks[0] > most) return round;
    for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] + flame[at];
  }
  return -1;
}
function inThree(bricks: number[], flame: number[], days: number, rounds: number, most: number): number {
  let ended = 0;
  for (let day = 0; day < days; day++) {
    for (let round = 0; round < rounds; round++) {
      for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] + flame[at];
      if (bricks[0] > most) break;
    }
    ended += bricks[0];
    bricks[0] = 0.25;
  }
  return ended;
}
function underTheCeiling(flame: number[], rounds: number): number {
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < note.length; at++) note[at] = note[at] + flame[at];
    if (note[0] > ceiling) return round;
  }
  return -1;
}
class Kiln {
  bricks: number[];
  most: number;
  constructor(bricks: number[], most: number) {
    this.bricks = bricks;
    this.most = most;
  }
  fire(flame: number[], rounds: number): number {
    const bricks = this.bricks;
    for (let round = 0; round < rounds; round++) {
      for (let at = 0; at < bricks.length; at++) bricks[at] = bricks[at] + flame[at];
      if (bricks[0] > this.most) return round;
    }
    return -1;
  }
}
function mended(bricks: (number | undefined)[], flame: number[], rounds: number): number {
  for (let round = 0; round < rounds; round++) {
    for (let at = 0; at < flame.length; at++) bricks[at] = flame[at] * (round + 1);
    if (bricks[2] !== undefined) return round;
  }
  return -1;
}

const bricks = (many: number) => Array.from({ length: many }, (_, at) => at * 0.25 + 0.5);
const flame = (many: number) => Array.from({ length: many }, (_, at) => 0.125 + at * 0.0625);
function tried(named: string, fire: () => number, of: readonly unknown[]): void {
  let end: string;
  try {
    end = String(fire());
  } catch (error) {
    end = (error as Error).message;
  }
  console.log(named, end, of.join(" "));
}
for (const [many, rounds, most] of [[3, 4, 100], [4, 20, 2.5], [8, 30, 5.5], [5, 12, 0.75], [16, 9, 3], [1, 40, 2], [33, 25, 1.125]] as const) {
  const runs: [string, (over: number[], by: number[]) => number][] = [
    ["first", (over, by) => firstOver(over, by, rounds, most)],
    ["last", (over, by) => lastOver(over, by, rounds, most)],
    ["cracks", (over, by) => cracks(over, by, rounds, most)],
    ["cooled", (over, by) => cooledDown(over, by, rounds, most)],
    ["two", (over, by) => ofTwo(over, by, rounds, most)],
    ["halves", (over, by) => halves(over, by, rounds, most)],
    ["named", (over, by) => underAnotherName(over, over, by, rounds, most)],
    ["apart", (over, by) => underAnotherName(over, over.slice(), by, rounds, most)],
    ["flame", (over, by) => ofTheFlame(over, by, rounds, most)],
    ["itself", (over) => firstOver(over, over, rounds, most)],
    ["row", (over, by) => ofARow([over, by], by, rounds, most)],
    ["front", (over, by) => inFront(over, by, rounds, most)],
    ["three", (over, by) => inThree(over, by, 3, rounds, most)],
    ["kiln", (over, by) => new Kiln(over, most).fire(by, rounds)],
  ];
  for (const [named, fire] of runs) {
    const over = bricks(many);
    const by = flame(many);
    tried(named, () => fire(over, by), over);
  }
}
tried("ceiling", () => underTheCeiling([0.5, 0.25, 0.125], 30), note);
ceiling = 60;
tried("ceiling", () => underTheCeiling([0.5, 0.25, 0.125], 300), note);
const holed: (number | undefined)[] = [0.5, 0.75, , 1.5];
tried("mended", () => mended(holed, [0.5, 0.25, 0.125, 1], 6), holed);
console.log("END");
export {};
