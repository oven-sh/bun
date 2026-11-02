// require() runs a module that no name finds. A text in that module calls import() on a second entry point. Plain Bun runs the steps of the loader before the require() returns, so the entry point runs before the line behind the require().
// Entry points: ./other-entry.mjs
// Todo: The executable runs other-entry.mjs when main.mjs has ended. With no import() to see, the build makes the require() of required.mjs a call of the module, and a call opens no queue for the steps of the loader.
require("./required.mjs");
console.log("main ends");
export {};
