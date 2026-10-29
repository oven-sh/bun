// lib.cjs reads `.default` of a required JSON file. require() answers the parsed value, which has no such member, as in Node and in `bun build --compile`.
// `bun run` prints { another: 2 }: there require() answers the namespace object, because main.mjs imports the same file.
const later = await import("./barrel.mjs");
import below from "./inner.json";
try {
  console.log("it is", later)} catch (error) {
}
/* Output:
it is Module {
  default: undefined,
}
*/
