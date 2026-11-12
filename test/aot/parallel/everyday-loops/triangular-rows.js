// Rows of growing length, each made of the row before it
function pascal(rows, wrap) {
  const triangle = [[1]];
  while (triangle.length < rows) {
    const above = triangle[triangle.length - 1];
    const row = [1];
    for (let i = 1; i < above.length; i++) {
      let sum = above[i - 1] + above[i];
      if (wrap && sum > wrap) sum -= wrap;
      row.push(sum);
    }
    row.push(1);
    triangle.push(row);
  }
  return triangle.map(row => row.join(" ")).join(" / ");
}
console.log(pascal(6));
console.log(pascal(7, 5));
console.log(pascal(1), pascal(8, 2.5), pascal(40).split(" / ")[39].split(" ")[19]);
