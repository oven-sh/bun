// What pages.mjs sees is what it sees in `bun build --compile`. In `bun <file>` the graph of menu.mjs runs first here and enters the cycle at layout.mjs: ReferenceError.
import { seen } from "./pages.mjs";
import tools from "./tools.cjs";
console.log("main: " + seen);
/* Output:
main: 6
*/
