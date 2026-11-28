// A namespace of node:fs lays nothing above the prototype of process at the link: the getter promises runs when the body first reads it off the namespace, and loads node:fs/promises then.
import * as fs from "node:fs";
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype ? "Object.prototype" : "another object";
console.log("before the read:", above());
console.log(typeof fs.readFileSync, above());
console.log(typeof fs.promises.readFile, above());
