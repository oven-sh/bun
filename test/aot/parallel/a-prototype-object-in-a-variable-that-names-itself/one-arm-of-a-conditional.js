function Shape() { this.sides = 4; }
function never() {
  var proto = Shape != null ? proto : null;
  Shape.prototype = proto;
}
if (JSON.parse("false")) never();
console.log(new Shape().sides);
