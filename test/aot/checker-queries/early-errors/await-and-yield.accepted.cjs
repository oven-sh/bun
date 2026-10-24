// In sloppy mode code, outside of async functions and generators, await and yield are names.
function f() { var await; var yield; }
function f(await, yield) {}
var yield = 1; yield;
