// Copies through JSON changed without their originals
function clone(rows) {
  const copy = JSON.parse(JSON.stringify(rows));
  for (const row of copy) {
    row.n *= 2;
    row.tags.push("copy");
  }
  return rows.map(row => row.n + row.tags.join("")).join() + " " + copy.map(row => row.n + row.tags.join("")).join();
}
console.log(clone([{ n: 1, tags: ["a"] }, { n: 2, tags: [] }]));
console.log(clone([{ n: 50, tags: ["x", "y"] }]));
console.log(clone([]));
