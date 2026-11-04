import "./in-the-ring.mjs";
import * as outside from "./outside.mjs";
import { Shown } from "./outside.mjs";
export function byNamespace(name) {
  try {
    return typeof outside[name];
  } catch (error) {
    return error.constructor.name;
  }
}
export function byBinding() {
  try {
    return typeof Shown;
  } catch (error) {
    return error.constructor.name;
  }
}
console.log("at the end:", byNamespace("Shown"), byBinding());
