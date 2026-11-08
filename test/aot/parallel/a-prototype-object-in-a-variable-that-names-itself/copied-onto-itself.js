function Shape() { this.sides = 4; }
function never() {
  var proto = Object.assign(proto, { area() { return 1; } });
  Shape.prototype = proto;
}
if (JSON.parse("false")) never();
console.log(new Shape().sides);
