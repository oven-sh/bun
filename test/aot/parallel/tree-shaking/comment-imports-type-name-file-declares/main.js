// An `@import` tag in a comment imports a type under the name that a class, a function or a constant of the same file has. The name holds what the file declares, and every one of them is called.
import { Exported } from "./exported.mjs";
import { createRequire } from "node:module";

/** @import Shape, { describe, measure } from "./types.ts" */
/** @import * as all from "./types.ts" */
/** @import Missing, { alsoMissing } from "./no-such-file.js" */

class Shape {
  constructor(sides) {
    this.sides = sides;
  }
  double() {
    return new Shape(this.sides * 2);
  }
  static prepare(names) {
    for (const name in names) Shape.define(name, names[name]);
  }
  static define(name, code) {
    Shape.prototype[name] = function (...operands) {
      return code(this, ...operands);
    };
  }
}

function describe(shape) {
  return "a shape of " + shape.sides + " sides";
}

const measure = function (shape, side) {
  return shape.sides * side;
};

function all() {
  return "the function named all";
}

class Missing {
  static answer() {
    return "the class named Missing";
  }
}

function alsoMissing() {
  return "the function named alsoMissing";
}

Shape.prepare({ describe, measure });
console.log(new Shape(3).double().describe(), new Shape(4).measure(2.5));
console.log(all(), "|", Missing.answer(), "|", alsoMissing());
console.log(Exported.answer());

const Color = createRequire(import.meta.url)("./color.cjs").default;
console.log(new Color("red").to("lab").toString());
