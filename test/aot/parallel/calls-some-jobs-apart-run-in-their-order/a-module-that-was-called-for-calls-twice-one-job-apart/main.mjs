// The lines are those of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and on a busy machine some of its runs print another order.
globalThis.line = [];
await import("./shell.mjs");
console.log(line.join(" "));
/* Output:
right left:E left+ right+
*/
