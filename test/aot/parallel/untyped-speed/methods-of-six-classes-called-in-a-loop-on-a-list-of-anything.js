// Shapes of six classes lie in a list that may hold anything, and a loop asks each for its area and its name. Nothing says what `shape` is, and six classes are too many to guess from
// the names: each call was a lookup by name and a call by value. Objects that find a method of the program under the name are told from everything else by one test and enter
// their method through the table of methods: the first loop looks up no name. A literal, which the table does not know, goes by name as before.
// COUNT: arrivals <= 6300
class Circle {
  constructor(size) {
    this.size = size;
  }
  area(scale) {
    return 3 * this.size * this.size * scale;
  }
  name() {
    return "circle";
  }
}
class Square {
  constructor(size) {
    this.size = size;
  }
  area(scale) {
    return this.size * this.size * scale;
  }
  name() {
    return "square";
  }
}
class Triangle {
  constructor(size) {
    this.size = size;
  }
  area(scale) {
    return (this.size * this.size * scale) / 2;
  }
  name() {
    return "triangle";
  }
}
class Hexagon {
  constructor(size) {
    this.size = size;
  }
  area(scale) {
    return 5 * this.size * scale;
  }
  name() {
    return "hexagon";
  }
}
class Ring {
  constructor(size) {
    this.size = size;
  }
  area(scale) {
    return (this.size - 1) * scale;
  }
  name() {
    return "ring";
  }
}
class Strip {
  constructor(size) {
    this.size = size;
  }
  area(scale) {
    return this.size * scale;
  }
  name() {
    return "strip";
  }
}

function total(shapes, turns) {
  let sum = 0;
  let letters = 0;
  for (let i = 0; i < turns; i++) {
    const shape = shapes[i % shapes.length];
    sum += shape.area(2);
    letters += shape.name().length;
  }
  return sum + " " + letters;
}

const shapes = [new Circle(1), new Square(2), new Triangle(4), new Hexagon(3), new Ring(5), new Strip(6)];
// What is parsed may be anything, so nothing is known of what the list holds.
for (const more of JSON.parse("[]")) shapes.push(more);
console.log(total(shapes, 6000));

shapes.push({
  area(scale) {
    return scale;
  },
  name() {
    return "literal";
  },
});
console.log(total(shapes, 70));

// What an object finds under the name when it is called is what runs.
Square.prototype.area = function () {
  return 1000;
};
shapes[0].name = () => "mine";
Object.defineProperty(Ring.prototype, "name", {
  get() {
    return () => "from a getter";
  },
});
Object.setPrototypeOf(shapes[5], Hexagon.prototype);
console.log(total(shapes, 70));
delete Triangle.prototype.name;
try {
  console.log(total(shapes, 70));
} catch (error) {
  console.log(error.name + ": " + error.message);
}
