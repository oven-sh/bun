// Instances printed as a table, with widths found in a first loop
class Row {
  constructor(name, n) {
    this.name = name;
    this.n = n;
  }
  get cells() {
    return [this.name, String(this.n), "*".repeat(this.n % 7)];
  }
}
function report(names, n) {
  const rows = names.map((name, i) => new Row(name, n * (i + 1)));
  const widths = [];
  for (const { cells } of rows) cells.forEach((cell, i) => (widths[i] = Math.max(widths[i] ?? 0, cell.length)));
  const lines = rows.map(({ cells }) => cells.map((cell, i) => (i === 1 ? cell.padStart(widths[i]) : cell.padEnd(widths[i], "."))).join("|"));
  return lines.join(" / ") + " " + widths.join();
}
console.log(report(["a", "bcd"], 3));
console.log(report(["x"], 100));
console.log(report(["one", "two", "three"], 0));
