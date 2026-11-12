"use strict";
const at = JSON.parse("0");
const held = [];
function lay(value) {
  const into = held[at];
  for (let i = 0; i < 12; i++) into[i] = value;
}
function fill(holders, value) {
  held[0] = holders[0];
  lay(value);
  return holders[0];
}
function attempt(made, value) {
  try {
    fill([made], value);
    return `done ${made.length} ${made.join()}`;
  } catch (error) {
    return `${error.constructor.name} ${made.length} ${made.join()}`;
  }
}
const said = [];
said.push(attempt(Object.freeze([1, 2, 3, 4, 5]), 9));
said.push(attempt(Object.seal([1, 2]), 9));
said.push(attempt(Object.preventExtensions([1, 2, 3]), 9));
said.push(attempt(Object.preventExtensions([1, , 3, 4]), 9));
const fixedLength = [1, 2];
Object.defineProperty(fixedLength, "length", { writable: false });
said.push(attempt(fixedLength, 9));
const readOnlyAtTwo = [1, 2, 3, 4];
Object.defineProperty(readOnlyAtTwo, 2, { value: "kept", writable: false });
said.push(attempt(readOnlyAtTwo, 9));
const log = [];
const setterAtOne = [1, 2, 3, 4];
Object.defineProperty(setterAtOne, 1, {
  get() {
    return "got";
  },
  set(value) {
    log.push(value);
  },
});
said.push(attempt(setterAtOne, 9), log.join());
said.push(attempt([1, 2, 3, 4], 9));
said.push(attempt(new Uint8Array(new ArrayBuffer(8), 2, 3), 9));
said.push(fill([new Int16Array(3)], "12").join());
console.log(
  said.join(`
`),
);
