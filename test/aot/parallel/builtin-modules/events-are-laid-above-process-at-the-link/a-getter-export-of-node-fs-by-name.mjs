// promises of node:fs is a getter that loads node:fs/promises, and with it node:events: a named import that the body reads later has run the getter at the link.
import { promises } from "node:fs";
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype ? "Object.prototype" : "another object";
console.log("before the read:", above());
console.log(typeof promises.readFile, above());
