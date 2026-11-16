// The line is that of `bun <file>`, in 15 of 16 runs: the graph of menu.mjs runs first here and enters the cycle at layout.mjs, so pages.mjs calls frame() ahead of the declaration of width. `bun build --compile` prints 6, and so did the other run of `bun <file>`.
import { seen } from "./pages.mjs";
import tools from "./tools.cjs";
console.log("main: " + seen);
/* Output:
main: ReferenceError
*/
