import { make } from "./es-lists.js";
const other = require("./commonjs-lists.js");

export function sizes(size) {
  return [size(make()), size(other.make())];
}
export const mode = (function () {
  return this === undefined ? "strict" : "sloppy";
})();
