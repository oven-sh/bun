// The lines are those of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and on a busy machine some of its runs print another order.
// In which order the three calls settle differs between the references, and from run to run of `bun <file>`. In which order the files run does not.
const ran = [];
globalThis.say = word => ran.push(word);
const first = import("./pages.mjs");
await null; await null; await null;
const second = import("./layout.mjs");
await null; await null; await null;
const third = import("./menu.mjs");
await Promise.all([first, second, third]);
console.log("ran: " + ran.join(" "));
/* Output:
ran: layout menu pages
*/
