// A loop reads a list of rows in front of its turns, out of a field of an object that Object.create() made below another object. A hardened build does not ask for the prototype of its layout there.
const outside: any = globalThis;
const numberOf = (value: number): number => Number(outside.missing ?? value);
function fill(turns: number) {
  const base = { label() { return "base"; } };
  const shelf = Object.create(base);
  shelf.bins = [[1, 2, 3], [4, 5, 6]];
  let total = 0;
  for (let i = 0; i < turns; i++) {
    const first = shelf.bins[0], second = shelf.bins[1];
    first[i] = i + 1;
    total += second[i % second.length];
  }
  return total;
}
const functions = [fill];
console.log(functions[numberOf(0)](numberOf(20)), functions[numberOf(0)](numberOf(5)));
