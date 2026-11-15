// The lines are those of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and on a busy machine some of its runs print another order.
const ran = [], settled = [];
globalThis.say = word => ran.push(word);
const note = (name, call) => call.then(() => settled.push(name + "+"), error => settled.push(name + "!" + error.name));
const first = note("pages", import("./pages.mjs"));
await null; await null; await null; await null; await null; await null; 
const second = note("layout", import("./layout.mjs"));
await Promise.all([first, second]);
console.log("ran: " + ran.join(" "));
console.log("settled: " + settled.join(" "));
/* Output:
ran: layout pages
settled: pages+ layout+
*/
