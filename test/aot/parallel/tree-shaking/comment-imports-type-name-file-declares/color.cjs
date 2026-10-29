"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

/** @import Color, { Kinds } from "./color.js" */

function to(color, space) {
  return new Color(space + " of " + color.name);
}

function serialize(color) {
  return "color: " + color.name;
}

class Color {
  constructor(name) {
    this.name = name;
  }
  static defineFunction(name, code) {
    if (!(name in Color)) Color[name] = code;
    Color.prototype[name] = function (...operands) {
      return code(this, ...operands);
    };
  }
  static defineFunctions(functions) {
    for (const name in functions) Color.defineFunction(name, functions[name]);
  }
}

Color.defineFunctions({ to, toString: serialize });

exports.default = Color;
