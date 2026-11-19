// The helper that checks `this` hands it to its handler, which reads it before the constructor has stored anything.
let fails = false;
let seen = [];
function touch() {
  if (fails) throw new Error("touched");
}

function checkAndRead(instance, constructor) {
  let checked = instance;
  try {
    if (!(instance instanceof constructor)) throw new TypeError("no instance");
    touch();
    checked = null;
  } catch {
    seen.push(checked.x, checked.y, "x" in checked, Object.keys(checked).length);
  }
}
function Point(x) {
  checkAndRead(this, Point);
  this.x = x;
  this.y = x + 1;
}
Point.prototype.sum = function () {
  return this.x + this.y;
};
for (let i = 0; i < 4; i++) {
  fails = i % 2 === 1;
  console.log(new Point(i).sum(), seen.splice(0));
}

let kept = null;
function read(object) {
  seen.push(object.width, object.height, object.area(), object.name);
  kept = object;
}
function checkAndPass(instance, constructor) {
  let checked = instance;
  try {
    if (!(instance instanceof constructor)) throw new TypeError("no instance");
    touch();
    checked = null;
  } catch {
    read(checked);
  }
}
function Box(width, name) {
  checkAndPass(this, Box);
  this.width = width;
  this.height = width * 2;
  this.name = name;
}
Box.prototype.area = function () {
  return this.width * this.height;
};
for (let i = 0; i < 4; i++) {
  fails = i % 2 === 1;
  const box = new Box(i + 0.5, "box" + i);
  console.log(box.area(), kept === box, seen.splice(0));
}
