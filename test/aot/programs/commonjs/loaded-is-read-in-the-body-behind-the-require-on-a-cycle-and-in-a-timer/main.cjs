// Loaded is read in the body behind the require on a cycle and in a timer.
console.log("main in body", module.loaded);
const a = require("./a.cjs");
console.log("a behind its require", a.loaded(), a.inBody, a.seenByB);
setTimeout(() => console.log("main later", module.loaded, require.main.loaded, a.mainLoaded()), 0);
