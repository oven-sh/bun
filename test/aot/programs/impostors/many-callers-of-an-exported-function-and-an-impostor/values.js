import { log } from "./report.js";

export const notLists = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["holes", () => new Array(2)],
  ["null", () => null],
];

export const notNumbers = [
  ["a numeric string", () => "3"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 3) })],
  ["a BigInt", () => 3n],
  ["two to the 32nd and one", () => 4294967297],
  ["negative zero", () => -0],
  ["undefined", () => undefined],
];

export const notPoints = [
  ["the other key order", () => ({ y: 1, x: 3 })],
  ["getters", () => ({ get y() { log.push("y"); return 1; }, get x() { log.push("x"); return 3; } })],
  ["strings inside", () => ({ x: "3", y: "1" })],
  ["y is missing", () => ({ x: 3 })],
  ["a number", () => 5],
  ["null", () => null],
];

export const notTexts = [
  ["an array", () => ["a"]],
  ["a String object", () => new String("ab")],
  ["an object with the method", () => ({ toUpperCase: () => "its own answer" })],
  ["a number", () => 5],
];
