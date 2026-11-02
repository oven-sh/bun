import { type T } from "./types";
require("./a");
const x: T = 1;
console.log(
  x,
  (function (this: unknown) {
    return this === undefined;
  })(),
);
