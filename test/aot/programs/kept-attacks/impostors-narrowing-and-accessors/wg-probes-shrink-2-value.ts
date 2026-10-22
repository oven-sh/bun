// Impostors narrowing and accessors: wg probes shrink  value. It prints what plain Bun prints.
class Cell {
  value: number | string = 1;
}

function describe(c: Cell): string {
  return typeof c.value === "number" ? "number " + (c.value + 1) : "string " + c.value.length;
}

const cell = new Cell();
Object.assign(cell, { value: "text" });
console.log(describe(cell));
