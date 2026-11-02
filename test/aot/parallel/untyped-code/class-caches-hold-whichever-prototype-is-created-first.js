// Env: JSC_aotCountsPath=/dev/null
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const asked = () => count("operationAOTGetByIdAndCache");
class Shape {
  sides = 0;
  area() { return 0; }
  describe() { return "shape"; }
  get corners() { return this.sides; }
  set corners(n) { this.sides = n; }
}
class Square extends Shape {
  sides = 4;
  area() { return 16; }
}
class Tile extends Square {
  describe() { return "tile"; }
}
const things = [new Shape(), new Square(), new Tile(), { area() { return -1; }, describe: () => "plain", corners: 9 }];
function look(o) {
  const area = o.area, describe = o.describe;
  return [area.call(o), describe.call(o), o.corners, o.constructor.name, o.missing, typeof o.hasOwnProperty, "area" in o].join(" ");
}
function all() {
  let out = "";
  for (let turn = 0; turn < 40; turn++) {
    out = "";
    for (const thing of things) out += look(thing) + "; ";
  }
  return out;
}
function unchanged(what, change) {
  change();
  const before = asked();
  const out = all();
  const after = asked();
  console.log(what + ": " + out);
  console.log(after === before ? "nothing was asked again" : (after - before) + " names were asked again");
}
console.log(all());

unchanged("the lowest class first", () => Object.getOwnPropertyNames(Tile.prototype));
unchanged("then the highest", () => Object.getOwnPropertyDescriptor(Shape.prototype, "corners"));
unchanged("then the one between", () => Reflect.ownKeys(Square.prototype));

Shape.prototype.area = function () { return 1; };
Square.prototype.describe = () => "square";
console.log(all());
Tile.prototype.constructor = Shape;
Object.defineProperty(Shape.prototype, "corners", { get() { return -2; } });
console.log(all());
delete Square.prototype.area;
delete Tile.prototype.describe;
Shape.prototype.missing = "found";
console.log(all());
