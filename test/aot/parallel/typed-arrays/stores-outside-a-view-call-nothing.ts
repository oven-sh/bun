// A store at a position that a view does not have stores nothing, and nothing of the run time is called for it: below zero each such store made a text of its key.
// COUNT: operations <= 300
function layWholeNumbers(view: Int16Array, start: number, end: number): void {
  for (let i = start; i < end; i++) view[i] = 9;
}
function layFractions(view: Float64Array, start: number, end: number): void {
  for (let i = start; i < end; i++) view[i] = 0.5;
}
function layClamped(view: Uint8ClampedArray, start: number, end: number): void {
  for (let i = start; i < end; i++) view[i] = 300;
}
const [farBelow, second, sixth, farAbove] = JSON.parse("[-3000, 2, 6, 3000]") as [number, number, number, number];
const show = (view: ArrayLike<number>) => `${Array.from(view).join()} | ${Object.keys(view).join()} | ${(view as any)[-1]} ${(view as any)[8]}`;

const wholeNumbers = new Int16Array(8);
layWholeNumbers(wholeNumbers, farBelow, second);
layWholeNumbers(wholeNumbers, sixth, farAbove);
console.log(show(wholeNumbers));

const fractions = new Float64Array(8);
layFractions(fractions, farBelow, second);
layFractions(fractions, sixth, farAbove);
console.log(show(fractions));

const clamped = new Uint8ClampedArray(8);
layClamped(clamped, farBelow, second);
layClamped(clamped, sixth, farAbove);
console.log(show(clamped));

const withoutMemory = new Int16Array(8);
structuredClone(withoutMemory.buffer, { transfer: [withoutMemory.buffer] });
layWholeNumbers(withoutMemory, farBelow, farAbove);
console.log(withoutMemory.length, withoutMemory[0]);

function layAnything(view: any, at: number, value: unknown): string {
  try {
    view[at] = value;
    return "stored nothing";
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
const asked: string[] = [];
const converted = { valueOf() { asked.push("converted"); return 1; } };
console.log(layAnything(wholeNumbers, -1, converted), layAnything(wholeNumbers, 8, converted), asked.join());
console.log(layAnything(wholeNumbers, -1, 1n), layAnything(wholeNumbers, -1, Symbol()), layAnything(new BigInt64Array(2), -1, 1), layAnything(new BigInt64Array(2), 2, 1), layAnything(new BigUint64Array(2), -1, 1n));
console.log(show(wholeNumbers));
