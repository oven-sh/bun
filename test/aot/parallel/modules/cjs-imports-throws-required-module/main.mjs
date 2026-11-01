// A required module imports a CommonJS file. The file calls import() of itself and throws.
// The call waits for the file, so what the file throws reaches the require() and the call, as in node. `bun run` takes the steps of the call inside the require() and loses the error.
import "./first.cjs";
/* Output:
first: require threw thrown by the file
file: rejected thrown by the file
*/
