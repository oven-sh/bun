// The line is that of Node.js and `bun build --compile`. `bun <file>` reads the texts on other threads, and some of its runs print another order, or a ReferenceError.
const ran = [], settled = [];
globalThis.say = word => ran.push(word);
const note = (name, call) => call.then(() => settled.push(name + "+"), error => settled.push(name + "!" + error.name));
Promise.all([note("pages", import("./pages.mjs")), note("menu", import("./menu.mjs"))]).then(() => {
  console.log("ran: " + ran.join(" "));
  console.log("settled: " + settled.sort().join(" "));
});
/* Output:
ran: layout theme:F pages:T menu:T
settled: menu+ pages+
*/
