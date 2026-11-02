// A `--define` whose value is one name reads the parameter of that name, an object without the fields of the class that the program declares for the defined name.
// Flags: --define NAME=target
class Point {
  x = 1;
  y = 2;
}
declare const NAME: Point;
function read(target: { z: string }): number {
  return NAME.x + NAME.y;
}
console.log(read({ z: "not a point" }), new Point().x);
export {};
