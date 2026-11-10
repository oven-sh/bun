function table(rows) {
  const width = Math.max(...rows.map(row => row[0].length));
  return rows.map(([name, count]) => name.padEnd(width) + " " + String(count).padStart(3, "0")).join("|");
}
console.log(table(JSON.parse('[["ash",7],["juniper",42]]')));
