// nothing throws: the names of a CommonJS file under an import statement, read by a function that the file handed out
import { show } from "./inner.cjs";
console.log(show(), globalThis.again().value);
