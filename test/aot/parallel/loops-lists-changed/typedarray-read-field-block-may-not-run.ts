// A loop reads a typed array out of a field, and its elements, only in a block behind a flag. With the flag down the field holds a typed array whose buffer is gone.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
class Shelf {
  constructor(
    public samples: Float64Array,
    public isOpen: boolean,
  ) {}
}
function work(shelf: Shelf, n: number): number {
  let sum = 0;
  for (let j = 0; j < n; j++) {
    sum += j;
    if (shelf.isOpen) sum = mix(sum, shelf.samples[j & 3]! + shelf.samples.length);
  }
  return sum;
}
let total = 0;
for (let i = 0; i < 400; i++) {
  const samples = new Float64Array([i, i + 1, i + 2, i + 3]);
  if (i % 5 === 2) samples.buffer.transfer();
  total = mix(total, work(new Shelf(samples, i % 5 !== 2), 24));
}
console.log(total);
