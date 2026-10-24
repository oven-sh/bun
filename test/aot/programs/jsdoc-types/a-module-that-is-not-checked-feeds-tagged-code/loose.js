// @ts-nocheck
export function same(value) {
  return value;
}

export function make(kind) {
  return { number: 3, text: "3", nothing: null, list: [3], point: { x: 1, y: 2 }, texts: { x: "1", y: "2" }, step: Object.assign(n => n + "!", { toString: () => "step" }) }[kind];
}

export function call(f, ...operands) {
  return f(...operands);
}

/** @type {number} */
export const tagged = "tagged and false";

/** @returns {number} */
export function taggedResult() {
  return "a false result";
}

export function spoil(object, name, value) {
  object[name] = value;
}
