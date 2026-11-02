// x % y where x or y has a fraction: constant and variable divisors, typed and untyped, dividends on and beside multiples of the divisor, minus zero, huge, tiny and no number.
declare const process: { argv: string[] };
const extra: number = process.argv.length > 99 ? 1 : 0;

const cell = new Float64Array(1);
const cellBits = new BigInt64Array(cell.buffer);
const cellWords = new Uint32Array(cell.buffer);
function stepped(value: number, steps: number): number {
  if (!Number.isFinite(value) || value === 0) return value;
  cell[0] = value;
  cellBits[0] += BigInt(steps);
  return cell[0];
}
function text(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

const byConstant: [string, number, (x: number) => number][] = [
  ["1000.5", 1000.5, x => x % 1000.5],
  ["-1000.5", -1000.5, x => x % -1000.5],
  ["0.5", 0.5, x => x % 0.5],
  ["0.25", 0.25, x => x % 0.25],
  ["1.5", 1.5, x => x % 1.5],
  ["2.5", 2.5, x => x % 2.5],
  ["0.1", 0.1, x => x % 0.1],
  ["-0.1", -0.1, x => x % -0.1],
  ["0.3", 0.3, x => x % 0.3],
  ["0.001", 0.001, x => x % 0.001],
  ["1e-9", 1e-9, x => x % 1e-9],
  ["pi", 3.141592653589793, x => x % 3.141592653589793],
  ["2 pi", 6.283185307179586, x => x % 6.283185307179586],
  ["a third", 0.3333333333333333, x => x % 0.3333333333333333],
  ["just over 3", 3.0000000000000004, x => x % 3.0000000000000004],
  ["just under 2048", 2047.9999999999998, x => x % 2047.9999999999998],
  ["26 bits", 32.00000095367432, x => x % 32.00000095367432],
  ["27 bits", 32.00000047683716, x => x % 32.00000047683716],
  ["123456789.125", 123456789.125, x => x % 123456789.125],
  ["1000000000000000.1", 1000000000000000.1, x => x % 1000000000000000.1],
  ["2", 2, x => x % 2],
  ["3", 3, x => x % 3],
  ["-7", -7, x => x % -7],
  ["10", 10, x => x % 10],
  ["360", 360, x => x % 360],
  ["1000", 1000, x => x % 1000],
  ["86400000", 86400000, x => x % 86400000],
  ["1000003", 1000003, x => x % 1000003],
  ["4294967296", 4294967296, x => x % 4294967296],
  ["4294967297", 4294967297, x => x % 4294967297],
  ["9007199254740991", 9007199254740991, x => x % 9007199254740991],
  ["1e150", 1e150, x => x % 1e150],
  ["3e150", 3.2733906078961419e150, x => x % 3.2733906078961419e150],
  ["4e150", 4e150, x => x % 4e150],
  ["1e-150", 1e-150, x => x % 1e-150],
  ["3e-151", 3.0549363634996047e-151, x => x % 3.0549363634996047e-151],
  ["2e-151", 2e-151, x => x % 2e-151],
  ["1e300", 1e300, x => x % 1e300],
  ["1e-300", 1e-300, x => x % 1e-300],
  ["largest", 1.7976931348623157e308, x => x % 1.7976931348623157e308],
  ["smallest", 5e-324, x => x % 5e-324],
  ["1", 1, x => x % 1],
  ["-1", -1, x => x % -1],
  ["0", 0, x => x % 0],
  ["-0", -0, x => x % -0],
  ["Infinity", Infinity, x => x % Infinity],
  ["-Infinity", -Infinity, x => x % -Infinity],
  ["NaN", NaN, x => x % NaN],
];

function byVariable(x: number, y: number): number {
  return x % y;
}
function untyped(x: any, y: any): any {
  return x % y;
}

const fixed: number[] = [
  0, -0, 5e-324, -5e-324, 2.2250738585072014e-308, 1e-300, 1e-20, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 7, 9.99, 10, 10.5, 359.5, 360, 360.25, 719.75, 1000, 1000.25, 1000.5, 1000.75, 2001,
  2001.5, 3001.5, 12345.678, 65535.5, 1e6 + 0.5, 67108863.5, 67108864, 67108864.5, 134217727.75, 4294967295.5, 4294967296, 1e10 + 0.25, 1e12 + 0.125, 4503599627370495.5, 4503599627370496, 9007199254740991,
  9007199254740992, 1e16, 1e17, 4611686018427387904, 9223372036854775808, 1e19, 1e22, 1e50, 1e100, 1e150, 1e200, 1e300, 1.0715086071862673e301, 1.7976931348623157e308, Infinity, NaN,
];
const factors: number[] = [1, 2, 3, 5, 1000, 33554431, 67108863, 67108864, 67108865, 134217728, 4398046511103, 4398046511104, 562949953421311, 562949953421312, 562949953421313, 4503599627370497, 9007199254740991];

function dividendsFor(divisor: number): number[] {
  const list: number[] = [];
  for (const value of fixed) list.push(value + extra, -(value + extra));
  const magnitude = Math.abs(divisor);
  for (const factor of factors) {
    const multiple = magnitude * factor;
    for (let steps = -2; steps <= 2; steps++) list.push(stepped(multiple, steps), -stepped(multiple, steps));
    list.push(multiple + magnitude / 2, multiple + magnitude / 3, -(multiple + magnitude / 7));
  }
  return list;
}

let state = 12345 + extra;
function nextWord(): number {
  state = (Math.imul(state, 1103515245) + 12345) | 0;
  return state >>> 0;
}
function mixed(hash: number, value: number): number {
  cell[0] = value;
  const low = value !== value ? 1 : cellWords[0];
  const high = value !== value ? 2 : cellWords[1];
  return (Math.imul(hash ^ low, 16777619) ^ Math.imul(high, 40503)) | 0;
}

for (const [name, divisor, remainder] of byConstant) {
  const dividends = dividendsFor(divisor);
  const answers: string[] = [];
  let disagreements = 0;
  for (const dividend of dividends) {
    const answer = remainder(dividend);
    answers.push(text(answer));
    if (!Object.is(answer, byVariable(dividend, divisor)) || !Object.is(answer, untyped(dividend, divisor))) disagreements++;
  }
  console.log(name + ": " + answers.join(" "));

  let hash = 0;
  const magnitude = Number.isFinite(divisor) && divisor !== 0 ? Math.abs(divisor) : 1;
  for (let round = 0; round < 4000; round++) {
    const fraction = 1 + nextWord() / 4294967296 + nextWord() / 18446744073709551616;
    const scale = 2 ** ((nextWord() % 64) - 6);
    const dividend = magnitude * fraction * scale * (nextWord() & 1 ? 1 : -1);
    const answer = remainder(dividend);
    hash = mixed(hash, answer);
    if (!Object.is(answer, byVariable(dividend, divisor)) || !Object.is(answer, untyped(dividend, divisor))) disagreements++;
  }
  console.log(name + ": hash " + hash + ", the three ways disagree " + disagreements + " times");
}

let wrapped = 0.25;
let chaotic = 0.5;
let hue = 0.5;
for (let round = 0; round < 100000; round++) {
  wrapped = (wrapped + 0.01) % 6.283185307179586;
  chaotic = (chaotic * 3 + 1) % 1000.5;
  hue = (hue * 3 - 1.25) % 360;
}
console.log(wrapped, chaotic, hue);
