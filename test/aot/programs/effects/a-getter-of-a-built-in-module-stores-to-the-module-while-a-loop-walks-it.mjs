// A for..in loop over node:fs, which arrives out of a trap or a reviver, asks for a descriptor in front of and behind `handed[key]`, and a getter of the module replaces itself
import fs from "node:fs";

const changed = [];
for (const handed of [new Proxy({}, { get: () => fs }).anything, JSON.parse("[0]", () => fs)]) {
  for (const key in handed) {
    const wasValue = Object.getOwnPropertyDescriptor(fs, "ReadStream").get === undefined;
    const value = handed[key];
    const isValue = Object.getOwnPropertyDescriptor(fs, "ReadStream").get === undefined;
    if (wasValue !== isValue) changed.push(key);
  }
}
console.log(changed.join());
