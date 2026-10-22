// Each callee declares that it returns a Point and now and then returns a string, each by another way out: a plain return, a rare tail call by value, a rare tail call of a function that declares more,
// a return out of a function that reads `arguments` (its return address lies below the argument registers it has spilled), a tail call with more stack words than the function was given
// (the callee returns into the stub that drops the frame of the list), and a chain of all of them. Nothing is damaged. Each holder reads a raw field of what it got with no test of its own.
// The wide tail call is also a fault of the tip: run it with --aot-disable=CleanReturns too.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

const odd: any = "odd";
let misfit = false;
const makeOdd = (): any => odd;

function plainReturn(p: Point): Point {
  return misfit ? odd : p;
}

function rareCallByValue(p: Point, make: () => any): Point {
  if (misfit) return make();
  return p;
}

function declaresMore(p: Point): Point | string {
  return misfit ? odd : p;
}
function rareCallOfWiderType(p: Point): Point {
  if (misfit) return declaresMore(p) as Point;
  return p;
}

function readsArguments(p: Point, q: any): Point {
  return arguments[misfit ? 1 : 0];
}

function wide(a: any, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number, q: number, r: number): Point {
  if (b + c + d + e + f + g + h + i + j + k + l + m + n + o + p + q + r !== 153) return odd;
  return a;
}
function narrow(a: any): Point {
  return wide(a, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17);
}

function chain(p: Point, make: () => any): Point {
  return narrow(readsArguments(rareCallOfWiderType(p), make()));
}

function holdsPlainReturn(p: Point): string {
  const got = plainReturn(p);
  return typeof got + ":" + got.x;
}
function holdsRareCallByValue(p: Point): string {
  const got = rareCallByValue(p, makeOdd);
  return typeof got + ":" + got.x;
}
function holdsRareCallOfWiderType(p: Point): string {
  const got = rareCallOfWiderType(p);
  return typeof got + ":" + got.x;
}
function holdsReadsArguments(p: Point): string {
  const got = readsArguments(p, odd);
  return typeof got + ":" + got.x;
}
function holdsNarrow(p: Point): string {
  const got = narrow(misfit ? odd : p);
  return typeof got + ":" + got.x;
}
function holdsChain(p: Point): string {
  const got = chain(p, makeOdd);
  return typeof got + ":" + got.x;
}

function all(p: Point): string {
  const before = p.y;
  const line = holdsPlainReturn(p) + " " + holdsRareCallByValue(p) + " " + holdsRareCallOfWiderType(p) + " " + holdsReadsArguments(p) + " " + holdsNarrow(p) + " " + holdsChain(p);
  return line + " " + (before + p.y);
}

for (let round = 0; round < 500; round++) {
  misfit = round % 100 === 99;
  const line = all(new Point(round, 1));
  if (misfit || round % 100 === 0) console.log(round + ": " + line);
}
