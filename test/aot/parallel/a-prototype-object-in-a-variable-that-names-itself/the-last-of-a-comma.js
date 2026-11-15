function Shape() { this.sides = 4; }
function never() {
  var proto = (0, proto);
  Shape.prototype = proto;
}
if (JSON.parse("false")) never();
console.log(new Shape().sides);
