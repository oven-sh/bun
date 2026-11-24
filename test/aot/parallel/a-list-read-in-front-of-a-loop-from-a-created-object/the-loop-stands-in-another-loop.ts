// The loop that reads its rows in front of its turns stands in another loop, which reads another field of the created object.
const outside: any = globalThis;
const numberOf = (value: number): number => Number(outside.missing ?? value);
function fill(turns: number) {
  const base = { label() { return "base"; } };
  const shelf = Object.create(base);
  shelf.bins = [[1, 2, 3], [4, 5, 6]];
  shelf.width = 7;
  let total = 0;
  for (let round = 0; round < turns; round++) {
    const width = shelf.width;
    for (let i = 0; i < width; i++) {
      const first = shelf.bins[0], second = shelf.bins[1];
      first[i] = i + round;
      total += second[i % second.length];
    }
  }
  return total;
}
const functions = [fill];
console.log(functions[numberOf(0)](numberOf(20)), functions[numberOf(0)](numberOf(5)));
