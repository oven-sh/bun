export const notLists = [["a string", () => "12"], ["an array-like object", () => ({ 0: 1, length: 1 })], ["holes", () => new Array(2)], ["null", () => null]];
export const notNumbers = [["a numeric string", () => "3"], ["a BigInt", () => 3n], ["an object with valueOf", () => ({ valueOf: () => 3 })], ["undefined", () => undefined]];
export const notPoints = [["the other key order", () => ({ y: 1, x: 3 })], ["strings inside", () => ({ x: "3", y: "1" })], ["a number", () => 5], ["null", () => null]];
