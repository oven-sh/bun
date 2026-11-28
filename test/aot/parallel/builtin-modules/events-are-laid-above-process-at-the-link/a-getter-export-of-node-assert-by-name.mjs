// AssertionError of node:assert is a getter that loads node:events on its way: a named import that the body reads later has run the getter at the link.
import { AssertionError } from "node:assert";
const above = () =>
  Object.getPrototypeOf(Object.getPrototypeOf(process)) === Object.prototype ? "Object.prototype" : "another object";
console.log("before the read:", above());
console.log(typeof AssertionError, above());
