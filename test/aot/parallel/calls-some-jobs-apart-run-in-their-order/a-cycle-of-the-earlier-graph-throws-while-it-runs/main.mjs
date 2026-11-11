// The lines are those of `bun <file>` and Node.js: a module that imports into a cycle that has failed fails with it. `bun build --compile` runs menu.mjs all the same.
const ran = [], settled = [];
globalThis.say = word => ran.push(word);
const note = (name, call) => call.then(() => settled.push(name + "+"), () => settled.push(name + "!"));
const soon = () => new Promise(done => setTimeout(done, 30));
note("pages", import("./pages.mjs"));
await null; await null; await null;
note("menu", import("./menu.mjs"));
await null;
note("alone", import("./alone.mjs"));
await soon();
console.log("ran: " + ran.sort().join(" "));
console.log("settled: " + settled.sort().join(" "));
/* Output:
ran: alone layout pages
settled: alone+ menu! pages!
*/
