// Receivers below an accessor: Array.prototype methods run on an instance of a class read `length` and the elements through its accessors and pass the instance, not an array, as the third argument of the callback.
let total = 0;

class Row {
  cells = ["a", "b"];
  get length(): number {
    total += 1;
    return this.cells.length;
  }
  get 0(): string {
    total += 100;
    return this.cells[0];
  }
  get 1(): number {
    total += 10000;
    return 5;
  }
}

function visit(cell: string, index: number, all: string[]): string {
  total += typeof cell === "string" ? 1000000 : 10000000;
  total += Array.isArray(all) ? 100000000 : 200000000;
  return cell + index + all.length;
}

visit("x", 0, ["x"]);
const row: any = new Row();
const results: unknown[] = [Array.prototype.map.call(row, visit as any), Array.prototype.join.call(row, "+"), Array.prototype.indexOf.call(row, 5), Array.prototype.slice.call(row).length, Array.from(row).length, Array.prototype.includes.call(row, "a"), Array.prototype.at.call(row, -1)];
console.log(total, results.join());
