// Maps in a Map, filled by pairs and read as a table
function table(pairs) {
  const rows = new Map();
  for (const [row, column, n] of pairs) {
    if (!rows.has(row)) rows.set(row, new Map());
    const cells = rows.get(row);
    cells.set(column, (cells.get(column) ?? 0) + n);
  }
  const columns = new Set([...rows.values()].flatMap(cells => [...cells.keys()]));
  return [...rows].map(([row, cells]) => row + ":" + [...columns].map(column => cells.get(column) ?? "-").join("")).join(" ") + " " + columns.size;
}
console.log(table([["a", "x", 1], ["a", "y", 2], ["b", "x", 3], ["a", "x", 4]]));
console.log(table([["p", "q", 10], ["p", "q", -10]]));
console.log(table([["z", "z", 0]]));
