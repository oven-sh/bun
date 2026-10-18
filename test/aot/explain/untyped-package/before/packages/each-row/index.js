// src/index.ts
function eachRow(rows, visit) {
  for (const row of rows)
    visit(row);
}
export {
  eachRow
};
