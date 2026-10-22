// Impostors narrowing and accessors: wg probes oa  an optional member is filled. It prints what plain Bun prints.
class Cell {
  value = 1;
  note?: string;
}

const cell = new Cell();
Object.assign(cell, { note: "filled" });
console.log(cell.note === undefined ? "missing" : cell.note.length, typeof cell.note);
