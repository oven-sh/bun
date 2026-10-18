// src/index.ts
function eachRow<Row>(rows: Row[], visit: (row: Row) => void): void {
  for (const row of rows)
    visit(row);
}
export {
  eachRow
};
