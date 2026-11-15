// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
// The entry has asked for pages.mjs already; its text is on its way when tools.cjs requires it. That load ends ahead of the load of the entry, so the cycle is entered at pages.mjs: main runs first.
import "./tools.cjs";
import "./pages.mjs";
console.log("main");
/* Output:
tools<
main
pages
tools>
*/
