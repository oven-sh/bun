// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
// menu.mjs is new to the loader and imports pages.mjs, whose text is on its way. The load of menu.mjs still ends one step ahead of the load of the entry: the cycle is entered at pages.mjs, from menu.mjs.
import "./tools.cjs";
import "./pages.mjs";
console.log("main");
/* Output:
tools<
main
pages
menu
tools>
*/
