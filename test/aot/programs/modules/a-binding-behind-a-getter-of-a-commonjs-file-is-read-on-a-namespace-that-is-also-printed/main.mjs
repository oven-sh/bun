// A CommonJS file defines a getter that returns a binding of its top level. A module reads the name on the namespace of the file, under a dot and
// under a written key, and prints the namespace.
import * as file from "./file.cjs";

console.log(file.number, file["number"], file);
console.log(Object.keys(file).join(), file.default.number);
