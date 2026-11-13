// A method that one subclass of several has is tested for and called on objects that a closure holds, where what the closure gives is joined with another object.
class Shape {}
class Circle extends Shape {}
class Square extends Shape {}
class Line extends Shape {}
class Dot extends Shape {
  highlight(by) {
    return "dot" + (by ?? "");
  }
}
let undo = () => ({});
function draw(shape) {
  undo = () => shape;
  return shape.highlight ? shape.highlight() : "plain";
}
console.log(draw(new Circle()), draw(new Square()), draw(new Line()), draw(new Dot()));
console.log(typeof undo(), undo() instanceof Dot);

let last = () => 0;
const shapes = [new Circle(), new Square(), new Line(), new Dot()];
function again(shape) {
  last = () => shape;
  return shape.highlight ? shape.highlight(1) : "no";
}
function all(count) {
  last = () => count;
  const got = [];
  for (let i = 0; i < count; i++) got.push(again(shapes[i % shapes.length]));
  return got.join();
}
console.log(all(JSON.parse("8")), typeof last());
