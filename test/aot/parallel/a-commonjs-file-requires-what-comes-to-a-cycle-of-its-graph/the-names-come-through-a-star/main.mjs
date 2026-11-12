// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
import { seen } from "./pages.mjs";
import tools from "./tools.cjs";
console.log("main: " + seen + " " + tools.ready);
/* Output:
tools<
layout
all
pages
main: 6 undefined
menu
tools>
*/
