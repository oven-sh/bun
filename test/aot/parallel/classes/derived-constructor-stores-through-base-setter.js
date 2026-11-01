const log = [];

class Shape {
  set size(value) {
    log.push("set " + value);
    this.stored = value < 0 ? 0 : value;
  }
  get size() {
    return this.stored;
  }
}
class Square extends Shape {
  constructor(size) {
    super();
    this.stored = -1;
    this.size = size;
  }
  area() {
    return this.size * this.size;
  }
}
class Tile extends Square {
  constructor(size, color) {
    super(size);
    this.size = size + 1;
    this.color = color;
  }
}
const square = new Square(3);
const tile = new Tile(-5, "red");
console.log(square.area(), tile.area(), Object.keys(square).join(), Object.keys(tile).join(), log.join());
console.log(Object.hasOwn(square, "size"), "size" in square, JSON.stringify(tile));

class ReadOnly {
  get id() {
    return 7;
  }
}
class Numbered extends ReadOnly {
  constructor() {
    super();
    try {
      this.id = 1;
      console.log("stored");
    } catch (error) {
      console.log(error.constructor.name);
    }
  }
}
console.log(new Numbered().id, Object.keys(new Numbered()).length);

class WithMethod extends Shape {
  size() {
    return "method";
  }
}
class BelowMethod extends WithMethod {
  constructor() {
    super();
    this.size = 9;
  }
}
console.log(new BelowMethod().size, Object.keys(new BelowMethod()).join(), log.length);

class WithField extends Shape {
  size = 4;
}
class BelowField extends WithField {
  constructor() {
    super();
    this.size = 5;
  }
}
console.log(new BelowField().size, Object.keys(new BelowField()).join(), log.length);

function sumOfAreas(rounds) {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum += new Square((round & 7) - 2).area();
  return sum;
}
log.length = 0;
console.log(sumOfAreas(1000), log.length);

delete Shape.prototype.size;
const plain = new Square(6);
console.log(plain.size, plain.stored, Object.keys(plain).join(), plain.area());
Object.defineProperty(Shape.prototype, "size", {
  set(value) {
    log.push("late " + value);
  },
  configurable: true,
});
const late = new Square(8);
console.log(late.size, late.stored, Object.keys(late).join(), log.at(-1), plain.size);
