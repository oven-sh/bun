function Shape() { this.sides = 4; }
function never() {
  var a = Object.assign(b, {}), b = Object.assign(a, {});
  Shape.prototype = a;
}
if (JSON.parse("false")) never();
console.log(new Shape().sides);
