/** @typedef {{ x: number, y: number }} Point */

/**
 * @this {Point}
 * @param {number} n
 * @returns {number}
 */
function shifted(n) {
  return this.x + this.y + n;
}

/** @enum {number} */
const Level = { Low: 1, Middle: 2, High: 3 };

/** @enum {string} */
const Color = { Red: "red", Green: "green" };

/** @enum {(n: number) => number} */
const Steps = { up: /** @param {number} n */ n => n + 1, down: /** @param {number} n */ n => n - 1 };

/**
 * @param {Level} level
 * @returns {string}
 */
function levelName(level) {
  switch (level) {
    case Level.Low:
      return "low";
    case Level.High:
      return "high";
    default:
      return "middle";
  }
}

/**
 * @interface
 */
class Shape {
  /** @returns {number} */
  area() {
    return 0;
  }
}

/** @implements {Shape} */
class Square {
  /** @param {number} side */
  constructor(side) {
    this.side = side;
  }
  area() {
    return this.side * this.side;
  }
}

/**
 * @template T
 */
class Stack {
  constructor() {
    /** @type {T[]} */
    this.items = [];
  }
  /** @param {T} item */
  push(item) {
    this.items.push(item);
    return this;
  }
  /** @returns {T | undefined} */
  top() {
    return this.items[this.items.length - 1];
  }
}

/** @extends {Stack<number>} */
class Numbers extends Stack {
  /** @returns {number} */
  total() {
    let sum = 0;
    for (const n of this.items) sum += n;
    return sum;
  }

  /**
   * @override
   * @param {number} item
   */
  push(item) {
    return super.push(item * 2);
  }
}

class Account {
  /** @private */
  secret = 1;
  /** @protected */
  shared = 2;
  /** @public */
  open = 3;
  /** @readonly */
  fixed = 4;
  /** @returns {number} */
  all() {
    return this.secret + this.shared + this.open + this.fixed;
  }
}

/**
 * @param {Shape} shape
 * @returns {number}
 */
function twiceTheArea(shape) {
  return shape.area() * 2;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += shifted.call({ x: i, y: 1 }, 1) + levelName(Level.High).length + twiceTheArea(new Square(i % 5)) + Steps.up(i) + new Numbers().push(i).total();
console.log("2000 rounds: " + warm);
console.log(shifted.call({ x: 1, y: 2 }, 3), shifted.apply({ x: 1, y: 2 }, [3]), shifted.bind({ x: 1, y: 2 })(3), [1, 2].map(shifted, { x: 1, y: 2 }).join());
console.log(levelName(Level.Low), levelName(Level.Middle), Color.Red + Color.Green, Steps.down(1), Object.keys(Level).join());
console.log(new Square(3).area(), twiceTheArea(new Shape()), new Square(1) instanceof Shape);
console.log(new Numbers().push(1).push(2).total(), new Numbers().top(), new Account().all(), new Account().open, Object.keys(new Account()).join());

export {};
