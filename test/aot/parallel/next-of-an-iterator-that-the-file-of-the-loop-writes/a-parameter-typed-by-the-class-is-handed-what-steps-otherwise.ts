// The parameter is typed by a class of the file, and the loop expects under `next` what the class writes. It is handed an object of the class, one of a class below it that writes nothing of its own,
// one of a class below it that writes its own iterator, one with a property of its own over the method, one that inherits from the prototype of the class and steps otherwise, and one whose iterator is made by the method of the class and then gets another `next`.
class Shelf { [Symbol.iterator]() { let at = 0; return { next: () => (at < 4 ? { done: false, value: at++ } : { done: true, value: undefined }) }; } }
class Same extends Shelf {}
class Below extends Shelf { [Symbol.iterator](): any { let left = 2; return { next: () => ({ done: left-- <= 0, value: 1000 }) }; } }
function total(given: Shelf, turns: number): number { let sum = 0; for (let turn = 0; turn < turns; turn++) for (const item of given) sum += item as number; return sum; }
(globalThis as any).keep = [total, new Shelf()];
const turns = Number(process.argv[2] ?? 5);
const written = Shelf.prototype[Symbol.iterator];
const covered: Shelf = Object.assign(new Shelf(), { [Symbol.iterator]: (): any => [7, 8][Symbol.iterator]() });
const odd: Shelf = Object.create(Shelf.prototype, { [Symbol.iterator]: { value() { let left = 3; return { next() { return { done: left-- <= 0, value: 10 }; } }; } } });
const changed: Shelf = Object.create(Shelf.prototype, { [Symbol.iterator]: { value() { const steps: any = written.call(this), first = steps.next; let calls = 0; steps.next = () => (++calls > 2 ? { done: true, value: undefined } : first()); return steps; } } });
for (let round = 0; round < 3; round++) console.log(total(new Shelf(), turns), total(odd, turns), total(new Same(), turns), total(new Below(), turns), total(changed, turns), total(covered, turns), total(new Shelf(), turns));
