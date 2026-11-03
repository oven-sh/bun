// One variable holds a bound function, an object that is no function, or a class. Each is constructed and called where the compiler has seen all three arrive.
function attempt(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    return "throws " + (error as Error).constructor.name;
  }
}
class Point {
  x = 1;
  toString(): string {
    return "point " + this.x;
  }
}
function Plain(this: any, x: number) {
  if (new.target) this.x = x;
  return new.target ? undefined : "plain " + x;
}
Plain.prototype.toString = function () {
  return "made " + this.x;
};
let held: any;
const construct = () => attempt(() => ((value: any) => new value())(held));
const call = () => attempt(() => ((value: any) => value())(held));
function boundBuiltIn(): void {
  held = Math.max.bind(null, 5);
}
function boundFunction(): void {
  held = Plain.bind(null, 7);
}
function boundClass(): void {
  held = Point.bind(null);
}
function boundTwice(): void {
  held = Plain.bind(null).bind(null, 9);
}
function noFunction(): void {
  held = Object.create(null);
}
function theClass(): void {
  held = Point;
}
for (let turn = 0; turn < 3; turn++) {
  for (const store of [boundBuiltIn, boundFunction, boundClass, boundTwice, noFunction, theClass]) {
    store();
    console.log(store.name, construct(), call());
  }
}
