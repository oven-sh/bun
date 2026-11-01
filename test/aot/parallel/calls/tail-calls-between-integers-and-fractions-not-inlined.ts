// Flags: --aot-validate --aot-disable=InlineCalls
// Functions that end in a call of another, where one returns integers and the other fractions, or a number or undefined. A chain that comes to an end may keep its frames.
// Functions that call each other last, a million deep, may not.
declare const process: { argv: string[] };
const seed: number = process.argv.length > 99 ? 7 : 3;
const out: string[] = [];
function show(name: string, value: unknown): void {
  out.push(name + " " + (Object.is(value, -0) ? "-0" : String(value)) + " " + typeof value);
}

function whole(x: number): number { return x | 0; }
function halfOrWhole(x: number): number { return x > 0 ? x * 0.5 : whole(x); }
function length(s: string): number { return s.length; }
function lengthOrHalf(s: string, x: number): number { return x > 0 ? x * 0.5 : length(s); }
function maybe(x: number): number | undefined { return x > 1 ? x : undefined; }
function maybeOrWhole(x: number): number | undefined { return x > 0 ? maybe(x) : whole(x); }
function wide(x: number): number { return (x | 0) + 4294967296; }
function wideOrWhole(x: number): number { return x > 0 ? wide(x) : whole(x); }
function fractionOrWide(x: number): number { return x > 2 ? x / 3 : wideOrWhole(x); }
function throughThree(x: number): number { return fractionOrWide(x); }

function fractionDown(n: number, sum: number): number { return n <= 0 ? sum + 0.5 : integerDown((n - 1) | 0, sum); }
function integerDown(n: number, sum: number): number { return n <= 0 ? sum | 0 : fractionDown((n - 1) | 0, sum + 1); }
function countDown(n: number): number { return n <= 0 ? 0 : countDown((n - 1) | 0); }
function countDownThenHalf(n: number): number { return n > 10 ? countDown(n) : n / 2; }

for (let turn = 0; turn < 3; turn++) {
  for (const x of [seed + turn, -seed - 0.75, 0, -0, 0.5, 1.5, 2147483647.5, -2147483649, NaN, Infinity]) {
    show("half or whole", halfOrWhole(x));
    show("whole", whole(x) + 1);
    show("length or half", lengthOrHalf("abc", x));
    show("maybe or whole", maybeOrWhole(x));
    show("wide or whole", wideOrWhole(x));
    show("fraction or wide", fractionOrWide(x));
    show("through three", throughThree(x) * 2);
  }
  show("fraction down", fractionDown(1000001 + turn, 0));
  show("integer down", integerDown(1000001 + turn, 0));
  show("count down then half", countDownThenHalf(1000000 + turn));
  show("count down then half, short", countDownThenHalf(seed + turn));
}
console.log(out.join("\n"));
