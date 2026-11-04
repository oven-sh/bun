// A required module calls import() of a CommonJS file. The file requires an ES module, which calls import() of the file, and throws.
// The call waits for the file, so what the file throws reaches the require() and the call, as in node. `bun run` takes the steps of the call inside the require() and loses the error.
import "./first.cjs";
/* Output:
module: rejected thrown by the file
second: rejected thrown by the file
*/
