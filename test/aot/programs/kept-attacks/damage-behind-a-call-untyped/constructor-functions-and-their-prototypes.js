// No types are written. Objects come from a constructor function, methods lie on its prototype object. A function reads an object, calls a method, makes a call and does both again. Below the call the object or the prototype object is damaged.
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.norm = function () {
  return this.x * this.x + this.y * this.y;
};
const norm = Point.prototype.norm;

let mode = 0;
function below(p) {
  if (mode === 1) delete p.x;
  else if (mode === 2) p.y = "text";
  else if (mode === 3) Point.prototype.norm = () => -1;
  else if (mode === 4) p.norm = () => -2;
  else if (mode === 5) Object.setPrototypeOf(p, { norm: () => -3 });
  else if (mode === 6) Point.prototype = { norm: () => -4 };
  return 1;
}

function holder(p) {
  const before = p.x + "," + p.y + "," + p.norm();
  const got = below(p);
  return before + " " + got + " " + p.x + "," + p.y + "," + p.norm() + "," + (p instanceof Point);
}

const prototype = Point.prototype;
for (let round = 0; round < 700; round++) {
  mode = round % 100 === 99 ? (round + 1) / 100 : 0;
  const line = holder(new Point(round, 1));
  Point.prototype = prototype;
  Point.prototype.norm = norm;
  if (mode || round === 0) console.log(round + ": " + line);
}
