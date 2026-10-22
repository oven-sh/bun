class Point {
  n = 1;
}

function put(point, value) {
  point.n = value;
}

const point = new Point();
console.log(point.n + 1);
put.call(undefined, point, 2.5);
console.log(point.n + 1);
put.call(undefined, point, "text");
console.log(point.n + 1);
