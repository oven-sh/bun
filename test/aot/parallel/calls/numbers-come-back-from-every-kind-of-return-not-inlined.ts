// Flags: --aot-validate --aot-disable=InlineCalls
// A function hands a number back in the form that fits all it returns: an integer, a double, a number or undefined. Functions that end in a call of another hand on what that one returns.
declare const process: { argv: string[] };
const seed: number = process.argv.length > 99 ? 7 : 3;
const out: string[] = [];
function show(name: string, value: unknown): void {
  out.push(name + " " + (Object.is(value, -0) ? "-0" : String(value)) + " " + typeof value);
}

enum Direction { Up, Down, Left, Right }
function step(direction: Direction, position: number, width: number): number {
  switch (direction) {
    case Direction.Up: return position - width;
    case Direction.Down: return position + width;
    case Direction.Left: return position - 1;
    case Direction.Right: return position + 1;
  }
}
function product(a: number, b: number): number { return Math.imul(a, b); }
function zeros(a: number): number { return Math.clz32(a); }
function size(a: number): number { return Math.abs(a); }
function middle(low: number, high: number): number { return Math.floor((low + high) / 2); }

function half(value: number): number { return value / 2; }
function halfOrNothing(value: number, skip: boolean): number | undefined {
  if (skip) return undefined;
  return half(value);
}
function halfOrNull(value: number, skip: boolean): number | null {
  if (skip) return null;
  return half(value);
}
function throughTwo(value: number, skip: boolean): number | undefined { return halfOrNothing(value, skip); }
function alwaysThere(value: number): number { return halfOrNothing(value, false) as number; }

function wide(value: number): number { return (value | 0) + 4294967296; }
function wideOrNothing(value: number, skip: boolean): number | undefined {
  if (skip) return undefined;
  return wide(value);
}
function wideThere(value: number): number { return wideOrNothing(value, false) as number; }

function flipped(value: number): number { return ~value; }
function fractionOrFlipped(value: number, fraction: boolean): number {
  if (fraction) return value + 0.5;
  return flipped(value);
}
function countDown(value: number): number {
  if (value <= 0) return 0;
  return countDown((value - 1) | 0);
}
function even(value: number): number { return value === 0 ? 1 : odd((value - 1) | 0); }
function odd(value: number): number { return value === 0 ? 0 : even((value - 1) | 0); }

let depth = 0;
function work(value: number): number {
  if (value < 0) throw new RangeError("negative");
  return value * 2 + depth;
}
function enter(value: number): number {
  depth++;
  try {
    return work(value);
  } finally {
    depth--;
  }
}
function isSmall(value: number): unknown { return value < 10; }
function minusZero(value: number): number { return value * -0; }
function notANumber(value: number): number { return value / 0 - value / 0; }
function notANumberOrNothing(value: number, skip: boolean): number | undefined {
  if (skip) return undefined;
  return notANumber(value);
}

const handed: ((value: number) => unknown)[] = [half, wide, flipped, size, zeros, countDown, alwaysThere, wideThere, minusZero, notANumber, isSmall, enter];

for (let turn = 0; turn < 3; turn++) {
  const n = seed + turn;
  for (let direction = -1; direction < 6; direction++) show("step " + direction, step(direction as Direction, n + 0.25, 2));
  show("product", product(n * 65537, 65537) ^ product(n, 7));
  show("product alone", product(2147483647, n));
  show("zeros", zeros(n) + zeros(0));
  show("size", size(-2147483648) + size(-n));
  show("middle", middle(2147483647, 2147483647 - n));
  show("half or nothing", halfOrNothing(n, turn === 1));
  show("half or null", halfOrNull(n, turn === 1));
  show("through two", throughTwo(n, turn === 2));
  show("always there", alwaysThere(n) + 1);
  show("wide", wide(-n) + wide(n));
  show("wide or nothing", wideOrNothing(n, turn === 0));
  show("wide there", wideThere(n) - 1);
  show("fraction or flipped", fractionOrFlipped(n, turn === 1));
  show("count down", countDown(n * 1000));
  show("even", even(n * 1001));
  show("enter", enter(n));
  try { enter(-n); } catch (error) { show("thrown", (error as Error).message + " " + depth); }
  show("is small", isSmall(n * 3));
  show("minus zero", minusZero(n));
  show("1 / minus zero", 1 / minusZero(n));
  show("not a number", notANumber(n));
  show("not a number or nothing", notANumberOrNothing(n, turn === 1));
  for (const callee of handed) show("handed " + callee.name, callee(n));
}
console.log(out.join("\n"));
