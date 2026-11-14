// Variables and private static fields that functions called in loops compute anew from what they hold: in their dead zone, given other kinds of values, read by other functions amid the loop, and left by throws.
let next: any = 1;
class Random {
  static #seed: any = 7;
  static #calls = 0;
  static step(by: number): any {
    Random.#calls++;
    return (Random.#seed = (Random.#seed * 1103515245 + 12345 + by) & 2147483647);
  }
  static limited(by: number): any {
    if (by === 9) throw new RangeError("limit");
    Random.#seed = (Random.#seed * 5 + by) & 1023;
    return Random.#seed;
  }
  static set(seed: any) {
    Random.#seed = seed;
  }
  static peek(): string {
    return Random.#seed + "/" + Random.#calls;
  }
}
function step(by: number): any {
  return (next = (next * 5 + by) & 1023);
}
function grow(by: number): any {
  next = next + by;
  return next;
}
function peek(): string {
  return String(next);
}
function run(turns: number, call: number): string {
  let sum = 0;
  if (call === 0) for (let k = 0; k < turns; k++) sum += step(k) | 0;
  else if (call === 1) for (let k = 0; k < turns; k++) sum = (sum + (grow(k) | 0)) | 0;
  else if (call === 2) for (let k = 0; k < turns; k++) sum = (sum ^ Random.step(k)) | 0;
  else for (let k = 0; k < turns; k++) sum += Random.limited(k) | 0;
  return sum + ":" + peek() + ":" + Random.peek();
}
function amid(turns: number): string {
  let seen = "";
  for (let k = 0; k < turns; k++) {
    step(k);
    if (k === 3) seen += peek();
    if (k === 5) next = "8";
    if (k === 7) next = undefined;
    if (k === 8) next = 0.5;
  }
  return seen + peek();
}
function early(turns: number): string {
  try {
    let sum = 0;
    for (let k = 0; k < turns; k++) sum += late(k);
    return "sum " + sum;
  } catch (error) {
    return (error as Error).name;
  }
}
console.log(early(0), early(3));
function late(by: number): number {
  return (laid = (laid + by) & 255);
}
let laid = 5;
console.log(early(0), early(9), laid);
for (let round = 0; round < 3; round++) {
  for (let call = 0; call < 4; call++) {
    try {
      console.log(run(call === 3 ? 12 : 10, call));
    } catch (error) {
      console.log((error as Error).message, peek(), Random.peek());
    }
  }
  console.log(amid(6 + round * 2), amid(0));
  Random.set(round === 0 ? "12" : round === 1 ? undefined : 2.5);
}
