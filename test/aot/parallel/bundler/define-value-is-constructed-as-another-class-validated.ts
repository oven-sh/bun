// `new` through a defined name constructs the class that has the name of the value, another class than the defined name declares.
// Flags: --define CTOR=Other --aot-validate --aot-check=ClaimsToBackEnd
class Point {
  x = 1;
  y = 2;
}
class Other {
  z = "s";
  w = "t";
}
declare const CTOR: typeof Point;
function sum(p: Point): number {
  return p.x + p.y;
}
function make(): Point {
  return new CTOR();
}
let total = 0;
for (let i = 0; i < 3; i++) total += sum(make());
console.log(total, sum(new Point()));
export {};
