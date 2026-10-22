// A hot loop keeps ten numbers live across a path taken every 1,000th turn, which calls functions, allocates and calls Math.random.
interface Sample {
  turn: number;
  total: number;
}

let rareTurns = 0;
let randomsOutOfRange = 0;
let samples: Sample[] = [];

function countRareTurn(): void {
  rareTurns++;
}
function newestSample(): Sample | undefined {
  return samples[samples.length - 1];
}
function addSample(turn: number, total: number): void {
  samples.push({ turn, total });
}

function sumWithRarePath(turns: number): number {
  let a = 1, b = 2, c = 3, d = 4, e = 5, v = 0.5, w = 1.5, x = 2.5, y = 3.5, z = 4.5;
  for (let turn = 0; turn < turns; turn++) {
    a = (a + turn) | 0;
    b = ((b ^ a) + 3) | 0;
    c = (c + (b & 255)) | 0;
    d = (d * 31 + c) | 0;
    e = (e + (d >>> 28)) | 0;
    v += 0.5;
    w += v * 0.25;
    x = x * 0.999 + w * 0.001;
    y += (a & 7) * 0.125;
    z = z * 0.5 + y;
    if (turn % 1000 === 999) {
      countRareTurn();
      addSample(turn, a + v);
      const pair = [newestSample(), { turn, total: e + z }];
      if (pair[0] === pair[1] || pair[0]!.turn !== pair[1]!.turn) throw new Error("wrong sample at turn " + turn);
      const random = Math.random();
      if (!(random >= 0 && random < 1)) randomsOutOfRange++;
    }
  }
  return a + b + c + d + e + v + w + x + y + z;
}

function sumWithoutRarePath(turns: number): number {
  let a = 1, b = 2, c = 3, d = 4, e = 5, v = 0.5, w = 1.5, x = 2.5, y = 3.5, z = 4.5;
  for (let turn = 0; turn < turns; turn++) {
    a = (a + turn) | 0;
    b = ((b ^ a) + 3) | 0;
    c = (c + (b & 255)) | 0;
    d = (d * 31 + c) | 0;
    e = (e + (d >>> 28)) | 0;
    v += 0.5;
    w += v * 0.25;
    x = x * 0.999 + w * 0.001;
    y += (a & 7) * 0.125;
    z = z * 0.5 + y;
  }
  return a + b + c + d + e + v + w + x + y + z;
}

// 999 turns never reach the rare path, 1,000 reach it in the last turn.
for (const turns of [0, 999, 1000, 1001, 250_000, 1_000_000]) {
  rareTurns = 0;
  samples = [];
  const sum = sumWithRarePath(turns);
  const expected = sumWithoutRarePath(turns);
  let sampleTotal = 0;
  for (const sample of samples) sampleTotal += sample.total + sample.turn;
  console.log(turns, sum === expected ? "equal" : "different", sum, expected, rareTurns, samples.length, sampleTotal);
}
console.log("randoms out of range:", randomsOutOfRange);
export {};
