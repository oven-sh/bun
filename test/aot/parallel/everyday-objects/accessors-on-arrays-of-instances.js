// Accessors of instances in a list that is mapped, reduced and written through
class Cell {
  #value = 0;
  history = 0;
  get value() {
    return this.#value;
  }
  set value(next) {
    if (next !== this.#value) this.history++;
    this.#value = next;
  }
}
function run(values) {
  const cells = Array.from({ length: 3 }, () => new Cell());
  values.forEach((value, i) => (cells[i % 3].value = value));
  for (const cell of cells) cell.value += cell.value;
  [cells[0].value, cells[2].value] = [cells[2].value, cells[0].value];
  return cells.map(cell => cell.value + "/" + cell.history).join() + " " + cells.reduce((sum, { value }) => sum + value, 0);
}
console.log(run([1, 2, 3, 4]));
console.log(run([10, 10, 10, 10, 10]));
console.log(run([0]));
