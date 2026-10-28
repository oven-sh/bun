// node:fs defines some members with getters. Reading a member under a computed key does not throw.
import fs from "node:fs";
const returned = new Proxy({}, { get: () => fs }).anything;
const thrown = [];
let read = 0;
for (const key of Object.keys(returned)) {
  try {
    if (returned[key] !== undefined) read++;
  } catch (error) {
    thrown.push(key);
  }
}
console.log(read, thrown.join());
for (const key of ["Write" + "Stream", "FileRead" + "Stream"]) {
  console.log(key, typeof returned[key], returned[key] === returned[key], typeof Object.getOwnPropertyDescriptor(returned, key).get);
}
