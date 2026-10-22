// A pattern on require() of a module that is half done copies what is there at that moment: a name that is not stored yet gives undefined, or the default of the pattern, and stays so. The same pattern in a function that runs later finds the value.
const b = require("./b.cjs");
console.log(b.saw, b.again());
