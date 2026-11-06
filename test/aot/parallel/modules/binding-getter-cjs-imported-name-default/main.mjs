// A CommonJS file defines getters that return bindings of its top level, as TypeScript writes them. A module imports the names and, beside them,
// the default, which it looks at as a whole.
import file, { number, greet, Kind } from "./file.cjs";

console.log(file, number, greet(), new Kind().name);
console.log(Object.keys(file).join(), file.number === number, file.greet === greet);
