// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
import tools from "./tools.cjs";
import { seen } from "./pages.mjs";
console.log("main: " + seen + " " + tools.ready);
/* Output:
tools<
layout
pages
main: 6 undefined
menu
tools>
*/
