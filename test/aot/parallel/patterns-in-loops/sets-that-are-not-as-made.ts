// What the one test in front of the steps is for: a Set with an iterator of its own, an object of a class below Set with and without one, a Set whose prototype is another, each beside a Set as made at the same place.
class Bag extends Set<number> {}
class Odd extends Set<number> { *[Symbol.iterator](): Generator<number> { yield 70; yield 80; yield 90; } }
const plain = new Set<number>([1, 2, 3]);
const own = new Set<number>([4, 5, 6]);
const bag = new Bag([7, 8, 9]);
const odd = new Odd([10, 11, 12]);
const moved = new Set<number>([13, 14, 15]);
function firstTwo(set: Set<number>, turns: number): string { let last = ""; for (let i = 0; i < turns; i++) { const [a, b] = set; last = a + "," + b; } return last; }
const said: string[] = [];
for (let i = 0; i < 90; i++) {
  if (i === 30) { (own as any)[Symbol.iterator] = function* () { yield 40; yield 50; }; Object.setPrototypeOf(moved, { *[Symbol.iterator]() { yield 130; } }); (Bag.prototype as any)[Symbol.iterator] = function* () { yield 700; yield 800; }; }
  if (i === 60) { delete (own as any)[Symbol.iterator]; Object.setPrototypeOf(moved, Set.prototype); delete (Bag.prototype as any)[Symbol.iterator]; }
  const line = [plain, own, bag, odd, moved].map(set => firstTwo(set, 3)).join(" ");
  if (i % 30 === 0 || i % 30 === 29) said.push(line);
}
console.log(said.join("\n"));
