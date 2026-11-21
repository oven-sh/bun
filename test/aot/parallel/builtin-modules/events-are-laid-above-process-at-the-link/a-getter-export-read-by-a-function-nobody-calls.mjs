// promises of node:fs is a getter that loads node:fs/promises, and with it node:events: a named import that only a function reads which nobody calls has run the getter at the link.
import { promises } from "node:fs";
const above = Object.getPrototypeOf(Object.getPrototypeOf(process));
function neverCalled() {
  return promises;
}
console.log(above === Object.prototype ? "Object.prototype" : "another object", typeof neverCalled);
