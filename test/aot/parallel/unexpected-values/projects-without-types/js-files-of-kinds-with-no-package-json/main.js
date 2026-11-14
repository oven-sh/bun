import * as both from "./both-in-one-file.js";
import commonjs from "./commonjs-lists.js";
import * as es from "./es-lists.js";
import shown from "./show.js";

console.log("this file is strict:", (function () {
  return this === undefined;
})());

const { attempt } = shown;
attempt("modes", () => [es.mode, commonjs.mode, both.mode]);
let sum = 0;
for (let i = 0; i < 2000; i++) sum += es.size(es.make()) + commonjs.size(es.make());
console.log("sum", sum);
attempt("an ES size of a CommonJS value", () => es.size(commonjs.make()) + 1);
attempt("a CommonJS size of a CommonJS value", () => commonjs.size(commonjs.make()) + 1);
attempt("an ES size of an ES value", () => es.size(es.make()) + 1);
attempt("through the file with both", () => [both.sizes(es.size), both.sizes(commonjs.size)]);
