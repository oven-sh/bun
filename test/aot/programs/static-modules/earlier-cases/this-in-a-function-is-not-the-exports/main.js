// `this` in a function of a CommonJS file is not the exports object; in an arrow at the top it is.
require("./nested"); require("./arrow"); require("./typed");
console.log(globalThis.fromNested); console.log(globalThis.fromArrow); console.log(globalThis.fromTyped);
