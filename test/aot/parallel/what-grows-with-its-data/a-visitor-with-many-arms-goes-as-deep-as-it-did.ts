// A visitor calls itself once for each level; each of its 48 arms hands a small test a range that it has just made. Only one arm runs at a level: the frame of the visitor must not grow with the number of its arms.
// Sizes: 1000 4000 16000
// Passes: 20
// Grows: linear
const size = Number(process.env.SIZE ?? 1000);
const passes = Number(process.env.PASSES ?? 2);

type Range = { low: number; high: number; step: number };

function lies(range: Range, value: number): boolean {
  let at = range.low;
  for (let turn = 0; turn < 2 && at < value; turn++) at += range.step;
  return value >= range.low && value <= range.high && at >= range.low;
}

function visit(depth: number, kind: number): number {
  if (depth === 0) return 0;
  let found = 0;
  switch (kind) {
    case 0: if (lies({ low: depth + 0, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 1: if (lies({ low: depth + 1, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 2: if (lies({ low: depth + 2, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 3: if (lies({ low: depth + 0, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 4: if (lies({ low: depth + 1, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 5: if (lies({ low: depth + 2, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 6: if (lies({ low: depth + 0, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 7: if (lies({ low: depth + 1, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 8: if (lies({ low: depth + 2, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 9: if (lies({ low: depth + 0, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 10: if (lies({ low: depth + 1, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 11: if (lies({ low: depth + 2, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 12: if (lies({ low: depth + 0, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 13: if (lies({ low: depth + 1, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 14: if (lies({ low: depth + 2, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 15: if (lies({ low: depth + 0, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 16: if (lies({ low: depth + 1, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 17: if (lies({ low: depth + 2, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 18: if (lies({ low: depth + 0, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 19: if (lies({ low: depth + 1, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 20: if (lies({ low: depth + 2, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 21: if (lies({ low: depth + 0, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 22: if (lies({ low: depth + 1, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 23: if (lies({ low: depth + 2, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 24: if (lies({ low: depth + 0, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 25: if (lies({ low: depth + 1, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 26: if (lies({ low: depth + 2, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 27: if (lies({ low: depth + 0, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 28: if (lies({ low: depth + 1, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 29: if (lies({ low: depth + 2, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 30: if (lies({ low: depth + 0, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 31: if (lies({ low: depth + 1, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 32: if (lies({ low: depth + 2, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 33: if (lies({ low: depth + 0, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 34: if (lies({ low: depth + 1, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 35: if (lies({ low: depth + 2, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 36: if (lies({ low: depth + 0, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 37: if (lies({ low: depth + 1, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 38: if (lies({ low: depth + 2, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 39: if (lies({ low: depth + 0, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 40: if (lies({ low: depth + 1, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 41: if (lies({ low: depth + 2, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 42: if (lies({ low: depth + 0, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 43: if (lies({ low: depth + 1, high: depth + 8, step: 3 }, depth + 1)) found++; break;
    case 44: if (lies({ low: depth + 2, high: depth + 5, step: 3 }, depth + 1)) found++; break;
    case 45: if (lies({ low: depth + 0, high: depth + 6, step: 3 }, depth + 1)) found++; break;
    case 46: if (lies({ low: depth + 1, high: depth + 7, step: 3 }, depth + 1)) found++; break;
    case 47: if (lies({ low: depth + 2, high: depth + 8, step: 3 }, depth + 1)) found++; break;
  }
  const below = visit(depth - 1, (kind + 1) % 48);
  return found + below;
}

let total = 0;
for (let pass = 0; pass < passes; pass++) total += visit(size, pass % 48);
console.log(total, size);
