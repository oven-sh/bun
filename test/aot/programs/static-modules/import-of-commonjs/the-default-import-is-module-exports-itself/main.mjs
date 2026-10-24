// The default import of a CommonJS file is `module.exports` itself.
import a from "./a.cjs";
a.a = 9;
console.log(a === require("./a.cjs"), a.read());
