// Loops whose small `if`s hang on an element read in the same turn. Where the arms only compute, the compiler may take both and choose; where an arm stores, calls, throws, reads memory or divides, it may not.
// CALLS+ keepSevens equality with[^.]* 7 
// CALLS+ callForSevens equality with[^.]* 7 
// CALLS+ countSevensOfCounter equality with[^.]* 7 
function countPositive(values: Int32Array): number {
  let n = 0;
  for (let i = 0; i < values.length; i++) if (values[i]! > 0) n++;
  return n;
}
function splitSums(values: Int32Array): string {
  let odd = 0;
  let even = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v & 1) odd = (odd + v) | 0;
    else even = (even - v) | 0;
  }
  return odd + " " + even;
}
function streaks(values: Int32Array): string {
  let best = 0;
  let streak = 0;
  let flips = 0;
  let wasOdd = false;
  for (let i = 0; i < values.length; i++) {
    const odd = (values[i]! & 1) === 1;
    if (odd) streak = 0;
    else {
      streak++;
      if (best < streak) best = streak;
    }
    if (odd !== wasOdd) flips++;
    wasOdd = odd;
  }
  return best + " " + flips;
}
function extremes(values: Int32Array): string {
  let least = 2147483647;
  let most = -2147483648;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v < least) least = v;
    if (v > most) most = v;
  }
  return least + " " + most;
}
function clampedSum(values: Int32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    let x = values[i]!;
    if (x < 0) x = 0;
    else if (x > 255) x = 255;
    sum += x;
  }
  return sum;
}
function lamp(bytes: Uint8Array): string {
  let lit = 0;
  let turnedOff = 0;
  let weight = 0;
  let isLit = false;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i]!;
    if (isLit && c < 60) {
      isLit = false;
      turnedOff++;
    } else if (c > 100) isLit = true;
    if (isLit) lit++;
    weight += c === 44 || c > 105 ? 2 : 1;
  }
  return lit + " " + turnedOff + " " + weight;
}
function aboveThreshold(samples: Float64Array, threshold: number): string {
  let n = 0;
  let notBelow = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    if (s > threshold) n++;
    if (!(s < threshold)) notBelow++;
  }
  return n + " " + notBelow;
}
function keepPositive(values: Int32Array, kept: Int32Array): string {
  let k = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v > 0) kept[k++] = v;
  }
  return k + " " + kept[0] + " " + kept[k - 1] + " " + kept[k];
}
let calls = 0;
const noted: ((v: number) => number)[] = [v => { calls++; return v & 3; }];
function callForNegative(values: Int32Array): string {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v < 0) sum += noted[0]!(v);
  }
  return sum + " " + calls;
}
function countSevens(values: Int32Array): number {
  let n = 0;
  for (let i = 0; i < values.length; i++) if ((values[i]! & 15) === 7) n++;
  return n;
}
function keepSevens(values: Int32Array, kept: Int32Array): number {
  let k = 0;
  for (let i = 0; i < values.length; i++) if ((values[i]! & 15) === 7) kept[k++] = i;
  return k;
}
function callForSevens(values: Int32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) if ((values[i]! & 15) === 7) sum += noted[0]!(i);
  return sum;
}
function countSevensOfCounter(turns: number): number {
  let n = 0;
  let wheel = 0;
  for (let i = 0; i < turns; i++) {
    wheel = (wheel + 3) & 15;
    if (wheel === 7) n++;
  }
  return n;
}
function quotients(values: Int32Array): string {
  let q = 0;
  let r = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]! & 7;
    if (v !== 0) q = (q + ((1000 / v) | 0)) | 0;
    if (v !== 0) r = (r + (1000 % v)) | 0;
  }
  return q + " " + r;
}
function lookedUp(values: Int32Array, table: Int32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v >= 0 && v < table.length) sum += table[v]!;
  }
  return sum;
}
function throwsAtZero(values: Int32Array): string {
  let n = 0;
  try {
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      if (v === 0) throw new RangeError("zero at " + i);
      n++;
    }
  } catch (error) {
    return n + " " + (error as Error).message;
  }
  return n + " none";
}
function stopsAtFirst(values: Int32Array, wanted: number): number {
  let at = -1;
  for (let i = 0; i < values.length; i++) {
    if (values[i]! === wanted) {
      at = i;
      break;
    }
  }
  return at;
}
function skipsOdd(values: Int32Array): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (v & 1) continue;
    sum = (sum + v) | 0;
  }
  return sum;
}
interface Item { flag: boolean; weight: number }
function flagged(items: Item[]): string {
  let n = 0;
  let heavy = 0;
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    if (item.flag) n++;
    if (item.weight > 50) heavy++;
  }
  return n + " " + heavy;
}
function inPlainArray(numbers: number[]): string {
  let positive = 0;
  let whole = 0;
  for (let i = 0; i < numbers.length; i++) {
    const v = numbers[i]!;
    if (v > 0) positive++;
    if (v === Math.floor(v)) whole++;
  }
  return positive + " " + whole;
}
function largeCounter(values: Int32Array, from: number): number {
  let n = from;
  for (let i = 0; i < values.length; i++) if (values[i]! > 0) n++;
  return n;
}
function swapsOnSign(values: Int32Array): string {
  let a = 1;
  let b = 2;
  for (let i = 0; i < values.length; i++) {
    if (values[i]! < 0) {
      const t = a;
      a = b;
      b = t;
    }
  }
  return a + " " + b;
}

