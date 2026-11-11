// The lines are those of `bun <file>`. It reads the texts on other threads, and on a busy machine some of its runs print another order.
const site = await import("./site.mjs");
console.log("main: " + site.told);
/* Output:
tools<
layout
pages
site
menu
tools>
main: 6
*/
