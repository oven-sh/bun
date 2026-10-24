// Calls of one method name with many implementations, next to a family whose methods are replaced or shadowed at run time.
abstract class Shape { constructor(public size: number) {} abstract area(): number }
class Square extends Shape { area() { return this.size * this.size; } }
class Circle extends Shape { area() { return this.size * 3; } }
class Line extends Shape { area() { return 0; } }
class Strip extends Shape { area() { return this.size * 2; } }
class Dot extends Shape { area() { return 1; } }
class Grower extends Shape { area() { this.size += 1; return this.size; } }

function total(shapes: Shape[], counts: number[]): number {
  let sum = 0;
  for (let i = 0; i < shapes.length; i++) {
    const before = shapes[i].size + counts[0];
    sum += shapes[i].area() + before + shapes[i].size + counts[0];
  }
  return sum;
}

class Cat { sound() { return 1; } }
class Dog { sound() { return 2; } }
class Cow { sound() { return 3; } }
class Owl { sound() { return 4; } }
class Bee { sound() { return 5; } }
type Animal = Cat | Dog | Cow | Owl | Bee;

const heard: number[] = [];
function listen(animals: Animal[]): number {
  let sum = 0;
  for (let i = 0; i < animals.length; i++) {
    const before = heard.length;
    sum += animals[i].sound() * 10 + (heard.length - before);
  }
  return sum;
}

const shapes: Shape[] = [new Square(2), new Circle(3), new Line(4), new Strip(5), new Dot(6), new Grower(7)];
const animals: Animal[] = [new Cat(), new Dog(), new Cow(), new Owl(), new Bee()];
let check = 0;
for (let round = 0; round < 400; round++) {
  check += total(shapes, [round]) + listen(animals);
  if (round === 100) Cow.prototype.sound = function () { heard.push(3); return 30; };
  if (round === 200) (animals[3] as any).sound = () => { heard.push(4); return 40; };
  if (round === 300) Object.setPrototypeOf(animals[4], { sound() { heard.push(5); return 50; } });
}
console.log(check, heard.length);
