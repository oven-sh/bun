// The lines are those of `bun <file>`, in 22 of 24 runs. It reads the texts on other threads, and on a busy machine some of its runs print another order.
// menu.mjs and layout.mjs are new to the loader; each costs the load for the require two steps. The load of the entry ends one step ahead of it, so the cycle is entered at the entry: pages runs first. In the other 2 runs main runs first.
import "./tools.cjs";
import "./pages.mjs";
console.log("main");
/* Output:
tools<
pages
main
layout
menu
tools>
*/
