// A list of lists: rows pushed whole, then grown through the outer list
function rows(fill) {
  const grid = [];
  for (let y = 0; y < 3; y++) {
    const row = [];
    for (let x = 0; x < 2; x++) row.push(fill, x);
    grid.push(row);
    for (let k = 0; k <= y; k++) grid[k].push(y);
    row.push("r");
  }
  return grid.map(row => row.join("")).join(" ");
}
console.log(rows(7));
console.log(rows("-"));
console.log(rows(0.5), rows(null));
