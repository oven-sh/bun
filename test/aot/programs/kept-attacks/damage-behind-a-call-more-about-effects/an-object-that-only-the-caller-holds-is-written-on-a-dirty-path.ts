// The caller makes objects that nothing else ever refers to and lends them to a callee, which only borrows them: it keeps none and hands none to unknown code.
// The stores of the callee stand behind a comparison that folds away on its typed path (`factor` is declared a number) and stays in the code that runs where `factor` holds a string.
// That code has left the typed paths by then (the multiplication of a string is unknown code), so the stores lie on no clean path, and on its normal edge the call writes nothing through its arguments.
// At the landing only the call itself can say what was done to the arguments: BecomeDirty has no operands, and whoever asks whether a writer reaches an object that has never escaped looks at the operands.
//   `c`     is an argument.
//   `inner` is held by a field of an argument.
//   `list`  is an array: what the caller holds proven about it is the kind of its storage, which the callee changes from integers to doubles.
// Build it without inlining too: inlined, there is no call.
class Counter {
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}

class Pair {
  first: Counter;
  second: number;
  constructor(first: Counter, second: number) {
    this.first = first;
    this.second = second;
  }
}

let factor: number = 2;

function bump(c: Counter): number {
  const f = factor;
  const product = f * 3;
  if ((f as any) === "strike") c.n = -1;
  return product;
}

function bumpInside(p: Pair): number {
  const f = factor;
  const product = f * 3;
  if ((f as any) === "strike") {
    p.first.n = -2;
    p.second = -3;
  }
  return product;
}

function widen(list: number[]): number {
  const f = factor;
  const product = f * 3;
  if ((f as any) === "strike") list[1] = 0.5;
  return product;
}

function holdsCounter(round: number): string {
  const c = new Counter(round);
  const before = c.n;
  const got = bump(c);
  return before + " " + got + " " + c.n;
}

function holdsPair(round: number): string {
  const inner = new Counter(round);
  const p = new Pair(inner, round + 1);
  const before = inner.n + p.second;
  const got = bumpInside(p);
  return before + " " + got + " " + inner.n + " " + p.second + " " + p.first.n;
}

function holdsList(round: number): string {
  const list = [round, 2, 3];
  const before = list[0] + list[1];
  const got = widen(list);
  return before + " " + got + " " + list[0] + "," + list[1] + "," + list[2];
}

for (let round = 0; round < 300; round++) {
  const strikes = round % 100 === 99;
  if (strikes) factor = "strike" as any;
  const line = holdsCounter(round) + " | " + holdsPair(round) + " | " + holdsList(round);
  factor = 2;
  if (strikes || round === 0) console.log(round + ": " + line);
}
