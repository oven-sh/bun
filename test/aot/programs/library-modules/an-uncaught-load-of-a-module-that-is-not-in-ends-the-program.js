// Nothing catches the error of require(name) for a module that is not in the executable: the program ends with exit code 1 and the message of the page. Plain Bun finds the module and goes on.
import "node:path";

console.log("before");
require(process.env.NAME);
console.log("after");
