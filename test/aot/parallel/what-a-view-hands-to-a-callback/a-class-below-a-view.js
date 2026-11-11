// A class of the program below Int32Array, with a sort of its own that hands out texts.
class Odd extends Int32Array {
  sort(comparator) {
    comparator("left", "right");
    return super.sort(comparator);
  }
}
const table = new Float64Array([0.5, 1.5, 2.5, 3.5]);
const said = [];
const odd = new Odd([3, 1, 2]);
odd.sort((a, b) => { said.push(`${typeof a} ${table[a]}`); return a < b ? -1 : a > b ? 1 : 0; });
console.log(odd.join(), said.join());
