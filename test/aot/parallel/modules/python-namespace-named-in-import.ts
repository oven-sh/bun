// `bun:python` is refused when the program is built.
import python from "bun:python";
console.log(typeof python.import);
/* Build errors:
error: TS100164: --aot does not support Python yet: "bun:python" cannot be imported by a compiled program
*/
