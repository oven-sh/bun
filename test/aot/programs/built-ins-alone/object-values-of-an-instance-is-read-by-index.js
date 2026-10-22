class Point {
  x = 1.5;
  label = "here";
}
const values = Object.values(new Point());
console.log(values.length, values[0] + 1, values[1].length);
