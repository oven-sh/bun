// Bags of unlisted names, each of another size, get two more names once.
type Bag = { a?: number; b?: string; c?: boolean };
type Two = { x: number; y: number };
function merge(bag: Bag, two: any): Bag {
  return { ...bag, ...two };
}
function bagOf(size: number): Bag {
  const bag: Bag = { a: size };
  for (let index = 0; index < size; ++index)
    (bag as any)["name" + index] = index;
  return bag;
}
const sizes = Number(process.argv[2] ?? 40);
const rounds = Number(process.argv[3] ?? 1);
let total = 0;
for (let round = 0; round < rounds; ++round) {
  for (let size = 1; size <= sizes; ++size)
    total += Object.keys(merge(bagOf(size), JSON.parse(`{"x":${size},"y":${round}}`))).length;
}
console.log(total);
