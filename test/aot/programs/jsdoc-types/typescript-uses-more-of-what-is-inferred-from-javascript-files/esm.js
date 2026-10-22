export function fewer(a, b) {
  return [a, b].filter(v => v !== undefined).length;
}

export function variadic() {
  return arguments.length;
}

export class Grown {
  constructor() {
    this.x = 1;
  }
}
Grown.made = 0;

export const space = {};
space.sub = {};
space.sub.value = 1;
space.fn = function (n) {
  return n;
};

export default {
  name: "default",
  size() {
    return 1;
  },
};

export class Fields {
  static count = 1;
  #hidden = 2;
  shown = 3;
  get both() {
    return this.#hidden + this.shown;
  }
  static make() {
    return new Fields();
  }
}

export const arrow = (a, b = 2) => a + b;

export function withDefault(a = 1, { b = 2 } = {}) {
  return a + b;
}

export async function later() {
  return 1;
}

export function* many() {
  yield 1;
  yield "two";
}

export const tuple = /** @type {[number, string]} */ ([1, "one"]);

/** @param n a number without a type */
export function untypedTag(n) {
  return n;
}

export * from "./other.js";
export * as other from "./other.js";
