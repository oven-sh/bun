// The method of the class makes an object of another class of the file, which writes `next`: that method is expected in the loop. Two loops over one object are nested: each has its own steps.
// From one round on another function lies over the `next` of the second class.
class Steps { at = 0; end: number; constructor(end: number) { this.end = end; } next() { return this.at < this.end ? { done: false, value: this.at++ } : { done: true, value: undefined }; } }
class Shelf { size: number; constructor(size: number) { this.size = size; } [Symbol.iterator]() { return new Steps(this.size); } }
function pairs(given: Shelf, turns: number): string { let sum = 0, last = ""; for (let turn = 0; turn < turns; turn++) for (const a of given) for (const b of given) { sum += (a as number) * 10 + (b as number); last = a + ":" + b; } return sum + " " + last; }
(globalThis as any).keep = [pairs, new Shelf(1), new Steps(1)];
const size = Number(process.argv[2] ?? 4);
for (let round = 0; round < 4; round++) {
  if (round === 2) (Steps.prototype as any).next = function (this: Steps) { return this.end > 0 ? { done: false, value: --this.end } : { done: true, value: undefined }; };
  console.log(pairs(new Shelf(size), 3), "|", pairs(new Shelf(0), 3), "|", pairs(new Shelf(size), 1));
}
