// Object.defineProperties with a literal map puts a getter and a setter on the prototype under the names of two optional fields.
// The accessors keep their values in a side table, so the slots of the instances must stay empty.
// In this twin the optional fields are class fields without `declare`: they are defined at birth and the constructor deletes them, so the slots are declared and empty. Every instance may reach unknown code.
const unknownCodeRuns = process.argv.length > 99;
function handOver(value: object) {
  if (unknownCodeRuns) (globalThis as any).hook?.(value);
}
class Cell {
  declare row: number;
  width?: number;
  note?: string;
  constructor(row: number) {
    delete this.width;
    delete this.note;
    handOver(this);
    this.row = row;
  }
}
const widths = new Map<Cell, number>();
const log: string[] = [];
function readWidth(cell: Cell) {
  return cell.width;
}
function writeWidth(cell: Cell, value: number) {
  cell.width = value;
}
function grow(cell: Cell) {
  cell.width! += 10;
  return cell.width;
}
function readNote(cell: Cell) {
  return cell.note;
}
function writeNote(cell: Cell, value: string) {
  cell.note = value;
}
function describe(cell: Cell) {
  return `${readWidth(cell)} ${readNote(cell)} ${"width" in cell} ${Object.hasOwn(cell, "width")} ${Object.hasOwn(cell, "note")} [${Object.keys(cell)}]`;
}
function install() {
  Object.defineProperties(Cell.prototype, {
    width: {
      get(this: Cell) {
        log.push("get width " + this.row);
        return widths.get(this) ?? -1;
      },
      set(this: Cell, value: number) {
        log.push(`set width ${value} ${this.row}`);
        widths.set(this, value);
      },
      configurable: true,
      enumerable: true,
    },
    note: {
      get(this: Cell) {
        return "note of " + this.row;
      },
      set(this: Cell, value: string) {
        log.push(`set note ${value} ${this.row}`);
      },
      configurable: true,
    },
  });
}
function flush() {
  const text = log.join(", ");
  log.length = 0;
  return text;
}

let sum = 0;
for (let i = 0; i < 3000; i++) {
  const cell = new Cell(i);
  sum += readWidth(cell) ?? 1;
  if (i & 1) {
    writeWidth(cell, 5);
    sum += grow(cell)!;
  }
  if (i & 2) writeNote(cell, "n");
  sum += readNote(cell)?.length ?? 0;
}
console.log("warm", sum);

const empty = new Cell(1);
const filled = new Cell(2);
writeWidth(filled, 20);
writeNote(filled, "own");
install();
const fresh = new Cell(3);
console.log("accessors:", describe(empty), "|", describe(filled), "|", describe(fresh));
console.log(flush());
writeWidth(empty, 100);
writeWidth(filled, 200);
writeWidth(fresh, 300);
writeNote(empty, "a");
writeNote(filled, "b");
console.log("stored:", describe(empty), "|", describe(filled), "|", describe(fresh));
console.log(flush());
console.log("grown:", grow(empty), grow(filled), grow(fresh), grow(new Cell(4)));
console.log(flush());
const names: string[] = [];
for (const name in fresh) names.push(name);
console.log("for-in:", names.join(), "| json:", JSON.stringify(fresh), "| spread:", JSON.stringify({ ...fresh }));
console.log(flush());
delete (Cell.prototype as any).width;
delete (Cell.prototype as any).note;
console.log("gone again:", describe(empty), "|", describe(filled), "|", describe(fresh));
writeWidth(empty, 1);
console.log("stored:", describe(empty), grow(empty), flush().length);
