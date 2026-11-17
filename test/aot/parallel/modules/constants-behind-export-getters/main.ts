// Constants that the getters of a bundler's namespace answer, read off the namespace by functions, classes, generators and handlers.
import * as functions from "./functions.js";
import * as classes from "./classes.js";
import * as objects from "./objects.js";
const commonjs = require("./commonjs.cjs");
console.log(functions.sum([1, 2]), functions.text());
console.log(classes.sum([1, 2]), classes.text());
console.log(objects.sum([1, 2]), objects.text());
console.log(commonjs.sum([1, 2]), commonjs.text(), commonjs.limit, Object.keys(commonjs).join());
