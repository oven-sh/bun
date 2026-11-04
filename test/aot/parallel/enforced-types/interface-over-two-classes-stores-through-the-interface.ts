// `interface Shape { tag: string | number }` over a class that writes `tag: string` and one that writes `tag: number`. A store through the interface asks not which class it has, and brings each of them what its own declaration rules out.
// What lies at one slot of a family is held to one type, which holds what each member writes.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
interface Shape {
  tag: string | number;
  area: number;
}
class Circle implements Shape {
  tag: string;
  area: number;
  constructor(tag: string, area: number) {
    this.tag = tag;
    this.area = area;
  }
}
class Square implements Shape {
  tag: number;
  area: number;
  constructor(tag: number, area: number) {
    this.tag = tag;
    this.area = area;
  }
}
function retag(shape: Shape, tag: string | number) {
  shape.tag = tag;
}
function lengthOf(circle: Circle): unknown {
  return circle.tag.length;
}
function next(square: Square): unknown {
  return square.tag + 1;
}
function show(shape: Shape): string {
  return shape.tag + " " + typeof shape.tag + " " + (shape.area + 1);
}
const circle = new Circle("round", 1);
const square = new Square(4, 2);
console.log("before", show(circle), lengthOf(circle), "|", show(square), next(square));
retag(circle, 9);
retag(square, "four");
console.log("behind", show(circle), lengthOf(circle), "|", show(square), next(square));
retag(circle, "again");
retag(square, 5);
console.log("honest again", show(circle), lengthOf(circle), "|", show(square), next(square));
retag(circle, JSON.parse("[1]"));
console.log("neither", show(circle), lengthOf(circle));
for (let turn = 0; turn < 3; turn++) {
  const shape: Shape = turn % 2 ? new Circle("c" + turn, turn) : new Square(turn, turn);
  const before = show(shape);
  retag(shape, turn % 2 ? turn : "s" + turn);
  console.log(turn, before, "|", show(shape));
}
