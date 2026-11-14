function Point() {
  Point.start.apply(this, arguments);
}
Point.prototype.set = function () {};
function work() {
  for (let i = 0; i < 5; i++) {
    let p = i % 3 ? new Point() : { x: 5 };
    let keys = "";
    for (const key in p) keys += key;
  }
}
try {
  work();
} catch (error) {
  console.log(error.name);
}
