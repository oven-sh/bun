// A CommonJS file puts a function in place of `module.exports`. A module calls it as `default` of the namespace of the file, so the namespace is its `this`.
import * as file from "./file.cjs";

console.log(file.default());
