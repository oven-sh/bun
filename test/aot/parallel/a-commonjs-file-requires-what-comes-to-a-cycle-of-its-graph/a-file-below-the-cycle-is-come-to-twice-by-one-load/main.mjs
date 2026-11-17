// The lines are those of `bun <file>`, in 24 of 24 runs. It reads the texts on other threads, and on a busy machine some of its runs print another order.
// Each module has a state of its own in the loader, and each state goes through all that is still new below its module. The state of pages.mjs comes to parts.cjs a second time, finds its text at hand and makes it there and then:
// parts.cjs runs in that step, and what it requires ends inside its require while pages.mjs and layout.mjs wait.
import "./tools.cjs";
console.log("main");
/* Output:
tools<
parts<
menu
parts>
pages
layout
tools>
main
*/
