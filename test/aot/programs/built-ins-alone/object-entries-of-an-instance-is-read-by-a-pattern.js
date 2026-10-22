class Point {
  x = 1.5;
  label = "here";
}
for (const [key, value] of Object.entries(new Point())) console.log(key, typeof value, value);
