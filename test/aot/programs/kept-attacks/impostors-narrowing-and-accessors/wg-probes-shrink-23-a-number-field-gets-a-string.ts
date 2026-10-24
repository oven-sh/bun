// Impostors narrowing and accessors: wg probes shrink  a number field gets a string. It prints what plain Bun prints.
class Cell {
  value = 1;
}

const cell = new Cell();
Object.assign(cell, { value: "text" });
console.log(typeof cell.value, cell.value + 1);
