class Shape {
  area() {
    return "method";
  }
}
const rows = JSON.parse('[{"n":"x"},{"n":1},{"n":"a"},{}]');
function measure(row) {
  const shape = new Shape();
  shape.area = row.n + 1;
  return shape.area;
}
console.log(rows.map(measure).join("|"));
const measured = [];
for (const row of rows) measured.push(measure(row));
console.log(measured.join("|"));