function fill(size: number, seed: number): Int32Array {
  const made = new Int32Array(size);
  let state = seed;
  for (let i = 0; i < size; i++) {
    state = (Math.imul(state, 22695477) + 1) >>> 0;
    made[i] = (state >>> 8) - (1 << 23);
  }
  return made;
}
for (const size of [0, 1, 2, 3, 17, 1000]) {
  const values = fill(size, 987654321 + size);
  const small = values.map(v => v % 300);
  const bytes = new Uint8Array(size);
  const samples = new Float64Array(size);
  const items: Item[] = [];
  const numbers: number[] = [];
  for (let i = 0; i < size; i++) {
    const pick = (values[i]! >>> 4) & 15;
    bytes[i] = pick === 0 ? 59 : pick < 4 ? 44 : pick < 7 ? 65 + pick : 97 + pick;
    samples[i] = pick === 1 ? NaN : pick === 2 ? -0 : values[i]! / 1000;
    items.push({ flag: (pick & 1) === 1, weight: pick * 7 });
    numbers.push(pick === 3 ? NaN : pick === 4 ? 0.5 : values[i]!);
  }
  console.log(size, countPositive(values), splitSums(values), streaks(values), extremes(values), clampedSum(small), lamp(bytes), aboveThreshold(samples, 0));
  console.log(size, size ? keepPositive(values, new Int32Array(size + 1)) : "-", callForNegative(values), quotients(values), lookedUp(small, fill(200, 5)), throwsAtZero(small), stopsAtFirst(small, small[size >> 1] ?? 0), skipsOdd(values));
  console.log(size, flagged(items), inPlainArray(numbers), largeCounter(values, 2147483640), largeCounter(values, 9007199254740000), swapsOnSign(values));
}
const sevens = new Int32Array([7, 0, 7, 7, -7, 8, 6, 7]);
console.log(countSevens(sevens), keepSevens(sevens, new Int32Array(8)), callForSevens(sevens), countSevensOfCounter(100));
const edges = new Int32Array([0, -1, 1, -2147483648, 2147483647, 0, 0, -1, -1, 5]);
console.log(countPositive(edges), splitSums(edges), streaks(edges), extremes(edges), clampedSum(edges), swapsOnSign(edges), throwsAtZero(edges));
