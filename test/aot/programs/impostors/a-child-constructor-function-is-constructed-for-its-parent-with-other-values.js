function Old(x, y) {
  this.x = x;
  this.y = y;
}
function Child(x, y) {
  Old.call(this, x, y);
  this.z = 3;
}
Child.prototype = Object.create(Old.prototype);
Child.prototype.constructor = Child;

for (const [x, y] of [[1, 2], [7, 8], [-1, 0], [1.5, 2.5], ["a", "b"], [true, null], [undefined, 2]]) {
  const usual = new Child(x, y);
  const made = Reflect.construct(Child, [x, y], Old);
  console.log("usual", typeof usual.x, String(usual.x), typeof usual.y, String(usual.y), usual.z);
  console.log("for the parent", typeof made.x, String(made.x), typeof made.y, String(made.y), made.z);
}
