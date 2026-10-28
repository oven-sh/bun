import { put, take } from "./out-of-sight.js";

function kept(name, value) {
  put(name, value);
  return take(name);
}

function hundred(make) {
  const made = [];
  for (let i = 0; i < 100; i++) made.push(make(i));
  return made;
}

function Vector(x, y) {
  this.vectorX = x;
  this.vectorY = y;
}

Vector.prototype.dot = function (other) {
  return this.vectorX * other.vectorX + this.vectorY * other.vectorY;
};

function lengthSquared(vector) {
  return vector.dot(vector);
}

function methodOnPrototype(vectors) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += lengthSquared(vectors[i]);
  return total;
}

function sumOfParts(vector) {
  return vector.vectorX + vector.vectorY;
}

function fieldsOfConstructorFunction(vectors) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += sumOfParts(vectors[i]);
  return total;
}

function Shape(sides) {
  this.shapeSides = sides;
}

Shape.prototype.sidesTwice = function () {
  return this.shapeSides * 2;
};

function Square(edge) {
  Shape.call(this, 4);
  this.squareEdge = edge;
}

Square.prototype = Object.create(Shape.prototype);
Square.prototype.constructor = Square;
Square.prototype.outline = function () {
  return this.squareEdge * this.shapeSides;
};

function inheritedSides(square) {
  return square.sidesTwice();
}

function methodOfParent(squares) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += inheritedSides(squares[i]);
  return total;
}

function sidesOf(square) {
  return square.shapeSides + square.squareEdge;
}

function fieldStoredByParent(squares) {
  let total = 0;
  for (let i = 0; i < 100; i++) total += sidesOf(squares[i]);
  return total;
}

function makeVectors(count) {
  let total = 0;
  for (let i = 0; i < count; i++) total += new Vector(i, 1).vectorX;
  return total;
}

export const cases = {
  "a method on the prototype of a constructor function is called": {
    prepare: () =>
      kept(
        "vectors",
        hundred(i => new Vector(i, 1)),
      ),
    turn: methodOnPrototype,
  },
  "fields that a constructor function stores are read": {
    prepare: () =>
      kept(
        "vectors",
        hundred(i => new Vector(i, 1)),
      ),
    turn: fieldsOfConstructorFunction,
  },
  "a method of the parent of a constructor function is called": {
    prepare: () =>
      kept(
        "squares",
        hundred(i => new Square(i)),
      ),
    turn: methodOfParent,
  },
  "a field that the parent of a constructor function stores is read": {
    prepare: () =>
      kept(
        "squares",
        hundred(i => new Square(i)),
      ),
    turn: fieldStoredByParent,
  },
  "a constructor function is constructed": { prepare: () => kept("count", 100), turn: makeVectors },
};
