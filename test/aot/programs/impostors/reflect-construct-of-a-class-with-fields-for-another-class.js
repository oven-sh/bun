class Point {
  x = 1;
  y = 2;
}
class Other {}
function Old() {}

for (const [label, target] of [["itself", Point], ["another class", Other], ["a constructor function", Old], ["Object", Object], ["Array", Array], ["Map", Map]]) {
  const p = Reflect.construct(Point, [], target);
  console.log(label, "keys", Object.keys(p).join(), "x", p.x, "y", p.y, "sum", p.x + p.y, "prototype", Object.getPrototypeOf(p) === target.prototype);
}
