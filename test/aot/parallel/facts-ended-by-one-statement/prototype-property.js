function Point(x) {
  this.x = x;
}
Point.prototype.show = function () {
  return "p" + this.x;
};
function draw(n) {
  let text = "";
  for (let i = 0; i < n; i++) {
    const point = new Point(i);
    text += point.show() + (point instanceof Point) + " ";
  }
  return text;
}
console.log(draw(3));
const old = new Point(9);
Point.prototype = {
  show() {
    return "q" + this.x;
  },
};
console.log(draw(3), old.show(), old instanceof Point);
